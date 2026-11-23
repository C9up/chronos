/**
 * Public holidays and the Easter date, computed by the Rust engine.
 *
 * The oracle below is written independently of the engine: the legacy
 * per-canton table of fixed days and the legacy rules, in plain `Date.UTC`
 * arithmetic, with its three defects fixed (Neuchatel's Sunday rule, the
 * Naefelser Fahrt computed on the year asked and moved out of Holy Week).
 */
import { describe, expect, it } from "vitest";
import {
	DateTime,
	easterDate,
	type Holiday,
	type HolidayOptions,
	holidays,
	isHoliday,
	SWISS_CANTONS,
	type SwissCanton,
} from "../../src/index.js";

const DAY = 86_400_000;

function iso(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number): number {
	return Date.UTC(year, month - 1, day);
}

/** The legacy computus (valid 1900-2099), as an independent oracle. */
function legacyEaster(year: number): number {
	const n = year - 1900;
	const a = n % 19;
	const b = Math.trunc((7 * a + 1) / 19);
	const c = (11 * a - b + 4) % 29;
	const d = Math.trunc(n / 4);
	const e = (n - c + d + 31) % 7;
	return utc(year, 3, 31) + (25 - c - e) * DAY;
}

/** The legacy fixed-day table, its numeric region ids mapped to the codes. */
const FIXED: Record<string, string[]> = {
	ZH: ["01-02", "05-01", "12-26"],
	BE: ["01-02", "12-26"],
	LU: ["01-02", "12-26"],
	UR: ["01-06", "03-19", "05-01", "08-15", "11-01", "12-08", "12-26"],
	SZ: ["01-06", "03-19", "08-15", "12-26"],
	OW: ["01-02", "08-15", "09-25", "11-01", "12-08", "12-26"],
	NW: ["03-19", "08-15", "11-01", "12-08", "12-26"],
	GL: ["01-02", "11-01", "12-26"],
	ZG: ["01-02", "08-15", "11-01", "12-08", "12-26"],
	FR: ["01-02", "08-15", "11-01", "12-08", "12-26"],
	SO: ["01-02", "08-15", "11-01", "12-26"],
	BS: ["05-01", "12-26"],
	BL: ["05-01", "12-26"],
	SH: ["01-02", "05-01", "12-26"],
	AR: ["12-26"],
	AI: ["08-15", "11-01", "12-26"],
	SG: ["11-01", "12-26"],
	GR: ["08-15", "12-26"],
	AG: ["01-02", "08-15", "12-26"],
	TG: ["12-26"],
	TI: ["01-06", "03-19", "05-01", "06-29", "08-15", "11-01", "12-08", "12-26"],
	VD: ["01-02"],
	VS: ["03-19", "08-15", "11-01", "12-08"],
	NE: ["01-02", "03-01", "05-01", "12-26"],
	GE: ["12-31"],
	JU: ["01-02", "05-01", "06-23", "08-15", "11-01", "12-08", "12-26"],
};

const GOOD_FRIDAY = new Set(["ZH", "BE", "LU", "SH", "AR", "SG", "GR", "TG"]);
const GOOD_FRIDAY_AND_CORPUS_CHRISTI = new Set([
	"UR",
	"SZ",
	"OW",
	"NW",
	"ZG",
	"FR",
	"SO",
	"BS",
	"BL",
	"AI",
	"AG",
	"TI",
	"JU",
]);

function firstSundayOfSeptember(year: number): number {
	const first = utc(year, 9, 1);
	return first + ((7 - new Date(first).getUTCDay()) % 7) * DAY;
}

