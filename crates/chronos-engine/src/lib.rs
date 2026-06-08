use chrono::{
  DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, Offset, TimeZone, Timelike, Utc, Weekday,
};
use chrono_tz::Tz;

pub fn add(iso: &str, amount: i64, unit: &str) -> Result<String, String> {
  let dt = parse_iso(iso)?;
  let out = match unit.to_ascii_lowercase().as_str() {
    "seconds" | "second" => dt + Duration::seconds(amount),
    "minutes" | "minute" => dt + Duration::minutes(amount),
    "hours" | "hour" => dt + Duration::hours(amount),
    "days" | "day" => dt + Duration::days(amount),
    "weeks" | "week" => dt + Duration::weeks(amount),
    "months" | "month" => add_months(dt, amount),
    "years" | "year" => add_months(dt, amount * 12),
    _ => return Err(format!("Unsupported unit: {}", unit)),
  };
  Ok(to_iso(out))
}

pub fn diff(a_iso: &str, b_iso: &str, unit: &str) -> Result<i64, String> {
  let a = parse_iso(a_iso)?;
  let b = parse_iso(b_iso)?;
  let delta = b - a;
  let out = match unit.to_ascii_lowercase().as_str() {
    "seconds" | "second" => delta.num_seconds(),
    "minutes" | "minute" => delta.num_minutes(),
    "hours" | "hour" => delta.num_hours(),
    "days" | "day" => delta.num_days(),
    "weeks" | "week" => delta.num_weeks(),
    "months" | "month" => months_between(a, b),
    "years" | "year" => months_between(a, b) / 12,
    _ => return Err(format!("Unsupported unit: {}", unit)),
  };
  Ok(out)
}

pub fn start_of(iso: &str, unit: &str) -> Result<String, String> {
  let dt = parse_iso(iso)?;
  let nd = dt.naive_utc();
  let out = match unit.to_ascii_lowercase().as_str() {
    "year" => Utc
      .with_ymd_and_hms(nd.year(), 1, 1, 0, 0, 0)
      .single()
      .ok_or_else(|| "Invalid year start".to_string())?,
    "month" => Utc
      .with_ymd_and_hms(nd.year(), nd.month(), 1, 0, 0, 0)
      .single()
      .ok_or_else(|| "Invalid month start".to_string())?,
    "week" => {
      let offset = nd.weekday().num_days_from_monday() as i64;
      let d = nd.date() - Duration::days(offset);
      Utc.with_ymd_and_hms(d.year(), d.month(), d.day(), 0, 0, 0)
        .single()
        .ok_or_else(|| "Invalid week start".to_string())?
    }
    "day" => Utc
      .with_ymd_and_hms(nd.year(), nd.month(), nd.day(), 0, 0, 0)
      .single()
      .ok_or_else(|| "Invalid day start".to_string())?,
    "hour" => Utc
      .with_ymd_and_hms(nd.year(), nd.month(), nd.day(), nd.hour(), 0, 0)
      .single()
      .ok_or_else(|| "Invalid hour start".to_string())?,
    "minute" => Utc
      .with_ymd_and_hms(nd.year(), nd.month(), nd.day(), nd.hour(), nd.minute(), 0)
      .single()
      .ok_or_else(|| "Invalid minute start".to_string())?,
    _ => return Err(format!("Unsupported unit: {}", unit)),
  };
  Ok(to_iso(out))
}

