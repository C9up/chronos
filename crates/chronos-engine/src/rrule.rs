//! RFC 5545 recurrence expansion (RRULE).
//!
//! The iteration is the one rrule.js inherited from python-dateutil: one period
//! at a time, day masks rebuilt once per year, and a time set built from the
//! BYHOUR/BYMINUTE/BYSECOND sets. Every bound is enforced here, before anything
//! is allocated or iterated, because the two ways an expansion can hurt the host
//! are both out of reach of `catch_unwind`: an allocation failure aborts the
//! process, and a long loop freezes the JavaScript thread that called it.
//!
//! - BY* lists are sets (RFC 5545 §3.3.10): sorted, deduplicated and
//!   range-checked, so none is longer than its domain, and the rule text itself
//!   is capped.
//! - Candidates are never materialised per period: days are walked in order and
//!   occurrences are emitted until the count, the limit or UNTIL is reached.
//! - Iteration stops after year 9999, like rrule.js, and empty stretches are
//!   skipped by scanning the per-year day mask instead of stepping period by
//!   period, so an unsatisfiable rule answers `[]` quickly.
//! - A step budget turns what is left (a sub-daily rule whose interval almost
//!   never meets its BY* parts) into an error instead of a frozen thread.

//!
//! Instants are UTC wall clocks ([`DateTime`]), dates are counted as days from
//! 1970-01-01 where the iteration needs arithmetic on them, and the days a
//! year's mask runs into the next one are simply not candidates past
//! 9999-12-31.

use jiff::civil::{Date, DateTime, Time};
use jiff::tz::TimeZone;
use jiff::SignedDuration;

use crate::{
    clock_text, fix_offset, local_clock, local_time, lookup_zone, offset_seconds_at, parse_iso,
    to_iso, LocalTime,
};

const MAX_YEAR: i32 = 9999;
/// Longest rule text accepted. Every BY* list fits well inside it once written
/// without repetition (BYYEARDAY with all 732 values is about 3.3 KB).
pub const MAX_RULE_LEN: usize = 8 * 1024;
/// The whole text, EXDATE and RDATE lines included: a series of a few years
/// keeps hundreds of exceptions, which the rule's own cap must not refuse.
pub const MAX_TEXT_LEN: usize = 256 * 1024;
/// EXDATE and RDATE values, all lines together.
pub const MAX_DATES: usize = 10_000;
/// Most occurrences one call returns.
pub const MAX_OCCURRENCES: usize = 10_000;
/// Iteration steps allowed per call (periods for YEARLY/MONTHLY/WEEKLY, lattice
/// points for DAILY and finer). Reaching it takes about 70 ms in a release
/// build (the rule in `a_rule_that_never_meets_its_lattice_stops_at_the_step_budget`);
/// a rule that needs more almost never meets its BY* parts.
const STEP_BUDGET: u64 = 3_000_000;
const SECONDS_PER_DAY: i64 = 86_400;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Freq {
    Yearly,
    Monthly,
    Weekly,
    Daily,
    Hourly,
    Minutely,
    Secondly,
}

#[derive(Clone, Copy, Debug)]
enum Until {
    /// `YYYYMMDDTHHMMSSZ` or an RFC 3339 instant, as its UTC wall clock.
    Instant(DateTime),
    /// `YYYYMMDDTHHMMSS`: a wall-clock time in the rule's zone.
    Local(DateTime),
    /// `YYYYMMDD`: every occurrence on that date is included.
    Date(Date),
}

#[derive(Default)]
struct RawRule {
    freq: Option<Freq>,
    interval: Option<i64>,
    wkst: Option<u32>,
    count: Option<u64>,
    until: Option<Until>,
    bymonth: Option<Vec<i64>>,
    byweekno: Option<Vec<i64>>,
    byyearday: Option<Vec<i64>>,
    bymonthday: Option<Vec<i64>>,
    byday: Option<Vec<(Option<i64>, u32)>>,
    byhour: Option<Vec<i64>>,
    byminute: Option<Vec<i64>>,
    bysecond: Option<Vec<i64>>,
    bysetpos: Option<Vec<i64>>,
}

struct DtStartLine {
    value: DateTime,
    utc: bool,
    tzid: Option<TimeZone>,
}

/// One `EXDATE` or `RDATE` line: its date-times, and the zone they are read in.
struct DateListLine {
    values: Vec<(DateTime, bool)>,
    tzid: Option<TimeZone>,
}

/// What a rule text holds: the rule, its start if it names one, and the
/// date-times it removes (EXDATE) and adds (RDATE).
struct Parsed {
    rule: RawRule,
    dtstart: Option<DtStartLine>,
    exdates: Vec<DateListLine>,
    rdates: Vec<DateListLine>,
}

struct Rule {
    freq: Freq,
    interval: i64,
    /// 0 = Monday.
    wkst: u32,
    count: Option<u64>,
    until: Option<Until>,
    /// Bit n set = month n.
    bymonth: u16,
    byweekno: Vec<i32>,
    byyearday: Vec<i32>,
    /// Bit d set = day d of the month.
    bymonthday: u32,
    /// Bit d set = day -d of the month.
    bynmonthday: u32,
    /// Bit w set = weekday w (0 = Monday).
    byweekday: u8,
    bynweekday: Vec<(u32, i32)>,
    /// A BYDAY ordinal was given, even if none of them can ever match.
    has_nweekday: bool,
    byhour: Vec<u32>,
    byminute: Vec<u32>,
    bysecond: Vec<u32>,
    bysetpos: Vec<i32>,
}

impl Rule {
    fn has_byday(&self) -> bool {
        self.byweekday != 0 || self.has_nweekday
    }
}

/// Expand a recurrence.
///
/// `start_iso` is the first instant (DTSTART) and `rrule` the rule text, an
/// `RRULE:` line, a bare rule, or a `DTSTART[;TZID=…]:…` line followed by the
/// rule — in which case `start_iso` must be `None`. With a zone (`tzid`, or the
/// DTSTART's TZID), the rule runs on that zone's wall clock, so a 09:00 series
/// stays at 09:00 across DST; occurrences are returned as UTC instants.
pub fn expand(
    start_iso: Option<&str>,
    rrule: &str,
    limit: usize,
    tzid: Option<&str>,
) -> Result<Vec<String>, String> {
    if rrule.len() > MAX_TEXT_LEN {
        return Err(format!(
            "The rule text is {} bytes long; the limit is {} bytes",
            rrule.len(),
            MAX_TEXT_LEN
        ));
    }
    let option_zone = match tzid {
        Some(name) => Some(parse_zone(name)?),
        None => None,
    };
    let Parsed {
        rule: raw,
        dtstart: dtstart_line,
        exdates,
        rdates,
    } = parse_text(rrule)?;

    let (dtstart, zone) = match (start_iso, dtstart_line) {
        (Some(_), Some(_)) => {
            return Err(
                "DTSTART is given twice: as the start argument and in the rule text".to_string(),
            )
        }
        (None, None) => {
            return Err("RRULE has no start: pass one or add a DTSTART line".to_string())
        }
        (Some(iso), None) => {
            let instant = parse_iso(iso)?;
            let local = match &option_zone {
                Some(tz) => local_clock(tz, instant),
                None => Some(instant),
            };
            (local, option_zone)
        }
        (None, Some(line)) => {
            let zone = match (line.tzid, option_zone) {
                (Some(a), Some(b)) if a.iana_name() != b.iana_name() => {
                    return Err(format!(
                        "DTSTART names the zone {} but the tzid option is {}",
                        a.iana_name().unwrap_or_default(),
                        b.iana_name().unwrap_or_default()
                    ))
                }
                (Some(a), _) => Some(a),
                (None, b) => b,
            };
            let local = match (line.utc, &zone) {
                (true, Some(tz)) => local_clock(tz, line.value),
                _ => Some(line.value),
            };
            (local, zone)
        }
    };
    // A start whose wall clock no value holds is one in year 10000: the UTC
    // start is at most 9999-12-31 and an offset is less than a day.
    let year = dtstart.map_or(MAX_YEAR + 1, |d| i32::from(d.year()));
    let dtstart = match dtstart {
        Some(d) if (0..=MAX_YEAR).contains(&year) => d,
        _ => return Err(format!("RRULE start year {} is outside 0000-9999", year)),
    };

    let rule = normalize(raw, dtstart)?;
    let limit = if limit == 0 {
        100
    } else {
        limit.min(MAX_OCCURRENCES)
    };
    let excluded = resolve_dates(&exdates, zone.as_ref(), "EXDATE")?;
    let added = resolve_dates(&rdates, zone.as_ref(), "RDATE")?;
    let mut expander = Expander {
        rule: &rule,
        dtstart,
        zone,
        // Enough of the rule's own occurrences that, every EXDATE removed,
        // `limit` of the set are still there.
        limit: limit + excluded.len(),
        remaining: rule.count,
        out: Vec::new(),
        last: None,
        steps: 0,
        year: None,
    };
    if rule.count != Some(0) {
        match rule.freq {
            Freq::Yearly | Freq::Monthly | Freq::Weekly => expander.run_periods()?,
            Freq::Daily | Freq::Hourly | Freq::Minutely | Freq::Secondly => {
                expander.run_lattice()?
            }
        }
    }
    // RFC 5545 §3.8.5: the set is the rule's occurrences and the RDATEs,
    // without the EXDATEs — which remove an RDATE as well. COUNT and UNTIL
    // bound the rule alone.
    let mut set: Vec<DateTime> = expander
        .out
        .into_iter()
        .chain(added)
        .filter(|instant| !excluded.contains(instant))
        .collect();
    set.sort_unstable();
    set.dedup();
    set.truncate(limit);
    Ok(set.into_iter().map(to_iso).collect())
}

