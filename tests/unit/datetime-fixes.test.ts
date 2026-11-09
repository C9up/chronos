import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "../../src/index.js";

/** Run with the host in a non-UTC zone, the way a dev laptop or a container may be. */
function withHostZone(zone: string): void {
	let previous: string | undefined;
	beforeEach(() => {
		previous = process.env.TZ;
		process.env.TZ = zone;
	});
	afterEach(() => {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	});
}

describe("toLocaleString formats in the value's own zone", () => {
	withHostZone("Europe/Paris");

	it("formats a UTC value in UTC, not in the host zone", () => {
		const dt = DateTime.from("2026-06-01T00:00:00Z");
		expect(dt.toLocaleString("en-GB", { timeStyle: "short" })).toBe("00:00");
	});

	it("formats a zoned value in its zone", () => {
		const dt = new DateTime("2026-06-01T00:00:00Z", "America/New_York");
		expect(dt.toLocaleString("en-GB", { timeStyle: "short" })).toBe("20:00");
	});
});

describe("format keeps non-ASCII literal text", () => {
	const instant = "2026-06-01T00:00:00Z";
	// Reykjavik sits on +00:00 all year, so the zoned path must print exactly
	// what the UTC path prints.
	const utc = DateTime.from(instant);
	const zoned = new DateTime(instant, "Atlantic/Reykjavik");

	it.each([
		["YYYY年MM月DD日", "2026年06月01日"],
		["[é] HH", "é 00"],
		["DD/MM/YYYY [à] HH:mm", "01/06/2026 à 00:00"],
		["HH:mm – DD·MM°", "00:00 – 01·06°"],
		["[100%] YYYY", "100% 2026"],
	])("%s", (pattern, expected) => {
		expect(utc.format(pattern)).toBe(expected);
		expect(zoned.format(pattern)).toBe(expected);
	});
});

describe("plus/minus validate the amount", () => {
	const base = DateTime.from("2026-06-01T00:00:00Z");

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"refuses %s instead of treating it as 0",
		(amount) => {
			expect(() => base.plus(amount, "day")).toThrow(RangeError);
			expect(() => base.minus(amount, "hour")).toThrow(RangeError);
		},
	);

	it("refuses a value that is not a number", () => {
		expect(() => Reflect.apply(base.plus, base, ["1", "day"])).toThrow(
			RangeError,
		);
	});

	it("carries a fraction as elapsed time, like Luxon", () => {
		expect(base.plus(1.5, "day").toISO()).toBe("2026-06-02T12:00:00.000Z");
		expect(base.plus(0.5, "hour").toISO()).toBe("2026-06-01T00:30:00.000Z");
		expect(base.minus(1.5, "day").toISO()).toBe("2026-05-30T12:00:00.000Z");
		expect(base.plus(2.5, "minute").toISO()).toBe("2026-06-01T00:02:30.000Z");
	});

	it("moves the whole part on the zone's calendar and the fraction as elapsed time", () => {
		// 2026-03-28 12:00 Paris (+01:00) + 1 calendar day = 2026-03-29 12:00
		// (+02:00), then + 12 h.
		const paris = new DateTime("2026-03-28T11:00:00Z", "Europe/Paris");
		expect(paris.plus(1.5, "day").toZonedISO()).toBe(
			"2026-03-30T00:00:00+02:00",
		);
	});

	it("reports a huge amount as out of range instead of a native panic", () => {
		expect(() => base.plus(1e18, "month")).toThrow(/out of range/);
		expect(() => base.plus(9e15, "year")).toThrow(/out of range/);
		expect(() => base.plus(9e15, "second")).toThrow(/out of range/);
		expect(() => base.plus(8000, "year")).toThrow(/out of range/);
		expect(() =>
			new DateTime("2026-06-01T00:00:00Z", "Europe/Paris").plus(9e15, "day"),
		).toThrow(/out of range/);
	});
});
