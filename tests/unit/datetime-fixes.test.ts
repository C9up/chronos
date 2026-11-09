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

describe("strings are read as ISO 8601, the same way on every host", () => {
	describe.each(["UTC", "Europe/Paris", "America/New_York"])(
		"host zone %s",
		(host) => {
			withHostZone(host);

			it("reads an offset-less time as UTC, not as host-local", () => {
				expect(new DateTime("2026-08-10T12:00:00").toISO()).toBe(
					"2026-08-10T12:00:00.000Z",
				);
				expect(new DateTime("2026-08-10 12:00:00").toISO()).toBe(
					"2026-08-10T12:00:00.000Z",
				);
				expect(new DateTime("2026-08-10").toISO()).toBe(
					"2026-08-10T00:00:00.000Z",
				);
			});

			it("reads an offset-less time in the zone it is given", () => {
				expect(
					new DateTime("2026-08-10T12:00:00", "Europe/Paris").toZonedISO(),
				).toBe("2026-08-10T12:00:00+02:00");
				expect(
					DateTime.fromISO("2026-08-10T12:00:00", {
						zone: "America/New_York",
					}).toISO(),
				).toBe("2026-08-10T16:00:00.000Z");
			});
		},
	);

	it.each([
		"1",
		"foo 2026",
		"March 7",
		"2026",
		"2026-08",
		"Mon, 10 Aug 2026 12:00:00 GMT",
		"2026-08-10T12",
		"2026-08-10T25:00:00Z",
		"2026-08-10T12:60:00Z",
		"2026-08-10T12:00:60Z",
		"2026-08-10T12:00:00+24:00",
		" 2026-08-10",
		"",
	])("refuses %j", (text) => {
		expect(() => new DateTime(text)).toThrow(RangeError);
	});

	it("keeps the offset forms and fractions it should read", () => {
		expect(new DateTime("2026-08-10T12:00:00+02:00").toISO()).toBe(
			"2026-08-10T10:00:00.000Z",
		);
		expect(new DateTime("2026-08-10T12:00:00-0530").toISO()).toBe(
			"2026-08-10T17:30:00.000Z",
		);
		expect(new DateTime("2026-08-10 12:00:00+00").toISO()).toBe(
			"2026-08-10T12:00:00.000Z",
		);
		expect(new DateTime("2026-08-10T12:00:00.123456Z").toISO()).toBe(
			"2026-08-10T12:00:00.123Z",
		);
		expect(new DateTime("2026-08-10T12:00Z").toISO()).toBe(
			"2026-08-10T12:00:00.000Z",
		);
	});
});

describe("values outside years 0000-9999 are refused at construction", () => {
	it.each([
		() => DateTime.fromMillis(253402300800000),
		() => DateTime.fromMillis(-62198755200000),
		() => DateTime.fromJSDate(new Date(253402300800000)),
		() => new DateTime(new Date(-62198755200000)),
		() => DateTime.fromObject({ year: 10000, month: 1, day: 1 }),
		() => DateTime.fromMillis(Number.NaN),
	])("%#", (build) => {
		expect(build).toThrow(RangeError);
	});

	it("still holds both ends of the range", () => {
		expect(DateTime.fromMillis(253402300799999).toISO()).toBe(
			"9999-12-31T23:59:59.999Z",
		);
		expect(DateTime.fromObject({ year: 0, month: 1, day: 1 }).toISO()).toBe(
			"0000-01-01T00:00:00.000Z",
		);
		expect(DateTime.fromMillis(253402300799999).plus(0, "day").year).toBe(9999);
	});
});

