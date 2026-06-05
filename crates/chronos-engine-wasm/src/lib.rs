use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn add(iso: &str, amount: i64, unit: &str) -> Result<String, JsValue> {
    chronos_engine::add(iso, amount, unit).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn diff(a_iso: &str, b_iso: &str, unit: &str) -> Result<i64, JsValue> {
    chronos_engine::diff(a_iso, b_iso, unit).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn start_of(iso: &str, unit: &str) -> Result<String, JsValue> {
    chronos_engine::start_of(iso, unit).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn end_of(iso: &str, unit: &str) -> Result<String, JsValue> {
    chronos_engine::end_of(iso, unit).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn format(iso: &str, pattern: &str) -> Result<String, JsValue> {
    chronos_engine::format(iso, pattern).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn validate_timezone(zone: &str) -> Result<String, JsValue> {
    chronos_engine::validate_timezone(zone).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn to_zone(utc_iso: &str, zone: &str) -> Result<JsValue, JsValue> {
    let result = chronos_engine::to_zone(utc_iso, zone).map_err(|e| JsValue::from_str(&e))?;
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"iso".into(), &JsValue::from_str(&result.iso))?;
    js_sys::Reflect::set(&obj, &"offsetMinutes".into(), &JsValue::from_f64(result.offset_minutes as f64))?;
    js_sys::Reflect::set(&obj, &"zoneName".into(), &JsValue::from_str(&result.zone_name))?;
    Ok(obj.into())
}

#[wasm_bindgen]
pub fn add_in_zone(utc_iso: &str, amount: i64, unit: &str, zone: &str) -> Result<String, JsValue> {
    chronos_engine::add_in_zone(utc_iso, amount, unit, zone).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn diff_in_zone(a_utc: &str, b_utc: &str, unit: &str, zone: &str) -> Result<i64, JsValue> {
    chronos_engine::diff_in_zone(a_utc, b_utc, unit, zone).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn zone_offset(utc_iso: &str, zone: &str) -> Result<i32, JsValue> {
    chronos_engine::zone_offset(utc_iso, zone).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn from_local(naive_iso: &str, zone: &str) -> Result<String, JsValue> {
    chronos_engine::from_local(naive_iso, zone).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn parse_rfc2822(input: &str) -> Result<String, JsValue> {
    chronos_engine::parse_rfc2822(input).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn parse_sql(input: &str) -> Result<String, JsValue> {
    chronos_engine::parse_sql(input).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn parse_http(input: &str) -> Result<String, JsValue> {
    chronos_engine::parse_http(input).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn rrule_expand(start_iso: &str, rrule: &str, limit: usize) -> Result<JsValue, JsValue> {
    let dates = chronos_engine::rrule_expand(start_iso, rrule, limit)
        .map_err(|e| JsValue::from_str(&e))?;
    let arr = js_sys::Array::new();
    for d in dates {
        arr.push(&JsValue::from_str(&d));
    }
    Ok(arr.into())
}

#[wasm_bindgen]
pub fn calendar_parts(iso: &str) -> Result<JsValue, JsValue> {
    let p = chronos_engine::calendar_parts(iso).map_err(|e| JsValue::from_str(&e))?;
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"year".into(), &JsValue::from_f64(p.year as f64))?;
    js_sys::Reflect::set(&obj, &"month".into(), &JsValue::from_f64(p.month as f64))?;
    js_sys::Reflect::set(&obj, &"day".into(), &JsValue::from_f64(p.day as f64))?;
    js_sys::Reflect::set(&obj, &"hour".into(), &JsValue::from_f64(p.hour as f64))?;
    js_sys::Reflect::set(&obj, &"minute".into(), &JsValue::from_f64(p.minute as f64))?;
    js_sys::Reflect::set(&obj, &"second".into(), &JsValue::from_f64(p.second as f64))?;
    js_sys::Reflect::set(&obj, &"millisecond".into(), &JsValue::from_f64(p.millisecond as f64))?;
    js_sys::Reflect::set(&obj, &"weekday".into(), &JsValue::from_f64(p.weekday as f64))?;
    js_sys::Reflect::set(&obj, &"weekNumber".into(), &JsValue::from_f64(p.week_number as f64))?;
    js_sys::Reflect::set(&obj, &"weekYear".into(), &JsValue::from_f64(p.week_year as f64))?;
    js_sys::Reflect::set(&obj, &"ordinal".into(), &JsValue::from_f64(p.ordinal as f64))?;
    js_sys::Reflect::set(&obj, &"quarter".into(), &JsValue::from_f64(p.quarter as f64))?;
    js_sys::Reflect::set(&obj, &"daysInMonth".into(), &JsValue::from_f64(p.days_in_month as f64))?;
    js_sys::Reflect::set(&obj, &"daysInYear".into(), &JsValue::from_f64(p.days_in_year as f64))?;
    js_sys::Reflect::set(&obj, &"isLeapYear".into(), &JsValue::from_bool(p.is_leap_year))?;
    Ok(obj.into())
}