/// The instants a list of EXDATE or RDATE lines names: a UTC value as it is,
/// a floating one on its line's zone, or the rule's, or UTC.
fn resolve_dates(
    lines: &[DateListLine],
    zone: Option<&TimeZone>,
    property: &str,
) -> Result<std::collections::BTreeSet<DateTime>, String> {
    let mut out = std::collections::BTreeSet::new();
    for line in lines {
        for &(value, utc) in &line.values {
            let instant = if utc {
                Some(value)
            } else {
                resolve(line.tzid.as_ref().or(zone), value)
            };
            out.insert(
                instant.ok_or_else(|| {
                    format!("Cannot resolve the {} {}", property, clock_text(value))
                })?,
            );
        }
    }
    Ok(out)
}

/// The instant a wall-clock time names in a zone: RFC 5545 §3.3.5 takes the
/// first of two ambiguous times, and reads a time that does not exist with
/// the offset in force before the gap (02:30 becomes 03:30).
fn resolve(zone: Option<&TimeZone>, local: DateTime) -> Option<DateTime> {
    match zone {
        None => Some(local),
        Some(tz) => match local_time(tz, local) {
            LocalTime::Single(utc) | LocalTime::Ambiguous(utc) => Some(utc),
            LocalTime::Gap => {
                let guess = offset_seconds_at(tz, local);
                fix_offset(local, guess, tz)
            }
        },
    }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

fn parse_zone(name: &str) -> Result<TimeZone, String> {
    lookup_zone(name.trim()).ok_or_else(|| format!("Unknown IANA timezone: '{}'", name))
}

fn parse_text(text: &str) -> Result<Parsed, String> {
    let mut rule: Option<RawRule> = None;
    let mut dtstart: Option<DtStartLine> = None;
    let mut exdates: Vec<DateListLine> = Vec::new();
    let mut rdates: Vec<DateListLine> = Vec::new();
    let mut dates = 0usize;

    for line in text.split(['\n', '\r']) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let header_end = line.find([':', ';', '=']);
        let header = match header_end {
            Some(at) if line.as_bytes()[at] != b'=' => Some(&line[..at]),
            _ => None,
        };
        let body = match header {
            Some(name) if name.eq_ignore_ascii_case("DTSTART") => {
                if dtstart.is_some() {
                    return Err("DTSTART appears twice".to_string());
                }
                dtstart = Some(parse_dtstart(&line[name.len()..])?);
                continue;
            }
            Some(name)
                if name.eq_ignore_ascii_case("EXDATE") || name.eq_ignore_ascii_case("RDATE") =>
            {
                let list = parse_date_list(name, &line[name.len()..])?;
                dates += list.values.len();
                if dates > MAX_DATES {
                    return Err(format!(
                        "EXDATE and RDATE name more than {} date-times",
                        MAX_DATES
                    ));
                }
                if name.eq_ignore_ascii_case("EXDATE") {
                    exdates.push(list);
                } else {
                    rdates.push(list);
                }
                continue;
            }
            Some(name) if name.eq_ignore_ascii_case("RRULE") => {
                let rest = &line[name.len()..];
                rest.strip_prefix(':')
                    .ok_or_else(|| format!("Invalid RRULE line: {}", line))?
            }
            Some(name) => {
                return Err(format!(
                    "Unsupported property '{}': only DTSTART, RRULE, EXDATE and RDATE are expanded",
                    name
                ))
            }
            // `get` rather than `[..8]`: byte 8 of hostile text can sit inside
            // a multi-byte character, where a slice panics.
            None if line
                .get(..8)
                .is_some_and(|head| head.eq_ignore_ascii_case("DTSTART=")) =>
            {
                if dtstart.is_some() {
                    return Err("DTSTART appears twice".to_string());
                }
                dtstart = Some(parse_dtstart(&line[7..])?);
                continue;
            }
            None => line,
        };
        if rule.is_some() {
            return Err("Only one RRULE can be expanded at a time".to_string());
        }
        // The rule itself keeps its own cap: only the date lists may be long.
        if body.len() > MAX_RULE_LEN {
            return Err(format!(
                "RRULE is {} bytes long; the limit is {} bytes",
                body.len(),
                MAX_RULE_LEN
            ));
        }
        rule = Some(parse_rule_body(body)?);
    }

    let rule = rule.ok_or_else(|| "RRULE missing FREQ".to_string())?;
    Ok(Parsed {
        rule,
        dtstart,
        exdates,
        rdates,
    })
}

/// `;TZID=Europe/Zurich:20261224T090000,20261231T090000`, `:20261224T080000Z`.
/// Date-times only: a `VALUE=DATE` list would name days of a series of
/// times, which RFC 5545 forbids, and an RDATE `PERIOD` is not an occurrence.
fn parse_date_list(property: &str, rest: &str) -> Result<DateListLine, String> {
    let at = rest
        .find(':')
        .ok_or_else(|| format!("Invalid {}: {}{}", property, property, rest))?;
    let (params, values) = (&rest[..at], &rest[at + 1..]);
    let mut tzid = None;
    for param in params.split(';').filter(|p| !p.is_empty()) {
        let (key, val) = param
            .split_once('=')
            .ok_or_else(|| format!("Invalid {} parameter: {}", property, param))?;
        if key.eq_ignore_ascii_case("TZID") {
            tzid = Some(parse_zone(val.trim_matches('"'))?);
        } else if key.eq_ignore_ascii_case("VALUE") {
            if !val.eq_ignore_ascii_case("DATE-TIME") {
                return Err(format!(
                    "{} VALUE={} is not supported: give the date-time of each occurrence",
                    property, val
                ));
            }
        } else {
            return Err(format!("Unsupported {} parameter: {}", property, key));
        }
    }
    let mut out = Vec::new();
    for value in values.split(',').map(str::trim) {
        let (naive, utc) = match parse_basic_datetime(value) {
            Some(parsed) if value.len() > 8 => parsed,
            _ => return Err(format!("Invalid {} value: {}", property, value)),
        };
        if utc && tzid.is_some() {
            return Err(format!(
                "{} cannot carry both a TZID and a UTC 'Z' value",
                property
            ));
        }
        out.push((naive, utc));
    }
    Ok(DateListLine { values: out, tzid })
}

/// `;TZID=Europe/Paris:20260323T090000`, `:20260323T080000Z`, `=20260323`…
fn parse_dtstart(rest: &str) -> Result<DtStartLine, String> {
    let (params, value) = if let Some(value) = rest.strip_prefix('=') {
        ("", value)
    } else {
        let at = rest
            .find(':')
            .ok_or_else(|| format!("Invalid DTSTART: DTSTART{}", rest))?;
        (&rest[..at], &rest[at + 1..])
    };
    let mut tzid = None;
    for param in params.split(';').filter(|p| !p.is_empty()) {
        let (key, val) = param
            .split_once('=')
            .ok_or_else(|| format!("Invalid DTSTART parameter: {}", param))?;
        if key.eq_ignore_ascii_case("TZID") {
            tzid = Some(parse_zone(val.trim_matches('"'))?);
        } else if key.eq_ignore_ascii_case("VALUE") {
            if !val.eq_ignore_ascii_case("DATE") && !val.eq_ignore_ascii_case("DATE-TIME") {
                return Err(format!("Invalid DTSTART VALUE: {}", val));
            }
        } else {
            return Err(format!("Unsupported DTSTART parameter: {}", key));
        }
    }
    let value = value.trim();
    let (naive, utc) =
        parse_basic_datetime(value).ok_or_else(|| format!("Invalid DTSTART value: {}", value))?;
    if utc && tzid.is_some() {
        return Err("DTSTART cannot carry both a TZID and a UTC 'Z' value".to_string());
    }
    Ok(DtStartLine {
        value: naive,
        utc,
        tzid,
    })
}