describe("fromObject validates every field", () => {
	it("reads years 0-99 literally", () => {
		expect(DateTime.fromObject({ year: 50, month: 6, day: 1 }).toISO()).toBe(
			"0050-06-01T00:00:00.000Z",
		);
		expect(new DateTime("0050-06-01").year).toBe(50);
	});

	it.each([
		{ hour: 24 },
		{ minute: 90 },
		{ second: 60 },
		{ millisecond: 1000 },
		{ hour: 1.5 },
		{ minute: -1 },
		{ hour: Number.NaN },
	])("refuses %j", (time) => {
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 6, day: 1, ...time }),
		).toThrow(/out of range/);
	});

	it("refuses a fractional or non-finite year, month or day", () => {
		expect(() =>
			DateTime.fromObject({ year: 2026.5, month: 6, day: 1 }),
		).toThrow(RangeError);
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 6, day: 1.5 }),
		).toThrow(RangeError);
		expect(() =>
			DateTime.fromObject({ year: 2026, month: Number.NaN, day: 1 }),
		).toThrow(RangeError);
	});

	it("builds a wall clock in a zone", () => {
		const dt = DateTime.fromObject(
			{ year: 2026, month: 8, day: 10, hour: 9, millisecond: 250 },
			{ zone: "Europe/Paris" },
		);
		expect(dt.toISO()).toBe("2026-08-10T07:00:00.250Z");
		expect(dt.zoneName).toBe("Europe/Paris");
	});
});

describe("fromSQL reads what databases print", () => {
	it.each([
		["2026-08-10 12:00:00+00", "2026-08-10T12:00:00.000Z"],
		["2026-08-10 12:00:00.123+02:00", "2026-08-10T10:00:00.123Z"],
		["2026-08-10", "2026-08-10T00:00:00.000Z"],
		["2026-08-10 12:00:00", "2026-08-10T12:00:00.000Z"],
	])("%s", (input, expected) => {
		expect(DateTime.fromSQL(input).toISO()).toBe(expected);
	});

	it("reads an offset-less value in the zone it is given", () => {
		const dt = DateTime.fromSQL("2026-08-10 12:00:00", {
			zone: "Europe/Paris",
		});
		expect(dt.toZonedISO()).toBe("2026-08-10T12:00:00+02:00");
		expect(
			DateTime.fromSQL("2026-08-10 12:00:00+00", {
				zone: "Europe/Paris",
			}).toISO(),
		).toBe("2026-08-10T12:00:00.000Z");
	});

	it("still refuses what is not a SQL literal", () => {
		expect(() => DateTime.fromSQL("2026-08-10 12")).toThrow(/Invalid SQL/);
		expect(() => DateTime.fromSQL("2026-02-30")).toThrow(/Invalid SQL/);
	});
});

describe("DST gaps and overlaps resolve as Luxon does", () => {
	it("moves a time in a spring gap forward by the size of the gap", () => {
		const dt = new DateTime("2026-03-28T01:30:00Z", "Europe/Paris");
		expect(dt.plus(1, "day").toZonedISO()).toBe("2026-03-29T03:30:00+02:00");
	});

	it("keeps the previous offset in an autumn overlap", () => {
		const dt = new DateTime("2026-10-26T01:30:00Z", "Europe/Paris");
		expect(dt.minus(1, "day").toZonedISO()).toBe("2026-10-25T02:30:00+01:00");
		const before = new DateTime("2026-10-24T00:30:00Z", "Europe/Paris");
		expect(before.plus(1, "day").toZonedISO()).toBe(
			"2026-10-25T02:30:00+02:00",
		);
	});

	it("steps over a gap of a whole day (Samoa, 2011-12-30)", () => {
		const dt = new DateTime("2011-12-29T22:00:00Z", "Pacific/Apia");
		expect(dt.plus(1, "day").toZonedISO()).toBe("2011-12-31T12:00:00+14:00");
	});
});

describe("diff counts calendar days and weeks in the value's zone", () => {
	it("is 1 from 12:00 to 12:00 the next day across both 2026 transitions", () => {
		const spring = new DateTime("2026-03-28T11:00:00Z", "Europe/Paris");
		expect(spring.plus(1, "day").diff(spring, "day")).toBe(1);
		const autumn = new DateTime("2026-10-24T10:00:00Z", "Europe/Paris");
		expect(autumn.plus(1, "day").diff(autumn, "day")).toBe(1);
		expect(autumn.diff(autumn.plus(1, "day"), "day")).toBe(-1);
	});

	it("gives back n for plus(n, 'day') and plus(n, 'week')", () => {
		const a = new DateTime("2026-01-15T11:00:00Z", "Europe/Paris");
		for (let n = 1; n <= 400; n++) {
			expect(a.plus(n, "day").diff(a, "day")).toBe(n);
		}
		for (let n = 1; n <= 60; n++) {
			expect(a.plus(n, "week").diff(a, "week")).toBe(n);
		}
	});
});