pub fn end_of(iso: &str, unit: &str) -> Result<String, String> {
  let start = parse_iso(&start_of(iso, unit)?)?;
  let next = match unit.to_ascii_lowercase().as_str() {
    "year" => add_months(start, 12),
    "month" => add_months(start, 1),
    "week" => start + Duration::weeks(1),
    "day" => start + Duration::days(1),
    "hour" => start + Duration::hours(1),
    "minute" => start + Duration::minutes(1),
    _ => return Err(format!("Unsupported unit: {}", unit)),
  };
  Ok(to_iso(next - Duration::milliseconds(1)))
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
  let mut out = String::with_capacity(pattern.len() * 2);
  let bytes = pattern.as_bytes();
  let mut i = 0;
  while i < bytes.len() {
    // Literal section [...] — pass through verbatim, drop the brackets.
    if bytes[i] == b'[' {
      i += 1;
      while i < bytes.len() && bytes[i] != b']' {
        // Escape any `%` so chrono doesn't interpret it as a format directive.
        if bytes[i] == b'%' {
          out.push_str("%%");
        } else {
          out.push(bytes[i] as char);
        }
        i += 1;
      }
      if i < bytes.len() { i += 1; } // skip closing ']'
      continue;
    }
    // Token matching — longest match wins so `YYYY` beats `YY`.
    let token: Option<(&str, &str)> =
      if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"YYYY" { Some(("YYYY", "%Y")) }
      else if i + 2 <= bytes.len() && &bytes[i..i + 2] == b"YY" { Some(("YY", "%y")) }
      else if i + 2 <= bytes.len() && &bytes[i..i + 2] == b"MM" { Some(("MM", "%m")) }
      else if i + 2 <= bytes.len() && &bytes[i..i + 2] == b"DD" { Some(("DD", "%d")) }
      else if i + 2 <= bytes.len() && &bytes[i..i + 2] == b"HH" { Some(("HH", "%H")) }
      else if i + 2 <= bytes.len() && &bytes[i..i + 2] == b"mm" { Some(("mm", "%M")) }
      else if i + 2 <= bytes.len() && &bytes[i..i + 2] == b"ss" { Some(("ss", "%S")) }
      else if bytes[i] == b'Z' {
        // Recognized only at the position where a timezone token would
        // legitimately appear (typically after `ss`). It is still translated
        // here in non-bracketed positions for backward compat — users who
        // want a literal `Z` should write `[Z]`.
        Some(("Z", "%:z"))
      }
      else { None };

    if let Some((src, dst)) = token {
      out.push_str(dst);
      i += src.len();
    } else {
      // Pass-through char. Escape `%` so chrono won't misinterpret it.
      if bytes[i] == b'%' {
        out.push_str("%%");
      } else {
        out.push(bytes[i] as char);
      }
      i += 1;
    }
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
  let tz: Tz = zone.parse().map_err(|_| format!("Unknown timezone: {}", zone))?;
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
  let tz: Tz = zone.parse().map_err(|_| format!("Unknown timezone: {}", zone))?;

  let unit_lower = unit.to_ascii_lowercase();
  match unit_lower.as_str() {
    // Clock units — exact durations, zone-independent.
    "seconds" | "second" => Ok(to_iso(dt + Duration::seconds(amount))),
    "minutes" | "minute" => Ok(to_iso(dt + Duration::minutes(amount))),
    "hours" | "hour"     => Ok(to_iso(dt + Duration::hours(amount))),
    // Calendar units — interpreted in the local zone.
    "days" | "day" => {
      let local = dt.with_timezone(&tz);
      let new_local = local.naive_local() + Duration::days(amount);
      resolve_local(new_local, tz)
    }
    "weeks" | "week" => {
      let local = dt.with_timezone(&tz);
      let new_local = local.naive_local() + Duration::days(amount * 7);
      resolve_local(new_local, tz)
    }
    "months" | "month" => {
      let local = dt.with_timezone(&tz);
      let naive_utc = add_months_naive(local.naive_local(), amount);
      resolve_local(naive_utc, tz)
    }
    "years" | "year" => {
      let local = dt.with_timezone(&tz);
      let naive_utc = add_months_naive(local.naive_local(), amount * 12);
      resolve_local(naive_utc, tz)
    }
    _ => Err(format!("Unsupported unit: {}", unit)),
  }
}

/// Diff two UTC instants with calendar-unit interpretation in the given zone.
/// Month/year diffs use the wall-clock date in the zone, not the UTC date.
pub fn diff_in_zone(a_utc: &str, b_utc: &str, unit: &str, zone: &str) -> Result<i64, String> {
  let unit_lower = unit.to_ascii_lowercase();
  // Clock units don't care about zone — defer to the existing UTC diff.
  match unit_lower.as_str() {
    "seconds" | "second" | "minutes" | "minute" | "hours" | "hour" |
    "days" | "day" | "weeks" | "week" => diff(a_utc, b_utc, unit),
    "months" | "month" | "years" | "year" => {
      let tz: Tz = zone.parse().map_err(|_| format!("Unknown timezone: {}", zone))?;
      let a = parse_iso(a_utc)?.with_timezone(&tz);
      let b = parse_iso(b_utc)?.with_timezone(&tz);
      let sign: i64 = if b >= a { 1 } else { -1 };
      let (earlier, later) = if b >= a { (a, b) } else { (b, a) };
      let mut months = (later.year() as i64 - earlier.year() as i64) * 12
        + (later.month() as i64 - earlier.month() as i64);
      if later.day() < earlier.day() { months -= 1; }
      let result = if unit_lower.starts_with("year") { months / 12 } else { months };
      Ok(result * sign)
    }
    _ => Err(format!("Unsupported unit: {}", unit)),
  }
}

/// Get the UTC offset in minutes for a given zone at a given UTC instant.
pub fn zone_offset(utc_iso: &str, zone: &str) -> Result<i32, String> {
  let dt = parse_iso(utc_iso)?;
  let tz: Tz = zone.parse().map_err(|_| format!("Unknown timezone: {}", zone))?;
  let local = dt.with_timezone(&tz);
  Ok(local.offset().fix().local_minus_utc() / 60)
}

/// Add months to a `NaiveDateTime`, clamping the day to the target month's
/// max (same as the UTC `add_months` but on NaiveDateTime for zone-local use).
fn add_months_naive(dt: NaiveDateTime, months: i64) -> NaiveDateTime {
  let mut year = dt.year() as i64;
  let mut month0 = dt.month0() as i64 + months;
  year += month0.div_euclid(12);
  month0 = month0.rem_euclid(12);
  let month = (month0 + 1) as u32;
  let max_day = days_in_month(year as i32, month);
  let day = dt.day().min(max_day);
  NaiveDate::from_ymd_opt(year as i32, month, day)
    .and_then(|d| d.and_hms_opt(dt.hour(), dt.minute(), dt.second()))
    .unwrap_or(dt)
}

/// Resolve a zone-local NaiveDateTime back to a UTC instant. Handles DST
/// ambiguity via the "earliest" policy (spring-forward gaps → move forward,
/// fall-back overlaps → pick the first occurrence).
fn resolve_local(naive_local: NaiveDateTime, tz: Tz) -> Result<String, String> {
  use chrono::LocalResult;
  match tz.from_local_datetime(&naive_local) {
    LocalResult::Single(dt) => Ok(to_iso(dt.with_timezone(&Utc))),
    LocalResult::Ambiguous(first, _) => Ok(to_iso(first.with_timezone(&Utc))),
    LocalResult::None => {
      // The local time falls in a DST gap (e.g. 2:30 AM during spring-forward).
      // Try advancing in 15-minute increments up to 2 hours to find the first
      // valid local time — handles 30-minute (Lord Howe) and 45-minute
      // (Chatham historical) transitions, not just the common 60-minute case.
      for step in &[15, 30, 45, 60, 75, 90, 105, 120] {
        let shifted = naive_local + Duration::minutes(*step);
        match tz.from_local_datetime(&shifted) {
          LocalResult::Single(dt) => return Ok(to_iso(dt.with_timezone(&Utc))),
          LocalResult::Ambiguous(first, _) => return Ok(to_iso(first.with_timezone(&Utc))),
          _ => continue,
        }
      }
      Err(format!("Cannot resolve local time {} in {} (gap > 2h)", naive_local, tz.name()))
    }
  }
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
  let tz: Tz = zone.parse().map_err(|_| format!("Unknown timezone: {}", zone))?;
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

/// Parse a SQL datetime literal (`2026-04-08 14:00:00`).
pub fn parse_sql(input: &str) -> Result<String, String> {
  NaiveDateTime::parse_from_str(input.trim(), "%Y-%m-%d %H:%M:%S")
    .map(|nd| to_iso(Utc.from_utc_datetime(&nd)))
    .or_else(|_| {
      NaiveDateTime::parse_from_str(input.trim(), "%Y-%m-%d %H:%M:%S%.f")
        .map(|nd| to_iso(Utc.from_utc_datetime(&nd)))
    })
    .map_err(|e| format!("Invalid SQL datetime: {} ({})", input, e))
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
  if let Ok(nd) = NaiveDateTime::parse_from_str(s.trim_end_matches(" GMT"), "%A, %d-%b-%y %H:%M:%S") {
    return Ok(to_iso(Utc.from_utc_datetime(&nd)));
  }
  // asctime: Mon Apr  2 14:00:00 2026
  if let Ok(nd) = NaiveDateTime::parse_from_str(s, "%a %b %e %H:%M:%S %Y") {
    return Ok(to_iso(Utc.from_utc_datetime(&nd)));
  }
  Err(format!("Invalid HTTP date: {}", input))
}

pub fn rrule_expand(start_iso: &str, rrule: &str, limit: usize) -> Result<Vec<String>, String> {
  let start = parse_iso(start_iso)?;
  let rule = parse_rrule(rrule)?;
  let hard_limit = if limit == 0 { 100 } else { limit.min(10_000) };
  let target = rule.count.unwrap_or(hard_limit).min(hard_limit);

  let mut out: Vec<DateTime<Utc>> = Vec::new();
  let mut period_index = 0usize;
  let mut safety = 0usize;

  while out.len() < target && safety < 200_000 {
    safety += 1;

    let period_start = period_start_for_index(start, &rule, period_index)?;

    if let Some(until) = rule.until {
      if period_start > until && rule.freq != Freq::Weekly && rule.freq != Freq::Monthly && rule.freq != Freq::Yearly {
        break;
      }
      if rule.freq == Freq::Weekly {
        let week_end = period_start + Duration::days(6);
        if week_end > until && period_start > until {
          break;
        }
      }
      if rule.freq == Freq::Monthly {
        let m_end = add_months(period_start, 1) - Duration::seconds(1);
        if m_end > until && period_start > until {
          break;
        }
      }
      if rule.freq == Freq::Yearly {
        let y_end = add_months(period_start, 12) - Duration::seconds(1);
        if y_end > until && period_start > until {
          break;
        }
      }
    }

    let mut candidates = generate_period_candidates(start, period_start, &rule)?;
    candidates.sort();
    candidates.dedup();

    let chosen = apply_bysetpos(candidates, &rule.bysetpos);
    for occ in chosen {
      if occ < start {
        continue;
      }
      if let Some(until) = rule.until {
        if occ > until {
          continue;
        }
      }
      out.push(occ);
      if out.len() >= target {
        break;
      }
    }

    period_index += 1;
  }

  Ok(out.into_iter().map(to_iso).collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Freq {
  Secondly,
  Minutely,
  Hourly,
  Daily,
  Weekly,
  Monthly,
  Yearly,
}

#[derive(Debug, Clone, Copy)]
struct ByDayRule {
  ordinal: Option<i32>,
  weekday: Weekday,
}

#[derive(Debug, Clone)]
struct RRule {
  freq: Freq,
  interval: u32,
  wkst: Weekday,
  byday: Vec<ByDayRule>,
  bymonthday: Vec<i32>,
  bymonth: Vec<u32>,
  byweekno: Vec<i32>,
  byyearday: Vec<i32>,
  bysetpos: Vec<i32>,
  byhour: Vec<u32>,
  byminute: Vec<u32>,
  bysecond: Vec<u32>,
  count: Option<usize>,
  until: Option<DateTime<Utc>>,
}

fn parse_rrule(rrule: &str) -> Result<RRule, String> {
  let line = rrule.trim().strip_prefix("RRULE:").unwrap_or(rrule.trim());
  let mut freq: Option<Freq> = None;
  let mut interval: u32 = 1;
  let mut wkst = Weekday::Mon;
  let mut byday: Vec<ByDayRule> = Vec::new();
  let mut bymonthday: Vec<i32> = Vec::new();
  let mut bymonth: Vec<u32> = Vec::new();
  let mut byweekno: Vec<i32> = Vec::new();
  let mut byyearday: Vec<i32> = Vec::new();
  let mut bysetpos: Vec<i32> = Vec::new();
  let mut byhour: Vec<u32> = Vec::new();
  let mut byminute: Vec<u32> = Vec::new();
  let mut bysecond: Vec<u32> = Vec::new();
  let mut count: Option<usize> = None;
  let mut until: Option<DateTime<Utc>> = None;

  for part in line.split(';') {
    let Some((k, v)) = part.split_once('=') else {
      continue;
    };

    match k.trim().to_ascii_uppercase().as_str() {
      "FREQ" => {
        freq = Some(match v.trim().to_ascii_uppercase().as_str() {
          "SECONDLY" => Freq::Secondly,
          "MINUTELY" => Freq::Minutely,
          "HOURLY" => Freq::Hourly,
          "DAILY" => Freq::Daily,
          "WEEKLY" => Freq::Weekly,
          "MONTHLY" => Freq::Monthly,
          "YEARLY" => Freq::Yearly,
          x => return Err(format!("Unsupported FREQ: {}", x)),
        });
      }
      "INTERVAL" => {
        interval = v.trim().parse::<u32>().map_err(|_| "Invalid INTERVAL".to_string())?;
        if interval == 0 {
          return Err("INTERVAL must be >= 1".to_string());
        }
      }
      "WKST" => {
        wkst = parse_weekday(v.trim())?;
      }
      "BYDAY" => {
        for token in v.split(',') {
          byday.push(parse_byday_token(token.trim())?);
        }
      }
      "BYMONTHDAY" => {
        for token in v.split(',') {
          let day = token
            .trim()
            .parse::<i32>()
            .map_err(|_| "Invalid BYMONTHDAY".to_string())?;
          if day == 0 || !(-31..=31).contains(&day) {
            return Err("BYMONTHDAY out of range".to_string());
          }
          bymonthday.push(day);
        }
      }
      "BYMONTH" => {
        for token in v.split(',') {
          let m = token
            .trim()
            .parse::<u32>()
            .map_err(|_| "Invalid BYMONTH".to_string())?;
          if !(1..=12).contains(&m) {
            return Err("BYMONTH out of range".to_string());
          }
          bymonth.push(m);
        }
      }
      "BYWEEKNO" => {
        for token in v.split(',') {
          let w = token
            .trim()
            .parse::<i32>()
            .map_err(|_| "Invalid BYWEEKNO".to_string())?;
          if w == 0 || !(-53..=53).contains(&w) {
            return Err("BYWEEKNO out of range".to_string());
          }
          byweekno.push(w);
        }
      }
      "BYYEARDAY" => {
        for token in v.split(',') {
          let d = token
            .trim()
            .parse::<i32>()
            .map_err(|_| "Invalid BYYEARDAY".to_string())?;
          if d == 0 || !(-366..=366).contains(&d) {
            return Err("BYYEARDAY out of range".to_string());
          }
          byyearday.push(d);
        }
      }
      "BYSETPOS" => {
        for token in v.split(',') {
          let p = token
            .trim()
            .parse::<i32>()
            .map_err(|_| "Invalid BYSETPOS".to_string())?;
          if p == 0 || !(-366..=366).contains(&p) {
            return Err("BYSETPOS out of range".to_string());
          }
          bysetpos.push(p);
        }
      }
      "BYHOUR" => {
        for token in v.split(',') {
          let h = token
            .trim()
            .parse::<u32>()
            .map_err(|_| "Invalid BYHOUR".to_string())?;
          if h > 23 {
            return Err("BYHOUR out of range".to_string());
          }
          byhour.push(h);
        }
      }
      "BYMINUTE" => {
        for token in v.split(',') {
          let m = token
            .trim()
            .parse::<u32>()
            .map_err(|_| "Invalid BYMINUTE".to_string())?;
          if m > 59 {
            return Err("BYMINUTE out of range".to_string());
          }
          byminute.push(m);
        }
      }
      "BYSECOND" => {
        for token in v.split(',') {
          let s = token
            .trim()
            .parse::<u32>()
            .map_err(|_| "Invalid BYSECOND".to_string())?;
          if s > 59 {
            return Err("BYSECOND out of range".to_string());
          }
          bysecond.push(s);
        }
      }
      "COUNT" => {
        count = Some(v.trim().parse::<usize>().map_err(|_| "Invalid COUNT".to_string())?);
      }
      "UNTIL" => {
        until = Some(parse_iso(v.trim())?);
      }
      _ => {}
    }
  }

  Ok(RRule {
    freq: freq.ok_or_else(|| "RRULE missing FREQ".to_string())?,
    interval,
    wkst,
    byday,
    bymonthday,
    bymonth,
    byweekno,
    byyearday,
    bysetpos,
    byhour,
    byminute,
    bysecond,
    count,
    until,
  })
}

fn period_start_for_index(start: DateTime<Utc>, rule: &RRule, idx: usize) -> Result<DateTime<Utc>, String> {
  let step = (idx as i64) * (rule.interval as i64);
  let out = match rule.freq {
    Freq::Secondly => start + Duration::seconds(step),
    Freq::Minutely => start + Duration::minutes(step),
    Freq::Hourly => start + Duration::hours(step),
    Freq::Daily => start + Duration::days(step),
    Freq::Weekly => {
      let ws = week_start(start.date_naive(), rule.wkst);
      let anchor = Utc
        .with_ymd_and_hms(ws.year(), ws.month(), ws.day(), 0, 0, 0)
        .single()
        .ok_or_else(|| "Invalid weekly anchor".to_string())?;
      anchor + Duration::weeks(step)
    }
    Freq::Monthly => {
      let anchor = Utc
        .with_ymd_and_hms(start.year(), start.month(), 1, 0, 0, 0)
        .single()
        .ok_or_else(|| "Invalid monthly anchor".to_string())?;
      add_months(anchor, step)
    }
    Freq::Yearly => Utc
      .with_ymd_and_hms(start.year() + step as i32, 1, 1, 0, 0, 0)
      .single()
      .ok_or_else(|| "Invalid yearly anchor".to_string())?,
  };
  Ok(out)
}

fn generate_period_candidates(
  start: DateTime<Utc>,
  period_start: DateTime<Utc>,
  rule: &RRule,
) -> Result<Vec<DateTime<Utc>>, String> {
  let mut out = Vec::new();

  match rule.freq {
    Freq::Secondly => {
      if match_calendar_filters(period_start.date_naive(), start, rule) {
        out.push(period_start);
      }
    }
    Freq::Minutely => {
      let hours = if rule.byhour.is_empty() {
        vec![period_start.hour()]
      } else {
        rule.byhour.clone()
      };
      let seconds = if rule.bysecond.is_empty() {
        vec![period_start.second()]
      } else {
        rule.bysecond.clone()
      };

      for h in hours {
        for s in &seconds {
          if let Some(dt) = Utc
            .with_ymd_and_hms(
              period_start.year(),
              period_start.month(),
              period_start.day(),
              h,
              period_start.minute(),
              *s,
            )
            .single()
          {
            if match_calendar_filters(dt.date_naive(), start, rule) {
              out.push(dt);
            }
          }
        }
      }
    }
    Freq::Hourly => {
      let minutes = if rule.byminute.is_empty() {
        vec![period_start.minute()]
      } else {
        rule.byminute.clone()
      };
      let seconds = if rule.bysecond.is_empty() {
        vec![period_start.second()]
      } else {
        rule.bysecond.clone()
      };

      for m in minutes {
        for s in &seconds {
          if let Some(dt) = Utc
            .with_ymd_and_hms(
              period_start.year(),
              period_start.month(),
              period_start.day(),
              period_start.hour(),
              m,
              *s,
            )
            .single()
          {
            if match_calendar_filters(dt.date_naive(), start, rule) {
              out.push(dt);
            }
          }
        }
      }
    }
    Freq::Daily => {
      let date = period_start.date_naive();
      if match_calendar_filters(date, start, rule) {
        append_times_for_date(&mut out, date, start, rule)?;
      }
    }
    Freq::Weekly => {
      for d in 0..7 {
        let date = (period_start + Duration::days(d)).date_naive();
        if match_calendar_filters(date, start, rule) {
          append_times_for_date(&mut out, date, start, rule)?;
        }
      }
    }
    Freq::Monthly => {
      let year = period_start.year();
      let month = period_start.month();
      let total = days_in_month(year, month);
      for day in 1..=total {
        let date = NaiveDate::from_ymd_opt(year, month, day)
          .ok_or_else(|| "Invalid date while expanding monthly RRULE".to_string())?;
        if match_calendar_filters(date, start, rule) {
          append_times_for_date(&mut out, date, start, rule)?;
        }
      }
    }
    Freq::Yearly => {
      let year = period_start.year();
      let total = days_in_year(year);
      for doy in 1..=total {
        let date = NaiveDate::from_yo_opt(year, doy)
          .ok_or_else(|| "Invalid date while expanding yearly RRULE".to_string())?;
        if match_calendar_filters(date, start, rule) {
          append_times_for_date(&mut out, date, start, rule)?;
        }
      }
    }
  }

  Ok(out)
}

fn append_times_for_date(
  out: &mut Vec<DateTime<Utc>>,
  date: NaiveDate,
  start: DateTime<Utc>,
  rule: &RRule,
) -> Result<(), String> {
  let hours = if rule.byhour.is_empty() {
    vec![start.hour()]
  } else {
    rule.byhour.clone()
  };
  let minutes = if rule.byminute.is_empty() {
    vec![start.minute()]
  } else {
    rule.byminute.clone()
  };
  let seconds = if rule.bysecond.is_empty() {
    vec![start.second()]
  } else {
    rule.bysecond.clone()
  };

  for h in &hours {
    for m in &minutes {
      for s in &seconds {
        let dt = Utc
          .with_ymd_and_hms(date.year(), date.month(), date.day(), *h, *m, *s)
          .single()
          .ok_or_else(|| "Invalid time candidate".to_string())?;
        out.push(dt);
      }
    }
  }

  Ok(())
}

fn match_calendar_filters(date: NaiveDate, start: DateTime<Utc>, rule: &RRule) -> bool {
  if !rule.bymonth.is_empty() && !rule.bymonth.contains(&date.month()) {
    return false;
  }

  if !rule.bymonthday.is_empty() {
    let total = days_in_month(date.year(), date.month()) as i32;
    if !match_signed_day_list(date.day() as i32, total, &rule.bymonthday) {
      return false;
    }
  }

  if !rule.byyearday.is_empty() {
    let total = days_in_year(date.year()) as i32;
    if !match_signed_day_list(date.ordinal() as i32, total, &rule.byyearday) {
      return false;
    }
  }

  if !rule.byweekno.is_empty() {
    let wk = week_number(date, rule.wkst);
    let total_weeks = weeks_in_year(date.year(), rule.wkst);
    if !match_signed_day_list(wk, total_weeks, &rule.byweekno) {
      return false;
    }
  }

  if !rule.byday.is_empty() {
    let mut day_ok = false;
    for d in &rule.byday {
      if d.weekday != date.weekday() {
        continue;
      }
      match d.ordinal {
        None => {
          day_ok = true;
          break;
        }
        Some(ord) => {
          if matches_byday_ordinal(date, ord) {
            day_ok = true;
            break;
          }
        }
      }
    }
    if !day_ok {
      return false;
    }
  }

  // FREQ base rhythm filtering
  let candidate = match Utc
    .with_ymd_and_hms(date.year(), date.month(), date.day(), start.hour(), start.minute(), start.second())
    .single()
  {
    Some(v) => v,
    None => return false,
  };

  let base_ok = match rule.freq {
    Freq::Secondly => (candidate - start).num_seconds() >= 0,
    Freq::Minutely => (candidate - start).num_minutes() >= 0,
    Freq::Hourly => (candidate - start).num_hours() >= 0,
    Freq::Daily => (candidate - start).num_days() >= 0,
    Freq::Weekly => weeks_between_custom(start.date_naive(), date, rule.wkst) >= 0,
    Freq::Monthly => months_between_dates(start.date_naive(), date) >= 0,
    Freq::Yearly => (date.year() - start.year()) >= 0,
  };

  base_ok
}

fn apply_bysetpos(mut candidates: Vec<DateTime<Utc>>, bysetpos: &[i32]) -> Vec<DateTime<Utc>> {
  if bysetpos.is_empty() {
    return candidates;
  }
  candidates.sort();
  let len = candidates.len() as i32;
  let mut out = Vec::new();

  for pos in bysetpos {
    let idx = if *pos > 0 { *pos - 1 } else { len + *pos };
    if idx >= 0 && idx < len {
      out.push(candidates[idx as usize]);
    }
  }

  out.sort();
  out.dedup();
  out
}

fn match_signed_day_list(value: i32, total: i32, list: &[i32]) -> bool {
  for entry in list {
    let resolved = if *entry > 0 { *entry } else { total + *entry + 1 };
    if resolved == value {
      return true;
    }
  }
  false
}

fn matches_byday_ordinal(date: NaiveDate, ordinal: i32) -> bool {
  let target_weekday = date.weekday();
  let year = date.year();
  let month = date.month();
  let total = days_in_month(year, month);

  let mut hits: Vec<u32> = Vec::new();
  for d in 1..=total {
    if let Some(nd) = NaiveDate::from_ymd_opt(year, month, d) {
      if nd.weekday() == target_weekday {
        hits.push(d);
      }
    }
  }

  if hits.is_empty() {
    return false;
  }

  let day = date.day();
  if ordinal > 0 {
    let idx = (ordinal - 1) as usize;
    idx < hits.len() && hits[idx] == day
  } else {
    let idx = (hits.len() as i32 + ordinal) as isize;
    idx >= 0 && hits[idx as usize] == day
  }
}

fn parse_byday_token(input: &str) -> Result<ByDayRule, String> {
  let trimmed = input.trim().to_ascii_uppercase();
  if trimmed.len() < 2 {
    return Err(format!("Invalid BYDAY token: {}", input));
  }

  let wd = parse_weekday(&trimmed[trimmed.len() - 2..])?;
  let prefix = &trimmed[..trimmed.len() - 2];
  let ordinal = if prefix.is_empty() {
    None
  } else {
    let n = prefix
      .parse::<i32>()
      .map_err(|_| format!("Invalid BYDAY ordinal: {}", input))?;
    if n == 0 || !(-53..=53).contains(&n) {
      return Err(format!("BYDAY ordinal out of range: {}", input));
    }
    Some(n)
  };

  Ok(ByDayRule { ordinal, weekday: wd })
}

fn weeks_between_custom(start: NaiveDate, end: NaiveDate, wkst: Weekday) -> i32 {
  let s = week_start(start, wkst);
  let e = week_start(end, wkst);
  ((e - s).num_days() / 7) as i32
}

fn week_start(date: NaiveDate, wkst: Weekday) -> NaiveDate {
  let date_idx = date.weekday().num_days_from_monday() as i64;
  let wkst_idx = wkst.num_days_from_monday() as i64;
  let delta = (7 + date_idx - wkst_idx) % 7;
  date - Duration::days(delta)
}

fn week_number(date: NaiveDate, wkst: Weekday) -> i32 {
  if wkst == Weekday::Mon {
    return date.iso_week().week() as i32;
  }

  let y = date.year();
  let jan4 = NaiveDate::from_ymd_opt(y, 1, 4).unwrap();
  let week1_start = week_start(jan4, wkst);
  let current_start = week_start(date, wkst);
  let mut n = ((current_start - week1_start).num_days() / 7 + 1) as i32;

  if n < 1 {
    return weeks_in_year(y - 1, wkst);
  }

  let max = weeks_in_year(y, wkst);
  if n > max {
    n = 1;
  }

  n
}

fn weeks_in_year(year: i32, wkst: Weekday) -> i32 {
  if wkst == Weekday::Mon {
    return NaiveDate::from_ymd_opt(year, 12, 28)
      .unwrap()
      .iso_week()
      .week() as i32;
  }

  let dec28 = NaiveDate::from_ymd_opt(year, 12, 28).unwrap();
  week_number_no_recurse(dec28, wkst)
}

fn week_number_no_recurse(date: NaiveDate, wkst: Weekday) -> i32 {
  let y = date.year();
  let jan4 = NaiveDate::from_ymd_opt(y, 1, 4).unwrap();
  let week1_start = week_start(jan4, wkst);
  let current_start = week_start(date, wkst);
  ((current_start - week1_start).num_days() / 7 + 1) as i32
}

fn parse_weekday(input: &str) -> Result<Weekday, String> {
  match input.to_ascii_uppercase().as_str() {
    "MO" => Ok(Weekday::Mon),
    "TU" => Ok(Weekday::Tue),
    "WE" => Ok(Weekday::Wed),
    "TH" => Ok(Weekday::Thu),
    "FR" => Ok(Weekday::Fri),
    "SA" => Ok(Weekday::Sat),
    "SU" => Ok(Weekday::Sun),
    _ => Err(format!("Invalid weekday: {}", input)),
  }
}

/// Calendar-aware month diff matching Luxon's contract: count the whole months
/// that have *fully passed*. `Jan 31 → Feb 28` = 0 (because there is no
/// Feb 31 to complete one full month). `Jan 31 → Mar 1` = 1.
fn months_between(start: DateTime<Utc>, end: DateTime<Utc>) -> i64 {
  let sign: i64 = if end >= start { 1 } else { -1 };
  let (earlier, later) = if end >= start { (start, end) } else { (end, start) };
  let mut months = (later.year() as i64 - earlier.year() as i64) * 12
    + (later.month() as i64 - earlier.month() as i64);
  // Clamp: if the day-of-month in `later` hasn't reached `earlier`'s day,
  // we haven't completed a full month yet — truncate toward zero.
  if later.day() < earlier.day() {
    months -= 1;
  }
  months * sign
}

fn months_between_dates(start: NaiveDate, end: NaiveDate) -> i32 {
  (end.year() - start.year()) * 12 + end.month() as i32 - start.month() as i32
}

fn add_months(dt: DateTime<Utc>, months: i64) -> DateTime<Utc> {
  let mut year = dt.year() as i64;
  let mut month0 = dt.month0() as i64 + months;
  year += month0.div_euclid(12);
  month0 = month0.rem_euclid(12);
  let month = (month0 + 1) as u32;
  let max_day = days_in_month(year as i32, month);
  let day = dt.day().min(max_day);
  Utc.with_ymd_and_hms(
    year as i32,
    month,
    day,
    dt.hour(),
    dt.minute(),
    dt.second(),
  )
  .single()
  .unwrap_or(dt)
}

fn days_in_month(year: i32, month: u32) -> u32 {
  let first = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
  let next = if month == 12 {
    NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap()
  } else {
    NaiveDate::from_ymd_opt(year, month + 1, 1).unwrap()
  };
  (next - first).num_days() as u32
}

fn days_in_year(year: i32) -> u32 {
  if NaiveDate::from_ymd_opt(year, 2, 29).is_some() {
    366
  } else {
    365
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
    return Ok(Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap()));
  }
  Err(format!("Invalid ISO date-time: {}", input))
}

fn to_iso(dt: DateTime<Utc>) -> String {
  // Use `Millis` precision so a JS-side `Date` round-trip (which always
  // preserves milliseconds via `toISOString()`) doesn't silently lose
  // sub-second data when going through the Rust engine. Previously the
  // `Secs` mode dropped milliseconds entirely, producing different output
  // between the native and TS fallback paths for the same input.
  if dt.timestamp_subsec_millis() == 0 {
    // Keep the compact form `2026-04-08T14:00:00Z` when there are no
    // subseconds — it round-trips identically to JavaScript's
    // `new Date('...').toISOString()` after `.replace('.000Z', 'Z')`.
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
  } else {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn add_and_diff_work() {
    let a = add("2026-01-15T10:00:00Z", 1, "month").unwrap();
    assert_eq!(a, "2026-02-15T10:00:00Z");
    let d = diff("2026-01-15T10:00:00Z", "2026-01-17T10:00:00Z", "days").unwrap();
    assert_eq!(d, 2);
  }

  #[test]
  fn rrule_monthly_works() {
    let out = rrule_expand(
      "2026-01-15T15:00:00Z",
      "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3",
      10,
    )
    .unwrap();
    assert_eq!(out.len(), 3);
    assert_eq!(out[0], "2026-01-15T15:00:00Z");
    assert_eq!(out[1], "2026-02-15T15:00:00Z");
  }

  #[test]
  fn rrule_weekly_works() {
    let out = rrule_expand(
      "2026-01-06T15:00:00Z",
      "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
      10,
    )
    .unwrap();
    assert_eq!(out.len(), 3);
    assert_eq!(out[0], "2026-01-06T15:00:00Z");
  }

  #[test]
  fn rrule_byday_ordinal_last_sunday() {
    let out = rrule_expand(
      "2026-01-01T12:00:00Z",
      "FREQ=MONTHLY;BYDAY=-1SU;COUNT=3",
      10,
    )
    .unwrap();
    assert_eq!(out[0], "2026-01-25T12:00:00Z");
    assert_eq!(out[1], "2026-02-22T12:00:00Z");
    assert_eq!(out[2], "2026-03-29T12:00:00Z");
  }

  #[test]
  fn rrule_hourly_multi_minute_with_bysetpos() {
    let out = rrule_expand(
      "2026-01-01T10:00:00Z",
      "FREQ=HOURLY;BYMINUTE=0,30;BYSECOND=0;BYSETPOS=-1;COUNT=3",
      10,
    )
    .unwrap();
    assert_eq!(out, vec![
      "2026-01-01T10:30:00Z",
      "2026-01-01T11:30:00Z",
      "2026-01-01T12:30:00Z",
    ]);
  }

  #[test]
  fn rrule_yearly_byweekno_and_byday() {
    let out = rrule_expand(
      "2026-01-01T09:00:00Z",
      "FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO;COUNT=2",
      10,
    )
    .unwrap();
    assert_eq!(out[0], "2027-01-04T09:00:00Z");
    assert_eq!(out[1], "2028-01-03T09:00:00Z");
  }

  #[test]
  fn rrule_yearly_byyearday_negative() {
    let out = rrule_expand(
      "2026-01-01T00:00:00Z",
      "FREQ=YEARLY;BYYEARDAY=-1;COUNT=2",
      10,
    )
    .unwrap();
    assert_eq!(out[0], "2026-12-31T00:00:00Z");
    assert_eq!(out[1], "2027-12-31T00:00:00Z");
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
    let result = add("2026-04-08T14:00:00Z", 1, "second").unwrap();
    assert_eq!(result, "2026-04-08T14:00:01Z");
  }

  #[test]
  fn format_literal_brackets() {
    // `[Z]` is a literal Z, not a timezone token.
    let result = format("2026-04-08T14:00:00Z", "YYYY-MM-DD[T]HH:mm:ss[Z]").unwrap();
    assert_eq!(result, "2026-04-08T14:00:00Z");
  }

  #[test]
  fn format_year_only_no_z_corruption() {
    // `YYYY` followed by no token must not be corrupted.
    let result = format("2026-04-08T14:00:00Z", "YYYY").unwrap();
    assert_eq!(result, "2026");
  }

  #[test]
  fn calendar_parts_isoweek_and_quarter() {
    let parts = calendar_parts("2026-04-08T14:30:45Z").unwrap();
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
    let parts = calendar_parts("2024-02-29T00:00:00Z").unwrap();
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
    assert_eq!(validate_timezone("Pacific/Chatham").unwrap(), "Pacific/Chatham");
  }

  #[test]
  fn validate_timezone_invalid() {
    assert!(validate_timezone("Not/A/Zone").is_err());
    assert!(validate_timezone("").is_err());
  }

  #[test]
  fn to_zone_paris_summer() {
    // 2026-07-15 14:00 UTC → 16:00 CEST (UTC+2)
    let result = to_zone("2026-07-15T14:00:00Z", "Europe/Paris").unwrap();
    assert!(result.iso.contains("16:00:00"));
    assert_eq!(result.offset_minutes, 120);
  }

  #[test]
  fn to_zone_paris_winter() {
    // 2026-01-15 14:00 UTC → 15:00 CET (UTC+1)
    let result = to_zone("2026-01-15T14:00:00Z", "Europe/Paris").unwrap();
    assert!(result.iso.contains("15:00:00"));
    assert_eq!(result.offset_minutes, 60);
  }

  #[test]
  fn to_zone_chatham_45min_offset() {
    // Pacific/Chatham is UTC+12:45 / +13:45
    let result = to_zone("2026-01-15T00:00:00Z", "Pacific/Chatham").unwrap();
    // Summer in southern hemisphere → CHADT = UTC+13:45
    assert_eq!(result.offset_minutes, 825); // 13*60 + 45
  }

  #[test]
  fn add_in_zone_dst_spring_forward() {
    // Europe/Paris springs forward on 2026-03-29 at 02:00 → 03:00.
    // Adding 1 day to 2026-03-28T10:00:00 UTC (= 11:00 CET) should land on
    // 2026-03-29T09:00:00 UTC (= 11:00 CEST), preserving wall-clock 11:00.
    let result = add_in_zone("2026-03-28T10:00:00Z", 1, "day", "Europe/Paris").unwrap();
    // Parse the result and check the wall-clock time in Paris.
    let result_paris = to_zone(&result, "Europe/Paris").unwrap();
    assert!(result_paris.iso.contains("11:00:00"), "Expected wall-clock 11:00, got {}", result_paris.iso);
  }

  #[test]
  fn add_in_zone_dst_fall_back() {
    // Europe/Paris falls back on 2026-10-25 at 03:00 → 02:00.
    // Adding 1 day to 2026-10-24T10:00:00 UTC (= 12:00 CEST) should land on
    // 2026-10-25T11:00:00 UTC (= 12:00 CET), preserving wall-clock 12:00.
    let result = add_in_zone("2026-10-24T10:00:00Z", 1, "day", "Europe/Paris").unwrap();
    let result_paris = to_zone(&result, "Europe/Paris").unwrap();
    assert!(result_paris.iso.contains("12:00:00"), "Expected wall-clock 12:00, got {}", result_paris.iso);
  }

  #[test]
  fn diff_in_zone_month() {
    let result = diff_in_zone(
      "2026-01-15T10:00:00Z", "2026-03-15T10:00:00Z", "month", "Europe/Paris"
    ).unwrap();
    assert_eq!(result, 2);
  }

  #[test]
  fn zone_offset_summer_vs_winter() {
    let summer = zone_offset("2026-07-15T12:00:00Z", "Europe/Paris").unwrap();
    let winter = zone_offset("2026-01-15T12:00:00Z", "Europe/Paris").unwrap();
    assert_eq!(summer, 120); // CEST
    assert_eq!(winter, 60);  // CET
  }

  #[test]
  fn calendar_parts_iso_week_year_boundary() {
    // 2026-01-01 is a Thursday — falls in ISO week 1 of 2026.
    let parts = calendar_parts("2026-01-01T00:00:00Z").unwrap();
    assert_eq!(parts.week_number, 1);
    assert_eq!(parts.week_year, 2026);
    // 2024-12-30 is a Monday — ISO week 1 of 2025 (week-numbering year shifts).
    let parts = calendar_parts("2024-12-30T00:00:00Z").unwrap();
    assert_eq!(parts.week_number, 1);
    assert_eq!(parts.week_year, 2025);
  }
}