/// RFC 5545 basic form: `YYYYMMDD`, `YYYYMMDDTHHMMSS` or `YYYYMMDDTHHMMSSZ`.
/// Returns the wall-clock value and whether it was UTC.
fn parse_basic_datetime(value: &str) -> Option<(DateTime, bool)> {
    let bytes = value.as_bytes();
    let digits = |range: std::ops::Range<usize>| -> Option<i16> {
        let slice = bytes.get(range)?;
        if !slice.iter().all(u8::is_ascii_digit) {
            return None;
        }
        slice
            .iter()
            .try_fold(0i16, |acc, b| Some(acc * 10 + i16::from(b - b'0')))
    };
    let pair = |range: std::ops::Range<usize>| -> Option<i8> { i8::try_from(digits(range)?).ok() };
    let date = Date::new(digits(0..4)?, pair(4..6)?, pair(6..8)?).ok()?;
    match bytes.len() {
        8 => Some((date.to_datetime(Time::midnight()), false)),
        15 | 16 => {
            if bytes[8] != b'T' && bytes[8] != b't' {
                return None;
            }
            let utc = match bytes.get(15) {
                None => false,
                Some(b'Z') | Some(b'z') => true,
                Some(_) => return None,
            };
            let time = Time::new(pair(9..11)?, pair(11..13)?, pair(13..15)?, 0).ok()?;
            Some((date.to_datetime(time), utc))
        }
        _ => None,
    }
}

fn parse_until(value: &str) -> Result<Until, String> {
    if let Some((naive, utc)) = parse_basic_datetime(value) {
        return Ok(if value.len() == 8 {
            Until::Date(naive.date())
        } else if utc {
            Until::Instant(naive)
        } else {
            Until::Local(naive)
        });
    }
    // RFC 3339, which chronos accepted before the RFC 5545 forms.
    parse_iso(value)
        .map(Until::Instant)
        .map_err(|_| format!("Invalid UNTIL value: {}", value))
}

fn set_once<T>(slot: &mut Option<T>, value: T, key: &str) -> Result<(), String> {
    if slot.is_some() {
        return Err(format!("RRULE property {} appears twice", key));
    }
    *slot = Some(value);
    Ok(())
}

fn parse_int(token: &str, key: &str) -> Result<i64, String> {
    let t = token.trim();
    let digits = t.strip_prefix(['+', '-']).unwrap_or(t);
    if digits.is_empty() || digits.len() > 10 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("Invalid {} value: '{}'", key, token));
    }
    t.parse::<i64>()
        .map_err(|_| format!("Invalid {} value: '{}'", key, token))
}

fn parse_int_list(value: &str, key: &str) -> Result<Vec<i64>, String> {
    value.split(',').map(|t| parse_int(t, key)).collect()
}

fn parse_weekday(input: &str) -> Result<u32, String> {
    match input.trim().to_ascii_uppercase().as_str() {
        "MO" => Ok(0),
        "TU" => Ok(1),
        "WE" => Ok(2),
        "TH" => Ok(3),
        "FR" => Ok(4),
        "SA" => Ok(5),
        "SU" => Ok(6),
        _ => Err(format!("Invalid weekday: '{}'", input)),
    }
}

fn parse_byday_token(input: &str) -> Result<(Option<i64>, u32), String> {
    let t = input.trim();
    if t.len() < 2 || !t.is_ascii() {
        return Err(format!("Invalid BYDAY value: '{}'", input));
    }
    let (prefix, day) = t.split_at(t.len() - 2);
    let weekday = parse_weekday(day).map_err(|_| format!("Invalid BYDAY value: '{}'", input))?;
    if prefix.is_empty() {
        return Ok((None, weekday));
    }
    let digits = prefix.strip_prefix(['+', '-']).unwrap_or(prefix);
    if digits.is_empty() || digits.len() > 2 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("Invalid BYDAY value: '{}'", input));
    }
    let n = prefix
        .parse::<i64>()
        .map_err(|_| format!("Invalid BYDAY value: '{}'", input))?;
    if n == 0 || !(-53..=53).contains(&n) {
        return Err(format!("BYDAY ordinal out of range: '{}'", input));
    }
    Ok((Some(n), weekday))
}

fn parse_rule_body(body: &str) -> Result<RawRule, String> {
    let mut raw = RawRule::default();
    for part in body.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (key, value) = part
            .split_once('=')
            .ok_or_else(|| format!("Invalid RRULE part '{}': expected KEY=VALUE", part))?;
        let key = key.trim().to_ascii_uppercase();
        let value = value.trim();
        match key.as_str() {
            "FREQ" => {
                let freq = match value.to_ascii_uppercase().as_str() {
                    "SECONDLY" => Freq::Secondly,
                    "MINUTELY" => Freq::Minutely,
                    "HOURLY" => Freq::Hourly,
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    other => return Err(format!("Unsupported FREQ: {}", other)),
                };
                set_once(&mut raw.freq, freq, "FREQ")?;
            }
            "INTERVAL" => set_once(&mut raw.interval, parse_int(value, "INTERVAL")?, "INTERVAL")?,
            "COUNT" => set_once(&mut raw.count, parse_count(value)?, "COUNT")?,
            "UNTIL" => set_once(&mut raw.until, parse_until(value)?, "UNTIL")?,
            "WKST" => set_once(&mut raw.wkst, parse_weekday(value)?, "WKST")?,
            "BYDAY" => {
                let days = value
                    .split(',')
                    .map(parse_byday_token)
                    .collect::<Result<Vec<_>, _>>()?;
                set_once(&mut raw.byday, days, "BYDAY")?;
            }
            "BYMONTH" => set_once(
                &mut raw.bymonth,
                parse_int_list(value, "BYMONTH")?,
                "BYMONTH",
            )?,
            "BYWEEKNO" => set_once(
                &mut raw.byweekno,
                parse_int_list(value, "BYWEEKNO")?,
                "BYWEEKNO",
            )?,
            "BYYEARDAY" => set_once(
                &mut raw.byyearday,
                parse_int_list(value, "BYYEARDAY")?,
                "BYYEARDAY",
            )?,
            "BYMONTHDAY" => set_once(
                &mut raw.bymonthday,
                parse_int_list(value, "BYMONTHDAY")?,
                "BYMONTHDAY",
            )?,
            "BYHOUR" => set_once(&mut raw.byhour, parse_int_list(value, "BYHOUR")?, "BYHOUR")?,
            "BYMINUTE" => set_once(
                &mut raw.byminute,
                parse_int_list(value, "BYMINUTE")?,
                "BYMINUTE",
            )?,
            "BYSECOND" => set_once(
                &mut raw.bysecond,
                parse_int_list(value, "BYSECOND")?,
                "BYSECOND",
            )?,
            "BYSETPOS" => set_once(
                &mut raw.bysetpos,
                parse_int_list(value, "BYSETPOS")?,
                "BYSETPOS",
            )?,
            other => return Err(format!("Unknown RRULE property '{}'", other)),
        }
    }
    Ok(raw)
}

fn parse_count(value: &str) -> Result<u64, String> {
    let n = parse_int(value, "COUNT")?;
    u64::try_from(n).map_err(|_| format!("Invalid COUNT value: '{}'", value))
}

