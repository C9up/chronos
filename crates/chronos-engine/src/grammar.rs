//! The input grammars the engine reads: RFC 3339, RFC 2822, and the fixed
//! `strftime`-style layouts behind the SQL-less ISO forms, `from_local` and the
//! two legacy HTTP dates.
//!
//! These are written out here rather than taken from the date library because
//! what they accept is part of the engine's contract. Each one keeps the exact
//! rules the engine has always applied — a numeric field skips the whitespace
//! before it and reads one or two digits (four for a year, any number after a
//! sign), a space in a layout matches any run of whitespace, a weekday has to
//! agree with its date — and reports the same kinds of error, whose text ends
//! up in messages such as `Invalid RFC 2822 date: … (trailing input)`.
//!
//! One thing is refused that used to be read: a 60th second. A leap second
//! has no value in the engine's time scale (nor in JavaScript's), and the
//! TypeScript API already refused the `…:60.000Z` it used to produce.

use std::fmt;

use jiff::civil::{Date, DateTime, Time, Weekday};
use jiff::SignedDuration;

/// Why a text is not a date-time, in the words the engine's messages use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParseError {
    /// A field, or the date it builds, is out of range.
    OutOfRange,
    /// The fields contradict each other (a weekday that is not the date's).
    Impossible,
    /// A field the value needs was not given.
    NotEnough,
    /// A character that has no place where it stands.
    Invalid,
    /// The text ended before the value did.
    TooShort,
    /// Text is left after the value.
    TooLong,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ParseError::OutOfRange => "input is out of range",
            ParseError::Impossible => "no possible date and time matching input",
            ParseError::NotEnough => "input is not enough for unique date and time",
            ParseError::Invalid => "input contains invalid characters",
            ParseError::TooShort => "premature end of input",
            ParseError::TooLong => "trailing input",
        })
    }
}

type Scan<'a, T> = Result<(&'a str, T), ParseError>;

// ─── Scanners ───────────────────────────────────────────────────────────────

/// Between `min` and `max` ASCII digits.
fn number(s: &str, min: usize, max: usize) -> Scan<'_, i64> {
    let bytes = s.as_bytes();
    if bytes.len() < min {
        return Err(ParseError::TooShort);
    }
    let mut n = 0i64;
    for (i, &c) in bytes.iter().take(max).enumerate() {
        if !c.is_ascii_digit() {
            return if i < min {
                Err(ParseError::Invalid)
            } else {
                Ok((&s[i..], n))
            };
        }
        n = n
            .checked_mul(10)
            .and_then(|n| n.checked_add(i64::from(c - b'0')))
            .ok_or(ParseError::OutOfRange)?;
    }
    Ok((&s[max.min(bytes.len())..], n))
}

/// A fraction of a second: its first nine digits, scaled to nanoseconds; any
/// further digits are read and dropped.
fn nanosecond(s: &str) -> Scan<'_, i32> {
    let before = s.len();
    let (rest, value) = number(s, 1, 9)?;
    let read = before - rest.len();
    let scaled = (read..9).try_fold(value, |v, _| v.checked_mul(10));
    let nanos = scaled
        .and_then(|v| i32::try_from(v).ok())
        .ok_or(ParseError::OutOfRange)?;
    Ok((rest.trim_start_matches(|c: char| c.is_ascii_digit()), nanos))
}

/// Exactly one given ASCII character.
fn char(s: &str, c: u8) -> Result<&str, ParseError> {
    match s.as_bytes().first() {
        Some(&b) if b == c => Ok(&s[1..]),
        Some(_) => Err(ParseError::Invalid),
        None => Err(ParseError::TooShort),
    }
}

/// One or more whitespace characters.
fn space(s: &str) -> Result<&str, ParseError> {
    let rest = s.trim_start();
    if rest.len() < s.len() {
        Ok(rest)
    } else if s.is_empty() {
        Err(ParseError::TooShort)
    } else {
        Err(ParseError::Invalid)
    }
}

/// The three bytes `s` starts with, lower-cased, when there are three.
fn head3(s: &str) -> Result<[u8; 3], ParseError> {
    match s.as_bytes() {
        [a, b, c, ..] => Ok([a | 32, b | 32, c | 32]),
        _ => Err(ParseError::TooShort),
    }
}

