//! Public holidays and the Easter date.
//!
//! France's national days, and Switzerland's federal days with each of the 26
//! cantons' own. Every holiday carries a stable `key` (snake_case) for the
//! application to translate; the engine names no holiday in any language.
//!
//! The cantonal table is today's calendar applied to every year asked: it does
//! not know when a holiday was instituted or dropped.

use jiff::civil::{Date, Weekday};
use jiff::ToSpan;

use crate::grammar;

/// The first year of the Gregorian computus (the reform of October 1582).
const MIN_YEAR: i32 = 1583;
const MAX_YEAR: i32 = 9999;

/// The cantons by their two-letter codes, in the federal order.
pub const SWISS_CANTONS: [&str; 26] = [
    "ZH", "BE", "LU", "UR", "SZ", "OW", "NW", "GL", "ZG", "FR", "SO", "BS", "BL", "SH", "AR", "AI",
    "SG", "GR", "AG", "TG", "TI", "VD", "VS", "NE", "GE", "JU",
];

/// One public holiday: its calendar date and the key the application translates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holiday {
    pub date: Date,
    pub key: &'static str,
}

fn check_year(year: i32) -> Result<(), String> {
    if (MIN_YEAR..=MAX_YEAR).contains(&year) {
        Ok(())
    } else {
        Err(format!(
            "E_CHRONOS_INVALID_YEAR: the Gregorian Easter date is computed for years {}-{}, got {}",
            MIN_YEAR, MAX_YEAR, year
        ))
    }
}

fn ymd(year: i32, month: i8, day: i8) -> Date {
    // Every (month, day) passed here is a fixed, valid calendar day, and every
    // year a checked one.
    i16::try_from(year)
        .ok()
        .and_then(|y| Date::new(y, month, day).ok())
        .unwrap_or(Date::MIN)
}

/// Easter Sunday of `year` (Gregorian; Meeus/Jones/Butcher algorithm).
pub fn easter_date(year: i32) -> Result<Date, String> {
    check_year(year)?;
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    // month is 3 or 4 and day 1..=31 by construction of the algorithm.
    match (i16::try_from(year), i8::try_from(month), i8::try_from(day)) {
        (Ok(y), Ok(m), Ok(d)) => Date::new(y, m, d).ok(),
        _ => None,
    }
    .ok_or_else(|| format!("E_CHRONOS_INVALID_YEAR: no Easter date for {}", year))
}

/// The first `weekday` on or after `date`.
fn on_or_after(date: Date, weekday: Weekday) -> Date {
    let ahead = (7 + weekday.to_monday_zero_offset() - date.weekday().to_monday_zero_offset()) % 7;
    date + i64::from(ahead).days()
}

/// The cantonal fixed days (`MM-DD`, key), from the legacy per-canton table.
fn cantonal_fixed_days(canton: &str) -> &'static [(i8, i8, &'static str)] {
    const BERCHTOLD: (i8, i8, &str) = (1, 2, "saint_berchtold");
    const EPIPHANY: (i8, i8, &str) = (1, 6, "epiphany");
    const REPUBLIC: (i8, i8, &str) = (3, 1, "republic_day");
    const JOSEPH: (i8, i8, &str) = (3, 19, "saint_joseph");
    const LABOUR: (i8, i8, &str) = (5, 1, "labour_day");
    const PLEBISCITE: (i8, i8, &str) = (6, 23, "plebiscite_commemoration");
    const PETER_PAUL: (i8, i8, &str) = (6, 29, "saints_peter_and_paul");
    const ASSUMPTION: (i8, i8, &str) = (8, 15, "assumption");
    const FLUE: (i8, i8, &str) = (9, 25, "nicholas_of_flue");
    const ALL_SAINTS: (i8, i8, &str) = (11, 1, "all_saints");
    const IMMACULATE: (i8, i8, &str) = (12, 8, "immaculate_conception");
    const STEPHEN: (i8, i8, &str) = (12, 26, "saint_stephen");
    const RESTORATION: (i8, i8, &str) = (12, 31, "restoration_of_the_republic");
    match canton {
        "ZH" => &[BERCHTOLD, LABOUR, STEPHEN],
        "BE" | "LU" => &[BERCHTOLD, STEPHEN],
        "UR" => &[
            EPIPHANY, JOSEPH, LABOUR, ASSUMPTION, ALL_SAINTS, IMMACULATE, STEPHEN,
        ],
        "SZ" => &[EPIPHANY, JOSEPH, ASSUMPTION, STEPHEN],
        "OW" => &[BERCHTOLD, ASSUMPTION, FLUE, ALL_SAINTS, IMMACULATE, STEPHEN],
        "NW" => &[JOSEPH, ASSUMPTION, ALL_SAINTS, IMMACULATE, STEPHEN],
        "GL" => &[BERCHTOLD, ALL_SAINTS, STEPHEN],
        "ZG" | "FR" => &[BERCHTOLD, ASSUMPTION, ALL_SAINTS, IMMACULATE, STEPHEN],
        "SO" => &[BERCHTOLD, ASSUMPTION, ALL_SAINTS, STEPHEN],
        "BS" | "BL" => &[LABOUR, STEPHEN],
        "SH" => &[BERCHTOLD, LABOUR, STEPHEN],
        "AR" | "TG" => &[STEPHEN],
        "AI" => &[ASSUMPTION, ALL_SAINTS, STEPHEN],
        "SG" => &[ALL_SAINTS, STEPHEN],
        "GR" => &[ASSUMPTION, STEPHEN],
        "AG" => &[BERCHTOLD, ASSUMPTION, STEPHEN],
        "TI" => &[
            EPIPHANY, JOSEPH, LABOUR, PETER_PAUL, ASSUMPTION, ALL_SAINTS, IMMACULATE, STEPHEN,
        ],
        "VD" => &[BERCHTOLD],
        "VS" => &[JOSEPH, ASSUMPTION, ALL_SAINTS, IMMACULATE],
        "NE" => &[BERCHTOLD, REPUBLIC, LABOUR, STEPHEN],
        "GE" => &[RESTORATION],
        "JU" => &[
            BERCHTOLD, LABOUR, PLEBISCITE, ASSUMPTION, ALL_SAINTS, IMMACULATE, STEPHEN,
        ],
        _ => &[],
    }
}

