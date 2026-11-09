import { describe, expect, it } from "vitest";
import { Duration } from "../../src/index.js";

/** Call with input the static types would refuse, as a parsed JSON body may carry. */
function fromUntyped(obj: unknown): Duration {
	return Reflect.apply(Duration.fromObject, Duration, [obj]);
}

describe("Duration validates its input like Luxon", () => {
	it.each([
		{ hours: Number.NaN },
		{ hours: Number.POSITIVE_INFINITY },
		{ minutes: Number.NEGATIVE_INFINITY },
		{ hours: "two" },
		{ hours: "" },
		{ hours: true },
	])("refuses %j", (obj) => {
		expect(() => fromUntyped(obj)).toThrow(/Invalid unit value/);
	});

	it("refuses an unknown unit and reads singular names", () => {
		expect(() => fromUntyped({ fortnights: 1 })).toThrow(
			/Invalid duration unit/,
		);
		expect(fromUntyped({ hour: 2, minute: 5 }).toISO()).toBe("PT2H5M");
	});

	it("coerces a numeric string instead of concatenating it", () => {
		expect(fromUntyped({ hours: "2" }).plus({ hours: 1 }).hours).toBe(3);
		expect(
			Duration.fromObject({ hours: 1 }).plus(fromUntyped({ hours: "2" })).hours,
		).toBe(3);
	});

	it("validates what plus/minus and fromMillis are given", () => {
		const d = Duration.fromObject({ hours: 1 });
		expect(() => d.plus({ hours: Number.NaN })).toThrow(/Invalid unit value/);
		expect(() => d.minus({ minutes: Number.POSITIVE_INFINITY })).toThrow(
			/Invalid unit value/,
		);
		expect(() => Duration.fromMillis(Number.NaN)).toThrow(/Invalid unit value/);
		expect(d.plus(1800000).toISO()).toBe("PT1H1800S");
	});
});

describe("Duration.fromISO follows Luxon's grammar", () => {
	it.each([
		["P1.5D", { days: 1.5 }],
		["PT-5M", { minutes: -5 }],
		["P1W2D", { weeks: 1, days: 2 }],
		["-P1DT2H", { days: -1, hours: -2 }],
		["PT1.25S", { seconds: 1, milliseconds: 250 }],
		["PT1,5S", { seconds: 1, milliseconds: 500 }],
		["P2Y-3M", { years: 2, months: -3 }],
	])("%s", (iso, expected) => {
		expect(Duration.fromISO(iso).toObject()).toEqual(
			expect.objectContaining(expected),
		);
	});

	it.each([
		"PT1.2.3S",
		`PT${"9".repeat(400)}S`,
		"P",
		"PT",
		"1D",
		"P1DT",
		"P1S",
	])("refuses %s", (iso) => {
		expect(() => Duration.fromISO(iso)).toThrow(/Invalid ISO 8601 duration/);
	});
});

describe("Duration conversions use the casual matrix", () => {
	it("counts a year as 365 days and a month as 30", () => {
		expect(Duration.fromObject({ years: 1 }).as("days")).toBe(365);
		expect(Duration.fromObject({ months: 1 }).as("days")).toBe(30);
		expect(Duration.fromObject({ days: 365 }).shiftTo("years").years).toBe(1);
	});
});

describe("Duration.normalize rebalances mixed signs", () => {
	it("folds a positive lower unit into a negative higher one", () => {
		const d = Duration.fromObject({ hours: -1, minutes: 30 }).normalize();
		expect(d.hours === 0 && d.minutes === -30).toBe(true);
		expect(Duration.fromObject({ hours: -1, minutes: 30 }).toHuman()).toBe(
			"-30 minutes",
		);
	});

	it("borrows from a higher unit for a negative lower one", () => {
		const d = Duration.fromObject({ hours: 2, minutes: -30 }).normalize();
		expect([d.hours, d.minutes]).toEqual([1, 30]);
	});

	it("pushes fractions down", () => {
		const d = Duration.fromObject({ hours: 1.5 }).normalize();
		expect([d.hours, d.minutes]).toEqual([1, 30]);
	});
});
