import { describe, expect, it } from "vitest";
import {
	DateTime,
	easterDate,
	expandRRule,
	holidays,
	isHoliday,
} from "../../src/index.js";

/**
 * What the public API answers where the Rust engine decides: zone offsets and
 * names, times a zone skips or repeats, calendar fields, the parsers, and
 * recurrences across a change of time. Each case renders its result (or the
 * error message) as text, so a change of date library underneath the engine
 * shows up here as a changed line rather than a silently different value.
 */
function attempt(run: () => unknown): string {
	try {
		const value = run();
		return typeof value === "string" ? value : JSON.stringify(value);
	} catch (error) {
		return `ERR ${error instanceof Error ? error.message : String(error)}`;
	}
}

const paris = (iso: string): DateTime =>
	DateTime.fromISO(iso).setZone("Europe/Paris");

const CASES: Array<[string, () => unknown, string | RegExp]> = [
	// Zone names: exact IANA spelling only, links included.
	[
		"US/Eastern",
		() =>
			DateTime.fromISO("2026-01-15T12:00:00Z").setZone("US/Eastern").toISO(),
		"2026-01-15T07:00:00.000-05:00",
	],
	[
		"europe/paris",
		() =>
			DateTime.fromISO("2026-01-15T12:00:00Z").setZone("europe/paris").toISO(),
		"ERR Unknown IANA timezone: 'europe/paris'. Check https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
	],
	[
		"Factory",
		() => DateTime.fromISO("2026-01-15T12:00:00Z").setZone("Factory").toISO(),
		"ERR Unknown IANA timezone: 'Factory'. Check https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
	],
	// Offsets either side of a change of time, and historical ones with seconds.
	[
		"paris before spring",
		() => paris("2026-03-29T00:59:59.999Z").toISO(),
		"2026-03-29T01:59:59.999+01:00",
	],
	[
		"paris after spring",
		() => paris("2026-03-29T01:00:00Z").toISO(),
		"2026-03-29T03:00:00.000+02:00",
	],
	[
		"paris fold first",
		() => paris("2026-10-25T00:30:00Z").toISO(),
		"2026-10-25T02:30:00.000+02:00",
	],
	[
		"paris fold second",
		() => paris("2026-10-25T01:30:00Z").toISO(),
		"2026-10-25T02:30:00.000+01:00",
	],
	["paris offset summer", () => paris("2026-07-15T12:00:00Z").offset, "120"],
	[
		"monrovia 1970 offset",
		() =>
			DateTime.fromISO("1970-01-01T00:00:00Z").setZone("Africa/Monrovia")
				.offset,
		"-44",
	],
	[
		"chatham",
		() =>
			DateTime.fromISO("2026-01-15T00:00:00Z")
				.setZone("Pacific/Chatham")
				.toISO(),
		"2026-01-15T13:45:00.000+13:45",
	],
	[
		"lord howe",
		() =>
			DateTime.fromISO("2026-07-15T00:00:00Z")
				.setZone("Australia/Lord_Howe")
				.toISO(),
		"2026-07-15T10:30:00.000+10:30",
	],
	// Wall clocks a zone skips or repeats.
	[
		"gap",
		() =>
			DateTime.fromObject(
				{ year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
				{ zone: "Europe/Paris" },
			)
				.toUTC()
				.toISO(),
		"2026-03-29T01:30:00.000Z",
	],
	[
		"fold",
		() =>
			DateTime.fromObject(
				{ year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
				{ zone: "Europe/Paris" },
			)
				.toUTC()
				.toISO(),
		"2026-10-25T00:30:00.000Z",
	],
	[
		"new york gap",
		() =>
			DateTime.fromObject(
				{ year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
				{ zone: "America/New_York" },
			)
				.toUTC()
				.toISO(),
		"2026-03-08T07:30:00.000Z",
	],
	[
		"apia skipped day",
		() =>
			DateTime.fromObject(
				{ year: 2011, month: 12, day: 30, hour: 12 },
				{ zone: "Pacific/Apia" },
			)
				.toUTC()
				.toISO(),
		"2011-12-30T22:00:00.000Z",
	],
	[
		"sao paulo midnight gap",
		() =>
			DateTime.fromISO("2018-11-04T12:00:00Z")
				.setZone("America/Sao_Paulo")
				.startOf("day")
				.toUTC()
				.toISO(),
		"2018-11-04T03:00:00.000Z",
	],
	[
		"plus a day across spring",
		() => paris("2026-03-28T10:00:00Z").plus(1, "day").toISO(),
		"2026-03-29T11:00:00.000+02:00",
	],
	[
		"plus a day across autumn",
		() => paris("2026-10-24T10:00:00Z").plus(1, "day").toISO(),
		"2026-10-25T12:00:00.000+01:00",
	],
	[
		"plus a day into the gap",
		() => paris("2026-03-28T01:30:00Z").plus(1, "day").toISO(),
		"2026-03-29T03:30:00.000+02:00",
	],
	[
		"plus an hour across the fold",
		() => paris("2026-10-25T00:30:00Z").plus(1, "hour").toISO(),
		"2026-10-25T02:30:00.000+01:00",
	],
	[
		"end of the spring day",
		() => paris("2026-03-29T12:00:00Z").endOf("day").toUTC().toISO(),
		"2026-03-29T21:59:59.999Z",
	],
	[
		"diff a 23-hour day",
		() =>
			paris("2026-03-29T10:00:00Z").diff(paris("2026-03-28T11:00:00Z"), "days"),
		'"P1D"',
	],
	// Calendar fields.
	[
		"iso week 53",
		() => [
			DateTime.fromISO("2021-01-03T00:00:00Z").weekNumber,
			DateTime.fromISO("2021-01-03T00:00:00Z").weekYear,
		],
		"[53,2020]",
	],
	[
		"iso week 1 of next year",
		() => [
			DateTime.fromISO("2024-12-30T00:00:00Z").weekNumber,
			DateTime.fromISO("2024-12-30T00:00:00Z").weekYear,
		],
		"[1,2025]",
	],
	[
		"leap day",
		() => {
			const d = DateTime.fromISO("2024-02-29T12:00:00Z");
			return [
				d.ordinal,
				d.daysInMonth,
				d.daysInYear,
				d.isInLeapYear,
				d.quarter,
				d.weekday,
			];
		},
		"[60,29,366,true,1,4]",
	],
	[
		"century not leap",
		() => {
			const d = DateTime.fromISO("2100-02-01T00:00:00Z");
			return [d.daysInMonth, d.isInLeapYear];
		},
		"[28,false]",
	],
	[
		"month end plus a month",
		() => DateTime.fromISO("2024-01-31T10:00:00Z").plus(1, "month").toISO(),
		"2024-02-29T10:00:00.000Z",
	],
	// Formatting tokens.
	[
		"format utc",
		() =>
			DateTime.fromISO("2005-01-02T03:04:05Z").format(
				"YYYY YY MM DD HH mm ss Z [Z] 100%",
			),
		"2005 05 01 02 03 04 05 +00:00 Z 100%",
	],
	[
		"format zoned",
		() => paris("2026-07-15T12:00:00Z").format("YYYY-MM-DD HH:mm:ss Z"),
		"2026-07-15 14:00:00 +02:00",
	],
	// Parsers.
	[
		"sql",
		() => DateTime.fromSQL("2026-08-10 12:00:00.123+02:00").toISO(),
		"2026-08-10T10:00:00.123Z",
	],
	[
		"sql in zone",
		() =>
			DateTime.fromSQL("2026-10-25 02:30:00", { zone: "Europe/Paris" })
				.toUTC()
				.toISO(),
		"2026-10-25T00:30:00.000Z",
	],
	[
		"sql invalid",
		() => DateTime.fromSQL("2026-02-30").toISO(),
		"ERR Invalid SQL datetime: 2026-02-30",
	],
	[
		"rfc2822",
		() => DateTime.fromRFC2822("Tue, 1 Jul 2003 10:52:37 +0200").toISO(),
		"2003-07-01T08:52:37.000Z",
	],
	[
		"rfc2822 two-digit year",
		() => DateTime.fromRFC2822("Thu, 1 Jul 49 10:52:37 PDT").toISO(),
		"2049-07-01T17:52:37.000Z",
	],
	[
		"rfc2822 wrong weekday",
		() => DateTime.fromRFC2822("Wed, 1 Jul 2003 10:52:37 +0200").toISO(),
		"ERR Invalid RFC 2822 date: Wed, 1 Jul 2003 10:52:37 +0200 (no possible date and time matching input)",
	],
	[
		"rfc2822 leap second",
		() => DateTime.fromRFC2822("Sat, 31 Dec 2016 23:59:60 +0000").toISO(),
		/^ERR /,
	],
	[
		"rfc2822 beyond 9999",
		() => DateTime.fromRFC2822("1 Jan 12345 00:00 GMT").toISO(),
		/^ERR /,
	],
	[
		"http imf",
		() => DateTime.fromHTTP("Sun, 06 Nov 1994 08:49:37 GMT").toISO(),
		"1994-11-06T08:49:37.000Z",
	],
	[
		"http rfc850",
		() => DateTime.fromHTTP("Sunday, 06-Nov-94 08:49:37 GMT").toISO(),
		"1994-11-06T08:49:37.000Z",
	],
	[
		"http asctime",
		() => DateTime.fromHTTP("Sun Nov  6 08:49:37 1994").toISO(),
		"1994-11-06T08:49:37.000Z",
	],
	[
		"http invalid",
		() => DateTime.fromHTTP("Sunday Nov  6 08:49:37 1994").toISO(),
		"ERR Invalid HTTP date: Sunday Nov  6 08:49:37 1994",
	],
	// Recurrences across a change of time.
	[
		"daily 09:00 paris",
		() => expandRRule(paris("2026-03-27T08:00:00Z"), "FREQ=DAILY;COUNT=4"),
		'["2026-03-27T08:00:00.000Z","2026-03-28T08:00:00.000Z","2026-03-29T07:00:00.000Z","2026-03-30T07:00:00.000Z"]',
	],
	[
		"hourly across the fold",
		() => expandRRule(paris("2026-10-24T23:00:00Z"), "FREQ=HOURLY;COUNT=5"),
		'["2026-10-24T23:00:00.000Z","2026-10-25T00:00:00.000Z","2026-10-25T02:00:00.000Z","2026-10-25T03:00:00.000Z","2026-10-25T04:00:00.000Z"]',
	],
	[
		"last sunday at 02:30",
		() =>
			expandRRule(
				"DTSTART;TZID=Europe/Paris:20260125T023000\nRRULE:FREQ=MONTHLY;BYDAY=-1SU;COUNT=12",
				{ limit: 20 },
			),
		'["2026-01-25T01:30:00.000Z","2026-02-22T01:30:00.000Z","2026-03-29T01:30:00.000Z","2026-04-26T00:30:00.000Z","2026-05-31T00:30:00.000Z","2026-06-28T00:30:00.000Z","2026-07-26T00:30:00.000Z","2026-08-30T00:30:00.000Z","2026-09-27T00:30:00.000Z","2026-10-25T00:30:00.000Z","2026-11-29T01:30:00.000Z","2026-12-27T01:30:00.000Z"]',
	],
	[
		"exdate in the fold",
		() =>
			expandRRule(
				"DTSTART;TZID=Europe/Paris:20261023T023000\nRRULE:FREQ=DAILY;COUNT=4",
				{ exdates: ["2026-10-25T00:30:00Z"] },
			),
		'["2026-10-23T00:30:00.000Z","2026-10-24T00:30:00.000Z","2026-10-26T01:30:00.000Z"]',
	],
	// Holidays.
	["easter", () => easterDate(2026), "2026-04-05"],
	[
		"näfelser fahrt",
		() =>
			holidays(2027, { country: "CH", region: "GL" }).find(
				(h) => h.key === "naefelser_fahrt",
			),
		'{"date":"2027-04-01","key":"naefelser_fahrt"}',
	],
	["bastille day", () => isHoliday("2026-07-14", { country: "FR" }), "true"],
];

describe("engine behaviour pinned through the public API", () => {
	for (const [name, run, expected] of CASES) {
		it(name, () => {
			if (typeof expected === "string") {
				expect(attempt(run)).toBe(expected);
			} else {
				expect(attempt(run)).toMatch(expected);
			}
		});
	}
});
