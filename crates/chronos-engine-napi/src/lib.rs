use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::panic::catch_unwind;

#[napi]
pub fn add(iso: String, amount: i64, unit: String) -> Result<String> {
  wrap_string(|| chronos_engine::add(&iso, amount, &unit))
}

#[napi]
pub fn diff(a_iso: String, b_iso: String, unit: String) -> Result<i64> {
  let result = catch_unwind(|| -> std::result::Result<i64, String> { chronos_engine::diff(&a_iso, &b_iso, &unit) });
  match result {
    Ok(Ok(value)) => Ok(value),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}

#[napi]
pub fn start_of(iso: String, unit: String) -> Result<String> {
  wrap_string(|| chronos_engine::start_of(&iso, &unit))
}

#[napi]
pub fn end_of(iso: String, unit: String) -> Result<String> {
  wrap_string(|| chronos_engine::end_of(&iso, &unit))
}

#[napi]
pub fn format(iso: String, pattern: String) -> Result<String> {
  wrap_string(|| chronos_engine::format(&iso, &pattern))
}

#[napi(object)]
pub struct CalendarPartsNapi {
  pub year: i32,
  pub month: u32,
  pub day: u32,
  pub hour: u32,
  pub minute: u32,
  pub second: u32,
  pub millisecond: u32,
  pub weekday: u32,
  pub week_number: u32,
  pub week_year: i32,
  pub ordinal: u32,
  pub quarter: u32,
  pub days_in_month: u32,
  pub days_in_year: u32,
  pub is_leap_year: bool,
}

#[napi]
pub fn calendar_parts(iso: String) -> Result<CalendarPartsNapi> {
  let result = catch_unwind(|| chronos_engine::calendar_parts(&iso));
  match result {
    Ok(Ok(p)) => Ok(CalendarPartsNapi {
      year: p.year, month: p.month, day: p.day,
      hour: p.hour, minute: p.minute, second: p.second, millisecond: p.millisecond,
      weekday: p.weekday, week_number: p.week_number, week_year: p.week_year,
      ordinal: p.ordinal, quarter: p.quarter,
      days_in_month: p.days_in_month, days_in_year: p.days_in_year,
      is_leap_year: p.is_leap_year,
    }),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}

#[napi]
pub fn validate_timezone(zone: String) -> Result<String> {
  wrap_string(|| chronos_engine::validate_timezone(&zone))
}

#[napi(object)]
pub struct ZonedOutputNapi {
  pub iso: String,
  pub offset_minutes: i32,
  pub zone_name: String,
}

#[napi]
pub fn to_zone(utc_iso: String, zone: String) -> Result<ZonedOutputNapi> {
  let result = catch_unwind(|| chronos_engine::to_zone(&utc_iso, &zone));
  match result {
    Ok(Ok(z)) => Ok(ZonedOutputNapi { iso: z.iso, offset_minutes: z.offset_minutes, zone_name: z.zone_name }),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}

#[napi]
pub fn add_in_zone(utc_iso: String, amount: i64, unit: String, zone: String) -> Result<String> {
  wrap_string(|| chronos_engine::add_in_zone(&utc_iso, amount, &unit, &zone))
}

#[napi]
pub fn diff_in_zone(a_utc: String, b_utc: String, unit: String, zone: String) -> Result<i64> {
  let result = catch_unwind(|| chronos_engine::diff_in_zone(&a_utc, &b_utc, &unit, &zone));
  match result {
    Ok(Ok(v)) => Ok(v),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}

#[napi]
pub fn zone_offset(utc_iso: String, zone: String) -> Result<i32> {
  let result = catch_unwind(|| chronos_engine::zone_offset(&utc_iso, &zone));
  match result {
    Ok(Ok(v)) => Ok(v),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}

#[napi]
pub fn from_local(naive_iso: String, zone: String) -> Result<String> {
  wrap_string(|| chronos_engine::from_local(&naive_iso, &zone))
}

#[napi]
pub fn parse_rfc2822(input: String) -> Result<String> {
  wrap_string(|| chronos_engine::parse_rfc2822(&input))
}

#[napi]
pub fn parse_sql(input: String) -> Result<String> {
  wrap_string(|| chronos_engine::parse_sql(&input))
}

#[napi]
pub fn parse_http(input: String) -> Result<String> {
  wrap_string(|| chronos_engine::parse_http(&input))
}

#[napi]
pub fn rrule_expand(start_iso: String, rrule: String, limit: u32) -> Result<Vec<String>> {
  let result = catch_unwind(|| -> std::result::Result<Vec<String>, String> {
    chronos_engine::rrule_expand(&start_iso, &rrule, limit as usize)
  });
  match result {
    Ok(Ok(value)) => Ok(value),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}

fn wrap_string<F>(f: F) -> Result<String>
where
  F: FnOnce() -> std::result::Result<String, String> + std::panic::UnwindSafe,
{
  let result = catch_unwind(|| -> std::result::Result<String, String> { f() });
  match result {
    Ok(Ok(value)) => Ok(value),
    Ok(Err(e)) => Err(Error::from_reason(e)),
    Err(_) => Err(Error::from_reason("Internal panic in chronos engine")),
  }
}