/// `Mon` … `Sun`, in any case.
fn short_weekday(s: &str) -> Scan<'_, Weekday> {
    let weekday = match &head3(s)? {
        b"mon" => Weekday::Monday,
        b"tue" => Weekday::Tuesday,
        b"wed" => Weekday::Wednesday,
        b"thu" => Weekday::Thursday,
        b"fri" => Weekday::Friday,
        b"sat" => Weekday::Saturday,
        b"sun" => Weekday::Sunday,
        _ => return Err(ParseError::Invalid),
    };
    Ok((&s[3..], weekday))
}

/// A weekday's short name, or its full name (`Monday`), in any case.
fn short_or_long_weekday(s: &str) -> Scan<'_, Weekday> {
    let (mut rest, weekday) = short_weekday(s)?;
    let suffix: &[u8] = match weekday {
        Weekday::Monday | Weekday::Friday | Weekday::Sunday => b"day",
        Weekday::Tuesday => b"sday",
        Weekday::Wednesday => b"nesday",
        Weekday::Thursday => b"rsday",
        Weekday::Saturday => b"urday",
    };
    if rest
        .as_bytes()
        .get(..suffix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(suffix))
    {
        rest = &rest[suffix.len()..];
    }
    Ok((rest, weekday))
}

/// `Jan` … `Dec`, in any case, as 1 … 12.
fn short_month(s: &str) -> Scan<'_, i64> {
    let month = match &head3(s)? {
        b"jan" => 1,
        b"feb" => 2,
        b"mar" => 3,
        b"apr" => 4,
        b"may" => 5,
        b"jun" => 6,
        b"jul" => 7,
        b"aug" => 8,
        b"sep" => 9,
        b"oct" => 10,
        b"nov" => 11,
        b"dec" => 12,
        _ => return Err(ParseError::Invalid),
    };
    Ok((&s[3..], month))
}

/// Two ASCII digits, when there are two characters.
fn two_bytes(s: &str) -> Result<(u8, u8), ParseError> {
    match s.as_bytes() {
        [a, b, ..] => Ok((*a, *b)),
        _ => Err(ParseError::TooShort),
    }
}

/// `±HH[:]MM` as seconds east of UTC. `colon` says whether the colon is
/// required; `zulu` lets `Z` stand for `+00:00`; `minus_sign` accepts U+2212.
fn offset(mut s: &str, colon: bool, zulu: bool, minus_sign: bool) -> Scan<'_, i32> {
    if zulu && matches!(s.as_bytes().first(), Some(b'Z' | b'z')) {
        return Ok((&s[1..], 0));
    }
    let negative = match s.chars().next() {
        Some('+') => false,
        Some('-') => true,
        Some('\u{2212}') if minus_sign => true,
        Some(_) => return Err(ParseError::Invalid),
        None => return Err(ParseError::TooShort),
    };
    s = s.char_indices().nth(1).map_or("", |(at, _)| &s[at..]);
    let hours = match two_bytes(s)? {
        (h1 @ b'0'..=b'9', h2 @ b'0'..=b'9') => i32::from((h1 - b'0') * 10 + (h2 - b'0')),
        _ => return Err(ParseError::Invalid),
    };
    s = &s[2..];
    if colon {
        s = char(s, b':')?;
    }
    let minutes = match two_bytes(s)? {
        (m1 @ b'0'..=b'5', m2 @ b'0'..=b'9') => i32::from((m1 - b'0') * 10 + (m2 - b'0')),
        (b'6'..=b'9', b'0'..=b'9') => return Err(ParseError::OutOfRange),
        _ => return Err(ParseError::Invalid),
    };
    let seconds = hours * 3600 + minutes * 60;
    Ok((&s[2..], if negative { -seconds } else { seconds }))
}

/// An RFC 2822 zone: a numeric offset, `UT`/`GMT`/`Z`, the North American
/// names it defines, or a single military letter (read as `-0000`).
fn offset_2822(s: &str) -> Scan<'_, i32> {
    let letters = s
        .bytes()
        .position(|c| !c.is_ascii_alphabetic())
        .unwrap_or(s.len());
    if letters == 0 {
        return offset(s, false, false, false);
    }
    let name = &s.as_bytes()[..letters];
    let rest = &s[letters..];
    let hours = |h: i32| Ok((rest, h * 3600));
    let is = |n: &[u8]| name.eq_ignore_ascii_case(n);
    if is(b"gmt") || is(b"ut") || is(b"z") {
        hours(0)
    } else if is(b"edt") {
        hours(-4)
    } else if is(b"est") || is(b"cdt") {
        hours(-5)
    } else if is(b"cst") || is(b"mdt") {
        hours(-6)
    } else if is(b"mst") || is(b"pdt") {
        hours(-7)
    } else if is(b"pst") {
        hours(-8)
    } else if let [b'a'..=b'i' | b'k'..=b'y' | b'A'..=b'I' | b'K'..=b'Y'] = name {
        hours(0)
    } else {
        Err(ParseError::Invalid)
    }
}