function oracle(year: number, region?: string): string[] {
	const days = new Set<string>([
		`${year}-01-01`,
		`${year}-08-01`,
		`${year}-12-25`,
	]);
	if (region === undefined) return [...days].sort();
	const easter = legacyEaster(year);
	for (const md of FIXED[region] ?? []) days.add(`${year}-${md}`);
	days.add(iso(easter + DAY));
	days.add(iso(easter + 39 * DAY));
	days.add(iso(easter + 50 * DAY));
	const goodFriday = iso(easter - 2 * DAY);
	const corpusChristi = iso(easter + 60 * DAY);
	const fastMonday = iso(firstSundayOfSeptember(year) + 15 * DAY);
	if (GOOD_FRIDAY.has(region)) days.add(goodFriday);
	if (GOOD_FRIDAY_AND_CORPUS_CHRISTI.has(region)) {
		days.add(goodFriday);
		days.add(corpusChristi);
	}
	if (region === "GL") {
		const april1 = utc(year, 4, 1);
		let fahrt = april1 + ((4 - new Date(april1).getUTCDay() + 7) % 7) * DAY;
		// Holy Week: Palm Sunday (Easter - 7) to Holy Saturday (Easter - 1).
		if (fahrt >= easter - 7 * DAY && fahrt < easter) fahrt += 7 * DAY;
		days.add(iso(fahrt));
		days.add(goodFriday);
	}
	if (region === "VD") {
		days.add(goodFriday);
		days.add(fastMonday);
	}
	if (region === "VS") days.add(corpusChristi);
	if (region === "NE") {
		days.add(goodFriday);
		days.add(fastMonday);
		days.add(corpusChristi);
		if (new Date(utc(year, 1, 1)).getUTCDay() !== 0)
			days.delete(`${year}-01-02`);
		if (new Date(utc(year, 12, 25)).getUTCDay() !== 0)
			days.delete(`${year}-12-26`);
	}
	if (region === "GE") {
		days.add(iso(firstSundayOfSeptember(year) + 4 * DAY));
		days.add(goodFriday);
	}
	return [...days].sort();
}

const datesOf = (list: Holiday[]): string[] =>
	[...new Set(list.map((h) => h.date))].sort();

describe("chronos > easterDate", () => {
	it("gives the Gregorian Easter Sunday", () => {
		expect(easterDate(2024)).toBe("2024-03-31");
		expect(easterDate(2025)).toBe("2025-04-20");
		expect(easterDate(2026)).toBe("2026-04-05");
		expect(easterDate(2038)).toBe("2038-04-25"); // latest possible
		expect(easterDate(2285)).toBe("2285-03-22"); // earliest possible
		expect(easterDate(1583)).toBe("1583-04-10");
	});

	it("agrees with the legacy computus on every year it is valid for", () => {
		for (let year = 1900; year <= 2099; year++) {
			expect(easterDate(year)).toBe(iso(legacyEaster(year)));
		}
	});

	it("refuses a year outside the Gregorian computus", () => {
		for (const year of [1582, 10_000, 2026.5]) {
			expect(() => easterDate(year)).toThrow(
				expect.objectContaining({ code: "E_CHRONOS_INVALID_YEAR" }),
			);
		}
	});
});

