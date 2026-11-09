import { describe, expect, it } from "vitest";
import { DateTime, Duration, Interval } from "../../src/index.js";

/**
 * What Luxon 3.7.2 returns for the same calls (DateTime in UTC and in
 * Europe/Paris, default locale en-US), recorded from its tarball.
 */
const LUXON = {
	toFormat: [
		[
			"yyyy-MM-dd HH:mm:ss.SSS",
			"2026-08-10 07:05:09.042",
			"2026-08-10 09:05:09.042",
		],
		["dd/MM/yyyy", "10/08/2026", "10/08/2026"],
		[
			"dd LLL yyyy 'at' h:mm a",
			"10 Aug 2026 at 7:05 AM",
			"10 Aug 2026 at 9:05 AM",
		],
		["EEEE, MMMM d", "Monday, August 10", "Monday, August 10"],
		["EEE ccc LLLL MMM", "Mon Mon August Aug", "Mon Mon August Aug"],
		["ZZ ZZZ Z z", "+00:00 +0000 +0 UTC", "+02:00 +0200 +2 Europe/Paris"],
		["kkkk-'W'WW-c", "2026-W33-1", "2026-W33-1"],
		["o ooo q qq", "222 222 3 03", "222 222 3 03"],
		["X x", "1786345509 1786345509042", "1786345509 1786345509042"],
		["yy y", "26 2026", "26 2026"],
		["'It''s' HH'h'", "Its 07h", "Its 09h"],
		["D", "8/10/2026", "8/10/2026"],
		["DD", "Aug 10, 2026", "Aug 10, 2026"],
		["DDD", "August 10, 2026", "August 10, 2026"],
		["t", "7:05\u202fAM", "9:05 AM"],
		["T", "07:05", "09:05"],
		["f", "8/10/2026, 7:05\u202fAM", "8/10/2026, 9:05 AM"],
		["ff", "Aug 10, 2026, 7:05\u202fAM", "Aug 10, 2026, 9:05 AM"],
		["G GG", "AD Anno Domini", "AD Anno Domini"],
		["S u uu uuu", "42 042 04 0", "42 042 04 0"],
	],
	iso: [
		"2026-08-10T07:05:09.042Z",
		"2026-08-10T09:05:09.042+02:00",
		"2026-08-10T09:05:09.042+02:00",
		"2026-08-10",
		"09:05:09.042+02:00",
		"07:05:09.042Z",
		"2026-08-10 09:05:09.042 +02:00",
		"2026-08-10 07:05:09.042 Z",
		"2026-08-10",
		"09:05:09.042 +02:00",
		"2026-08-10 09:05:09.042",
	],
	set: [
		"2026-01-31T09:00:00.000+01:00",
		"2026-02-28T11:00:00.000+01:00",
		"2028-02-29T11:30:00.000+01:00",
	],
	keepLocal: ["2026-08-10T09:05:09.042-04:00", "2026-08-10T03:05:09.042-04:00"],
	diff: [
		[
			["months", "days"],
			{ months: 1, days: 29.271070601851854 },
			{ months: -1, days: -29.271070601851854 },
		],
		[
			["days", "hours"],
			{ days: 57, hours: 6.505694444444444 },
			{ days: -57, hours: -6.505694444444444 },
		],
		[
			["hours", "minutes"],
			{ hours: 1373, minutes: 30.341666666659876 },
			{ hours: -1373, minutes: -30.341666666659876 },
		],
		[
			["years", "months", "days", "hours"],
			{ years: 0, months: 1, days: 29, hours: 6.505694444444444 },
			{ years: 0, months: -1, days: -29, hours: -6.505694444444444 },
		],
		[
			["weeks", "days", "seconds"],
			{ weeks: 8, days: 1, seconds: 23420.5 },
			{ weeks: -8, days: -1, seconds: -23420.5 },
		],
		[
			["minutes"],
			{ minutes: 82410.34166666666 },
			{ minutes: -82410.34166666666 },
		],
		[
			["milliseconds"],
			{ milliseconds: 4944620500 },
			{ milliseconds: -4944620500 },
		],
		[
			["months", "days", "hours", "minutes", "seconds", "milliseconds"],
			{
				months: 1,
				days: 29,
				hours: 6,
				minutes: 30,
				seconds: 20,
				milliseconds: 500,
			},
			{
				months: -1,
				days: -29,
				hours: -6,
				minutes: -30,
				seconds: -20,
				milliseconds: -500,
			},
		],
	],
	valueOf: [4944620500, true],
	count: [3, 48, 1, 1],
	fromISO: [
		["2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
		["2026-01-31T00:00:00.000Z", "2026-02-28T00:00:00.000Z"],
		["2026-02-28T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
	],
	before: ["2026-02-28T00:00:00.000Z", "2026-03-31T00:00:00.000Z"],
	xor: [
		["2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
		["2026-01-10T00:00:00.000Z", "2026-01-15T00:00:00.000Z"],
		["2026-01-20T00:00:00.000Z", "2026-01-25T00:00:00.000Z"],
	],
	difference: [
		["2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
		["2026-01-10T00:00:00.000Z", "2026-01-20T00:00:00.000Z"],
	],
	dur: [
		{ days: 1, hours: 1, minutes: 1, seconds: 1, milliseconds: 1 },
		3630000,
		{
			years: 1,
			months: 2,
			weeks: 1,
			days: 1,
			hours: 0,
			minutes: 0,
			seconds: 0,
			milliseconds: 0,
		},
	],
};

describe("the Luxon surface an Adonis app relies on", () => {
	it("answers like Luxon", () => {
		const utc = new DateTime("2026-08-10T07:05:09.042Z");
		const paris = new DateTime("2026-08-10T07:05:09.042Z", "Europe/Paris");
		const fmts = [
			"yyyy-MM-dd HH:mm:ss.SSS",
			"dd/MM/yyyy",
			"dd LLL yyyy 'at' h:mm a",
			"EEEE, MMMM d",
			"EEE ccc LLLL MMM",
			"ZZ ZZZ Z z",
			"kkkk-'W'WW-c",
			"o ooo q qq",
			"X x",
			"yy y",
			"'It''s' HH'h'",
			"D",
			"DD",
			"DDD",
			"t",
			"T",
			"f",
			"ff",
			"G GG",
			"S u uu uuu",
		];
		expect(fmts.map((f) => [f, utc.toFormat(f), paris.toFormat(f)])).toEqual(
			LUXON.toFormat,
		);
		expect([
			utc.toISO(),
			paris.toISO(),
			paris.toISO({ suppressMilliseconds: true }),
			paris.toISODate(),
			paris.toISOTime(),
			utc.toISOTime(),
			paris.toSQL(),
			utc.toSQL(),
			paris.toSQLDate(),
			paris.toSQLTime(),
			paris.toSQL({ includeOffset: false }),
		]).toEqual(LUXON.iso);
		const jan31 = new DateTime("2026-01-31T10:00:00Z", "Europe/Paris");
		expect([
			jan31.set({ hour: 9 }).toISO(),
			jan31.set({ month: 2 }).toISO(),
			jan31.set({ year: 2028, month: 2, day: 29, minute: 30 }).toISO(),
		]).toEqual(LUXON.set);
		expect([
			paris.setZone("America/New_York", { keepLocalTime: true }).toISO(),
			paris.setZone("America/New_York").toISO(),
		]).toEqual(LUXON.keepLocal);
		const a = new DateTime("2026-01-31T10:00:00Z", "Europe/Paris");
		const b = new DateTime("2026-03-29T15:30:20.500Z", "Europe/Paris");
		const sets = [
			["months", "days"],
			["days", "hours"],
			["hours", "minutes"],
			["years", "months", "days", "hours"],
			["weeks", "days", "seconds"],
			["minutes"],
			["milliseconds"],
			["months", "days", "hours", "minutes", "seconds", "milliseconds"],
		] as const;
		const pick = (d: Duration, units: readonly string[]) =>
			Object.fromEntries(units.map((u) => [u, Reflect.get(d.toObject(), u)]));
		expect(
			sets.map((u) => [u, pick(b.diff(a, u), u), pick(a.diff(b, u), u)]),
		).toEqual(LUXON.diff);
		expect([Number(b) - Number(a), a < b]).toEqual(LUXON.valueOf);
		const iv = Interval.fromDateTimes(
			"2026-01-01T12:00:00Z",
			"2026-01-03T12:00:00Z",
		);
		expect([
			iv.count("day"),
			iv.count("hour"),
			iv.count("month"),
			iv.count("week"),
		]).toEqual(LUXON.count);
		const toJ = (i: Interval) => [
			i.start.toUTC().toISO(),
			i.end.toUTC().toISO(),
		];
		expect(
			[
				"2026-01-01T00:00:00Z/2026-01-05T00:00:00Z",
				"2026-01-31T00:00:00Z/P1M",
				"P1D/2026-03-01T00:00:00Z",
			].map((t) => toJ(Interval.fromISO(t))),
		).toEqual(LUXON.fromISO);
		expect(
			toJ(
				Interval.before(
					"2026-03-31T00:00:00Z",
					Duration.fromObject({ months: 1 }),
				),
			),
		).toEqual(LUXON.before);
		const I = (s: string, e: string) => Interval.fromDateTimes(s, e);
		expect(
			Interval.xor([
				I("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z"),
				I("2026-01-05T00:00:00Z", "2026-01-15T00:00:00Z"),
				I("2026-01-20T00:00:00Z", "2026-01-25T00:00:00Z"),
			]).map(toJ),
		).toEqual(LUXON.xor);
		expect(
			I("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z")
				.difference(
					I("2026-01-05T00:00:00Z", "2026-01-10T00:00:00Z"),
					I("2026-01-20T00:00:00Z", "2026-02-10T00:00:00Z"),
				)
				.map(toJ),
		).toEqual(LUXON.difference);
		const nz = (o: Record<string, number>) =>
			Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));
		expect([
			nz(Duration.fromObject({ milliseconds: 90061001 }).rescale().toObject()),
			Duration.fromObject({ hours: 1, seconds: 30 }).toMillis(),
			Duration.fromObject({ days: 400 }).shiftToAll().toObject(),
		]).toEqual(LUXON.dur);
	});
});

describe("Luxon semantics chronos now shares", () => {
	const t = "2026-08-10T07:05:09.042Z";

	it("compares and subtracts as numbers through valueOf", () => {
		const a = DateTime.from(t);
		const b = a.plus(1, "day");
		expect(Number(b) - Number(a)).toBe(86_400_000);
		expect(a < b).toBe(true);
	});

	it("equals checks zone and locale against another DateTime, the instant otherwise", () => {
		const utc = DateTime.from(t);
		const paris = new DateTime(t, "Europe/Paris");
		expect(paris.equals(utc)).toBe(false);
		expect(paris.equals(paris.setZone("Europe/Paris"))).toBe(true);
		expect(utc.equals(utc.setLocale("fr"))).toBe(false);
		expect(paris.equals(t)).toBe(true);
		expect(paris.toMillis()).toBe(utc.toMillis());
	});

	it("reads its own zoned toISO back to the same instant", () => {
		const paris = new DateTime(t, "Europe/Paris");
		expect(paris.toISO()).toBe("2026-08-10T09:05:09.042+02:00");
		expect(DateTime.from(paris.toISO()).toMillis()).toBe(paris.toMillis());
		expect(JSON.stringify({ at: paris })).toBe(
			'{"at":"2026-08-10T09:05:09.042+02:00"}',
		);
	});

	it("writes names in the value's locale", () => {
		const fr = new DateTime(t, "Europe/Paris").setLocale("fr");
		expect(fr.locale).toBe("fr");
		expect(fr.toFormat("EEEE d MMMM yyyy")).toBe("lundi 10 août 2026");
		expect(fr.plus(1, "day").toFormat("cccc")).toBe("mardi");
		expect(() => DateTime.from(t).setLocale("not a locale!")).toThrow(
			RangeError,
		);
	});

	it("checks set() fields and keeps the month's last day", () => {
		const jan31 = DateTime.from("2026-01-31T10:00:00Z");
		expect(jan31.set({ month: 2 }).toISO()).toBe("2026-02-28T10:00:00.000Z");
		expect(() => jan31.set({ hour: 24 })).toThrow(/out of range/);
		expect(() => jan31.set({ month: 2, day: 30 })).toThrow(/no day 30/);
	});

	it("builds UTC values with DateTime.utc and is always valid", () => {
		expect(DateTime.utc(2026, 8, 10, 9).toISO()).toBe(
			"2026-08-10T09:00:00.000Z",
		);
		expect(DateTime.utc().isValid).toBe(true);
	});

	it("measures hasSame on the value's own calendar", () => {
		const paris = new DateTime("2026-08-10T22:30:00Z", "Europe/Paris");
		// 00:30 on the 11th in Paris; 23:59 UTC on the 10th is 01:59 on the 11th.
		expect(paris.hasSame("2026-08-10T23:59:00Z", "day")).toBe(true);
		expect(paris.hasSame("2026-08-10T21:00:00Z", "day")).toBe(false);
	});

	it("reads an Interval count, ISO form and difference like Luxon", () => {
		const iv = Interval.fromISO("2026-01-01T12:00:00Z/P2D");
		expect(iv.count("day")).toBe(3);
		expect(() => Interval.fromISO("nope/nope")).toThrow(
			/Invalid ISO 8601 interval/,
		);
	});
});

describe("the atlas adapter stores one canonical instant", () => {
	it("prepares a zoned DateTime in its UTC form", async () => {
		const { dateTimeAtlasAdapter } = await import("../../src/atlas.js");
		const paris = new DateTime("2026-08-10T07:05:09.042Z", "Europe/Paris");
		expect(dateTimeAtlasAdapter.prepare(paris)).toBe(
			"2026-08-10T07:05:09.042Z",
		);
	});
});