/// A parenthesised comment, nested ones and `\` escapes included, after any
/// whitespace.
fn comment_2822(s: &str) -> Scan<'_, ()> {
    let s = s.trim_start();
    let mut bytes = s.bytes().enumerate();
    if bytes.next().map(|(_, c)| c) != Some(b'(') {
        return Err(if s.is_empty() {
            ParseError::TooShort
        } else {
            ParseError::Invalid
        });
    }
    let mut depth = 1usize;
    let mut escaped = false;
    for (i, c) in bytes {
        if escaped {
            escaped = false;
        } else if c == b'\\' {
            escaped = true;
        } else if c == b'(' {
            depth += 1;
        } else if c == b')' {
            depth -= 1;
            if depth == 0 {
                return Ok((&s[i + 1..], ()));
            }
        }
    }
    Err(ParseError::TooShort)
}

// ─── Fields ─────────────────────────────────────────────────────────────────

/// The fields a text gave, each range-checked as it is read.
#[derive(Default)]
struct Fields {
    year: Option<i64>,
    year_mod_100: Option<i64>,
    month: Option<i64>,
    day: Option<i64>,
    hour: Option<i64>,
    minute: Option<i64>,
    second: Option<i64>,
    nanosecond: Option<i32>,
    weekday: Option<Weekday>,
}

/// `value` when it lies in `range`, as an out-of-range error otherwise.
fn checked(value: i64, range: std::ops::RangeInclusive<i64>) -> Result<i64, ParseError> {
    if range.contains(&value) {
        Ok(value)
    } else {
        Err(ParseError::OutOfRange)
    }
}

impl Fields {
    fn set_year(&mut self, value: i64) -> Result<(), ParseError> {
        // Any year an `i32` holds is a field; whether a date has it is decided
        // when the date is built.
        i32::try_from(value).map_err(|_| ParseError::OutOfRange)?;
        self.year = Some(value);
        Ok(())
    }

    fn set_year_mod_100(&mut self, value: i64) -> Result<(), ParseError> {
        self.year_mod_100 = Some(checked(value, 0..=99)?);
        Ok(())
    }

    fn set_month(&mut self, value: i64) -> Result<(), ParseError> {
        self.month = Some(checked(value, 1..=12)?);
        Ok(())
    }

    fn set_day(&mut self, value: i64) -> Result<(), ParseError> {
        self.day = Some(checked(value, 1..=31)?);
        Ok(())
    }

    fn set_hour(&mut self, value: i64) -> Result<(), ParseError> {
        self.hour = Some(checked(value, 0..=23)?);
        Ok(())
    }

    fn set_minute(&mut self, value: i64) -> Result<(), ParseError> {
        self.minute = Some(checked(value, 0..=59)?);
        Ok(())
    }

    fn set_second(&mut self, value: i64) -> Result<(), ParseError> {
        // 60 is a field (RFC 3339 and 2822 allow a leap second); it is refused
        // when the time is built.
        self.second = Some(checked(value, 0..=60)?);
        Ok(())
    }

    /// The calendar date, its weekday checked against the one given.
    fn date(&self) -> Result<Date, ParseError> {
        let year = match (self.year, self.year_mod_100) {
            (Some(year), _) => year,
            // A two-digit year alone: 00-69 is 20xx, 70-99 is 19xx.
            (None, Some(y)) => y + if y < 70 { 2000 } else { 1900 },
            (None, None) => return Err(ParseError::NotEnough),
        };
        let (Some(month), Some(day)) = (self.month, self.day) else {
            return Err(ParseError::NotEnough);
        };
        let date = match (i16::try_from(year), i8::try_from(month), i8::try_from(day)) {
            (Ok(y), Ok(m), Ok(d)) => Date::new(y, m, d).map_err(|_| ParseError::OutOfRange)?,
            _ => return Err(ParseError::OutOfRange),
        };
        if self.weekday.is_some_and(|w| w != date.weekday()) {
            return Err(ParseError::Impossible);
        }
        Ok(date)
    }

