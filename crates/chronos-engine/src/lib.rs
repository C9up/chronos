//! The date/time and recurrence engine behind `@c9up/chronos`.
//!
//! Every instant crosses this API as an ISO 8601 string and is held here as its
//! UTC wall clock, a [`jiff::civil::DateTime`] — not a `jiff::Timestamp`, whose
//! range stops a day short of 9999-12-31 so that it can be shown at any offset,
//! while the engine's range is all of years 0000-9999. Zones come from the IANA
//! database jiff bundles into the binary (see `Cargo.toml`), and every
//! wall-clock rule — what an ambiguous or skipped time becomes, how a calendar
//! step keeps its hour across a change of time — is written out here.

use jiff::civil::{Date, DateTime, Time};
use jiff::tz::{AmbiguousOffset, Offset, TimeZone};
use jiff::{SignedDuration, Timestamp};

mod grammar;
pub mod holidays;
pub mod rrule;

/// Years a value may carry: what a four-digit ISO 8601 year can write, so every
/// result can be read back by `parse_iso`.
const MIN_YEAR: i32 = 0;
const MAX_YEAR: i32 = 9999;

const ONE_MILLISECOND: SignedDuration = SignedDuration::from_millis(1);

fn out_of_range() -> String {
    format!(
        "Date arithmetic result is out of range: years are limited to {:04}-{}",
        MIN_YEAR, MAX_YEAR
    )
}

fn in_range(value: DateTime) -> Result<DateTime, String> {
    if (MIN_YEAR..=MAX_YEAR).contains(&i32::from(value.year())) {
        Ok(value)
    } else {
        Err(out_of_range())
    }
}

/// Seconds per clock unit, `None` for calendar units.
fn clock_unit_seconds(unit: &str) -> Option<i64> {
    match unit {
        "seconds" | "second" => Some(1),
        "minutes" | "minute" => Some(60),
        "hours" | "hour" => Some(3600),
        _ => None,
    }
}

/// `amount × seconds` as a duration, or an out-of-range error when the product
/// leaves what an `i64` holds.
fn checked_duration(amount: i64, seconds: i64) -> Result<SignedDuration, String> {
    amount
        .checked_mul(seconds)
        .map(SignedDuration::from_secs)
        .ok_or_else(out_of_range)
}

/// `dt` moved by an exact duration; `None` past the years a value can hold.
///
/// jiff refuses a duration of more days than it counts from 1970 to 9999
/// (about 8 000 years) even when the result is in range, so a longer one is
/// added in two halves; each lands between the start and the result.
fn shifted(dt: DateTime, by: SignedDuration) -> Option<DateTime> {
    const LONGEST_HOURS: i64 = 2_000_000 * 24;
    match dt.checked_add(by) {
        Ok(out) => Some(out),
        Err(_) if by.as_hours().abs() > LONGEST_HOURS => {
            let half = by / 2;
            shifted(shifted(dt, half)?, by - half)
        }
        Err(_) => None,
    }
}

pub fn add(iso: &str, amount: i64, unit: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    let unit = unit.to_ascii_lowercase();
    let out = match unit.as_str() {
        "days" | "day" => shifted(dt, checked_duration(amount, 86_400)?),
        "weeks" | "week" => shifted(dt, checked_duration(amount, 604_800)?),
        "months" | "month" => checked_add_months(dt, amount),
        "years" | "year" => amount
            .checked_mul(12)
            .and_then(|m| checked_add_months(dt, m)),
        other => match clock_unit_seconds(other) {
            Some(seconds) => shifted(dt, checked_duration(amount, seconds)?),
            None => return Err(format!("Unsupported unit: {}", unit)),
        },
    };
    Ok(to_iso(in_range(out.ok_or_else(out_of_range)?)?))
}

/// Milliseconds from `b` to `a`, truncated toward zero.
fn millis_between(a: DateTime, b: DateTime) -> f64 {
    a.duration_since(b).as_millis() as f64
}

/// `a - b`, in the given unit, signed and fractional.
///
/// Both halves of that used to be wrong. The subtraction ran `b - a`, so the
/// sign was the opposite of what every caller coming from Luxon expects — a
/// date two days ahead answered -2. And the result was an `i64`, so a gap of
/// five and a half months came back as 5, with the half silently gone.
pub fn diff(a_iso: &str, b_iso: &str, unit: &str) -> Result<f64, String> {
    let a = parse_iso(a_iso)?;
    let b = parse_iso(b_iso)?;
    let ms = millis_between(a, b);
    let out = match unit.to_ascii_lowercase().as_str() {
        "milliseconds" | "millisecond" => ms,
        "seconds" | "second" => ms / 1_000.0,
        "minutes" | "minute" => ms / 60_000.0,
        "hours" | "hour" => ms / 3_600_000.0,
        "days" | "day" => ms / 86_400_000.0,
        "weeks" | "week" => ms / 604_800_000.0,
        // One calendar routine for every zone, UTC included.
        "months" | "month" | "years" | "year" => diff_in_zone(a_iso, b_iso, unit, "UTC")?,
        _ => return Err(format!("Unsupported unit: {}", unit)),
    };
    Ok(out)
}

/// A wall clock at whole hours, minutes and seconds.
fn at_hms(date: Date, hour: i8, minute: i8, second: i8) -> Option<DateTime> {
    Time::new(hour, minute, second, 0)
        .ok()
        .map(|time| date.to_datetime(time))
}

/// Truncate a wall clock to the start of `unit`.
///
/// The ONE place boundary arithmetic lives. `start_of` applies it to a UTC
/// instant and `start_of_in_zone` to a wall-clock one — before this existed the
/// zoned path was a hand-written switch in TypeScript, and the two drifted:
/// `second` was added to one and not the other, so the same call answered
/// differently depending on the zone.
fn start_of_naive(nd: DateTime, unit: &str) -> Result<DateTime, String> {
    let date = nd.date();
    let out = match unit.to_ascii_lowercase().as_str() {
        "year" => at_hms(date.first_of_year(), 0, 0, 0),
        "month" => at_hms(date.first_of_month(), 0, 0, 0),
        "week" => {
            let back = i64::from(date.weekday().to_monday_zero_offset());
            date.checked_sub(SignedDuration::from_hours(24 * back))
                .ok()
                .and_then(|monday| at_hms(monday, 0, 0, 0))
        }
        "day" => at_hms(date, 0, 0, 0),
        "hour" => at_hms(date, nd.hour(), 0, 0),
        "minute" => at_hms(date, nd.hour(), nd.minute(), 0),
        "second" => at_hms(date, nd.hour(), nd.minute(), nd.second()),
        _ => return Err(format!("Unsupported unit: {}", unit)),
    };
    out.ok_or_else(|| format!("Invalid {} start", unit))
}

/// Where the unit after the one containing a wall clock starts.
enum NextStart {
    At(DateTime),
    /// The first instant of year 10000, which no civil value holds: the unit
    /// is the last of its kind in 9999 (a week never ends exactly there).
    YearTenThousand,
}

