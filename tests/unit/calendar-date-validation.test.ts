/**
 * A calendar date that does not exist is refused, not slid to the next one.
 *
 * `new Date('2026-02-30')` answers March 2nd. Those overflow semantics are
 * right for arithmetic — adding a month to January 31st has to land somewhere
 * — and wrong for reading input, where the same slide turns a typo into a
 * fact stored in a database.
 */
import { describe, expect, it } from "vitest";
import { DateTime, Interval, overlapsRange } from "../../src/index.js";

describe("chronos > a date that does not exist is refused, not slid forward", () => {
	// `new Date('2026-02-30')` answers March 2nd. Overflow is right for
	// arithmetic and wrong for reading input, and the inconsistency was the
	// dangerous half: '2026-13-45' threw while '2026-02-30' came back as a
	// date, so a try/catch around this covered the loud case and let the one
	// that writes something false through.
	it.each([
		["2026-02-30", "February 2026 has 28 days"],
		["2026-02-29", "February 2026 has 28 days"],
		["2026-04-31", "April 2026 has 30 days"],
		["2026-06-31", "June 2026 has 30 days"],
		["2026-01-32", "January 2026 has 31 days"],
	])("refuses %s, naming the month's real length", (input, reason) => {
		expect(() => DateTime.from(input)).toThrow(reason);
	});

	it("refuses a month that does not exist, in the same words", () => {
		expect(() => DateTime.from("2026-13-01")).toThrow(/there is no month 13/);
	});

	it("keeps a real leap day", () => {
		expect(DateTime.from("2024-02-29").toISO()).toBe(
			"2024-02-29T00:00:00.000Z",
		);
	});

	it("keeps an offset that legitimately moves the UTC day", () => {
		// The written date is the 10th, the instant lands on the 11th. Only the
		// written date is checked, so this is untouched.
		expect(DateTime.from("2026-08-10T23:00:00-05:00").toISO()).toBe(
			"2026-08-11T04:00:00.000Z",
		);
	});

	it("still slides on arithmetic, where the slide is the point", () => {
		// Adding a month to the 31st has to land somewhere; chronos clamps to
		// the month's last day, as Luxon does.
		expect(DateTime.from("2026-01-31").plus(1, "month").toISO()).toBe(
			"2026-02-28T00:00:00.000Z",
		);
	});

	it("refuses through the constructor too, not only through from()", () => {
		expect(() => new DateTime("2026-02-30")).toThrow(/no day 30/);
	});
});

describe("chronos > Interval units are named, not guessed", () => {
	const june = Interval.fromDateTimes(
		DateTime.from("2026-06-01"),
		DateTime.from("2026-07-01"),
	);

	it("accepts the plural spelling durations use", () => {
		expect(june.length("days")).toBe(30);
	});

	it("accepts the singular spelling DateTime uses", () => {
		// The table was keyed plural and fell back to 1 for anything else, so
		// this answered 2592000000 — milliseconds, presented as days.
		expect(june.length("day")).toBe(30);
	});

	// TypeScript already refuses an unknown unit at the call site, so these go
	// through `Reflect.apply` — the way a JavaScript consumer reaches the same
	// method, and the only way the runtime guard can be exercised at all.
	it("refuses a unit it does not know instead of measuring milliseconds", () => {
		expect(() => Reflect.apply(june.length, june, ["fortnight"])).toThrow(
			/'fortnight' is not a unit/,
		);
	});

	it("refuses an unknown unit in splitBy, which a silent 1ms step would explode", () => {
		// A one-millisecond step over this interval is 2.6 billion sub-intervals.
		expect(() =>
			Reflect.apply(june.splitBy, june, [{ amount: 1, unit: "fortnight" }]),
		).toThrow(/is not a unit/);
	});

	it("splits on a real unit", () => {
		expect(june.splitBy({ amount: 1, unit: "week" })).toHaveLength(5);
	});
});

describe("chronos > two ranges that only touch", () => {
	const first = { start: "2026-01-01", end: "2026-01-10" };
	const second = { start: "2026-01-10", end: "2026-01-20" };

	it("overlap when both bounds are closed — the instant is in both", () => {
		expect(overlapsRange(first, second)).toBe(true);
	});

	it("do not overlap when the end is open", () => {
		// The shared instant is the second range's start and the first's end.
		// With the end open it belongs to the second alone, so there is no
		// instant in both — `||` called these overlapping anyway.
		expect(overlapsRange(first, second, { inclusiveEnd: false })).toBe(false);
	});

	it("do not overlap when the start is open", () => {
		expect(overlapsRange(first, second, { inclusiveStart: false })).toBe(false);
	});

	it("do not overlap when neither bound is closed", () => {
		expect(
			overlapsRange(first, second, {
				inclusiveStart: false,
				inclusiveEnd: false,
			}),
		).toBe(false);
	});

	it("still overlap when they genuinely share a span", () => {
		// The change must not turn a real overlap into a miss.
		expect(
			overlapsRange(
				first,
				{ start: "2026-01-05", end: "2026-01-15" },
				{ inclusiveStart: false, inclusiveEnd: false },
			),
		).toBe(true);
	});
});
