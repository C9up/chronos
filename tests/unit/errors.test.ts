/**
 * Every refusal chronos raises carries an `E_CHRONOS_` code, and is one of
 * the classes the entry exports as `errors`.
 */
import { Exception } from "@c9up/flare";
import { describe, expect, it } from "vitest";
import { dateTimeAtlasAdapter } from "../../src/atlas.js";
import {
	DateTime,
	Duration,
	easterDate,
	errors,
	expandRRule,
	holidays,
	Interval,
	inRange,
	isHoliday,
	toRRuleString,
} from "../../src/index.js";

const code = (value: string) => expect.objectContaining({ code: value });
const base = DateTime.from("2026-08-10T12:00:00Z");

describe("chronos > errors", () => {
	it("exports one flare Exception class per code as `errors`", () => {
		const error = new errors.E_CHRONOS_INVALID_LOCALE(["xx-!"]);
		expect(error).toBeInstanceOf(Exception);
		expect(error).toMatchObject({
			code: "E_CHRONOS_INVALID_LOCALE",
			status: 500,
			message: "Invalid locale: xx-!",
		});
		expect(() => base.setLocale("not a locale!")).toThrow(
			errors.E_CHRONOS_INVALID_LOCALE,
		);
	});

	it("reads the engine's coded refusals back into chronos errors", () => {
		const failure = (run: () => unknown): unknown => {
			try {
				run();
			} catch (error) {
				return error;
			}
			return undefined;
		};
		const year = failure(() => easterDate(1500));
		expect(year).toBeInstanceOf(errors.E_CHRONOS_INVALID_YEAR);
		const country = failure(() =>
			holidays(2026, JSON.parse('{"country":"DE"}')),
		);
		expect(country).toBeInstanceOf(errors.E_CHRONOS_UNKNOWN_COUNTRY);
		expect(country).toMatchObject({
			message: "country 'DE' has no holiday calendar; known: CH, FR",
			cause: expect.objectContaining({
				message: expect.stringMatching(/^E_CHRONOS_UNKNOWN_COUNTRY: /),
			}),
		});
		expect(
			failure(() =>
				holidays(2026, JSON.parse('{"country":"CH","region":"vd"}')),
			),
		).toBeInstanceOf(errors.E_CHRONOS_UNKNOWN_REGION);
		expect(
			failure(() => isHoliday("2026-02-30", { country: "FR" })),
		).toBeInstanceOf(errors.E_CHRONOS_INVALID_DATE);
	});

	it("gives a code to the engine's refusals that come without one", () => {
		expect(() => new DateTime("2026-01-01T00:00:00Z", "Mars/Olympus")).toThrow(
			code("E_CHRONOS_UNKNOWN_ZONE"),
		);
		expect(() => base.setZone("Mars/Olympus")).toThrow(
			code("E_CHRONOS_UNKNOWN_ZONE"),
		);
		expect(() =>
			expandRRule(base, "FREQ=DAILY;COUNT=1", { tzid: "Mars/Olympus" }),
		).toThrow(code("E_CHRONOS_UNKNOWN_ZONE"));
		expect(() => expandRRule(base, "FREQ=DAILY;FOO=BAR")).toThrow(
			code("E_CHRONOS_UNREADABLE_RRULE"),
		);
		expect(() => expandRRule("RRULE:FREQ=DAILY;COUNT=1")).toThrow(
			code("E_CHRONOS_UNREADABLE_RRULE"),
		);
		expect(() => base.plus(1e18, "month")).toThrow(
			code("E_CHRONOS_OUT_OF_RANGE"),
		);
		expect(() => DateTime.fromSQL("2026-02-30")).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() => DateTime.fromHTTP("Sunday Nov  6 08:49:37 1994")).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() =>
			DateTime.fromRFC2822("Wed, 1 Jul 2003 10:52:37 +0200"),
		).toThrow(code("E_CHRONOS_INVALID_DATE"));
	});

	it("E_CHRONOS_INVALID_COLUMN_VALUE: the atlas adapter got a value it cannot store or read", () => {
		expect(() => dateTimeAtlasAdapter.consume(true)).toThrow(
			code("E_CHRONOS_INVALID_COLUMN_VALUE"),
		);
		expect(() => dateTimeAtlasAdapter.prepare(42)).toThrow(
			code("E_CHRONOS_INVALID_COLUMN_VALUE"),
		);
	});

	it("E_CHRONOS_INVALID_RRULE: a structured rule with a bad field", () => {
		expect(() =>
			Reflect.apply(toRRuleString, undefined, [{ freq: "HOURLYISH" }]),
		).toThrow(code("E_CHRONOS_INVALID_RRULE"));
		expect(() =>
			Reflect.apply(toRRuleString, undefined, [
				{ freq: "DAILY", until: "March 7" },
			]),
		).toThrow(code("E_CHRONOS_INVALID_RRULE"));
	});

	it("E_CHRONOS_INVALID_RRULE_LIMIT and E_CHRONOS_RRULE_LIMIT_EXCEEDED", () => {
		expect(() => expandRRule(base, "FREQ=DAILY", 0)).toThrow(
			code("E_CHRONOS_INVALID_RRULE_LIMIT"),
		);
		expect(() => expandRRule(base, "FREQ=DAILY", 1.5)).toThrow(
			code("E_CHRONOS_INVALID_RRULE_LIMIT"),
		);
		expect(() => expandRRule(base, "FREQ=DAILY", 10_001)).toThrow(
			code("E_CHRONOS_RRULE_LIMIT_EXCEEDED"),
		);
	});

	it("E_CHRONOS_INVALID_ARGUMENT: an argument of the wrong type", () => {
		expect(() => Reflect.apply(expandRRule, undefined, [42])).toThrow(
			code("E_CHRONOS_INVALID_ARGUMENT"),
		);
		expect(() => Reflect.apply(DateTime.fromMillis, DateTime, ["12"])).toThrow(
			code("E_CHRONOS_INVALID_ARGUMENT"),
		);
		expect(() => Reflect.apply(DateTime.fromSeconds, DateTime, [null])).toThrow(
			code("E_CHRONOS_INVALID_ARGUMENT"),
		);
		expect(() =>
			Reflect.apply(DateTime.fromFormat, DateTime, [1, "yyyy"]),
		).toThrow(code("E_CHRONOS_INVALID_ARGUMENT"));
		expect(() => Reflect.apply(DateTime.from, DateTime, [true])).toThrow(
			code("E_CHRONOS_INVALID_ARGUMENT"),
		);
		expect(() =>
			Reflect.apply(base.toRelative, base, [
				{ base: base.plus(3, "day"), rounding: "sideways" },
			]),
		).toThrow(code("E_CHRONOS_INVALID_ARGUMENT"));
	});

	it("E_CHRONOS_UNSUPPORTED_UNIT: a unit chronos does not know", () => {
		const june = Interval.fromDateTimes(
			"2026-06-01T00:00:00Z",
			"2026-07-01T00:00:00Z",
		);
		expect(() => Reflect.apply(june.length, june, ["fortnight"])).toThrow(
			code("E_CHRONOS_UNSUPPORTED_UNIT"),
		);
		expect(() =>
			Reflect.apply(Duration.fromObject, Duration, [{ fortnights: 1 }]),
		).toThrow(code("E_CHRONOS_UNSUPPORTED_UNIT"));
		expect(() => Reflect.apply(base.plus, base, [1, "fortnight"])).toThrow(
			code("E_CHRONOS_UNSUPPORTED_UNIT"),
		);
		expect(() => Reflect.apply(base.diff, base, [base, "fortnight"])).toThrow(
			code("E_CHRONOS_UNSUPPORTED_UNIT"),
		);
		expect(() =>
			Reflect.apply(base.toRelative, base, [{ unit: "fortnight" }]),
		).toThrow(code("E_CHRONOS_UNSUPPORTED_UNIT"));
	});

	it("E_CHRONOS_MISSING_UNIT: a call that needs a unit got none", () => {
		expect(() => Reflect.apply(base.plus, base, [1])).toThrow(
			code("E_CHRONOS_MISSING_UNIT"),
		);
		expect(() => Reflect.apply(base.minus, base, [1])).toThrow(
			code("E_CHRONOS_MISSING_UNIT"),
		);
		expect(() => base.diff(base, [])).toThrow(code("E_CHRONOS_MISSING_UNIT"));
		expect(() => base.toRelative({ unit: [] })).toThrow(
			code("E_CHRONOS_MISSING_UNIT"),
		);
	});

	it("E_CHRONOS_INVALID_UNIT_VALUE: a unit amount that is not a finite number", () => {
		expect(() => Duration.fromMillis(Number.NaN)).toThrow(
			code("E_CHRONOS_INVALID_UNIT_VALUE"),
		);
		expect(() => base.plus(Number.NaN, "day")).toThrow(
			code("E_CHRONOS_INVALID_UNIT_VALUE"),
		);
		expect(() => Reflect.apply(base.minus, base, ["1", "day"])).toThrow(
			code("E_CHRONOS_INVALID_UNIT_VALUE"),
		);
	});

	it("E_CHRONOS_INVALID_DURATION: a duration that cannot be read or used", () => {
		expect(() => Duration.fromISO("P")).toThrow(
			code("E_CHRONOS_INVALID_DURATION"),
		);
		expect(() => Duration.fromISO("P1DT")).toThrow(
			code("E_CHRONOS_INVALID_DURATION"),
		);
		expect(() => Reflect.apply(Duration.fromObject, Duration, [5])).toThrow(
			code("E_CHRONOS_INVALID_DURATION"),
		);
		const iv = Interval.fromDateTimes(
			"2026-01-01T00:00:00Z",
			"2026-01-05T00:00:00Z",
		);
		expect(() => iv.splitBy({ amount: 0, unit: "day" })).toThrow(
			code("E_CHRONOS_INVALID_DURATION"),
		);
	});

	it("E_CHRONOS_INVALID_INTERVAL: an interval that ends before it starts or does not parse", () => {
		expect(() =>
			Interval.fromDateTimes("2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"),
		).toThrow(code("E_CHRONOS_INVALID_INTERVAL"));
		expect(() => Interval.fromISO("nope/nope")).toThrow(
			code("E_CHRONOS_INVALID_INTERVAL"),
		);
	});

	it("E_CHRONOS_INVALID_RANGE: a range whose start is after its end", () => {
		expect(() =>
			inRange(base, { start: "2026-09-01", end: "2026-08-01" }),
		).toThrow(code("E_CHRONOS_INVALID_RANGE"));
	});

	it("E_CHRONOS_INVALID_DATE: a date that does not exist or does not parse", () => {
		expect(() => new DateTime("2026-02-30")).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() => new DateTime("2026-02-30")).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() => new DateTime("not-a-date")).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() => DateTime.fromJSDate(new Date("not-a-date"))).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() => DateTime.fromSeconds(Number.NaN)).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() => DateTime.fromFormat("2026-08-10 x", "yyyy-MM-dd")).toThrow(
			code("E_CHRONOS_INVALID_DATE"),
		);
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 1, day: 1, hour: 24 }),
		).toThrow(code("E_CHRONOS_INVALID_DATE"));
	});

	it("E_CHRONOS_OUT_OF_RANGE: a value outside years 0000-9999", () => {
		expect(() => base.plus(1e18, "month")).toThrow(
			code("E_CHRONOS_OUT_OF_RANGE"),
		);
		expect(() => DateTime.fromMillis(-1e14)).toThrow(
			code("E_CHRONOS_OUT_OF_RANGE"),
		);
	});

	it("E_CHRONOS_CONFLICTING_FIELDS: a format whose fields contradict each other", () => {
		expect(() => DateTime.fromFormat("1 PM 13", "h a H")).toThrow(
			code("E_CHRONOS_CONFLICTING_FIELDS"),
		);
		expect(() =>
			DateTime.fromFormat("2026-W33 2026-08-10", "kkkk-'W'WW yyyy-MM-dd"),
		).toThrow(code("E_CHRONOS_CONFLICTING_FIELDS"));
		expect(() =>
			DateTime.fromFormat("2026-222 08-10", "yyyy-ooo MM-dd"),
		).toThrow(code("E_CHRONOS_CONFLICTING_FIELDS"));
	});

	it("E_CHRONOS_INVALID_LOCALE: a locale tag Intl does not accept", () => {
		expect(() => base.setLocale("not a locale!")).toThrow(
			code("E_CHRONOS_INVALID_LOCALE"),
		);
		expect(() => base.setLocale("not a locale!")).toThrow(
			code("E_CHRONOS_INVALID_LOCALE"),
		);
	});
});