/// Range-check a list, then make it the set RFC 5545 says it is.
fn checked_set(
    values: Option<Vec<i64>>,
    key: &str,
    min: i64,
    max: i64,
    allow_zero: bool,
) -> Result<Vec<i32>, String> {
    let mut out = Vec::new();
    for v in values.unwrap_or_default() {
        if v < min || v > max || (v == 0 && !allow_zero) {
            return Err(format!("{} value {} is out of range", key, v));
        }
        // In range of an i32 by the check above.
        out.push(v as i32);
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

fn normalize(raw: RawRule, dtstart: DateTime) -> Result<Rule, String> {
    let freq = raw.freq.ok_or_else(|| "RRULE missing FREQ".to_string())?;
    let interval = raw.interval.unwrap_or(1);
    if interval < 1 {
        return Err("INTERVAL must be >= 1".to_string());
    }

    let mut bymonth = checked_set(raw.bymonth, "BYMONTH", 1, 12, false)?;
    let byweekno = checked_set(raw.byweekno, "BYWEEKNO", -53, 53, false)?;
    let byyearday = checked_set(raw.byyearday, "BYYEARDAY", -366, 366, false)?;
    let mut bymonthday = checked_set(raw.bymonthday, "BYMONTHDAY", -31, 31, false)?;
    let bysetpos = checked_set(raw.bysetpos, "BYSETPOS", -366, 366, false)?;
    let byhour = checked_set(raw.byhour, "BYHOUR", 0, 23, true)?;
    let byminute = checked_set(raw.byminute, "BYMINUTE", 0, 59, true)?;
    let bysecond = checked_set(raw.bysecond, "BYSECOND", 0, 59, true)?;
    let mut byday = raw.byday.unwrap_or_default();

    // RFC 5545: what the rule leaves out comes from DTSTART. Without one of
    // these parts, MONTHLY would otherwise mean every day of the month.
    if byweekno.is_empty() && byyearday.is_empty() && bymonthday.is_empty() && byday.is_empty() {
        match freq {
            Freq::Yearly => {
                if bymonth.is_empty() {
                    bymonth = vec![i32::from(dtstart.month())];
                }
                bymonthday = vec![i32::from(dtstart.day())];
            }
            Freq::Monthly => bymonthday = vec![i32::from(dtstart.day())],
            Freq::Weekly => byday = vec![(None, weekday_index(dtstart.date()))],
            _ => {}
        }
    }

    // An ordinal only means something for MONTHLY and YEARLY; finer
    // frequencies read the weekday alone (rrule.js and dateutil do the same).
    let mut byweekday = 0u8;
    let mut bynweekday: Vec<(u32, i32)> = Vec::new();
    let mut has_nweekday = false;
    // Within a month a weekday occurs at most 5 times, so a larger ordinal can
    // never match there; dropping it keeps the per-year work bounded.
    let month_scoped = freq == Freq::Monthly || (freq == Freq::Yearly && !bymonth.is_empty());
    for (n, weekday) in byday {
        match n {
            Some(n) if freq <= Freq::Monthly => {
                has_nweekday = true;
                // n is within -53..=53 from parsing.
                let n = n as i32;
                if !month_scoped || n.abs() <= 5 {
                    bynweekday.push((weekday, n));
                }
            }
            _ => byweekday |= 1 << weekday,
        }
    }
    bynweekday.sort_unstable();
    bynweekday.dedup();

    let mut monthday_mask = 0u32;
    let mut nmonthday_mask = 0u32;
    for d in bymonthday {
        if d > 0 {
            monthday_mask |= 1 << d;
        } else {
            nmonthday_mask |= 1 << (-d);
        }
    }
    let month_mask = bymonth.iter().fold(0u16, |m, v| m | (1 << v));

    let as_u32 = |v: Vec<i32>| -> Vec<u32> { v.into_iter().map(|x| x as u32).collect() };
    let mut byhour = as_u32(byhour);
    let mut byminute = as_u32(byminute);
    let mut bysecond = as_u32(bysecond);
    if byhour.is_empty() && freq < Freq::Hourly {
        byhour = vec![clock_field(dtstart.hour())];
    }
    if byminute.is_empty() && freq < Freq::Minutely {
        byminute = vec![clock_field(dtstart.minute())];
    }
    if bysecond.is_empty() && freq < Freq::Secondly {
        bysecond = vec![clock_field(dtstart.second())];
    }

    Ok(Rule {
        freq,
        interval,
        wkst: raw.wkst.unwrap_or(0),
        count: raw.count,
        until: raw.until,
        bymonth: month_mask,
        byweekno,
        byyearday,
        bymonthday: monthday_mask,
        bynmonthday: nmonthday_mask,
        byweekday,
        bynweekday,
        has_nweekday,
        byhour,
        byminute,
        bysecond,
        bysetpos,
    })
}

// ─── Per-year day masks ─────────────────────────────────────────────────────

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn year_len(year: i32) -> i32 {
    if is_leap(year) {
        366
    } else {
        365
    }
}

fn pymod(a: i64, b: i64) -> i64 {
    a.rem_euclid(b)
}

/// Day 0 of the day numbers below. jiff counts dates from this one itself, so
/// every date from -9999 to 9999 is a duration it accepts from here.
const DAY_ZERO: Date = Date::constant(1970, 1, 1);

/// Days from 1970-01-01.
fn day_number(date: Date) -> i64 {
    date.duration_since(DAY_ZERO).as_hours() / 24
}

/// The date `days` days from 1970-01-01; `None` outside years -9999 to 9999.
fn date_of_day(days: i64) -> Option<Date> {
    let hours = days.checked_mul(24)?;
    DAY_ZERO.checked_add(SignedDuration::from_hours(hours)).ok()
}

/// The date `days` days after `from`.
fn days_after(from: Date, days: i64) -> Option<Date> {
    date_of_day(day_number(from).checked_add(days)?)
}

/// Weekday, 0 = Monday.
fn weekday_index(date: Date) -> u32 {
    u32::from(date.weekday().to_monday_zero_offset().unsigned_abs())
}

/// Day of the year, 0-based.
fn ordinal0(date: Date) -> usize {
    usize::from(date.day_of_year().unsigned_abs()) - 1
}

/// An hour, minute or second as the rule stores it.
fn clock_field(value: i8) -> u32 {
    u32::from(value.unsigned_abs())
}

struct YearInfo {
    year: i32,
    yearlen: usize,
    /// Day number of January 1st.
    yearordinal: i64,
    /// Weekday of January 1st, 0 = Monday.
    yearweekday: i64,
    /// Whether day `i` of the year (0-based, running 7 days into the next year
    /// for weeks that straddle it) passes the calendar parts of the rule.
    pass: Vec<bool>,
}

impl YearInfo {
    fn build(year: i32, rule: &Rule) -> Option<YearInfo> {
        let jan1 = Date::new(i16::try_from(year).ok()?, 1, 1).ok()?;
        let yearlen = year_len(year) as usize;
        let yearordinal = day_number(jan1);
        let yearweekday = i64::from(weekday_index(jan1));
        let len = yearlen + 7;
        let wday = |i: i64| pymod(yearweekday + i, 7);

        let wnomask = if rule.byweekno.is_empty() {
            None
        } else {
            Some(build_wnomask(year, yearlen, yearweekday, rule))
        };
        let nwdaymask = if rule.has_nweekday && rule.freq <= Freq::Monthly {
            let mut ranges: Vec<(i64, i64)> = Vec::new();
            let month_start = |m: u32| -> i64 {
                i8::try_from(m)
                    .ok()
                    .and_then(|m| jan1.with().month(m).build().ok())
                    .map_or(yearlen as i64, |d| ordinal0(d) as i64)
            };
            let month_end = |m: u32| -> i64 {
                if m == 12 {
                    yearlen as i64
                } else {
                    month_start(m + 1)
                }
            };
            if rule.freq == Freq::Yearly && rule.bymonth == 0 {
                ranges.push((0, yearlen as i64 - 1));
            } else {
                // MONTHLY reads one month per period; marking every month at
                // once gives each month the same marks.
                for m in 1..=12u32 {
                    if rule.freq == Freq::Monthly || rule.bymonth & (1 << m) != 0 {
                        ranges.push((month_start(m), month_end(m) - 1));
                    }
                }
            }
            let mut mask = vec![false; yearlen];
            for &(first, last) in &ranges {
                for &(weekday, n) in &rule.bynweekday {
                    let (n, weekday) = (i64::from(n), i64::from(weekday));
                    let i = if n < 0 {
                        let i = last + (n + 1) * 7;
                        i - pymod(wday(i) - weekday, 7)
                    } else {
                        let i = first + (n - 1) * 7;
                        i + pymod(7 - wday(i) + weekday, 7)
                    };
                    if first <= i && i <= last {
                        mask[i as usize] = true;
                    }
                }
            }
            Some(mask)
        } else {
            None
        };

        // Walked a day at a time, without a date per day. The week that
        // straddles the end of 9999 has no candidates past it.
        let mut day = Day::first_of(year, weekday_index(jan1));
        let mut pass = Vec::with_capacity(len);
        for i in 0..len {
            pass.push(day.year <= MAX_YEAR && day_passes(rule, &day, i, &wnomask, &nwdaymask));
            day = day.next();
        }
        Some(YearInfo {
            year,
            yearlen,
            yearordinal,
            yearweekday,
            pass,
        })
    }

    fn date(&self, i: usize) -> Option<Date> {
        date_of_day(self.yearordinal + i as i64)
    }

    fn weekday(&self, i: usize) -> u32 {
        pymod(self.yearweekday + i as i64, 7) as u32
    }
}

/// The calendar fields of one day, as the year mask reads them.
#[derive(Clone, Copy)]
struct Day {
    year: i32,
    month: u32,
    day: u32,
    days_in_month: u32,
    /// 0 = Monday.
    weekday: u32,
    /// Day of the year, 1-based.
    ordinal: i32,
}

impl Day {
    fn first_of(year: i32, weekday: u32) -> Day {
        Day {
            year,
            month: 1,
            day: 1,
            days_in_month: 31,
            weekday,
            ordinal: 1,
        }
    }

    fn next(self) -> Day {
        let mut next = Day {
            weekday: (self.weekday + 1) % 7,
            day: self.day + 1,
            ordinal: self.ordinal + 1,
            ..self
        };
        if next.day > self.days_in_month {
            next.day = 1;
            next.month += 1;
            if next.month > 12 {
                next.month = 1;
                next.year += 1;
                next.ordinal = 1;
            }
            next.days_in_month = days_in_month(next.year, next.month);
        }
        next
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(year) => 29,
        _ => 28,
    }
}

fn day_passes(
    rule: &Rule,
    date: &Day,
    i: usize,
    wnomask: &Option<Vec<bool>>,
    nwdaymask: &Option<Vec<bool>>,
) -> bool {
    if rule.bymonth != 0 && rule.bymonth & (1 << date.month) == 0 {
        return false;
    }
    if let Some(mask) = wnomask {
        if !mask.get(i).copied().unwrap_or(false) {
            return false;
        }
    }
    if rule.has_byday() {
        let plain = rule.byweekday & (1 << date.weekday) != 0;
        let nth = nwdaymask
            .as_ref()
            .is_some_and(|m| m.get(i).copied().unwrap_or(false));
        // A plain weekday and an ordinal one are alternatives (BYDAY=MO,1TU is
        // every Monday plus the first Tuesday), as RFC 5545 reads a list.
        if !plain && !nth {
            return false;
        }
    }
    if rule.bymonthday != 0 || rule.bynmonthday != 0 {
        let day = date.day;
        let from_end = date.days_in_month - day + 1;
        if rule.bymonthday & (1 << day) == 0 && rule.bynmonthday & (1 << from_end) == 0 {
            return false;
        }
    }
    if !rule.byyearday.is_empty() {
        let ordinal = date.ordinal;
        let negative = ordinal - year_len(date.year) - 1;
        if rule.byyearday.binary_search(&ordinal).is_err()
            && rule.byyearday.binary_search(&negative).is_err()
        {
            return false;
        }
    }
    true
}

/// BYWEEKNO marks, as rrule.js and dateutil compute them (weeks start on WKST
/// and week 1 is the first with at least four days in the year).
fn build_wnomask(year: i32, yearlen: usize, yearweekday: i64, rule: &Rule) -> Vec<bool> {
    let len = yearlen + 14;
    let mut mask = vec![false; len];
    let wkst = i64::from(rule.wkst);
    let ylen = yearlen as i64;
    let wday = |i: i64| pymod(yearweekday + i, 7);
    let mark_week = |mask: &mut [bool], mut i: i64| {
        for _ in 0..7 {
            if (0..len as i64).contains(&i) {
                mask[i as usize] = true;
            }
            i += 1;
            if wday(i) == wkst {
                break;
            }
        }
    };

    let firstwkst = pymod(7 - yearweekday + wkst, 7);
    let mut no1wkst = firstwkst;
    let wyearlen = if no1wkst >= 4 {
        no1wkst = 0;
        ylen + pymod(yearweekday - wkst, 7)
    } else {
        ylen - no1wkst
    };
    let numweeks = wyearlen / 7 + if pymod(wyearlen, 7) >= 4 { 1 } else { 0 };

    for &week in &rule.byweekno {
        let mut n = i64::from(week);
        if n < 0 {
            n += numweeks + 1;
        }
        if !(n > 0 && n <= numweeks) {
            continue;
        }
        let i = if n > 1 {
            let mut i = no1wkst + (n - 1) * 7;
            if no1wkst != firstwkst {
                i -= 7 - firstwkst;
            }
            i
        } else {
            no1wkst
        };
        mark_week(&mut mask, i);
    }

    if rule.byweekno.binary_search(&1).is_ok() {
        // Week 1 of next year may start in this one.
        let mut i = no1wkst + numweeks * 7;
        if no1wkst != firstwkst {
            i -= 7 - firstwkst;
        }
        if i < ylen {
            mark_week(&mut mask, i);
        }
    }

    if no1wkst != 0 {
        // The days before week 1 belong to the last week of the previous year.
        let lnumweeks = if rule.byweekno.binary_search(&-1).is_err() {
            let lyearweekday = i16::try_from(year - 1)
                .ok()
                .and_then(|y| Date::new(y, 1, 1).ok())
                .map_or(0, |d| i64::from(weekday_index(d)));
            let lno1wkst = pymod(7 - lyearweekday + wkst, 7);
            let lyearlen = i64::from(year_len(year - 1));
            let weekst = if lno1wkst >= 4 {
                lyearlen + pymod(lyearweekday - wkst, 7)
            } else {
                ylen - no1wkst
            };
            52 + if pymod(weekst, 7) >= 4 { 1 } else { 0 }
        } else {
            -1
        };
        if rule.byweekno.binary_search(&lnumweeks).is_ok() {
            for slot in mask.iter_mut().take(no1wkst as usize) {
                *slot = true;
            }
        }
    }
    mask
}

// ─── Iteration ──────────────────────────────────────────────────────────────

#[derive(PartialEq, Eq)]
enum Flow {
    Continue,
    Stop,
}

struct Expander<'a> {
    rule: &'a Rule,
    /// DTSTART on the rule's wall clock.
    dtstart: DateTime,
    zone: Option<TimeZone>,
    limit: usize,
    remaining: Option<u64>,
    /// Occurrences, as UTC wall clocks.
    out: Vec<DateTime>,
    last: Option<DateTime>,
    steps: u64,
    year: Option<YearInfo>,
}

impl Expander<'_> {
    fn tick(&mut self) -> Result<(), String> {
        self.steps += 1;
        if self.steps > STEP_BUDGET {
            return Err(format!(
                "RRULE expansion stopped after {} steps without completing: \
                 the rule's INTERVAL almost never meets its BY* parts",
                STEP_BUDGET
            ));
        }
        Ok(())
    }

    fn year_info(&mut self, year: i32) -> Result<&YearInfo, String> {
        if self.year.as_ref().map(|y| y.year) != Some(year) {
            let info = YearInfo::build(year, self.rule)
                .ok_or_else(|| format!("RRULE expansion reached an invalid year {}", year))?;
            self.year = Some(info);
        }
        self.year
            .as_ref()
            .ok_or_else(|| "RRULE year table missing".to_string())
    }

    /// The instant a wall-clock occurrence names: RFC 5545 §3.3.5 takes the
    /// first of two ambiguous times, and reads a time that does not exist with
    /// the offset in force before the gap (02:30 becomes 03:30).
    fn instant(&self, local: DateTime) -> Option<DateTime> {
        resolve(self.zone.as_ref(), local)
    }

    fn emit(&mut self, local: DateTime) -> Result<Flow, String> {
        let past_until = match self.rule.until {
            None => false,
            Some(Until::Local(until)) => local > until,
            Some(Until::Date(until)) => local.date() > until,
            Some(Until::Instant(until)) => self.instant(local).is_none_or(|i| i > until),
        };
        if past_until {
            return Ok(Flow::Stop);
        }
        if local < self.dtstart {
            return Ok(Flow::Continue);
        }
        let instant = self
            .instant(local)
            .ok_or_else(|| format!("Cannot resolve the occurrence {}", clock_text(local)))?;
        // Around a DST change two wall-clock times can name the same or an
        // earlier instant; the output stays strictly increasing.
        if self.last.is_some_and(|last| instant <= last) {
            return Ok(Flow::Continue);
        }
        self.out.push(instant);
        self.last = Some(instant);
        if let Some(remaining) = self.remaining.as_mut() {
            *remaining -= 1;
            if *remaining == 0 {
                return Ok(Flow::Stop);
            }
        }
        if self.out.len() >= self.limit {
            return Ok(Flow::Stop);
        }
        Ok(Flow::Continue)
    }

    fn combine(&self, date: Date, (h, m, s): (u32, u32, u32)) -> Option<DateTime> {
        let field = |v: u32| i8::try_from(v).ok();
        let time = Time::new(
            field(h)?,
            field(m)?,
            field(s)?,
            self.dtstart.subsec_nanosecond(),
        )
        .ok()?;
        Some(date.to_datetime(time))
    }

    /// Emit one period: `days` are the dates that passed the calendar parts,
    /// in order, and `times` the period's time set, sorted.
    fn emit_period(&mut self, days: &[Date], times: &[(u32, u32, u32)]) -> Result<Flow, String> {
        if days.is_empty() || times.is_empty() {
            return Ok(Flow::Continue);
        }
        if !self.rule.bysetpos.is_empty() {
            let len = times.len() as i64;
            let mut picked: Vec<DateTime> = Vec::with_capacity(self.rule.bysetpos.len());
            for &pos in &self.rule.bysetpos {
                let pos = i64::from(pos);
                let (daypos, timepos) = if pos < 0 {
                    (pos.div_euclid(len), pos.rem_euclid(len))
                } else {
                    ((pos - 1).div_euclid(len), (pos - 1).rem_euclid(len))
                };
                let day_index = if daypos < 0 {
                    days.len() as i64 + daypos
                } else {
                    daypos
                };
                let Some(date) = usize::try_from(day_index).ok().and_then(|i| days.get(i)) else {
                    continue;
                };
                let Some(time) = times.get(timepos as usize) else {
                    continue;
                };
                if let Some(res) = self.combine(*date, *time) {
                    picked.push(res);
                }
            }
            picked.sort_unstable();
            picked.dedup();
            for res in picked {
                if self.emit(res)? == Flow::Stop {
                    return Ok(Flow::Stop);
                }
            }
            return Ok(Flow::Continue);
        }
        let first_day = self.dtstart.date();
        for &date in days {
            // Every time of an earlier day is before DTSTART.
            if date < first_day {
                continue;
            }
            for &time in times {
                let Some(res) = self.combine(date, time) else {
                    continue;
                };
                if self.emit(res)? == Flow::Stop {
                    return Ok(Flow::Stop);
                }
            }
        }
        Ok(Flow::Continue)
    }

    fn daily_timeset(&self) -> Vec<(u32, u32, u32)> {
        let r = self.rule;
        let mut out = Vec::with_capacity(r.byhour.len() * r.byminute.len() * r.bysecond.len());
        for &h in &r.byhour {
            for &m in &r.byminute {
                for &s in &r.bysecond {
                    out.push((h, m, s));
                }
            }
        }
        out
    }

    /// YEARLY, MONTHLY and WEEKLY: one period at a time, each period's days
    /// read from the year mask.
    fn run_periods(&mut self) -> Result<(), String> {
        let rule = self.rule;
        let times = self.daily_timeset();
        let interval = rule.interval;
        let wkst = rule.wkst;
        let mut year = i64::from(self.dtstart.year());
        let mut month = i64::from(self.dtstart.month());
        let mut week_cursor = self.dtstart.date();
        let mut days: Vec<Date> = Vec::with_capacity(373);

        loop {
            self.tick()?;
            let current_year = match rule.freq {
                Freq::Weekly => i32::from(week_cursor.year()),
                _ => match i32::try_from(year) {
                    Ok(y) => y,
                    Err(_) => break,
                },
            };
            if current_year > MAX_YEAR {
                break;
            }
            let info = self.year_info(current_year)?;
            let (start, end) = match rule.freq {
                Freq::Yearly => (0, info.yearlen),
                Freq::Monthly => {
                    let first = match (i16::try_from(current_year), i8::try_from(month)) {
                        (Ok(y), Ok(m)) => Date::new(y, m, 1).ok(),
                        _ => None,
                    }
                    .ok_or_else(|| "Invalid month while expanding RRULE".to_string())?;
                    let start = ordinal0(first);
                    (
                        start,
                        start + usize::from(first.days_in_month().unsigned_abs()),
                    )
                }
                _ => {
                    let start = ordinal0(week_cursor);
                    let mut end = start;
                    for _ in 0..7 {
                        end += 1;
                        if info.weekday(end) == wkst {
                            break;
                        }
                    }
                    (start, end)
                }
            };
            days.clear();
            for i in start..end {
                if info.pass[i] {
                    if let Some(date) = info.date(i) {
                        days.push(date);
                    }
                }
            }
            if self.emit_period(&days, &times)? == Flow::Stop {
                break;
            }
            match rule.freq {
                Freq::Yearly => year += interval,
                Freq::Monthly => {
                    let m0 = month - 1 + interval;
                    year += m0.div_euclid(12);
                    month = m0.rem_euclid(12) + 1;
                    if year > i64::from(MAX_YEAR) {
                        break;
                    }
                }
                _ => {
                    let back = (7 + i64::from(weekday_index(week_cursor)) - i64::from(wkst)) % 7;
                    let forward = interval.saturating_mul(7).saturating_sub(back);
                    match days_after(week_cursor, forward) {
                        Some(next) => week_cursor = next,
                        None => break,
                    }
                }
            }
        }
        Ok(())
    }

    /// DAILY and finer: the periods sit on a lattice of `interval` units from
    /// DTSTART. Days the calendar parts reject and times the BY* limits reject
    /// are jumped over rather than stepped through.
    fn run_lattice(&mut self) -> Result<(), String> {
        let rule = self.rule;
        let unit: i64 = match rule.freq {
            Freq::Daily => SECONDS_PER_DAY,
            Freq::Hourly => 3600,
            Freq::Minutely => 60,
            _ => 1,
        };
        let step = rule.interval.saturating_mul(unit);
        let t0 = seconds_of(self.dtstart);
        if !self.time_reachable(t0, step) {
            return Ok(());
        }
        let daily_times = if rule.freq == Freq::Daily {
            self.daily_timeset()
        } else {
            Vec::new()
        };
        let mut times: Vec<(u32, u32, u32)> = Vec::new();
        let mut t = t0;
        while let Some(valid) = self.next_valid(t, t0, step)? {
            t = valid;
            let (date, sod) =
                split_seconds(t).ok_or_else(|| "Invalid RRULE instant".to_string())?;
            let (h, m, s) = hms(sod);
            let period_times: &[(u32, u32, u32)] = match rule.freq {
                Freq::Daily => &daily_times,
                Freq::Hourly => {
                    times.clear();
                    for &mm in &rule.byminute {
                        for &ss in &rule.bysecond {
                            times.push((h, mm, ss));
                        }
                    }
                    &times
                }
                Freq::Minutely => {
                    times.clear();
                    times.extend(rule.bysecond.iter().map(|&ss| (h, m, ss)));
                    &times
                }
                _ => {
                    times.clear();
                    times.push((h, m, s));
                    &times
                }
            };
            if self.emit_period(&[date], period_times)? == Flow::Stop {
                break;
            }
            t = match t.checked_add(step) {
                Some(next) => next,
                None => break,
            };
        }
        Ok(())
    }

    /// Whether any lattice point can satisfy the sub-daily BY* limits. The
    /// lattice visits exactly the seconds of the day congruent to DTSTART
    /// modulo gcd(step, 86400); rrule.js loops forever when none of them fits.
    fn time_reachable(&self, t0: i64, step: i64) -> bool {
        if self.rule.freq == Freq::Daily {
            return true;
        }
        let g = gcd(step, SECONDS_PER_DAY);
        let mut sod = t0.rem_euclid(g);
        while sod < SECONDS_PER_DAY {
            if self.time_passes(sod) {
                return true;
            }
            sod += g;
        }
        false
    }

    fn time_passes(&self, sod: i64) -> bool {
        let (h, m, s) = hms(sod);
        let r = self.rule;
        let freq = r.freq;
        (freq < Freq::Hourly || r.byhour.is_empty() || r.byhour.binary_search(&h).is_ok())
            && (freq < Freq::Minutely
                || r.byminute.is_empty()
                || r.byminute.binary_search(&m).is_ok())
            && (freq < Freq::Secondly
                || r.bysecond.is_empty()
                || r.bysecond.binary_search(&s).is_ok())
    }

    /// The first lattice point at or after `t` whose day passes the calendar
    /// parts and whose time passes the BY* limits, or `None` past year 9999.
    fn next_valid(&mut self, mut t: i64, t0: i64, step: i64) -> Result<Option<i64>, String> {
        let ceil = |x: i64| -> Option<i64> {
            let k = (x - t0 + step - 1).div_euclid(step);
            t0.checked_add(k.checked_mul(step)?)
        };
        loop {
            self.tick()?;
            let Some((date, sod)) = split_seconds(t) else {
                return Ok(None);
            };
            let year = i32::from(date.year());
            if year > MAX_YEAR {
                return Ok(None);
            }
            let day_start = t - sod;
            let info = self.year_info(year)?;
            if !info.pass[ordinal0(date)] {
                let Some(next_day) = self.next_passing_day(date)? else {
                    return Ok(None);
                };
                t = match ceil(seconds_of_date(next_day)) {
                    Some(v) => v,
                    None => return Ok(None),
                };
                continue;
            }
            if self.rule.freq == Freq::Daily {
                return Ok(Some(t));
            }
            let (h, m, s) = hms(sod);
            let r = self.rule;
            let target = if !r.byhour.is_empty() && r.byhour.binary_search(&h).is_err() {
                Some(match r.byhour.iter().find(|&&x| x > h) {
                    Some(&next) => day_start + i64::from(next) * 3600,
                    None => day_start + SECONDS_PER_DAY,
                })
            } else if r.freq >= Freq::Minutely
                && !r.byminute.is_empty()
                && r.byminute.binary_search(&m).is_err()
            {
                let hour_start = day_start + i64::from(h) * 3600;
                Some(match r.byminute.iter().find(|&&x| x > m) {
                    Some(&next) => hour_start + i64::from(next) * 60,
                    None => hour_start + 3600,
                })
            } else if r.freq == Freq::Secondly
                && !r.bysecond.is_empty()
                && r.bysecond.binary_search(&s).is_err()
            {
                let minute_start = day_start + i64::from(h) * 3600 + i64::from(m) * 60;
                Some(match r.bysecond.iter().find(|&&x| x > s) {
                    Some(&next) => minute_start + i64::from(next),
                    None => minute_start + 60,
                })
            } else {
                None
            };
            match target {
                None => return Ok(Some(t)),
                Some(x) => {
                    t = match ceil(x) {
                        Some(v) => v,
                        None => return Ok(None),
                    }
                }
            }
        }
    }

    /// The first day after `date` that passes the calendar parts, scanning the
    /// year masks, or `None` past year 9999.
    fn next_passing_day(&mut self, date: Date) -> Result<Option<Date>, String> {
        let mut year = i32::from(date.year());
        let mut from = ordinal0(date) + 1;
        while year <= MAX_YEAR {
            let info = self.year_info(year)?;
            if let Some(offset) = info.pass[from.min(info.yearlen)..info.yearlen]
                .iter()
                .position(|&p| p)
            {
                return Ok(info.date(from + offset));
            }
            year += 1;
            from = 0;
        }
        Ok(None)
    }
}