    fn time(&self) -> Result<Time, ParseError> {
        let (Some(hour), Some(minute)) = (self.hour, self.minute) else {
            return Err(ParseError::NotEnough);
        };
        let second = self.second.unwrap_or(0);
        if second == 60 {
            return Err(ParseError::OutOfRange);
        }
        let nanosecond = match (self.nanosecond, self.second) {
            (Some(_), None) => return Err(ParseError::NotEnough),
            (nanos, _) => nanos.unwrap_or(0),
        };
        match (
            i8::try_from(hour),
            i8::try_from(minute),
            i8::try_from(second),
        ) {
            (Ok(h), Ok(m), Ok(s)) => {
                Time::new(h, m, s, nanosecond).map_err(|_| ParseError::OutOfRange)
            }
            _ => Err(ParseError::OutOfRange),
        }
    }

    /// The date and the time; when both are wrong, the date's error is the one
    /// reported.
    fn datetime(&self) -> Result<DateTime, ParseError> {
        let date = self.date();
        let time = self.time();
        Ok(date?.to_datetime(time?))
    }
}

/// The UTC wall clock of `local` read at `offset` seconds east.
fn at_offset(local: DateTime, offset: i32) -> Result<DateTime, ParseError> {
    // An offset is less than a day either way.
    if offset.abs() >= 86_400 {
        return Err(ParseError::OutOfRange);
    }
    local
        .checked_sub(SignedDuration::from_secs(i64::from(offset)))
        .map_err(|_| ParseError::OutOfRange)
}

// ─── Layouts ────────────────────────────────────────────────────────────────

/// One piece of a fixed layout, as `strftime` spells it.
#[derive(Clone, Copy)]
pub(crate) enum Item {
    /// Text that must be there, exactly.
    Literal(&'static str),
    /// Any run of whitespace, none included.
    Space,
    /// `%Y`: up to four digits, or any number of them after a sign.
    Year,
    /// `%y`.
    YearMod100,
    /// `%m`.
    Month,
    /// `%d` and `%e`.
    Day,
    /// `%H`.
    Hour,
    /// `%M`.
    Minute,
    /// `%S`.
    Second,
    /// `%a`.
    ShortWeekday,
    /// `%A`: the full name, or the short one.
    LongWeekday,
    /// `%b`.
    ShortMonth,
}

/// `%Y-%m-%d`.
pub(crate) const DATE: &[Item] = &[
    Item::Year,
    Item::Literal("-"),
    Item::Month,
    Item::Literal("-"),
    Item::Day,
];

/// `%Y-%m-%d %H:%M:%S`.
pub(crate) const DATE_SPACE_TIME: &[Item] = &[
    Item::Year,
    Item::Literal("-"),
    Item::Month,
    Item::Literal("-"),
    Item::Day,
    Item::Space,
    Item::Hour,
    Item::Literal(":"),
    Item::Minute,
    Item::Literal(":"),
    Item::Second,
];

/// `%Y-%m-%dT%H:%M:%S`.
pub(crate) const DATE_T_TIME: &[Item] = &[
    Item::Year,
    Item::Literal("-"),
    Item::Month,
    Item::Literal("-"),
    Item::Day,
    Item::Literal("T"),
    Item::Hour,
    Item::Literal(":"),
    Item::Minute,
    Item::Literal(":"),
    Item::Second,
];

/// RFC 850, the obsolete HTTP date: `%A, %d-%b-%y %H:%M:%S`.
pub(crate) const RFC_850: &[Item] = &[
    Item::LongWeekday,
    Item::Literal(","),
    Item::Space,
    Item::Day,
    Item::Literal("-"),
    Item::ShortMonth,
    Item::Literal("-"),
    Item::YearMod100,
    Item::Space,
    Item::Hour,
    Item::Literal(":"),
    Item::Minute,
    Item::Literal(":"),
    Item::Second,
];

/// C's `asctime()`: `%a %b %e %H:%M:%S %Y`.
pub(crate) const ASCTIME: &[Item] = &[
    Item::ShortWeekday,
    Item::Space,
    Item::ShortMonth,
    Item::Space,
    Item::Day,
    Item::Space,
    Item::Hour,
    Item::Literal(":"),
    Item::Minute,
    Item::Literal(":"),
    Item::Second,
    Item::Space,
    Item::Year,
];

/// A numeric field: the whitespace before it, then one to `width` digits.
fn numeric(s: &str, width: usize) -> Scan<'_, i64> {
    number(s.trim_start(), 1, width)
}