/// The start of the unit AFTER the one containing `nd` — the other half of
/// `end_of`, kept beside `start_of_naive` so the two unit lists cannot drift.
fn next_unit_naive(nd: DateTime, unit: &str) -> Result<NextStart, String> {
    let start = start_of_naive(nd, unit)?;
    let lower = unit.to_ascii_lowercase();
    let next = match lower.as_str() {
        "year" => checked_add_months(start, 12),
        "month" => checked_add_months(start, 1),
        "week" => shifted(start, SignedDuration::from_hours(7 * 24)),
        "day" => shifted(start, SignedDuration::from_hours(24)),
        "hour" => shifted(start, SignedDuration::from_hours(1)),
        "minute" => shifted(start, SignedDuration::from_mins(1)),
        "second" => shifted(start, SignedDuration::from_secs(1)),
        _ => return Err(format!("Unsupported unit: {}", unit)),
    };
    match next {
        Some(next) => Ok(NextStart::At(next)),
        None if lower != "week" => Ok(NextStart::YearTenThousand),
        None => Err(out_of_range()),
    }
}

/// One millisecond before the start of the next unit, on the UTC side: `read`
/// is where a wall clock resolves, and `after` how far past it the start lies
/// (one nanosecond when the start is the first instant of year 10000, read as
/// the last nanosecond of 9999).
fn last_millisecond_before(read: DateTime, after: SignedDuration) -> Result<DateTime, String> {
    shifted(read, after - ONE_MILLISECOND).ok_or_else(out_of_range)
}

pub fn start_of(iso: &str, unit: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    Ok(to_iso(start_of_naive(dt, unit)?))
}

/// `start_of` against the WALL CLOCK in `zone`, returned as a UTC instant.
pub fn start_of_in_zone(utc_iso: &str, unit: &str, zone: &str) -> Result<String, String> {
    let dt = parse_iso(utc_iso)?;
    let tz = known_zone(zone)?;
    let local = Wall::of(&tz, dt)?;
    let naive = start_of_naive(local.clock, unit)?;
    Ok(to_iso(resolve_from(naive, local.offset, &tz)?))
}

/// `end_of` against the WALL CLOCK in `zone`, returned as a UTC instant.
pub fn end_of_in_zone(utc_iso: &str, unit: &str, zone: &str) -> Result<String, String> {
    let dt = parse_iso(utc_iso)?;
    let tz = known_zone(zone)?;
    let local = Wall::of(&tz, dt)?;
    // The start of the next unit, one millisecond back on the UTC side.
    let end = match next_unit_naive(local.clock, unit)? {
        NextStart::At(next) => {
            last_millisecond_before(resolve_from(next, local.offset, &tz)?, SignedDuration::ZERO)?
        }
        NextStart::YearTenThousand => last_millisecond_before(
            resolve_from(DateTime::MAX, local.offset, &tz)?,
            SignedDuration::from_nanos(1),
        )?,
    };
    Ok(to_iso(end))
}

pub fn end_of(iso: &str, unit: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    let end = match next_unit_naive(dt, unit)? {
        NextStart::At(next) => last_millisecond_before(next, SignedDuration::ZERO)?,
        NextStart::YearTenThousand => {
            last_millisecond_before(DateTime::MAX, SignedDuration::from_nanos(1))?
        }
    };
    Ok(to_iso(end))
}

pub fn format(iso: &str, pattern: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    Ok(render_pattern(dt, pattern))
}

/// A token of the moment-style patterns `format` reads.
#[derive(Clone, Copy)]
enum Token {
    Year,
    YearOfCentury,
    Month,
    Day,
    Hour,
    Minute,
    Second,
    Offset,
}