fn gcd(a: i64, b: i64) -> i64 {
    let (mut a, mut b) = (a.abs(), b.abs());
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a.max(1)
}

fn seconds_of_date(date: Date) -> i64 {
    day_number(date) * SECONDS_PER_DAY
}

fn seconds_of(dt: DateTime) -> i64 {
    seconds_of_date(dt.date())
        + i64::from(dt.hour()) * 3600
        + i64::from(dt.minute()) * 60
        + i64::from(dt.second())
}

fn split_seconds(t: i64) -> Option<(Date, i64)> {
    Some((
        date_of_day(t.div_euclid(SECONDS_PER_DAY))?,
        t.rem_euclid(SECONDS_PER_DAY),
    ))
}

fn hms(sod: i64) -> (u32, u32, u32) {
    // sod is within 0..86400.
    let sod = sod as u32;
    (sod / 3600, sod / 60 % 60, sod % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn run(start: &str, rule: &str, limit: usize) -> Result<Vec<String>, String> {
        expand(Some(start), rule, limit, None)
    }

    #[test]
    fn repeated_by_values_are_one_set() {
        let list = |key: &str| format!("{}={}", key, vec!["0"; 1000].join(","));
        let hostile = format!(
            "FREQ=DAILY;{};{};{};BYSETPOS=1",
            list("BYHOUR"),
            list("BYMINUTE"),
            list("BYSECOND")
        );
        let started = Instant::now();
        let out = run("2026-01-01T00:00:00Z", &hostile, 1).unwrap();
        assert!(started.elapsed().as_millis() < 100);
        assert_eq!(
            out,
            run(
                "2026-01-01T00:00:00Z",
                "FREQ=DAILY;BYHOUR=0;BYMINUTE=0;BYSECOND=0;BYSETPOS=1",
                1
            )
            .unwrap()
        );
    }

    #[test]
    fn rule_text_is_capped() {
        let rule = format!("FREQ=DAILY;BYHOUR={}", vec!["1"; 5000].join(","));
        let err = run("2026-01-01T00:00:00Z", &rule, 1).unwrap_err();
        assert!(err.contains("limit is 8192 bytes"), "{}", err);
    }

    #[test]
    fn a_multi_byte_character_across_byte_8_is_an_ordinary_error() {
        // 7 ASCII bytes then `é` (bytes 7..9): the DTSTART= check used to
        // slice at byte 8, inside the character, and panic.
        for rule in ["ABCDEFGé=1", "DTSTARé=20260101", "ABCDEFGé=1\nFREQ=DAILY"] {
            let err = run("2026-01-01T00:00:00Z", rule, 1).unwrap_err();
            assert!(err.contains("Unknown RRULE property"), "{}: {}", rule, err);
        }
    }

    #[test]
    fn a_rule_that_never_meets_its_lattice_stops_at_the_step_budget() {
        // INTERVAL=7063 s (7 x 1009) is coprime with a day, so every second of
        // the day is reachable and `time_reachable` lets the rule through. But
        // 86400 = -1 (mod 7), so the lattice can only land on 00:00:00 on one
        // weekday out of seven — the Wednesday, from this DTSTART — and BYDAY
        // leaves exactly that one out. Nothing ever matches, every passing day
        // costs a few steps, and the day mask never comes up empty, so neither
        // the empty-year skip nor year 9999 ends it before the budget.
        let started = Instant::now();
        let err = run(
            "2026-01-01T00:00:01Z",
            "FREQ=SECONDLY;INTERVAL=7063;BYDAY=MO,TU,TH,FR,SA,SU;BYHOUR=0;BYMINUTE=0;BYSECOND=0",
            1,
        )
        .unwrap_err();
        assert!(
            err.contains(&format!("stopped after {} steps", STEP_BUDGET)),
            "{}",
            err
        );
        // About 70 ms in a release build, 0.6 s in this debug one; without the
        // budget the same call walks on to year 9999.
        assert!(started.elapsed().as_secs() < 5, "{:?}", started.elapsed());
    }

    #[test]
    fn unsatisfiable_rules_end_at_year_9999_with_nothing() {
        for rule in [
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
            "FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30",
            "FREQ=WEEKLY;BYMONTH=2;BYMONTHDAY=30",
            "FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30",
            "FREQ=MINUTELY;BYMONTH=2;BYMONTHDAY=30;BYHOUR=23",
            "FREQ=HOURLY;INTERVAL=2;BYHOUR=1",
            "FREQ=SECONDLY;INTERVAL=60;BYSECOND=30",
        ] {
            let started = Instant::now();
            assert_eq!(
                run("0001-01-01T00:00:00Z", rule, 1).unwrap(),
                Vec::<String>::new()
            );
            assert!(started.elapsed().as_secs() < 2, "{} took too long", rule);
        }
    }

    #[test]
    fn defaults_come_from_dtstart() {
        assert_eq!(
            run("2026-01-31T10:00:00Z", "FREQ=MONTHLY;COUNT=3", 10).unwrap(),
            vec![
                "2026-01-31T10:00:00.000Z",
                "2026-03-31T10:00:00.000Z",
                "2026-05-31T10:00:00.000Z"
            ]
        );
        assert_eq!(
            run("2024-02-29T10:00:00Z", "FREQ=YEARLY;COUNT=2", 10).unwrap(),
            vec!["2024-02-29T10:00:00.000Z", "2028-02-29T10:00:00.000Z"]
        );
    }

    #[test]
    fn sub_daily_frequencies_limit_on_by_parts() {
        assert_eq!(
            run("2026-01-01T00:00:00Z", "FREQ=HOURLY;BYHOUR=9;COUNT=2", 10).unwrap(),
            vec!["2026-01-01T09:00:00.000Z", "2026-01-02T09:00:00.000Z"]
        );
        assert_eq!(
            run(
                "2026-01-01T00:00:00Z",
                "FREQ=SECONDLY;BYSECOND=0;BYMINUTE=0;COUNT=2",
                10
            )
            .unwrap(),
            vec!["2026-01-01T00:00:00.000Z", "2026-01-01T01:00:00.000Z"]
        );
    }

    #[test]
    fn yearly_ordinal_counts_within_the_year() {
        assert_eq!(
            run("2026-01-05T00:00:00Z", "FREQ=YEARLY;BYDAY=20MO;COUNT=2", 10).unwrap(),
            vec!["2026-05-18T00:00:00.000Z", "2027-05-17T00:00:00.000Z"]
        );
    }

    #[test]
    fn plain_and_ordinal_byday_are_alternatives() {
        // Every Monday of January 2026, plus its first Tuesday (the 6th).
        assert_eq!(
            run(
                "2026-01-01T09:00:00Z",
                "FREQ=MONTHLY;BYDAY=MO,1TU;COUNT=6",
                10
            )
            .unwrap(),
            vec![
                "2026-01-05T09:00:00.000Z",
                "2026-01-06T09:00:00.000Z",
                "2026-01-12T09:00:00.000Z",
                "2026-01-19T09:00:00.000Z",
                "2026-01-26T09:00:00.000Z",
                "2026-02-02T09:00:00.000Z"
            ]
        );
    }

    #[test]
    fn until_accepts_the_rfc_5545_forms() {
        let three = vec![
            "2026-01-15T10:00:00.000Z",
            "2026-01-16T10:00:00.000Z",
            "2026-01-17T10:00:00.000Z",
        ];
        for until in [
            "20260118T000000Z",
            "20260117T100000",
            "20260117",
            "2026-01-17T10:00:00Z",
        ] {
            let rule = format!("FREQ=DAILY;UNTIL={}", until);
            assert_eq!(
                run("2026-01-15T10:00:00Z", &rule, 10).unwrap(),
                three,
                "{}",
                until
            );
        }
    }

    #[test]
    fn unknown_and_malformed_parts_are_errors() {
        for (rule, message) in [
            ("FREQ=DAILY;BYDAYX=MO", "Unknown RRULE property 'BYDAYX'"),
            ("FREQ=DAILY;COUNT", "expected KEY=VALUE"),
            ("FREQ=DAILY;COUNT=1;COUNT=2", "appears twice"),
            ("FREQ=DAILY;BYHOUR=24", "out of range"),
            ("FREQ=DAILY;BYDAY=0MO", "out of range"),
            ("FREQ=DAILY;BYDAY=MO;BYSETPOS=0", "out of range"),
            ("FREQ=DAILY;INTERVAL=0", "INTERVAL"),
            ("FREQ=DAILY;COUNT=99999999999", "Invalid COUNT"),
            ("COUNT=2", "missing FREQ"),
            // EXRULE is deprecated by RFC 5545; EXDATE and RDATE are expanded.
            ("EXRULE:FREQ=WEEKLY", "Unsupported property"),
        ] {
            let err = run("2026-01-15T10:00:00Z", rule, 10).unwrap_err();
            assert!(err.contains(message), "{} -> {}", rule, err);
        }
    }

    #[test]
    fn output_is_strictly_increasing() {
        let out = run(
            "2026-01-01T00:00:00Z",
            "FREQ=MINUTELY;BYHOUR=9;COUNT=200",
            200,
        )
        .unwrap();
        assert_eq!(out.len(), 200);
        assert!(out.windows(2).all(|w| w[0] < w[1]));
    }
}

#[cfg(test)]
mod zone_tests {
    use super::*;

    #[test]
    fn a_zoned_series_keeps_its_wall_clock() {
        let out = expand(
            Some("2026-03-23T08:00:00Z"),
            "FREQ=WEEKLY;COUNT=2",
            10,
            Some("Europe/Paris"),
        )
        .unwrap();
        assert_eq!(
            out,
            vec!["2026-03-23T08:00:00.000Z", "2026-03-30T07:00:00.000Z"]
        );
    }

    #[test]
    fn dtstart_line_carries_the_zone() {
        let out = expand(
            None,
            "DTSTART;TZID=Europe/Paris:20260328T023000\nRRULE:FREQ=DAILY;COUNT=3",
            10,
            None,
        )
        .unwrap();
        // 02:30 on the 29th does not exist in Paris: read with the offset in
        // force before the gap, it is 03:30 CEST.
        assert_eq!(
            out,
            vec![
                "2026-03-28T01:30:00.000Z",
                "2026-03-29T01:30:00.000Z",
                "2026-03-30T00:30:00.000Z"
            ]
        );
    }

    #[test]
    fn conflicting_starts_and_zones_are_errors() {
        let both = expand(
            Some("2026-01-01T00:00:00Z"),
            "DTSTART:20260101T000000Z\nRRULE:FREQ=DAILY",
            1,
            None,
        );
        assert!(both.unwrap_err().contains("given twice"));
        let zones = expand(
            None,
            "DTSTART;TZID=Europe/Paris:20260101T000000\nRRULE:FREQ=DAILY",
            1,
            Some("America/New_York"),
        );
        assert!(zones.unwrap_err().contains("tzid option"));
        let unknown = expand(
            Some("2026-01-01T00:00:00Z"),
            "FREQ=DAILY",
            1,
            Some("Nowhere/X"),
        );
        assert!(unknown.unwrap_err().contains("Unknown IANA timezone"));
    }
}

#[cfg(test)]
mod exception_tests {
    use super::*;

    fn expand_text(text: &str, limit: usize) -> Result<Vec<String>, String> {
        expand(None, text, limit, None)
    }

    #[test]
    fn a_weekly_slot_at_nine_in_zurich_stays_at_nine_across_both_changes_of_time() {
        // 29 March and 25 October 2026: CET to CEST and back.
        let spring = expand_text(
            "DTSTART;TZID=Europe/Zurich:20260323T090000\nRRULE:FREQ=WEEKLY;COUNT=2",
            10,
        )
        .unwrap();
        assert_eq!(
            spring,
            vec!["2026-03-23T08:00:00.000Z", "2026-03-30T07:00:00.000Z"]
        );
        let autumn = expand_text(
            "DTSTART;TZID=Europe/Zurich:20261019T090000\nRRULE:FREQ=WEEKLY;COUNT=2",
            10,
        )
        .unwrap();
        assert_eq!(
            autumn,
            vec!["2026-10-19T07:00:00.000Z", "2026-10-26T08:00:00.000Z"]
        );
    }

    #[test]
    fn an_exdate_removes_an_occurrence_and_an_rdate_adds_one_in_order() {
        let text = "DTSTART;TZID=Europe/Zurich:20261214T090000\n\
                    RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\n\
                    EXDATE;TZID=Europe/Zurich:20261228T090000\n\
                    RDATE;TZID=Europe/Zurich:20261230T140000";
        assert_eq!(
            expand_text(text, 10).unwrap(),
            vec![
                "2026-12-14T08:00:00.000Z",
                "2026-12-21T08:00:00.000Z",
                "2026-12-30T13:00:00.000Z",
                "2027-01-04T08:00:00.000Z",
            ]
        );
    }

    #[test]
    fn a_floating_exdate_is_read_on_the_rule_zone_and_a_utc_one_as_it_is() {
        let floating = "DTSTART;TZID=Europe/Zurich:20260706T090000\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20260707T090000";
        let utc = "DTSTART;TZID=Europe/Zurich:20260706T090000\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20260707T070000Z";
        let expected = vec!["2026-07-06T07:00:00.000Z", "2026-07-08T07:00:00.000Z"];
        assert_eq!(expand_text(floating, 10).unwrap(), expected);
        assert_eq!(expand_text(utc, 10).unwrap(), expected);
        // An EXDATE that names no occurrence removes nothing.
        let elsewhere = "DTSTART;TZID=Europe/Zurich:20260706T090000\nRRULE:FREQ=DAILY;COUNT=2\nEXDATE:20260707T100000";
        assert_eq!(expand_text(elsewhere, 10).unwrap().len(), 2);
    }

    #[test]
    fn several_values_and_lines_add_up_and_an_exdate_removes_an_rdate_too() {
        let text = "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=2\n\
                    RDATE:20260110T100000Z,20260111T100000Z\nRDATE:20260112T100000Z\n\
                    EXDATE:20260111T100000Z,20260101T100000Z";
        assert_eq!(
            expand_text(text, 10).unwrap(),
            vec![
                "2026-01-02T10:00:00.000Z",
                "2026-01-10T10:00:00.000Z",
                "2026-01-12T10:00:00.000Z"
            ]
        );
    }

    #[test]
    fn count_bounds_the_rule_alone_and_the_limit_the_whole_set() {
        // COUNT=3 counts the rule's occurrences, the removed one included (RFC 5545).
        let counted = "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20260102T100000Z";
        assert_eq!(
            expand_text(counted, 10).unwrap(),
            vec!["2026-01-01T10:00:00.000Z", "2026-01-03T10:00:00.000Z"]
        );
        // Without an end, the limit is reached despite what the EXDATEs remove.
        let endless =
            "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY\nEXDATE:20260101T100000Z,20260102T100000Z";
        assert_eq!(
            expand_text(endless, 2).unwrap(),
            vec!["2026-01-03T10:00:00.000Z", "2026-01-04T10:00:00.000Z"]
        );
        // An RDATE before the rule's first occurrence leads the set.
        let early = "DTSTART:20260105T100000Z\nRRULE:FREQ=DAILY\nRDATE:20251231T100000Z";
        assert_eq!(
            expand_text(early, 2).unwrap(),
            vec!["2025-12-31T10:00:00.000Z", "2026-01-05T10:00:00.000Z"]
        );
    }

    #[test]
    fn what_cannot_name_an_occurrence_is_refused() {
        let base = "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=2\n";
        for (line, expected) in [
            ("EXDATE;VALUE=DATE:20260102", "VALUE=DATE is not supported"),
            (
                "RDATE;VALUE=PERIOD:20260102T100000Z/PT1H",
                "VALUE=PERIOD is not supported",
            ),
            (
                "EXDATE;TZID=Europe/Zurich:20260102T100000Z",
                "both a TZID and a UTC",
            ),
            ("EXDATE:20260102", "Invalid EXDATE value"),
            ("RDATE:tomorrow", "Invalid RDATE value"),
            (
                "EXDATE;TZID=Mars/Olympus:20260102T100000",
                "Unknown IANA timezone",
            ),
            (
                "EXDATE;X-FOO=1:20260102T100000Z",
                "Unsupported EXDATE parameter",
            ),
        ] {
            let err = expand_text(&format!("{}{}", base, line), 10).unwrap_err();
            assert!(err.contains(expected), "{}: {}", line, err);
        }
    }

    #[test]
    fn date_lists_are_bounded_and_may_be_long_while_the_rule_stays_capped() {
        let values: Vec<String> = (0..2000)
            .map(|i| format!("2027{:04}T100000Z", 101 + i % 28))
            .collect();
        let long = format!(
            "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=2\nEXDATE:{}",
            values.join(",")
        );
        assert!(long.len() > MAX_RULE_LEN);
        assert_eq!(expand_text(&long, 10).unwrap().len(), 2);
        let too_many = format!(
            "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=2\nEXDATE:{}",
            vec!["20270101T100000Z"; MAX_DATES + 1].join(",")
        );
        assert!(expand_text(&too_many, 10)
            .unwrap_err()
            .contains(&format!("more than {}", MAX_DATES)));
        let rule = format!(
            "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;BYHOUR={}",
            vec!["1"; 5000].join(",")
        );
        assert!(expand_text(&rule, 1)
            .unwrap_err()
            .contains("limit is 8192 bytes"));
    }
}
