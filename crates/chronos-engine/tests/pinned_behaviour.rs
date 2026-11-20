//! What the engine answers, pinned call by call.
//!
//! Each line of `pinned_behaviour.txt` is one public call and the exact text it
//! produced: `function|argument|… => result`, or `=> ERR message`. The table
//! covers what moves when the date library underneath changes: DST transitions,
//! times a zone skips or repeats, leap years and month ends, ISO week numbers,
//! the formatting tokens, what each parser accepts and the errors it gives, zone
//! names and offsets (historical ones with seconds included), and recurrences
//! expanded across a change of time.
//!
//! Arguments are separated by `|`; `-` stands for `None`, and `\n` in a rule
//! text for a line break.

use chronos_engine as engine;

fn render<T, F: FnOnce(T) -> String>(result: Result<T, String>, ok: F) -> String {
    match result {
        Ok(value) => ok(value),
        Err(message) => format!("ERR {}", message),
    }
}

fn text(result: Result<String, String>) -> String {
    render(result, |value| value)
}

fn optional(arg: &str) -> Option<&str> {
    if arg == "-" {
        None
    } else {
        Some(arg)
    }
}

fn number<T: std::str::FromStr>(arg: &str) -> T {
    match arg.parse() {
        Ok(value) => value,
        Err(_) => panic!("not a number in a pinned call: {}", arg),
    }
}

/// Run one pinned call and render what it returned.
fn call(spec: &str) -> String {
    let args: Vec<&str> = spec.split('|').collect();
    let arg = |i: usize| -> &str {
        match args.get(i) {
            Some(value) => value,
            None => panic!("missing argument {} in a pinned call: {}", i, spec),
        }
    };
    match arg(0) {
        "add" => text(engine::add(arg(1), number(arg(2)), arg(3))),
        "diff" => render(engine::diff(arg(1), arg(2), arg(3)), |v| format!("{:?}", v)),
        "start_of" => text(engine::start_of(arg(1), arg(2))),
        "end_of" => text(engine::end_of(arg(1), arg(2))),
        "start_of_in_zone" => text(engine::start_of_in_zone(arg(1), arg(2), arg(3))),
        "end_of_in_zone" => text(engine::end_of_in_zone(arg(1), arg(2), arg(3))),
        "format" => text(engine::format(arg(1), arg(2))),
        "validate_timezone" => text(engine::validate_timezone(arg(1))),
        "to_zone" => render(engine::to_zone(arg(1), arg(2)), |z| {
            format!("{} {} {}", z.iso, z.offset_minutes, z.zone_name)
        }),
        "add_in_zone" => text(engine::add_in_zone(arg(1), number(arg(2)), arg(3), arg(4))),
        "diff_in_zone" => render(engine::diff_in_zone(arg(1), arg(2), arg(3), arg(4)), |v| {
            format!("{:?}", v)
        }),
        "zone_offset" => render(engine::zone_offset(arg(1), arg(2)), |v| v.to_string()),
        "from_local" => text(engine::from_local(arg(1), arg(2))),
        "calendar_parts" => render(engine::calendar_parts(arg(1)), |p| {
            format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03} weekday={} week={} week_year={} ordinal={} quarter={} days_in_month={} days_in_year={} leap={}",
                p.year,
                p.month,
                p.day,
                p.hour,
                p.minute,
                p.second,
                p.millisecond,
                p.weekday,
                p.week_number,
                p.week_year,
                p.ordinal,
                p.quarter,
                p.days_in_month,
                p.days_in_year,
                p.is_leap_year
            )
        }),
        "parse_rfc2822" => text(engine::parse_rfc2822(arg(1))),
        "parse_sql" => text(engine::parse_sql(arg(1), optional(arg(2)))),
        "parse_http" => text(engine::parse_http(arg(1))),
        "rrule" => render(
            engine::rrule_expand(
                optional(arg(1)),
                &arg(2).replace("\\n", "\n"),
                number(arg(3)),
                optional(arg(4)),
            ),
            |list| list.join(" "),
        ),
        "easter_date" => render(engine::holidays::easter_date(number(arg(1))), |d| {
            d.to_string()
        }),
        "holidays" => render(
            engine::holidays::holidays(number(arg(1)), arg(2), optional(arg(3))),
            |list| {
                list.iter()
                    .map(|h| format!("{} {}", h.date, h.key))
                    .collect::<Vec<_>>()
                    .join(", ")
            },
        ),
        "is_holiday" => render(
            engine::holidays::is_holiday(arg(1), arg(2), optional(arg(3))),
            |v| v.to_string(),
        ),
        other => panic!("unknown function in a pinned call: {}", other),
    }
}

/// The pinned table: `(line number, section, call, expected)`.
fn cases(table: &str) -> Vec<(usize, String, String, String)> {
    let mut section = String::new();
    let mut out = Vec::new();
    for (index, line) in table.lines().enumerate() {
        if let Some(title) = line.strip_prefix("# ") {
            section = title.to_string();
            continue;
        }
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let (spec, expected) = match line.split_once(" => ") {
            Some(pair) => pair,
            None => panic!("line {} has no ` => `: {}", index + 1, line),
        };
        out.push((
            index + 1,
            section.clone(),
            spec.to_string(),
            expected.to_string(),
        ));
    }
    out
}

#[test]
fn every_pinned_call_answers_what_it_answered() {
    let table = include_str!("pinned_behaviour.txt");
    let cases = cases(table);
    assert!(cases.len() > 300, "the table lost its cases");
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|(line, section, spec, expected)| {
            let actual = call(spec);
            (&actual != expected).then(|| {
                format!(
                    "line {} [{}] {}\n    expected: {}\n    actual:   {}",
                    line, section, spec, expected, actual
                )
            })
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} pinned call(s) changed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