/// Read `input` against a layout; every character has to be used.
fn scan_layout(input: &str, items: &[Item]) -> Result<Fields, ParseError> {
    let mut fields = Fields::default();
    let mut s = input;
    for item in items {
        match *item {
            Item::Literal(text) => {
                if s.len() < text.len() {
                    return Err(ParseError::TooShort);
                }
                s = s.strip_prefix(text).ok_or(ParseError::Invalid)?;
            }
            Item::Space => s = s.trim_start(),
            Item::Year => {
                let t = s.trim_start();
                let (rest, value) = if let Some(digits) = t.strip_prefix('-') {
                    let (rest, v) = number(digits, 1, usize::MAX)?;
                    (rest, 0i64.checked_sub(v).ok_or(ParseError::OutOfRange)?)
                } else if let Some(digits) = t.strip_prefix('+') {
                    number(digits, 1, usize::MAX)?
                } else {
                    number(t, 1, 4)?
                };
                fields.set_year(value)?;
                s = rest;
            }
            Item::YearMod100 => {
                let (rest, v) = numeric(s, 2)?;
                fields.set_year_mod_100(v)?;
                s = rest;
            }
            Item::Month => {
                let (rest, v) = numeric(s, 2)?;
                fields.set_month(v)?;
                s = rest;
            }
            Item::Day => {
                let (rest, v) = numeric(s, 2)?;
                fields.set_day(v)?;
                s = rest;
            }
            Item::Hour => {
                let (rest, v) = numeric(s, 2)?;
                fields.set_hour(v)?;
                s = rest;
            }
            Item::Minute => {
                let (rest, v) = numeric(s, 2)?;
                fields.set_minute(v)?;
                s = rest;
            }
            Item::Second => {
                let (rest, v) = numeric(s, 2)?;
                fields.set_second(v)?;
                s = rest;
            }
            Item::ShortWeekday => {
                let (rest, w) = short_weekday(s)?;
                fields.weekday = Some(w);
                s = rest;
            }
            Item::LongWeekday => {
                let (rest, w) = short_or_long_weekday(s)?;
                fields.weekday = Some(w);
                s = rest;
            }
            Item::ShortMonth => {
                let (rest, m) = short_month(s)?;
                fields.set_month(m)?;
                s = rest;
            }
        }
    }
    if s.is_empty() {
        Ok(fields)
    } else {
        Err(ParseError::TooLong)
    }
}

/// A wall clock in a fixed layout.
pub(crate) fn datetime(input: &str, items: &[Item]) -> Result<DateTime, ParseError> {
    scan_layout(input, items)?.datetime()
}

/// A calendar date in a fixed layout.
pub(crate) fn date(input: &str, items: &[Item]) -> Result<Date, ParseError> {
    scan_layout(input, items)?.date()
}

// ─── RFC 3339 and RFC 2822 ──────────────────────────────────────────────────

/// RFC 3339 (`2026-04-08T14:00:00.250+02:00`; `t`, `T` or a space between
/// date and time, `Z` in either case), as a UTC wall clock.
pub(crate) fn rfc3339(s: &str) -> Result<DateTime, ParseError> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return Err(ParseError::TooShort);
    }
    let digit = |i: usize| -> Result<u8, ParseError> {
        match bytes[i] {
            c @ b'0'..=b'9' => Ok(c - b'0'),
            _ => Err(ParseError::Invalid),
        }
    };
    let pair = |i: usize| -> Result<i8, ParseError> {
        i8::try_from(digit(i)? * 10 + digit(i + 1)?).map_err(|_| ParseError::OutOfRange)
    };
    let year = i16::from(digit(0)?) * 1000
        + i16::from(digit(1)?) * 100
        + i16::from(digit(2)?) * 10
        + i16::from(digit(3)?);
    if bytes[4] != b'-' {
        return Err(ParseError::Invalid);
    }
    let month = pair(5)?;
    if bytes[7] != b'-' {
        return Err(ParseError::Invalid);
    }
    let day = pair(8)?;
    let date = Date::new(year, month, day).map_err(|_| ParseError::OutOfRange)?;
    if !matches!(bytes[10], b't' | b'T' | b' ') {
        return Err(ParseError::Invalid);
    }
    let hour = pair(11)?;
    if bytes[13] != b':' {
        return Err(ParseError::Invalid);
    }
    let minute = pair(14)?;
    if bytes[16] != b':' {
        return Err(ParseError::Invalid);
    }
    let second = pair(17)?;
    let (rest, nanos) = if bytes.get(19) == Some(&b'.') {
        nanosecond(&s[20..])?
    } else {
        (&s[19..], 0)
    };
    if second == 60 {
        return Err(ParseError::OutOfRange);
    }
    let time = Time::new(hour, minute, second, nanos).map_err(|_| ParseError::OutOfRange)?;
    let (rest, east) = offset(rest, true, true, true)?;
    if !rest.is_empty() {
        return Err(ParseError::TooLong);
    }
    at_offset(date.to_datetime(time), east)
}