describe("chronos > holidays", () => {
	it("lists France's eleven public holidays", () => {
		expect(holidays(2026, { country: "FR" })).toEqual([
			{ date: "2026-01-01", key: "new_year" },
			{ date: "2026-04-06", key: "easter_monday" },
			{ date: "2026-05-01", key: "labour_day" },
			{ date: "2026-05-08", key: "victory_in_europe" },
			{ date: "2026-05-14", key: "ascension" },
			{ date: "2026-05-25", key: "whit_monday" },
			{ date: "2026-07-14", key: "national_day" },
			{ date: "2026-08-15", key: "assumption" },
			{ date: "2026-11-01", key: "all_saints" },
			{ date: "2026-11-11", key: "armistice" },
			{ date: "2026-12-25", key: "christmas" },
		]);
	});

	it("keeps both holidays of one day (Ascension on Labour Day, 2008)", () => {
		const may1 = holidays(2008, { country: "FR" }).filter(
			(h) => h.date === "2008-05-01",
		);
		expect(may1.map((h) => h.key)).toEqual(["ascension", "labour_day"]);
	});

	it("lists the Swiss federal days without a canton", () => {
		expect(holidays(2026, { country: "CH" })).toEqual([
			{ date: "2026-01-01", key: "new_year" },
			{ date: "2026-08-01", key: "national_day" },
			{ date: "2026-12-25", key: "christmas" },
		]);
	});

	it("matches the legacy calendar for every canton over 2000-2040", () => {
		expect([...SWISS_CANTONS].sort()).toEqual(Object.keys(FIXED).sort());
		for (const region of SWISS_CANTONS) {
			for (let year = 2000; year <= 2040; year++) {
				expect(
					datesOf(holidays(year, { country: "CH", region })),
					`${region} ${year}`,
				).toEqual(oracle(year, region));
			}
		}
	});

	it("gives Neuchâtel 2 January and 26 December only after a Sunday", () => {
		// 1 January 2023 and 25 December 2022 are Sundays; 2026's are not.
		const ne = (year: number) =>
			datesOf(holidays(year, { country: "CH", region: "NE" }));
		expect(ne(2023)).toContain("2023-01-02");
		expect(ne(2022)).toContain("2022-12-26");
		expect(ne(2026)).not.toContain("2026-01-02");
		expect(ne(2026)).not.toContain("2026-12-26");
	});

	it("computes the Näfelser Fahrt on the year asked, out of Holy Week", () => {
		const fahrt = (year: number) =>
			holidays(year, { country: "CH", region: "GL" }).find(
				(h) => h.key === "naefelser_fahrt",
			)?.date;
		expect(fahrt(2027)).toBe("2027-04-01");
		// The first Thursday of April 2023 is Maundy Thursday: one week later.
		expect(fahrt(2023)).toBe("2023-04-13");
		expect(fahrt(2026)).toBe("2026-04-09");
		expect(fahrt(2030)).toBe("2030-04-04");
	});

	it("dates the Federal Fast Monday and the Geneva Fast", () => {
		const keyed = (region: SwissCanton, key: string) =>
			holidays(2026, { country: "CH", region }).find((h) => h.key === key)
				?.date;
		expect(keyed("VD", "federal_fast_monday")).toBe("2026-09-21");
		expect(keyed("NE", "federal_fast_monday")).toBe("2026-09-21");
		expect(keyed("GE", "geneva_fast")).toBe("2026-09-10");
		expect(keyed("TI", "corpus_christi")).toBe("2026-06-04");
		expect(keyed("ZH", "good_friday")).toBe("2026-04-03");
	});

	it("refuses an unknown country or region instead of answering none", () => {
		// Typed, but read from a request body or a settings row at runtime.
		const fromJson = (text: string): HolidayOptions => JSON.parse(text);
		expect(() => holidays(2026, fromJson('{"country":"DE"}'))).toThrow(
			expect.objectContaining({ code: "E_CHRONOS_UNKNOWN_COUNTRY" }),
		);
		expect(() =>
			holidays(2026, fromJson('{"country":"CH","region":"vd"}')),
		).toThrow(expect.objectContaining({ code: "E_CHRONOS_UNKNOWN_REGION" }));
		expect(() =>
			holidays(2026, fromJson('{"country":"FR","region":"IDF"}')),
		).toThrow(expect.objectContaining({ code: "E_CHRONOS_UNKNOWN_REGION" }));
	});
});

describe("chronos > isHoliday", () => {
	it("reads a calendar date", () => {
		expect(isHoliday("2026-09-21", { country: "CH", region: "VD" })).toBe(true);
		expect(isHoliday("2026-09-21", { country: "CH", region: "GE" })).toBe(
			false,
		);
		expect(isHoliday("2026-07-14", { country: "FR" })).toBe(true);
	});

	it("reads a DateTime on its own wall clock", () => {
		// 23:30 UTC on 31 July is already 1 August in Zurich.
		const zurich = DateTime.fromISO("2026-07-31T23:30:00Z").setZone(
			"Europe/Zurich",
		);
		expect(isHoliday(zurich, { country: "CH" })).toBe(true);
		expect(
			isHoliday(DateTime.fromISO("2026-07-31T23:30:00Z"), { country: "CH" }),
		).toBe(false);
	});

	it("refuses a text that is not a calendar date", () => {
		expect(() => isHoliday("2026-02-30", { country: "FR" })).toThrow(
			expect.objectContaining({ code: "E_CHRONOS_INVALID_DATE" }),
		);
		expect(() => isHoliday("2026-07-14T10:00:00Z", { country: "FR" })).toThrow(
			expect.objectContaining({ code: "E_CHRONOS_INVALID_DATE" }),
		);
	});
});