fn france(year: i32, easter: Date, out: &mut Vec<Holiday>) {
    let fixed: [(i8, i8, &'static str); 8] = [
        (1, 1, "new_year"),
        (5, 1, "labour_day"),
        (5, 8, "victory_in_europe"),
        (7, 14, "national_day"),
        (8, 15, "assumption"),
        (11, 1, "all_saints"),
        (11, 11, "armistice"),
        (12, 25, "christmas"),
    ];
    for (month, day, key) in fixed {
        out.push(Holiday {
            date: ymd(year, month, day),
            key,
        });
    }
    out.push(Holiday {
        date: easter + 1.days(),
        key: "easter_monday",
    });
    out.push(Holiday {
        date: easter + 39.days(),
        key: "ascension",
    });
    out.push(Holiday {
        date: easter + 50.days(),
        key: "whit_monday",
    });
}

fn canton(year: i32, easter: Date, code: &str, out: &mut Vec<Holiday>) {
    for &(month, day, key) in cantonal_fixed_days(code) {
        out.push(Holiday {
            date: ymd(year, month, day),
            key,
        });
    }
    out.push(Holiday {
        date: easter + 1.days(),
        key: "easter_monday",
    });
    out.push(Holiday {
        date: easter + 39.days(),
        key: "ascension",
    });
    out.push(Holiday {
        date: easter + 50.days(),
        key: "whit_monday",
    });

    let good_friday = Holiday {
        date: easter - 2.days(),
        key: "good_friday",
    };
    let corpus_christi = Holiday {
        date: easter + 60.days(),
        key: "corpus_christi",
    };
    let first_sunday_of_september = on_or_after(ymd(year, 9, 1), Weekday::Sunday);
    // The Monday after the third Sunday of September.
    let federal_fast_monday = Holiday {
        date: first_sunday_of_september + 15.days(),
        key: "federal_fast_monday",
    };

    match code {
        "ZH" | "BE" | "LU" | "SH" | "AR" | "SG" | "GR" | "TG" => out.push(good_friday),
        "UR" | "SZ" | "OW" | "NW" | "ZG" | "FR" | "SO" | "BS" | "BL" | "AI" | "AG" | "TI"
        | "JU" => {
            out.push(good_friday);
            out.push(corpus_christi);
        }
        "GL" => {
            // First Thursday of April, of the year asked; one week later when
            // it falls in Holy Week (Palm Sunday to Holy Saturday).
            let mut fahrt = on_or_after(ymd(year, 4, 1), Weekday::Thursday);
            if fahrt >= easter - 7.days() && fahrt < easter {
                fahrt += 7.days();
            }
            out.push(Holiday {
                date: fahrt,
                key: "naefelser_fahrt",
            });
            out.push(good_friday);
        }
        "VD" => {
            out.push(good_friday);
            out.push(federal_fast_monday);
        }
        "VS" => out.push(corpus_christi),
        "NE" => {
            out.push(good_friday);
            out.push(federal_fast_monday);
            out.push(corpus_christi);
            // 2 January and 26 December only when 1 January / 25 December is
            // a Sunday.
            let jan2 = ymd(year, 1, 2);
            let dec26 = ymd(year, 12, 26);
            let new_year_on_sunday = ymd(year, 1, 1).weekday() == Weekday::Sunday;
            let christmas_on_sunday = ymd(year, 12, 25).weekday() == Weekday::Sunday;
            out.retain(|h| {
                !((h.date == jan2 && !new_year_on_sunday)
                    || (h.date == dec26 && !christmas_on_sunday))
            });
        }
        "GE" => {
            // Thursday after the first Sunday of September.
            out.push(Holiday {
                date: first_sunday_of_september + 4.days(),
                key: "geneva_fast",
            });
            out.push(good_friday);
        }
        _ => {}
    }
}

/// The public holidays of `year` in `country` (`CH` or `FR`), with those of
/// `region` (a Swiss canton's two-letter code) when one is given, sorted by
/// date then key. Two holidays on one day are both listed.
pub fn holidays(year: i32, country: &str, region: Option<&str>) -> Result<Vec<Holiday>, String> {
    let easter = easter_date(year)?;
    let mut out = Vec::new();
    match country {
        "FR" => {
            if let Some(r) = region {
                return Err(format!(
                    "E_CHRONOS_UNKNOWN_REGION: region '{}' is not known for FR, which has none",
                    r
                ));
            }
            france(year, easter, &mut out);
        }
        "CH" => {
            out.push(Holiday {
                date: ymd(year, 1, 1),
                key: "new_year",
            });
            out.push(Holiday {
                date: ymd(year, 8, 1),
                key: "national_day",
            });
            out.push(Holiday {
                date: ymd(year, 12, 25),
                key: "christmas",
            });
            if let Some(r) = region {
                if !SWISS_CANTONS.contains(&r) {
                    return Err(format!(
                        "E_CHRONOS_UNKNOWN_REGION: region '{}' is not a canton code; known: {}",
                        r,
                        SWISS_CANTONS.join(", ")
                    ));
                }
                canton(year, easter, r, &mut out);
            }
        }
        _ => {
            return Err(format!(
                "E_CHRONOS_UNKNOWN_COUNTRY: country '{}' has no holiday calendar; known: CH, FR",
                country
            ))
        }
    }
    out.sort_by(|a, b| a.date.cmp(&b.date).then(a.key.cmp(b.key)));
    out.dedup();
    Ok(out)
}

/// Whether the calendar date `date` (`YYYY-MM-DD`) is a public holiday.
pub fn is_holiday(date: &str, country: &str, region: Option<&str>) -> Result<bool, String> {
    let day = parse_calendar_date(date)?;
    Ok(holidays(i32::from(day.year()), country, region)?
        .iter()
        .any(|h| h.date == day))
}

fn parse_calendar_date(text: &str) -> Result<Date, String> {
    let invalid = || {
        format!(
            "E_CHRONOS_INVALID_DATE: '{}' is not a calendar date (YYYY-MM-DD)",
            text
        )
    };
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(invalid());
    }
    grammar::date(text, grammar::DATE).map_err(|_| invalid())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(text: &str) -> Date {
        text.parse().unwrap()
    }

    #[test]
    fn easter_known_dates() {
        assert_eq!(easter_date(2024).unwrap(), d("2024-03-31"));
        assert_eq!(easter_date(2026).unwrap(), d("2026-04-05"));
        assert_eq!(easter_date(2038).unwrap(), d("2038-04-25"));
        assert_eq!(easter_date(2285).unwrap(), d("2285-03-22"));
        assert!(easter_date(1582)
            .unwrap_err()
            .starts_with("E_CHRONOS_INVALID_YEAR"));
    }

    #[test]
    fn easter_always_a_sunday_in_range() {
        for year in MIN_YEAR..=MAX_YEAR {
            let e = easter_date(year).unwrap();
            assert_eq!(e.weekday(), Weekday::Sunday, "{}", year);
            assert!(e >= ymd(year, 3, 22) && e <= ymd(year, 4, 25), "{}", year);
        }
    }

    #[test]
    fn neuchatel_sunday_rule() {
        let ne = |y| holidays(y, "CH", Some("NE")).unwrap();
        assert!(ne(2023).iter().any(|h| h.date == d("2023-01-02")));
        assert!(!ne(2026).iter().any(|h| h.date == d("2026-01-02")));
        assert!(ne(2022).iter().any(|h| h.date == d("2022-12-26")));
        assert!(!ne(2026).iter().any(|h| h.date == d("2026-12-26")));
    }

    #[test]
    fn naefelser_fahrt_leaves_holy_week() {
        let fahrt = |y| {
            holidays(y, "CH", Some("GL"))
                .unwrap()
                .into_iter()
                .find(|h| h.key == "naefelser_fahrt")
                .unwrap()
                .date
        };
        assert_eq!(fahrt(2023), d("2023-04-13"));
        assert_eq!(fahrt(2027), d("2027-04-01"));
    }

    #[test]
    fn refuses_unknown_inputs() {
        assert!(holidays(2026, "DE", None)
            .unwrap_err()
            .starts_with("E_CHRONOS_UNKNOWN_COUNTRY"));
        assert!(holidays(2026, "CH", Some("XX"))
            .unwrap_err()
            .starts_with("E_CHRONOS_UNKNOWN_REGION"));
        assert!(is_holiday("2026-7-14", "FR", None)
            .unwrap_err()
            .starts_with("E_CHRONOS_INVALID_DATE"));
        assert!(is_holiday("2026-07-14", "FR", None).unwrap());
    }
}