/// RFC 2822 (`Tue, 1 Jul 2003 10:52:37 +0200`), as a UTC wall clock.
///
/// Whitespace stands for folding white space, comments after the zone are
/// skipped, a two-digit year below 50 is 20xx and any other two- or
/// three-digit year is 1900 + it.
pub(crate) fn rfc2822(input: &str) -> Result<DateTime, ParseError> {
    let mut fields = Fields::default();
    let mut s = input.trim_start();

    if let Ok((rest, weekday)) = short_weekday(s) {
        s = rest.strip_prefix(',').ok_or(ParseError::Invalid)?;
        fields.weekday = Some(weekday);
    }

    let (rest, day) = number(s.trim_start(), 1, 2)?;
    fields.set_day(day)?;
    let (rest, month) = short_month(space(rest)?)?;
    fields.set_month(month)?;

    let s = space(rest)?;
    let (rest, mut year) = number(s, 2, usize::MAX)?;
    match (s.len() - rest.len(), year) {
        (2, 0..=49) => year += 2000,
        (2, 50..=99) | (3, _) => year += 1900,
        _ => {}
    }
    fields.set_year(year)?;

    let (rest, hour) = number(space(rest)?, 2, 2)?;
    fields.set_hour(hour)?;
    let s = char(rest.trim_start(), b':')?.trim_start();
    let (mut rest, minute) = number(s, 2, 2)?;
    fields.set_minute(minute)?;
    if let Ok(after_colon) = char(rest.trim_start(), b':') {
        let (after_second, second) = number(after_colon, 2, 2)?;
        fields.set_second(second)?;
        rest = after_second;
    }

    let (mut rest, east) = offset_2822(space(rest)?)?;
    while let Ok((after, ())) = comment_2822(rest) {
        rest = after;
    }
    if !rest.is_empty() {
        return Err(ParseError::TooLong);
    }
    at_offset(fields.datetime()?, east)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fraction_keeps_nine_digits_and_drops_the_rest() {
        assert_eq!(nanosecond("5Z"), Ok(("Z", 500_000_000)));
        assert_eq!(nanosecond("123456789123Z"), Ok(("Z", 123_456_789)));
        assert_eq!(nanosecond("Z"), Err(ParseError::Invalid));
        assert_eq!(nanosecond(""), Err(ParseError::TooShort));
    }

    #[test]
    fn layouts_read_short_fields_and_whitespace_before_numbers() {
        let read = |s: &str| datetime(s, DATE_SPACE_TIME).map(|d| d.to_string());
        assert_eq!(
            read("2026-1-5 1:2:3"),
            Ok("2026-01-05T01:02:03".to_string())
        );
        assert_eq!(
            read(" 2026-01-05\t 01:02:03"),
            Ok("2026-01-05T01:02:03".to_string())
        );
        assert_eq!(
            read("-1-01-05 01:02:03"),
            Ok("-000001-01-05T01:02:03".to_string())
        );
        assert_eq!(read("2026-01-05 01:02:03 "), Err(ParseError::TooLong));
        assert_eq!(read("2026-01-05 01:02"), Err(ParseError::TooShort));
        assert_eq!(read("2026-02-30 01:02:03"), Err(ParseError::OutOfRange));
        assert_eq!(read("2026-01-05 01:02:60"), Err(ParseError::OutOfRange));
    }

    #[test]
    fn a_weekday_has_to_be_the_dates() {
        assert_eq!(
            datetime("Sun Nov  6 08:49:37 1994", ASCTIME).map(|d| d.to_string()),
            Ok("1994-11-06T08:49:37".to_string())
        );
        assert_eq!(
            datetime("Mon Nov  6 08:49:37 1994", ASCTIME),
            Err(ParseError::Impossible)
        );
    }

    #[test]
    fn comments_nest_and_escape() {
        assert_eq!(comment_2822(" (a (b) \\) c) x"), Ok((" x", ())));
        assert_eq!(comment_2822(" (open"), Err(ParseError::TooShort));
        assert_eq!(comment_2822(" x"), Err(ParseError::Invalid));
    }
}
