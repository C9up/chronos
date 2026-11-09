import { describe, expect, it } from "vitest";
import { DateTime, Duration, Interval } from "../../src/index.js";

describe("Interval.after adds a Duration on the calendar", () => {
	it.each([
		["2026-01-31T00:00:00Z", { months: 1 }, "2026-02-28T00:00:00.000Z"],
		["2024-02-29T00:00:00Z", { years: 1 }, "2025-02-28T00:00:00.000Z"],
		["2026-01-01T00:00:00Z", { years: 1 }, "2027-01-01T00:00:00.000Z"],
		[
			"2024-02-29T00:00:00Z",
			{ years: 1, months: 1 },
			"2025-03-29T00:00:00.000Z",
		],
		[
			"2026-01-31T00:00:00Z",
			{ months: 1, days: 1 },
			"2026-03-01T00:00:00.000Z",
		],
		["2026-01-01T00:00:00Z", { days: 1, hours: 6 }, "2026-01-02T06:00:00.000Z"],
		["2026-01-01T00:00:00Z", { days: 1.5 }, "2026-01-02T12:00:00.000Z"],
	])("%s + %j", (start, duration, end) => {
		expect(
			Interval.after(start, Duration.fromObject(duration)).end.toISO(),
		).toBe(end);
		expect(Interval.after(start, duration).end.toISO()).toBe(end);
	});

	it("adds a day in the start's zone across DST", () => {
		const start = new DateTime("2026-03-28T11:00:00Z", "Europe/Paris");
		const end = Interval.after(start, Duration.fromObject({ days: 1 })).end;
		expect(end.toZonedISO()).toBe("2026-03-29T12:00:00+02:00");
	});
});

describe("DateTime.plus/minus take a Duration, as Luxon's do", () => {
	it("applies years and months in one step, then days, then clock units", () => {
		const dt = DateTime.from("2024-02-29T10:00:00Z");
		expect(dt.plus({ years: 1, months: 1 }).toISO()).toBe(
			"2025-03-29T10:00:00.000Z",
		);
		expect(dt.plus(Duration.fromObject({ weeks: 1, hours: 2 })).toISO()).toBe(
			"2024-03-07T12:00:00.000Z",
		);
		expect(dt.minus({ months: 1, minutes: 30 }).toISO()).toBe(
			"2024-01-29T09:30:00.000Z",
		);
	});
});

describe("Interval.splitBy steps on the calendar", () => {
	it("splits a year into twelve months on month boundaries", () => {
		const year = Interval.fromDateTimes(
			"2026-01-31T00:00:00Z",
			"2027-01-31T00:00:00Z",
		);
		const parts = year.splitBy({ amount: 1, unit: "month" });
		expect(parts).toHaveLength(12);
		expect(parts.slice(0, 3).map((p) => p.end.toISO())).toEqual([
			"2026-02-28T00:00:00.000Z",
			"2026-03-31T00:00:00.000Z",
			"2026-04-30T00:00:00.000Z",
		]);
		expect(parts.at(-1)?.end.toISO()).toBe("2027-01-31T00:00:00.000Z");
	});

	it("still refuses an unknown unit and a non-positive step", () => {
		const iv = Interval.fromDateTimes(
			"2026-01-01T00:00:00Z",
			"2026-01-05T00:00:00Z",
		);
		expect(() =>
			Reflect.apply(iv.splitBy, iv, [{ amount: 1, unit: "fortnight" }]),
		).toThrow(/not a unit/);
		expect(() => iv.splitBy({ amount: 0, unit: "day" })).toThrow(/positive/);
	});
});