/// Render a moment-style pattern (`YYYY`, `YY`, `MM`, `DD`, `HH`, `mm`, `ss`,
/// `Z`) against a UTC wall clock.
///
/// The walk is **token-aware**. Chained `String::replace` on the whole pattern
/// used to break for two reasons:
///   1. `replace("YYYY", ...)` then `replace("MM", ...)` would substitute
///      inside literal text the user wanted preserved
///   2. `replace("Z", ...)` was global, corrupting any literal `Z` in the
///      pattern (e.g. `"YYYY-MM-DDTHH:mm:ss[Z]"` had its `Z` replaced even
///      though it was meant to stay literal)
///
/// Brackets `[...]` mark literal sections that pass through untouched (Luxon
/// convention; an unclosed one runs to the end). Outside brackets, recognized
/// tokens are written, longest first; any other character is kept as it is.
fn render_pattern(dt: DateTime, pattern: &str) -> String {
    const TOKENS: [(&str, Token); 8] = [
        ("YYYY", Token::Year),
        ("YY", Token::YearOfCentury),
        ("MM", Token::Month),
        ("DD", Token::Day),
        ("HH", Token::Hour),
        ("mm", Token::Minute),
        ("ss", Token::Second),
        // A literal Z is written `[Z]`.
        ("Z", Token::Offset),
    ];
    let mut out = String::with_capacity(pattern.len() * 2);
    let mut rest = pattern;
    while let Some(c) = rest.chars().next() {
        if c == '[' {
            // Literal section [...] — pass through verbatim, drop the brackets.
            let inner = &rest[1..];
            let (literal, after) = match inner.find(']') {
                Some(end) => (&inner[..end], &inner[end + 1..]),
                None => (inner, ""),
            };
            out.push_str(literal);
            rest = after;
            continue;
        }
        if let Some((src, token)) = TOKENS.iter().find(|(src, _)| rest.starts_with(src)) {
            match token {
                Token::Year => push_year(&mut out, dt.year()),
                Token::YearOfCentury => push_two(&mut out, i64::from(dt.year()).rem_euclid(100)),
                Token::Month => push_two(&mut out, dt.month()),
                Token::Day => push_two(&mut out, dt.day()),
                Token::Hour => push_two(&mut out, dt.hour()),
                Token::Minute => push_two(&mut out, dt.minute()),
                Token::Second => push_two(&mut out, dt.second()),
                // The value is UTC; the token writes its offset.
                Token::Offset => push_offset(&mut out, 0),
            }
            rest = &rest[src.len()..];
            continue;
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// `width` decimal digits of a non-negative value, zero-padded. Written by
/// hand rather than through `format!`: every result crosses the API as text,
/// and this is on the path of each one.
fn push_digits(out: &mut String, value: u32, width: u32) {
    for place in (0..width).rev() {
        let digit = (value / 10u32.pow(place)) % 10;
        out.push(char::from(b'0' + digit as u8));
    }
}

/// Two digits, zero-padded.
fn push_two(out: &mut String, value: impl Into<i64>) {
    push_digits(out, u32::try_from(value.into()).unwrap_or_default(), 2);
}

/// An ISO 8601 year: four digits for 0000-9999, an explicit sign otherwise.
fn push_year(out: &mut String, year: i16) {
    if !(0..=9999).contains(&year) {
        out.push(if year < 0 { '-' } else { '+' });
    }
    push_digits(out, u32::from(year.unsigned_abs()), 4);
}

/// `±HH:MM`, rounded to the nearest minute.
fn push_offset(out: &mut String, seconds: i32) {
    out.push(if seconds < 0 { '-' } else { '+' });
    let minutes = (seconds.unsigned_abs() + 30) / 60;
    push_digits(out, minutes / 60, 2);
    out.push(':');
    push_digits(out, minutes % 60, 2);
}

/// How many fractional digits an RFC 3339 rendering writes.
#[derive(Clone, Copy)]
enum Fraction {
    /// Always three.
    Millis,
    /// None, three, six or nine: as many as the value needs.
    Auto,
}

/// `YYYY-MM-DD`, `separator`, `HH:MM:SS` and the fraction.
fn push_clock(out: &mut String, clock: DateTime, separator: char, fraction: Fraction) {
    push_year(out, clock.year());
    out.push('-');
    push_two(out, clock.month());
    out.push('-');
    push_two(out, clock.day());
    out.push(separator);
    push_two(out, clock.hour());
    out.push(':');
    push_two(out, clock.minute());
    out.push(':');
    push_two(out, clock.second());
    let nanos = clock.subsec_nanosecond().unsigned_abs();
    let (value, width) = match fraction {
        Fraction::Millis => (nanos / 1_000_000, 3),
        Fraction::Auto if nanos == 0 => return,
        Fraction::Auto if nanos.is_multiple_of(1_000_000) => (nanos / 1_000_000, 3),
        Fraction::Auto if nanos.is_multiple_of(1_000) => (nanos / 1_000, 6),
        Fraction::Auto => (nanos, 9),
    };
    out.push('.');
    push_digits(out, value, width);
}

/// A wall clock as messages name it: `2026-03-29 02:30:00`.
pub(crate) fn clock_text(clock: DateTime) -> String {
    let mut out = String::with_capacity(32);
    push_clock(&mut out, clock, ' ', Fraction::Auto);
    out
}

/// An RFC 3339 rendering of a wall clock and its offset. `zulu` writes a zero
/// offset as `Z`.
fn rfc3339(clock: DateTime, offset_seconds: i32, fraction: Fraction, zulu: bool) -> String {
    let mut out = String::with_capacity(32);
    push_clock(&mut out, clock, 'T', fraction);
    if zulu && offset_seconds == 0 {
        out.push('Z');
    } else {
        push_offset(&mut out, offset_seconds);
    }
    out
}

// ─── Timezone support (Story 36.11) ─────────────────────────────────────────

/// The zone an IANA identifier names, spelled exactly as the database spells
/// it: `Europe/Paris` and the `US/Eastern` link, not `europe/paris`.
///
/// jiff looks names up without regard to case and answers with the database's
/// spelling, so a name is known only when that spelling is the one given.
/// `Factory` — tzdata's placeholder for "no zone configured yet", not a place —
/// is not a zone the engine accepts.
pub(crate) fn lookup_zone(name: &str) -> Option<TimeZone> {
    if name == "Factory" {
        return None;
    }
    let tz = jiff::tz::db().get(name).ok()?;
    (tz.iana_name() == Some(name)).then_some(tz)
}

fn known_zone(zone: &str) -> Result<TimeZone, String> {
    lookup_zone(zone).ok_or_else(|| format!("Unknown timezone: {}", zone))
}

/// Validate an IANA timezone identifier against the bundled tz database and
/// return it. Names are case-sensitive: `us/eastern` is refused, `US/Eastern`
/// (a link) is returned as it is.
pub fn validate_timezone(zone: &str) -> Result<String, String> {
    lookup_zone(zone)
    .map(|_| zone.to_string())
    .ok_or_else(|| format!("Unknown IANA timezone: '{}'. Check https://en.wikipedia.org/wiki/List_of_tz_database_time_zones", zone))
}

/// Convert a UTC ISO timestamp to the wall-clock time in the given IANA zone.
/// Returns `{ iso, offset, zoneName }` where `iso` is the local time with
/// offset suffix (e.g. `2026-04-08T16:00:00+02:00`) and `offset` is the
/// total UTC offset in minutes (e.g. 120 for `Europe/Paris` in summer).
pub fn to_zone(utc_iso: &str, zone: &str) -> Result<ZonedOutput, String> {
    let dt = parse_iso(utc_iso)?;
    let tz = known_zone(zone)?;
    let local = Wall::of(&tz, dt)?;
    let offset_seconds = local.offset_seconds();
    Ok(ZonedOutput {
        iso: rfc3339(local.clock, offset_seconds, Fraction::Auto, false),
        offset_minutes: offset_seconds / 60,
        zone_name: zone.to_string(),
    })
}

#[derive(Debug)]
pub struct ZonedOutput {
    pub iso: String,
    pub offset_minutes: i32,
    pub zone_name: String,
}

/// DST-aware addition: add `amount` of `unit` to a UTC instant, interpreting
/// calendar units (day/week/month/year) in the given IANA zone so that
/// "plus 1 day" preserves the wall-clock hour across DST transitions.
///
/// Clock units (hour/minute/second) always add exact durations — they are
/// timezone-independent and behave identically to the UTC `add` path.
pub fn add_in_zone(utc_iso: &str, amount: i64, unit: &str, zone: &str) -> Result<String, String> {
    let dt = parse_iso(utc_iso)?;
    let tz = known_zone(zone)?;

    let unit_lower = unit.to_ascii_lowercase();
    let local = Wall::of(&tz, dt)?;
    let shifted_local = match unit_lower.as_str() {
        // Calendar units — interpreted on the local wall clock.
        "days" | "day" => shifted(local.clock, checked_duration(amount, 86_400)?),
        "weeks" | "week" => shifted(local.clock, checked_duration(amount, 604_800)?),
        "months" | "month" => checked_add_months(local.clock, amount),
        "years" | "year" => amount
            .checked_mul(12)
            .and_then(|m| checked_add_months(local.clock, m)),
        other => match clock_unit_seconds(other) {
            // Clock units — exact durations, zone-independent.
            Some(seconds) => {
                let out =
                    shifted(dt, checked_duration(amount, seconds)?).ok_or_else(out_of_range)?;
                return Ok(to_iso(in_range(out)?));
            }
            None => return Err(format!("Unsupported unit: {}", unit)),
        },
    };
    let shifted_local = in_range(shifted_local.ok_or_else(out_of_range)?)?;
    Ok(to_iso(resolve_from(shifted_local, local.offset, &tz)?))
}

/// An instant together with its wall clock in a zone.
#[derive(Clone, Copy)]
struct Wall {
    /// The instant, as its UTC wall clock.
    utc: DateTime,
    /// The wall clock in the zone.
    clock: DateTime,
    /// The zone's offset at the instant, in seconds east of UTC.
    offset: i64,
}

impl Wall {
    fn of(tz: &TimeZone, utc: DateTime) -> Result<Wall, String> {
        let offset = offset_seconds_at(tz, utc);
        let clock = shifted(utc, SignedDuration::from_secs(offset)).ok_or_else(out_of_range)?;
        Ok(Wall { utc, clock, offset })
    }

    /// The offset as `i32`; a zone's offset is less than a day.
    fn offset_seconds(&self) -> i32 {
        i32::try_from(self.offset).unwrap_or_default()
    }
}

/// Move a zoned instant by whole months, keeping the wall-clock time; `None`
/// past the years a value can hold.
///
/// The same DST policy `resolve_from` applies elsewhere: an ambiguous local
/// time keeps the offset it had, and one that falls in a spring-forward gap
/// moves forward by the size of the gap.
fn add_months_in_zone(tz: &TimeZone, dt: Wall, months: i64) -> Option<Wall> {
    let naive = checked_add_months(dt.clock, months)?;
    let utc = resolve_from(naive, dt.offset, tz).ok()?;
    Wall::of(tz, utc).ok()
}

/// Diff two UTC instants with calendar-unit interpretation in the given zone.
/// Month/year diffs use the wall-clock date in the zone, not the UTC date.
pub fn diff_in_zone(a_utc: &str, b_utc: &str, unit: &str, zone: &str) -> Result<f64, String> {
    let unit_lower = unit.to_ascii_lowercase();
    // Calendar units are counted on the zone's calendar: a day across a DST
    // change is one day, not 23/24 of one.
    let (months_per_step, days_per_step) = match unit_lower.as_str() {
        "milliseconds" | "millisecond" | "seconds" | "second" | "minutes" | "minute" | "hours"
        | "hour" => return diff(a_utc, b_utc, unit),
        "days" | "day" => (0, 1),
        "weeks" | "week" => (0, 7),
        "months" | "month" => (1, 0),
        "years" | "year" => (12, 0),
        _ => return Err(format!("Unsupported unit: {}", unit)),
    };
    let tz = known_zone(zone)?;
    let a = Wall::of(&tz, parse_iso(a_utc)?)?;
    let b = Wall::of(&tz, parse_iso(b_utc)?)?;
    let sign = if a.utc >= b.utc { 1.0 } else { -1.0 };
    let (earlier, later) = if a.utc >= b.utc { (b, a) } else { (a, b) };

    // `steps` whole units from `base`, on the wall clock.
    let step_from = |base: Wall, steps: i64| -> Option<Wall> {
        if months_per_step > 0 {
            add_months_in_zone(&tz, base, steps * months_per_step)
        } else {
            add_days_in_zone(&tz, base, steps * days_per_step)
        }
    };
    // The instant `steps` whole units after `earlier`, read `cycles` times 400
    // years earlier; `None` past the years a value can hold.
    //
    // A unit can end past 9999-12-31, where no value reaches. It is then
    // measured 400 years earlier: the Gregorian calendar repeats every 400
    // years (146 097 days, a whole number of weeks), and so does a zone that
    // far ahead, where only its standing rule applies.
    let step_back = |steps: i64, cycles: i64| -> Option<DateTime> {
        let clock = if months_per_step > 0 {
            let months = steps.checked_mul(months_per_step)?;
            checked_add_months(earlier.clock, months.checked_sub(4_800 * cycles)?)?
        } else {
            let days = steps.checked_mul(days_per_step)?;
            let days = days.checked_sub(146_097 * cycles)?;
            shifted(
                earlier.clock,
                SignedDuration::from_hours(days.checked_mul(24)?),
            )?
        };
        resolve_from(clock, earlier.offset, &tz).ok()
    };
    let step = |steps: i64| step_back(steps, 0);
    let four_centuries = SignedDuration::from_hours(146_097 * 24);
    // Luxon's `highOrderDiffs`: estimate the whole units from the calendar
    // fields, back off when that overshoots, and measure the remainder against
    // the unit it falls in (a 23-hour day, a 28-day month) — not an average.
    let (lc, ec) = (later.clock, earlier.clock);
    let estimate = match (months_per_step, days_per_step) {
        (12, _) => i64::from(lc.year()) - i64::from(ec.year()),
        (1, _) => {
            (i64::from(lc.year()) - i64::from(ec.year())) * 12
                + (i64::from(lc.month()) - i64::from(ec.month()))
        }
        (_, days) => lc.date().duration_since(ec.date()).as_hours() / 24 / days,
    };
    // An instant past 9999 is past `later` too.
    let overshoots = |utc: Option<DateTime>| utc.is_none_or(|u| u > later.utc);
    let mut steps = estimate;
    let mut high_water = step(steps);
    let cursor = if overshoots(high_water) {
        steps -= 1;
        let mut cursor = step(steps);
        if overshoots(cursor) {
            high_water = cursor;
            steps -= 1;
            cursor = step(steps);
        }
        cursor
    } else {
        high_water
    }
    .unwrap_or(earlier.utc);
    let span = match high_water {
        // `later` lies in the unit after the cursor.
        Some(top) if top < later.utc => {
            let next = Wall::of(&tz, cursor).ok().and_then(|wall| {
                step_from(wall, 1)
                    .map(|end| millis_between(end.utc, wall.utc))
                    .or_else(|| {
                        let clock = checked_add_months(wall.clock, -4_800)?;
                        let utc = resolve_from(clock, wall.offset, &tz).ok()?;
                        let back = Wall::of(&tz, utc).ok()?;
                        step_from(back, 1).map(|end| millis_between(end.utc, back.utc))
                    })
            });
            next.unwrap_or(0.0)
        }
        Some(top) => millis_between(top, cursor),
        // The unit after the cursor ends past 9999.
        None => match (step_back(steps + 1, 1), shifted(cursor, -four_centuries)) {
            (Some(top), Some(base)) => millis_between(top, base),
            _ => 0.0,
        },
    };
    let rest = millis_between(later.utc, cursor);
    let fraction = if span == 0.0 { 0.0 } else { rest / span };
    Ok((steps as f64 + fraction) * sign)
}

/// Move a zoned instant by whole calendar days, keeping the wall-clock time;
/// `None` past the years a value can hold.
fn add_days_in_zone(tz: &TimeZone, dt: Wall, days: i64) -> Option<Wall> {
    let hours = days.checked_mul(24)?;
    let naive = shifted(dt.clock, SignedDuration::from_hours(hours))?;
    let utc = resolve_from(naive, dt.offset, tz).ok()?;
    Wall::of(tz, utc).ok()
}

/// Get the UTC offset in minutes for a given zone at a given UTC instant.
pub fn zone_offset(utc_iso: &str, zone: &str) -> Result<i32, String> {
    let dt = parse_iso(utc_iso)?;
    let tz = known_zone(zone)?;
    Ok(Wall::of(&tz, dt)?.offset_seconds() / 60)
}

/// Move by whole months, clamping the day to the target month's last one;
/// `None` past the years a value can hold.
fn checked_add_months(dt: DateTime, months: i64) -> Option<DateTime> {
    let month0 = i64::from(dt.month() - 1).checked_add(months)?;
    let year = i16::try_from(i64::from(dt.year()).checked_add(month0.div_euclid(12))?).ok()?;
    let month = i8::try_from(month0.rem_euclid(12) + 1).ok()?;
    let first = Date::new(year, month, 1).ok()?;
    let day = dt.day().min(first.days_in_month());
    // Nanoseconds carried through: month arithmetic moves the DATE, it does not
    // truncate the instant. Dropping them silently rounded every timestamp to the
    // whole second.
    Date::new(year, month, day)
        .ok()
        .map(|date| date.to_datetime(dt.time()))
}

/// The wall clock in `tz` of a UTC instant; `None` past the years a value can
/// hold.
pub(crate) fn local_clock(tz: &TimeZone, utc: DateTime) -> Option<DateTime> {
    Wall::of(tz, utc).ok().map(|wall| wall.clock)
}

/// The zone's UTC offset, in seconds, at a UTC wall-clock instant.
///
/// The last hours of 9999-12-31 lie past `Timestamp::MAX`; they are read at
/// that bound, where the zone's rules have no change of time left to make.
pub(crate) fn offset_seconds_at(tz: &TimeZone, utc: DateTime) -> i64 {
    let instant = Offset::UTC.to_timestamp(utc).unwrap_or(if utc.year() > 0 {
        Timestamp::MAX
    } else {
        Timestamp::MIN
    });
    i64::from(tz.to_offset(instant).seconds())
}

/// The UTC instant (as a UTC wall clock) for a wall-clock time, starting from a
/// guessed offset `o` (seconds) — Luxon's `fixOffset`. In an overlap it keeps
/// `o` when `o` is one of the two offsets; in a gap it reads the time with the
/// offset in force before the gap, which moves it forward by the size of the
/// gap whatever that size is.
pub(crate) fn fix_offset(local: DateTime, o: i64, tz: &TimeZone) -> Option<DateTime> {
    let utc_guess = shifted(local, SignedDuration::from_secs(-o))?;
    let o2 = offset_seconds_at(tz, utc_guess);
    if o == o2 {
        return Some(utc_guess);
    }
    let utc_guess = shifted(utc_guess, SignedDuration::from_secs(o - o2))?;
    let o3 = offset_seconds_at(tz, utc_guess);
    if o2 == o3 {
        return Some(utc_guess);
    }
    shifted(local, SignedDuration::from_secs(-o2.min(o3)))
}

/// How a wall clock reads in a zone: once, twice (an overlap, of which the
/// engine always takes the earlier instant), or not at all (a gap).
pub(crate) enum LocalTime {
    Single(DateTime),
    /// The earlier of the two instants.
    Ambiguous(DateTime),
    Gap,
}

/// The UTC instants a wall clock names in a zone.
pub(crate) fn local_time(tz: &TimeZone, local: DateTime) -> LocalTime {
    let at = |offset: Offset| {
        shifted(
            local,
            -SignedDuration::from_secs(i64::from(offset.seconds())),
        )
    };
    match tz.to_ambiguous_timestamp(local).offset() {
        AmbiguousOffset::Unambiguous { offset } => {
            at(offset).map_or(LocalTime::Gap, LocalTime::Single)
        }
        AmbiguousOffset::Fold { before, after } => match (at(before), at(after)) {
            (Some(first), Some(second)) => LocalTime::Ambiguous(first.min(second)),
            (Some(only), None) | (None, Some(only)) => LocalTime::Single(only),
            (None, None) => LocalTime::Gap,
        },
        AmbiguousOffset::Gap { .. } => LocalTime::Gap,
    }
}

/// Resolve a zone-local wall clock back to a UTC instant. Handles DST
/// ambiguity via the "earliest" policy (spring-forward gaps → move forward,
/// fall-back overlaps → pick the first occurrence).
fn resolve_local(naive_local: DateTime, tz: &TimeZone) -> Result<String, String> {
    match local_time(tz, naive_local) {
        LocalTime::Single(utc) | LocalTime::Ambiguous(utc) => Ok(to_iso(utc)),
        // In a gap: the offset before it, which moves the time forward by the
        // size of the gap (02:30 → 03:30), whatever that size is.
        LocalTime::Gap => {
            let guess = offset_seconds_at(tz, naive_local);
            Ok(to_iso(resolve_from(naive_local, guess, tz)?))
        }
    }
}

/// A wall clock reached by arithmetic on a value whose offset was `previous`,
/// resolved as Luxon does: an overlap keeps the previous offset, a gap moves
/// the time forward by the size of the gap.
fn resolve_from(local: DateTime, previous: i64, tz: &TimeZone) -> Result<DateTime, String> {
    fix_offset(local, previous, tz).ok_or_else(out_of_range)
}

/// Convert a **local** naive datetime (e.g. "2026-07-16T00:00:00") to a UTC
/// instant by resolving it in the given IANA timezone. Handles DST gaps via
/// the "earliest" policy (spring-forward → advance, fall-back → first occurrence).
///
/// This is the inverse of `to_zone`: `to_zone` goes UTC→local; this function
/// goes local→UTC. Used by the TS `startOf`/`endOf` zone-aware path.
pub fn from_local(naive_iso: &str, zone: &str) -> Result<String, String> {
    // Strip any offset/Z suffix the caller may have left on — we want naive.
    let clean = naive_iso.trim_end_matches('Z').trim();
    let naive = grammar::datetime(clean, grammar::DATE_T_TIME)
        .or_else(|_| grammar::datetime(clean, grammar::DATE_SPACE_TIME))
        .map_err(|e| format!("Invalid naive datetime '{}': {}", naive_iso, e))?;
    let tz = known_zone(zone)?;
    resolve_local(naive, &tz)
}

/// Calendar-derived properties exposed in one shot so the TS layer can read
/// every accessor (`weekday`, `weekNumber`, `ordinal`, `quarter`,
/// `daysInMonth`, `daysInYear`, `isInLeapYear`) with a single NAPI hop. This
/// matches the Atom pattern of "fetch the whole bag at once" rather than one
/// NAPI call per accessor — the cost of the marshalling is the same for one
/// number or seven.
#[derive(Debug)]
pub struct CalendarParts {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub millisecond: u32,
    /// ISO 8601 weekday: 1 = Monday, 7 = Sunday.
    pub weekday: u32,
    /// ISO 8601 week of year: 1-53.
    pub week_number: u32,
    /// ISO 8601 week-numbering year (may differ from `year` near year boundaries).
    pub week_year: i32,
    /// Day of year, 1-366.
    pub ordinal: u32,
    /// Quarter, 1-4.
    pub quarter: u32,
    /// Number of days in this month (28-31).
    pub days_in_month: u32,
    /// Number of days in this year (365 or 366).
    pub days_in_year: u32,
    pub is_leap_year: bool,
}

/// A calendar field as `u32`; every one is positive.
fn field(value: impl Into<i32>) -> u32 {
    u32::try_from(value.into()).unwrap_or_default()
}

pub fn calendar_parts(iso: &str) -> Result<CalendarParts, String> {
    let nd = parse_iso(iso)?;
    let date = nd.date();
    let iso_week = date.iso_week_date();
    Ok(CalendarParts {
        year: i32::from(nd.year()),
        month: field(nd.month()),
        day: field(nd.day()),
        hour: field(nd.hour()),
        minute: field(nd.minute()),
        second: field(nd.second()),
        millisecond: field(nd.subsec_nanosecond() / 1_000_000),
        weekday: field(date.weekday().to_monday_one_offset()),
        week_number: field(iso_week.week()),
        week_year: i32::from(iso_week.year()),
        ordinal: field(date.day_of_year()),
        quarter: field((nd.month() - 1) / 3 + 1),
        days_in_month: field(date.days_in_month()),
        days_in_year: field(date.days_in_year()),
        is_leap_year: date.in_leap_year(),
    })
}

/// Parse an RFC 2822 date string (email / HTTP legacy format).
pub fn parse_rfc2822(input: &str) -> Result<String, String> {
    grammar::rfc2822(input.trim())
        .map(to_iso)
        .map_err(|e| format!("Invalid RFC 2822 date: {} ({})", input, e))
}

/// Read `count` ASCII digits at the start of `s`.
fn leading_digits(s: &str, count: usize) -> Option<(u32, &str)> {
    let head = s.get(..count)?;
    if !head.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((head.parse().ok()?, &s[count..]))
}

/// A parsed SQL field as the integer type a civil value takes.
fn sql_field<T: TryFrom<u32>>(value: u32) -> Option<T> {
    T::try_from(value).ok()
}

/// Parse a SQL date/time literal the way databases print them: `YYYY-MM-DD`
/// (a `date` column) or `YYYY-MM-DD HH:MM[:SS[.fffffffff]]`, optionally
/// followed, with or without a space, by an offset (`Z`, `+HH`, `+HHMM`,
/// `+HH:MM` — PostgreSQL prints a `timestamptz` as `2026-08-10 12:00:00+00`) or
/// an IANA zone name. A value with neither is a wall clock in `zone`, UTC when
/// none is given.
pub fn parse_sql(input: &str, zone: Option<&str>) -> Result<String, String> {
    let invalid = || format!("Invalid SQL datetime: {}", input);
    let s = input.trim();
    let (year, rest) = leading_digits(s, 4).ok_or_else(invalid)?;
    let rest = rest.strip_prefix('-').ok_or_else(invalid)?;
    let (month, rest) = leading_digits(rest, 2).ok_or_else(invalid)?;
    let rest = rest.strip_prefix('-').ok_or_else(invalid)?;
    let (day, mut rest) = leading_digits(rest, 2).ok_or_else(invalid)?;
    let date = match (sql_field(year), sql_field(month), sql_field(day)) {
        (Some(y), Some(m), Some(d)) => Date::new(y, m, d).map_err(|_| invalid())?,
        _ => return Err(invalid()),
    };

    let mut time = Time::midnight();
    if let Some(after) = rest.strip_prefix([' ', 'T']) {
        let (hour, r) = leading_digits(after, 2).ok_or_else(invalid)?;
        let r = r.strip_prefix(':').ok_or_else(invalid)?;
        let (minute, mut r) = leading_digits(r, 2).ok_or_else(invalid)?;
        let mut second = 0;
        let mut nanos = 0;
        if let Some(sec) = r.strip_prefix(':') {
            let (value, after_sec) = leading_digits(sec, 2).ok_or_else(invalid)?;
            second = value;
            r = after_sec;
            if let Some(fraction) = r.strip_prefix('.') {
                let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
                if digits == 0 || digits > 9 {
                    return Err(invalid());
                }
                let value: u32 = fraction[..digits].parse().map_err(|_| invalid())?;
                nanos = value * 10u32.pow(9 - digits as u32);
                r = &fraction[digits..];
            }
        }
        time = match (
            sql_field(hour),
            sql_field(minute),
            sql_field(second),
            sql_field(nanos),
        ) {
            (Some(h), Some(m), Some(sec), Some(ns)) => {
                Time::new(h, m, sec, ns).map_err(|_| invalid())?
            }
            _ => return Err(invalid()),
        };
        rest = r;
    }
    let wall = date.to_datetime(time);

    let suffix = rest.strip_prefix(' ').unwrap_or(rest);
    let instant = if suffix.is_empty() {
        match zone {
            None => wall,
            Some(name) => {
                let tz = known_zone(name)?;
                return resolve_local(in_range(wall)?, &tz);
            }
        }
    } else if suffix.eq_ignore_ascii_case("z") {
        wall
    } else if let Some(sign) = suffix.chars().next().filter(|c| *c == '+' || *c == '-') {
        let (hours, r) = leading_digits(&suffix[1..], 2).ok_or_else(invalid)?;
        let r = r.strip_prefix(':').unwrap_or(r);
        let minutes = if r.is_empty() {
            0
        } else {
            let (m, end) = leading_digits(r, 2).ok_or_else(invalid)?;
            if !end.is_empty() {
                return Err(invalid());
            }
            m
        };
        if hours > 23 || minutes > 59 {
            return Err(invalid());
        }
        let seconds = i64::from(hours * 3600 + minutes * 60);
        let east = if sign == '-' { -seconds } else { seconds };
        shifted(wall, SignedDuration::from_secs(-east)).ok_or_else(out_of_range)?
    } else {
        let tz = lookup_zone(suffix).ok_or_else(invalid)?;
        return resolve_local(in_range(wall)?, &tz);
    };
    Ok(to_iso(in_range(instant)?))
}

/// Parse an HTTP date (`Mon, 02 Apr 2026 14:00:00 GMT`).
pub fn parse_http(input: &str) -> Result<String, String> {
    // RFC 7231 §7.1.1.1 defines three formats — try them in order.
    let s = input.trim();
    // Preferred: IMF-fixdate (same as RFC 2822 with "GMT")
    if let Ok(dt) = grammar::rfc2822(s) {
        return Ok(to_iso(dt));
    }
    // RFC 850 format: Sunday, 02-Apr-26 14:00:00 GMT
    if let Ok(nd) = grammar::datetime(s.trim_end_matches(" GMT"), grammar::RFC_850) {
        return Ok(to_iso(nd));
    }
    // asctime: Mon Apr  2 14:00:00 2026
    if let Ok(nd) = grammar::datetime(s, grammar::ASCTIME) {
        return Ok(to_iso(nd));
    }
    Err(format!("Invalid HTTP date: {}", input))
}

/// Expand a recurrence. `start_iso` is the UTC start instant, or `None` when
/// the rule text carries its own `DTSTART` line; `tzid` runs the rule on that
/// zone's wall clock. See [`rrule::expand`].
pub fn rrule_expand(
    start_iso: Option<&str>,
    rrule: &str,
    limit: usize,
    tzid: Option<&str>,
) -> Result<Vec<String>, String> {
    rrule::expand(start_iso, rrule, limit, tzid)
}

/// An instant written as RFC 3339 or as a `YYYY-MM-DD[ HH:MM:SS]` UTC wall
/// clock, as its UTC wall clock.
fn parse_iso(input: &str) -> Result<DateTime, String> {
    grammar::rfc3339(input)
        .or_else(|_| grammar::datetime(input, grammar::DATE_SPACE_TIME))
        .or_else(|_| grammar::date(input, grammar::DATE).map(|d| d.to_datetime(Time::midnight())))
        .map_err(|_| format!("Invalid ISO date-time: {}", input))
}

fn to_iso(dt: DateTime) -> String {
    // ALWAYS milliseconds, even when they are zero: `2026-04-08T14:00:00.000Z`.
    //
    // That is what Luxon's `toISO()` returns, and therefore what a serialized
    // model reads under `@adonisjs/lucid`. The compact form is Luxon's opt-in
    // `toISO({ suppressMilliseconds: true })`.
    //
    // It also keeps ONE canonical form: this engine and the TypeScript side used
    // to strip `.000` independently, each justified by matching the other, and
    // an rrule expansion therefore disagreed with `DateTime.toISO()` on the same
    // instant — the same value, two literals, across the NAPI boundary.
    rfc3339(dt, 0, Fraction::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_diff_work() {
        let a = add("2026-01-15T10:00:00.000Z", 1, "month").unwrap();
        assert_eq!(a, "2026-02-15T10:00:00.000Z");
        // `a - b`, as Luxon spells it: the 15th is two days BEFORE the 17th.
        let d = diff(
            "2026-01-15T10:00:00.000Z",
            "2026-01-17T10:00:00.000Z",
            "days",
        )
        .unwrap();
        assert_eq!(d, -2.0);
    }

    #[test]
    fn rrule_monthly_works() {
        let out = rrule_expand(
            Some("2026-01-15T15:00:00.000Z"),
            "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3",
            10,
            None,
        )
        .unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], "2026-01-15T15:00:00.000Z");
        assert_eq!(out[1], "2026-02-15T15:00:00.000Z");
    }

    #[test]
    fn rrule_weekly_works() {
        let out = rrule_expand(
            Some("2026-01-06T15:00:00.000Z"),
            "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
            10,
            None,
        )
        .unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[0], "2026-01-06T15:00:00.000Z");
    }

    #[test]
    fn rrule_byday_ordinal_last_sunday() {
        let out = rrule_expand(
            Some("2026-01-01T12:00:00.000Z"),
            "FREQ=MONTHLY;BYDAY=-1SU;COUNT=3",
            10,
            None,
        )
        .unwrap();
        assert_eq!(out[0], "2026-01-25T12:00:00.000Z");
        assert_eq!(out[1], "2026-02-22T12:00:00.000Z");
        assert_eq!(out[2], "2026-03-29T12:00:00.000Z");
    }

    #[test]
    fn rrule_hourly_multi_minute_with_bysetpos() {
        let out = rrule_expand(
            Some("2026-01-01T10:00:00.000Z"),
            "FREQ=HOURLY;BYMINUTE=0,30;BYSECOND=0;BYSETPOS=-1;COUNT=3",
            10,
            None,
        )
        .unwrap();
        assert_eq!(
            out,
            vec![
                "2026-01-01T10:30:00.000Z",
                "2026-01-01T11:30:00.000Z",
                "2026-01-01T12:30:00.000Z",
            ]
        );
    }

    #[test]
    fn rrule_yearly_byweekno_and_byday() {
        let out = rrule_expand(
            Some("2026-01-01T09:00:00.000Z"),
            "FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO;COUNT=2",
            10,
            None,
        )
        .unwrap();
        assert_eq!(out[0], "2027-01-04T09:00:00.000Z");
        assert_eq!(out[1], "2028-01-03T09:00:00.000Z");
    }

    #[test]
    fn rrule_yearly_byyearday_negative() {
        let out = rrule_expand(
            Some("2026-01-01T00:00:00.000Z"),
            "FREQ=YEARLY;BYYEARDAY=-1;COUNT=2",
            10,
            None,
        )
        .unwrap();
        assert_eq!(out[0], "2026-12-31T00:00:00.000Z");
        assert_eq!(out[1], "2027-12-31T00:00:00.000Z");
    }

    // === Audit Phase 1 — fix tests ===

    #[test]
    fn to_iso_preserves_milliseconds() {
        // Round-trip through the engine — milliseconds must survive.
        let result = add("2026-04-08T14:00:00.500Z", 1, "second").unwrap();
        assert_eq!(result, "2026-04-08T14:00:01.500Z");
    }

    #[test]
    fn to_iso_keeps_zero_milliseconds() {
        // `.000` is written even when the milliseconds are zero, as Luxon's
        // `toISO()` and `Date.toISOString()` both write it.
        let result = add("2026-04-08T14:00:00.000Z", 1, "second").unwrap();
        assert_eq!(result, "2026-04-08T14:00:01.000Z");
    }

    #[test]
    fn parse_sql_reads_what_databases_print() {
        let cases = [
            ("2026-08-10 12:00:00+00", "2026-08-10T12:00:00.000Z"),
            ("2026-08-10 12:00:00.123+02:00", "2026-08-10T10:00:00.123Z"),
            ("2026-08-10 12:00:00-0530", "2026-08-10T17:30:00.000Z"),
            ("2026-08-10 12:00:00 +02", "2026-08-10T10:00:00.000Z"),
            ("2026-08-10 12:00:00Z", "2026-08-10T12:00:00.000Z"),
            ("2026-08-10 12:00", "2026-08-10T12:00:00.000Z"),
            ("2026-08-10", "2026-08-10T00:00:00.000Z"),
            (
                "2026-08-10 12:00:00 Europe/Paris",
                "2026-08-10T10:00:00.000Z",
            ),
            ("2026-08-10 12:00:00.123456789", "2026-08-10T12:00:00.123Z"),
        ];
        for (input, expected) in cases {
            assert_eq!(parse_sql(input, None).unwrap(), expected, "{}", input);
        }
        assert_eq!(
            parse_sql("2026-08-10 12:00:00", Some("Europe/Paris")).unwrap(),
            "2026-08-10T10:00:00.000Z"
        );
        // An explicit offset wins over the zone.
        assert_eq!(
            parse_sql("2026-08-10 12:00:00+00", Some("Europe/Paris")).unwrap(),
            "2026-08-10T12:00:00.000Z"
        );
        for bad in [
            "2026-08-10 12",
            "2026-8-10",
            "2026-02-30",
            "2026-08-10 12:00:00+24",
            "2026-08-10 12:00:00 Nowhere/X",
            "2026-08-10 12:00:00.",
            "2026-08-10 12:00:00+02:00x",
            "10000-01-01",
        ] {
            assert!(parse_sql(bad, None).is_err(), "{}", bad);
        }
    }

    #[test]
    fn huge_amounts_are_range_errors_not_panics() {
        let base = "2026-06-01T00:00:00.000Z";
        for unit in ["second", "minute", "hour", "day", "week", "month", "year"] {
            for amount in [i64::MAX, i64::MIN, 1_000_000_000_000_000_000] {
                let err = add(base, amount, unit).unwrap_err();
                assert!(err.contains("out of range"), "{} {}: {}", amount, unit, err);
                let err = add_in_zone(base, amount, unit, "Europe/Paris").unwrap_err();
                assert!(err.contains("out of range"), "{} {}: {}", amount, unit, err);
            }
        }
        assert!(add(base, 7974, "year")
            .unwrap_err()
            .contains("out of range"));
        assert_eq!(add(base, 7973, "year").unwrap(), "9999-06-01T00:00:00.000Z");
        assert!(add(base, -2027, "year")
            .unwrap_err()
            .contains("out of range"));
    }

    #[test]
    fn format_keeps_multi_byte_literals() {
        assert_eq!(
            format("2026-06-01T00:00:00Z", "YYYY年MM月DD日").unwrap(),
            "2026年06月01日"
        );
        assert_eq!(
            format("2026-06-01T00:00:00Z", "[é] HH [à] mm°").unwrap(),
            "é 00 à 00°"
        );
        assert_eq!(format("2026-06-01T00:00:00Z", "[100%]").unwrap(), "100%");
    }

    #[test]
    fn format_literal_brackets() {
        // `[Z]` is a literal Z, not a timezone token.
        let result = format("2026-04-08T14:00:00.000Z", "YYYY-MM-DD[T]HH:mm:ss[Z]").unwrap();
        // The format tokens carry no milliseconds, so this stays compact — the
        // canonical ISO form is `toISO()`, not a caller-chosen token string.
        assert_eq!(result, "2026-04-08T14:00:00Z");
    }

    #[test]
    fn format_year_only_no_z_corruption() {
        // `YYYY` followed by no token must not be corrupted.
        let result = format("2026-04-08T14:00:00.000Z", "YYYY").unwrap();
        assert_eq!(result, "2026");
    }

    #[test]
    fn calendar_parts_isoweek_and_quarter() {
        let parts = calendar_parts("2026-04-08T14:30:45.000Z").unwrap();
        assert_eq!(parts.year, 2026);
        assert_eq!(parts.month, 4);
        assert_eq!(parts.day, 8);
        assert_eq!(parts.hour, 14);
        assert_eq!(parts.minute, 30);
        assert_eq!(parts.second, 45);
        assert_eq!(parts.weekday, 3); // Wednesday
        assert_eq!(parts.quarter, 2);
        assert_eq!(parts.days_in_month, 30);
        assert!(!parts.is_leap_year);
    }

    #[test]
    fn calendar_parts_leap_year() {
        let parts = calendar_parts("2024-02-29T00:00:00.000Z").unwrap();
        assert_eq!(parts.days_in_month, 29);
        assert_eq!(parts.days_in_year, 366);
        assert!(parts.is_leap_year);
        assert_eq!(parts.ordinal, 60);
    }

    // === Timezone tests (Story 36.11) ===

    #[test]
    fn validate_timezone_valid() {
        assert_eq!(validate_timezone("Europe/Paris").unwrap(), "Europe/Paris");
        assert_eq!(validate_timezone("US/Eastern").unwrap(), "US/Eastern");
        assert_eq!(
            validate_timezone("Pacific/Chatham").unwrap(),
            "Pacific/Chatham"
        );
    }

    #[test]
    fn validate_timezone_invalid() {
        assert!(validate_timezone("Not/A/Zone").is_err());
        assert!(validate_timezone("").is_err());
    }

    #[test]
    fn to_zone_paris_summer() {
        // 2026-07-15 14:00 UTC → 16:00 CEST (UTC+2)
        let result = to_zone("2026-07-15T14:00:00.000Z", "Europe/Paris").unwrap();
        assert!(result.iso.contains("16:00:00"));
        assert_eq!(result.offset_minutes, 120);
    }

    #[test]
    fn to_zone_paris_winter() {
        // 2026-01-15 14:00 UTC → 15:00 CET (UTC+1)
        let result = to_zone("2026-01-15T14:00:00.000Z", "Europe/Paris").unwrap();
        assert!(result.iso.contains("15:00:00"));
        assert_eq!(result.offset_minutes, 60);
    }

    #[test]
    fn to_zone_chatham_45min_offset() {
        // Pacific/Chatham is UTC+12:45 / +13:45
        let result = to_zone("2026-01-15T00:00:00.000Z", "Pacific/Chatham").unwrap();
        // Summer in southern hemisphere → CHADT = UTC+13:45
        assert_eq!(result.offset_minutes, 825); // 13*60 + 45
    }

    #[test]
    fn add_in_zone_dst_spring_forward() {
        // Europe/Paris springs forward on 2026-03-29 at 02:00 → 03:00.
        // Adding 1 day to 2026-03-28T10:00:00 UTC (= 11:00 CET) should land on
        // 2026-03-29T09:00:00 UTC (= 11:00 CEST), preserving wall-clock 11:00.
        let result = add_in_zone("2026-03-28T10:00:00.000Z", 1, "day", "Europe/Paris").unwrap();
        // Parse the result and check the wall-clock time in Paris.
        let result_paris = to_zone(&result, "Europe/Paris").unwrap();
        assert!(
            result_paris.iso.contains("11:00:00"),
            "Expected wall-clock 11:00, got {}",
            result_paris.iso
        );
    }

    #[test]
    fn dst_resolution_matches_luxon() {
        let zoned = |iso: &str, zone: &str| to_zone(iso, zone).unwrap().iso;
        // Gap: 02:30 does not exist on the 29th; the time moves by the gap.
        let gap = add_in_zone("2026-03-28T01:30:00.000Z", 1, "day", "Europe/Paris").unwrap();
        assert_eq!(zoned(&gap, "Europe/Paris"), "2026-03-29T03:30:00+02:00");
        // Overlap: 02:30 exists twice on the 25th; the previous offset (+01:00) is kept.
        let overlap = add_in_zone("2026-10-26T01:30:00.000Z", -1, "day", "Europe/Paris").unwrap();
        assert_eq!(zoned(&overlap, "Europe/Paris"), "2026-10-25T02:30:00+01:00");
        // A 24-hour gap (Samoa skipped 2011-12-30) is a calendar step, not an error.
        let apia = add_in_zone("2011-12-29T22:00:00.000Z", 1, "day", "Pacific/Apia").unwrap();
        assert_eq!(zoned(&apia, "Pacific/Apia"), "2011-12-31T12:00:00+14:00");
        // Lord Howe's 30-minute gap.
        let howe = from_local("2026-10-04T02:15:00", "Australia/Lord_Howe").unwrap();
        assert_eq!(
            zoned(&howe, "Australia/Lord_Howe"),
            "2026-10-04T02:45:00+11:00"
        );
    }

    #[test]
    fn diff_in_zone_counts_calendar_days_across_dst() {
        let paris = "Europe/Paris";
        // 12:00 local on the 28th to 12:00 local on the 29th: 23 hours, one day.
        let spring = diff_in_zone(
            "2026-03-29T10:00:00.000Z",
            "2026-03-28T11:00:00.000Z",
            "day",
            paris,
        )
        .unwrap();
        assert_eq!(spring, 1.0);
        let autumn = diff_in_zone(
            "2026-10-24T10:00:00.000Z",
            "2026-10-25T11:00:00.000Z",
            "days",
            paris,
        )
        .unwrap();
        assert_eq!(autumn, -1.0);
        // From midnight on the 29th (23:00Z the day before), half of that
        // 23-hour day is 11:30 later.
        let half = diff_in_zone(
            "2026-03-29T10:30:00.000Z",
            "2026-03-28T23:00:00.000Z",
            "day",
            paris,
        )
        .unwrap();
        assert!((half - 0.5).abs() < 1e-12, "{}", half);
        let week = diff_in_zone(
            "2026-04-04T11:00:00.000Z",
            "2026-03-28T12:00:00.000Z",
            "week",
            paris,
        )
        .unwrap();
        assert_eq!(week, 1.0);
    }

    #[test]
    fn add_in_zone_dst_fall_back() {
        // Europe/Paris falls back on 2026-10-25 at 03:00 → 02:00.
        // Adding 1 day to 2026-10-24T10:00:00 UTC (= 12:00 CEST) should land on
        // 2026-10-25T11:00:00 UTC (= 12:00 CET), preserving wall-clock 12:00.
        let result = add_in_zone("2026-10-24T10:00:00.000Z", 1, "day", "Europe/Paris").unwrap();
        let result_paris = to_zone(&result, "Europe/Paris").unwrap();
        assert!(
            result_paris.iso.contains("12:00:00"),
            "Expected wall-clock 12:00, got {}",
            result_paris.iso
        );
    }

    #[test]
    fn diff_in_zone_month() {
        let result = diff_in_zone(
            "2026-01-15T10:00:00.000Z",
            "2026-03-15T10:00:00.000Z",
            "month",
            "Europe/Paris",
        )
        .unwrap();
        assert_eq!(result, -2.0);
    }

    #[test]
    fn zone_offset_summer_vs_winter() {
        let summer = zone_offset("2026-07-15T12:00:00.000Z", "Europe/Paris").unwrap();
        let winter = zone_offset("2026-01-15T12:00:00.000Z", "Europe/Paris").unwrap();
        assert_eq!(summer, 120); // CEST
        assert_eq!(winter, 60); // CET
    }

    #[test]
    fn calendar_parts_iso_week_year_boundary() {
        // 2026-01-01 is a Thursday — falls in ISO week 1 of 2026.
        let parts = calendar_parts("2026-01-01T00:00:00.000Z").unwrap();
        assert_eq!(parts.week_number, 1);
        assert_eq!(parts.week_year, 2026);
        // 2024-12-30 is a Monday — ISO week 1 of 2025 (week-numbering year shifts).
        let parts = calendar_parts("2024-12-30T00:00:00.000Z").unwrap();
        assert_eq!(parts.week_number, 1);
        assert_eq!(parts.week_year, 2025);
    }
}
