use chrono::{
    DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, Offset, TimeZone, Timelike, Utc,
};
use chrono_tz::Tz;

pub mod rrule;

/// Years a value may carry: what a four-digit ISO 8601 year can write, so every
/// result can be read back by `parse_iso`.
const MIN_YEAR: i32 = 0;
const MAX_YEAR: i32 = 9999;

fn out_of_range() -> String {
    format!(
        "Date arithmetic result is out of range: years are limited to {:04}-{}",
        MIN_YEAR, MAX_YEAR
    )
}

fn in_range<T: Datelike>(value: T) -> Result<T, String> {
    if (MIN_YEAR..=MAX_YEAR).contains(&value.year()) {
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

/// `amount × seconds` as a Duration, or an out-of-range error instead of the
/// panic `Duration::seconds` raises past its bounds.
fn checked_duration(amount: i64, seconds: i64) -> Result<Duration, String> {
    amount
        .checked_mul(seconds)
        .and_then(Duration::try_seconds)
        .ok_or_else(out_of_range)
}

pub fn add(iso: &str, amount: i64, unit: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    let unit = unit.to_ascii_lowercase();
    let out = match unit.as_str() {
        "days" | "day" => dt.checked_add_signed(checked_duration(amount, 86_400)?),
        "weeks" | "week" => dt.checked_add_signed(checked_duration(amount, 604_800)?),
        "months" | "month" => checked_add_months(dt.naive_utc(), amount).map(|n| n.and_utc()),
        "years" | "year" => amount
            .checked_mul(12)
            .and_then(|m| checked_add_months(dt.naive_utc(), m))
            .map(|n| n.and_utc()),
        other => match clock_unit_seconds(other) {
            Some(seconds) => dt.checked_add_signed(checked_duration(amount, seconds)?),
            None => return Err(format!("Unsupported unit: {}", unit)),
        },
    };
    Ok(to_iso(in_range(out.ok_or_else(out_of_range)?)?))
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
    let ms = (a - b).num_milliseconds() as f64;
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

/// Truncate a naive datetime to the start of `unit`.
///
/// The ONE place boundary arithmetic lives. `start_of` applies it to a UTC
/// instant and `start_of_in_zone` to a wall-clock one — before this existed the
/// zoned path was a hand-written switch in TypeScript, and the two drifted:
/// `second` was added to one and not the other, so the same call answered
/// differently depending on the zone.
fn start_of_naive(nd: NaiveDateTime, unit: &str) -> Result<NaiveDateTime, String> {
    let date = nd.date();
    let out = match unit.to_ascii_lowercase().as_str() {
        "year" => NaiveDate::from_ymd_opt(date.year(), 1, 1).and_then(|d| d.and_hms_opt(0, 0, 0)),
        "month" => NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
            .and_then(|d| d.and_hms_opt(0, 0, 0)),
        "week" => {
            let offset = date.weekday().num_days_from_monday() as i64;
            (date - Duration::days(offset)).and_hms_opt(0, 0, 0)
        }
        "day" => date.and_hms_opt(0, 0, 0),
        "hour" => date.and_hms_opt(nd.hour(), 0, 0),
        "minute" => date.and_hms_opt(nd.hour(), nd.minute(), 0),
        "second" => date.and_hms_opt(nd.hour(), nd.minute(), nd.second()),
        _ => return Err(format!("Unsupported unit: {}", unit)),
    };
    out.ok_or_else(|| format!("Invalid {} start", unit))
}

/// The start of the unit AFTER the one containing `nd` — the other half of
/// `end_of`, kept beside `start_of_naive` so the two unit lists cannot drift.
fn next_unit_naive(nd: NaiveDateTime, unit: &str) -> Result<NaiveDateTime, String> {
    let start = start_of_naive(nd, unit)?;
    Ok(match unit.to_ascii_lowercase().as_str() {
        "year" => add_months_naive(start, 12),
        "month" => add_months_naive(start, 1),
        "week" => start + Duration::weeks(1),
        "day" => start + Duration::days(1),
        "hour" => start + Duration::hours(1),
        "minute" => start + Duration::minutes(1),
        "second" => start + Duration::seconds(1),
        _ => return Err(format!("Unsupported unit: {}", unit)),
    })
}

pub fn start_of(iso: &str, unit: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    let naive = start_of_naive(dt.naive_utc(), unit)?;
    Ok(to_iso(Utc.from_utc_datetime(&naive)))
}

/// `start_of` against the WALL CLOCK in `zone`, returned as a UTC instant.
pub fn start_of_in_zone(utc_iso: &str, unit: &str, zone: &str) -> Result<String, String> {
    let dt = parse_iso(utc_iso)?;
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;
    let local = dt.with_timezone(&tz);
    let naive = start_of_naive(local.naive_local(), unit)?;
    Ok(to_iso(resolve_from(naive, offset_of(&local), tz)?))
}

/// `end_of` against the WALL CLOCK in `zone`, returned as a UTC instant.
pub fn end_of_in_zone(utc_iso: &str, unit: &str, zone: &str) -> Result<String, String> {
    let dt = parse_iso(utc_iso)?;
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;
    let local = dt.with_timezone(&tz);
    let next = next_unit_naive(local.naive_local(), unit)?;
    // The start of the next unit, one millisecond back on the UTC side.
    let next_utc = resolve_from(next, offset_of(&local), tz)?;
    Ok(to_iso(next_utc - Duration::milliseconds(1)))
}

pub fn end_of(iso: &str, unit: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    let next = next_unit_naive(dt.naive_utc(), unit)?;
    Ok(to_iso(
        Utc.from_utc_datetime(&next) - Duration::milliseconds(1),
    ))
}

pub fn format(iso: &str, pattern: &str) -> Result<String, String> {
    let dt = parse_iso(iso)?;
    let chrono_pattern = translate_pattern(pattern);
    Ok(dt.format(&chrono_pattern).to_string())
}

/// Translate a Luxon-style pattern to chrono's `strftime` format with
/// **token-aware** substitution.
///
/// Previously this function did chained `String::replace` on the whole
/// pattern, which broke for two reasons:
///   1. `replace("YYYY", ...)` then `replace("MM", ...)` would substitute
///      inside literal text the user wanted preserved
///   2. `replace("Z", ...)` was global, corrupting any literal `Z` in the
///      pattern (e.g. `"YYYY-MM-DDTHH:mm:ss[Z]"` had its `Z` replaced even
///      though it was meant to stay literal)
///
/// The new implementation walks the pattern character-by-character. Brackets
/// `[...]` mark literal sections that pass through untouched (Luxon
/// convention). Outside brackets, recognized tokens are translated; anything
/// else is escaped via `%%` so chrono treats it literally.
fn translate_pattern(pattern: &str) -> String {
    const TOKENS: [(&str, &str); 8] = [
        ("YYYY", "%Y"),
        ("YY", "%y"),
        ("MM", "%m"),
        ("DD", "%d"),
        ("HH", "%H"),
        ("mm", "%M"),
        ("ss", "%S"),
        // A literal Z is written `[Z]`.
        ("Z", "%:z"),
    ];
    // Literal text is pushed char by char, never byte by byte: a byte of a
    // multi-byte character pushed as a `char` is a different, Latin-1 one.
    let push_literal = |out: &mut String, c: char| {
        if c == '%' {
            out.push_str("%%");
        } else {
            out.push(c);
        }
    };
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
            for lc in literal.chars() {
                push_literal(&mut out, lc);
            }
            rest = after;
            continue;
        }
        // Longest match first, so `YYYY` beats `YY`.
        if let Some((src, dst)) = TOKENS.iter().find(|(src, _)| rest.starts_with(src)) {
            out.push_str(dst);
            rest = &rest[src.len()..];
            continue;
        }
        push_literal(&mut out, c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

// ─── Timezone support (Story 36.11) ─────────────────────────────────────────

/// Validate an IANA timezone identifier against the `chrono-tz` database.
/// Returns the canonical name on success (e.g. normalizes `us/eastern` to
/// `US/Eastern`).
pub fn validate_timezone(zone: &str) -> Result<String, String> {
    zone.parse::<Tz>()
    .map(|tz| tz.name().to_string())
    .map_err(|_| format!("Unknown IANA timezone: '{}'. Check https://en.wikipedia.org/wiki/List_of_tz_database_time_zones", zone))
}

/// Convert a UTC ISO timestamp to the wall-clock time in the given IANA zone.
/// Returns `{ iso, offset, zoneName }` where `iso` is the local time with
/// offset suffix (e.g. `2026-04-08T16:00:00+02:00`) and `offset` is the
/// total UTC offset in minutes (e.g. 120 for `Europe/Paris` in summer).
pub fn to_zone(utc_iso: &str, zone: &str) -> Result<ZonedOutput, String> {
    let dt = parse_iso(utc_iso)?;
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;
    let local = dt.with_timezone(&tz);
    let offset_seconds = local.offset().fix().local_minus_utc();
    let offset_minutes = offset_seconds / 60;
    // Format with the local offset.
    let iso = local.to_rfc3339();
    Ok(ZonedOutput {
        iso,
        offset_minutes,
        zone_name: tz.name().to_string(),
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
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;

    let unit_lower = unit.to_ascii_lowercase();
    let local = dt.with_timezone(&tz).naive_local();
    let shifted = match unit_lower.as_str() {
        // Calendar units — interpreted on the local wall clock.
        "days" | "day" => local.checked_add_signed(checked_duration(amount, 86_400)?),
        "weeks" | "week" => local.checked_add_signed(checked_duration(amount, 604_800)?),
        "months" | "month" => checked_add_months(local, amount),
        "years" | "year" => amount
            .checked_mul(12)
            .and_then(|m| checked_add_months(local, m)),
        other => match clock_unit_seconds(other) {
            // Clock units — exact durations, zone-independent.
            Some(seconds) => {
                let out = dt
                    .checked_add_signed(checked_duration(amount, seconds)?)
                    .ok_or_else(out_of_range)?;
                return Ok(to_iso(in_range(out)?));
            }
            None => return Err(format!("Unsupported unit: {}", unit)),
        },
    };
    let shifted = in_range(shifted.ok_or_else(out_of_range)?)?;
    let previous = offset_of(&dt.with_timezone(&tz));
    Ok(to_iso(resolve_from(shifted, previous, tz)?))
}

/// Diff two UTC instants with calendar-unit interpretation in the given zone.
/// Month/year diffs use the wall-clock date in the zone, not the UTC date.
/// Move a zoned instant by whole months, keeping the wall-clock time.
///
/// The same DST policy `resolve_local` applies elsewhere: an ambiguous local
/// time takes the first occurrence, and one that falls in a spring-forward gap
/// steps forward to the first that exists.
fn add_months_in_zone(dt: DateTime<Tz>, months: i64) -> DateTime<Tz> {
    let tz = dt.timezone();
    let naive = add_months_naive(dt.naive_local(), months);
    resolve_from(naive, offset_of(&dt), tz)
        .map(|utc| utc.with_timezone(&tz))
        .unwrap_or(dt)
}

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
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;
    let a = parse_iso(a_utc)?.with_timezone(&tz);
    let b = parse_iso(b_utc)?.with_timezone(&tz);
    let sign = if a >= b { 1.0 } else { -1.0 };
    let (earlier, later) = if a >= b { (b, a) } else { (a, b) };

    // `steps` whole units from `base`, on the wall clock.
    let step_from = |base: DateTime<Tz>, steps: i64| -> DateTime<Tz> {
        if months_per_step > 0 {
            add_months_in_zone(base, steps * months_per_step)
        } else {
            add_days_in_zone(base, steps * days_per_step)
        }
    };
    let step = |steps: i64| step_from(earlier, steps);
    // Luxon's `highOrderDiffs`: estimate the whole units from the calendar
    // fields, back off when that overshoots, and measure the remainder against
    // the unit it falls in (a 23-hour day, a 28-day month) — not an average.
    let estimate = match (months_per_step, days_per_step) {
        (12, _) => later.year() as i64 - earlier.year() as i64,
        (1, _) => {
            (later.year() as i64 - earlier.year() as i64) * 12
                + (later.month() as i64 - earlier.month() as i64)
        }
        (_, days) => (later.date_naive() - earlier.date_naive()).num_days() / days,
    };
    let mut steps = estimate;
    let mut high_water = step(steps);
    let cursor = if high_water > later {
        steps -= 1;
        let mut cursor = step(steps);
        if cursor > later {
            high_water = cursor;
            steps -= 1;
            cursor = step(steps);
        }
        cursor
    } else {
        high_water
    };
    if high_water < later {
        high_water = step_from(cursor, 1);
    }
    let span = (high_water - cursor).num_milliseconds() as f64;
    let rest = (later - cursor).num_milliseconds() as f64;
    let fraction = if span == 0.0 { 0.0 } else { rest / span };
    Ok((steps as f64 + fraction) * sign)
}

/// Move a zoned instant by whole calendar days, keeping the wall-clock time.
fn add_days_in_zone(dt: DateTime<Tz>, days: i64) -> DateTime<Tz> {
    let tz = dt.timezone();
    Duration::try_days(days)
        .and_then(|d| dt.naive_local().checked_add_signed(d))
        .and_then(|naive| resolve_from(naive, offset_of(&dt), tz).ok())
        .map(|utc| utc.with_timezone(&tz))
        .unwrap_or(dt)
}

/// Get the UTC offset in minutes for a given zone at a given UTC instant.
pub fn zone_offset(utc_iso: &str, zone: &str) -> Result<i32, String> {
    let dt = parse_iso(utc_iso)?;
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;
    let local = dt.with_timezone(&tz);
    Ok(local.offset().fix().local_minus_utc() / 60)
}

/// Add months to a `NaiveDateTime`, clamping the day to the target month's
/// max (same as the UTC `add_months` but on NaiveDateTime for zone-local use).
fn add_months_naive(dt: NaiveDateTime, months: i64) -> NaiveDateTime {
    checked_add_months(dt, months).unwrap_or(dt)
}

/// Move by whole months, clamping the day to the target month's last one;
/// `None` when the year leaves what an `i32` holds.
fn checked_add_months(dt: NaiveDateTime, months: i64) -> Option<NaiveDateTime> {
    let month0 = i64::from(dt.month0()).checked_add(months)?;
    let year = i32::try_from(i64::from(dt.year()).checked_add(month0.div_euclid(12))?).ok()?;
    let month = u32::try_from(month0.rem_euclid(12) + 1).ok()?;
    let day = dt.day().min(days_in_month(year, month));
    // Nanoseconds carried through: month arithmetic moves the DATE, it does not
    // truncate the instant. Dropping them silently rounded every timestamp to the
    // whole second.
    NaiveDate::from_ymd_opt(year, month, day)
        .and_then(|d| d.and_hms_nano_opt(dt.hour(), dt.minute(), dt.second(), dt.nanosecond()))
}

/// The zone's UTC offset, in seconds, at a UTC wall-clock instant.
pub(crate) fn offset_seconds_at(tz: Tz, utc: NaiveDateTime) -> i64 {
    i64::from(tz.offset_from_utc_datetime(&utc).fix().local_minus_utc())
}

/// The UTC instant (as a naive UTC date-time) for a wall-clock time, starting
/// from a guessed offset `o` (seconds) — Luxon's `fixOffset`. In an overlap it
/// keeps `o` when `o` is one of the two offsets; in a gap it reads the time
/// with the offset in force before the gap, which moves it forward by the size
/// of the gap whatever that size is.
pub(crate) fn fix_offset(local: NaiveDateTime, o: i64, tz: Tz) -> Option<NaiveDateTime> {
    let utc_guess = local.checked_sub_signed(Duration::try_seconds(o)?)?;
    let o2 = offset_seconds_at(tz, utc_guess);
    if o == o2 {
        return Some(utc_guess);
    }
    let utc_guess = utc_guess.checked_sub_signed(Duration::try_seconds(o2 - o)?)?;
    let o3 = offset_seconds_at(tz, utc_guess);
    if o2 == o3 {
        return Some(utc_guess);
    }
    local.checked_sub_signed(Duration::try_seconds(o2.min(o3))?)
}

/// Resolve a zone-local NaiveDateTime back to a UTC instant. Handles DST
/// ambiguity via the "earliest" policy (spring-forward gaps → move forward,
/// fall-back overlaps → pick the first occurrence).
fn resolve_local(naive_local: NaiveDateTime, tz: Tz) -> Result<String, String> {
    use chrono::LocalResult;
    match tz.from_local_datetime(&naive_local) {
        LocalResult::Single(dt) => Ok(to_iso(dt.with_timezone(&Utc))),
        LocalResult::Ambiguous(first, _) => Ok(to_iso(first.with_timezone(&Utc))),
        // In a gap: the offset before it, which moves the time forward by the
        // size of the gap (02:30 → 03:30), whatever that size is.
        LocalResult::None => {
            let guess = offset_seconds_at(tz, naive_local);
            Ok(to_iso(resolve_from(naive_local, guess, tz)?))
        }
    }
}

/// The UTC offset of a zoned value, in seconds.
fn offset_of(dt: &DateTime<Tz>) -> i64 {
    i64::from(dt.offset().fix().local_minus_utc())
}

/// A wall clock reached by arithmetic on a value whose offset was `previous`,
/// resolved as Luxon does: an overlap keeps the previous offset, a gap moves
/// the time forward by the size of the gap.
fn resolve_from(local: NaiveDateTime, previous: i64, tz: Tz) -> Result<DateTime<Utc>, String> {
    fix_offset(local, previous, tz)
        .map(|utc| utc.and_utc())
        .ok_or_else(out_of_range)
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
    let naive = NaiveDateTime::parse_from_str(clean, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(clean, "%Y-%m-%d %H:%M:%S"))
        .map_err(|e| format!("Invalid naive datetime '{}': {}", naive_iso, e))?;
    let tz: Tz = zone
        .parse()
        .map_err(|_| format!("Unknown timezone: {}", zone))?;
    resolve_local(naive, tz)
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

pub fn calendar_parts(iso: &str) -> Result<CalendarParts, String> {
    let dt = parse_iso(iso)?;
    let nd = dt.naive_utc();
    let iso_week = nd.iso_week();
    let leap = NaiveDate::from_ymd_opt(nd.year(), 2, 29).is_some();
    Ok(CalendarParts {
        year: nd.year(),
        month: nd.month(),
        day: nd.day(),
        hour: nd.hour(),
        minute: nd.minute(),
        second: nd.second(),
        millisecond: nd.and_utc().timestamp_subsec_millis(),
        weekday: nd.weekday().number_from_monday(),
        week_number: iso_week.week(),
        week_year: iso_week.year(),
        ordinal: nd.ordinal(),
        quarter: ((nd.month() - 1) / 3) + 1,
        days_in_month: days_in_month(nd.year(), nd.month()),
        days_in_year: if leap { 366 } else { 365 },
        is_leap_year: leap,
    })
}

/// Parse an RFC 2822 date string (email / HTTP legacy format).
pub fn parse_rfc2822(input: &str) -> Result<String, String> {
    DateTime::parse_from_rfc2822(input.trim())
        .map(|dt| to_iso(dt.with_timezone(&Utc)))
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
    let date = NaiveDate::from_ymd_opt(year as i32, month, day).ok_or_else(invalid)?;

    let mut time = chrono::NaiveTime::MIN;
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
        time = chrono::NaiveTime::from_hms_nano_opt(hour, minute, second, nanos)
            .ok_or_else(invalid)?;
        rest = r;
    }
    let wall = date.and_time(time);

    let suffix = rest.strip_prefix(' ').unwrap_or(rest);
    let instant = if suffix.is_empty() {
        match zone {
            None => Utc.from_utc_datetime(&wall),
            Some(name) => {
                let tz: Tz = name
                    .parse()
                    .map_err(|_| format!("Unknown timezone: {}", name))?;
                return resolve_local(in_range(wall)?, tz);
            }
        }
    } else if suffix.eq_ignore_ascii_case("z") {
        Utc.from_utc_datetime(&wall)
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
        let seconds = i32::try_from(hours * 3600 + minutes * 60).map_err(|_| invalid())?;
        let offset = if sign == '-' {
            chrono::FixedOffset::west_opt(seconds)
        } else {
            chrono::FixedOffset::east_opt(seconds)
        }
        .ok_or_else(invalid)?;
        offset
            .from_local_datetime(&wall)
            .single()
            .ok_or_else(invalid)?
            .with_timezone(&Utc)
    } else {
        let tz: Tz = suffix.parse().map_err(|_| invalid())?;
        return resolve_local(in_range(wall)?, tz);
    };
    Ok(to_iso(in_range(instant)?))
}

/// Parse an HTTP date (`Mon, 02 Apr 2026 14:00:00 GMT`).
pub fn parse_http(input: &str) -> Result<String, String> {
    // RFC 7231 §7.1.1.1 defines three formats — try them in order.
    let s = input.trim();
    // Preferred: IMF-fixdate (same as RFC 2822 with "GMT")
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        return Ok(to_iso(dt.with_timezone(&Utc)));
    }
    // RFC 850 format: Sunday, 02-Apr-26 14:00:00 GMT
    if let Ok(nd) =
        NaiveDateTime::parse_from_str(s.trim_end_matches(" GMT"), "%A, %d-%b-%y %H:%M:%S")
    {
        return Ok(to_iso(Utc.from_utc_datetime(&nd)));
    }
    // asctime: Mon Apr  2 14:00:00 2026
    if let Ok(nd) = NaiveDateTime::parse_from_str(s, "%a %b %e %H:%M:%S %Y") {
        return Ok(to_iso(Utc.from_utc_datetime(&nd)));
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

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        _ => 31,
    }
}

fn parse_iso(input: &str) -> Result<DateTime<Utc>, String> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(input) {
        return Ok(dt.with_timezone(&Utc));
    }
    if let Ok(nd) = NaiveDateTime::parse_from_str(input, "%Y-%m-%d %H:%M:%S") {
        return Ok(Utc.from_utc_datetime(&nd));
    }
    if let Ok(d) = NaiveDate::parse_from_str(input, "%Y-%m-%d") {
        return Ok(Utc.from_utc_datetime(&d.and_time(chrono::NaiveTime::MIN)));
    }
    Err(format!("Invalid ISO date-time: {}", input))
}

fn to_iso(dt: DateTime<Utc>) -> String {
    // ALWAYS `Millis`, even when they are zero: `2026-04-08T14:00:00.000Z`.
    //
    // That is what Luxon's `toISO()` returns, and therefore what a serialized
    // model reads under `@adonisjs/lucid`. The compact form is Luxon's opt-in
    // `toISO({ suppressMilliseconds: true })`.
    //
    // It also keeps ONE canonical form: this engine and the TypeScript side used
    // to strip `.000` independently, each justified by matching the other, and
    // an rrule expansion therefore disagreed with `DateTime.toISO()` on the same
    // instant — the same value, two literals, across the NAPI boundary.
    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
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
    fn to_iso_drops_zero_milliseconds_for_compactness() {
        // When subseconds are zero, the compact form is preferred so the output
        // matches `Date.toISOString().replace('.000Z', 'Z')` from the JS side.
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
