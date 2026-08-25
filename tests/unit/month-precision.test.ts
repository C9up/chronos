/**
 * Month and year arithmetic rebuilt the instant from Y/M/D + h:m:s and dropped
 * everything below the second, so `plus(1, "month")` silently rounded a
 * timestamp — and a value round-tripped through it no longer matched the row
 * it came from.
 */
import { describe, expect, it } from "vitest";
import { DateTime } from "../../src/DateTime.js";

describe("chronos > sub-second precision in calendar arithmetic", () => {
	it("keeps the milliseconds across a month", () => {
		const d = new DateTime("2026-01-15T10:30:45.123Z");
		expect(d.plus(1, "month").toISO()).toBe("2026-02-15T10:30:45.123Z");
		expect(d.minus(1, "month").toISO()).toBe("2025-12-15T10:30:45.123Z");
	});

	it("keeps them across a year", () => {
		const d = new DateTime("2026-01-15T10:30:45.987Z");
		expect(d.plus(1, "year").toISO()).toBe("2027-01-15T10:30:45.987Z");
	});

	it("keeps them when the day is clamped to a shorter month", () => {
		const d = new DateTime("2026-01-31T23:59:59.999Z");
		expect(d.plus(1, "month").toISO()).toBe("2026-02-28T23:59:59.999Z");
	});

	it("still truncates where truncating is the point", () => {
		const d = new DateTime("2026-01-15T10:30:45.123Z");
		expect(d.startOf("second").toISO()).toBe("2026-01-15T10:30:45.000Z");
	});
});

describe("chronos > startOf/endOf('second')", () => {
	it("truncates and extends to the second in UTC", () => {
		const d = new DateTime("2026-01-15T10:30:45.123Z");
		expect(d.startOf("second").toISO()).toBe("2026-01-15T10:30:45.000Z");
		expect(d.endOf("second").toISO()).toBe("2026-01-15T10:30:45.999Z");
	});

	it("behaves the same in a zone", () => {
		// The zoned path has its own switch; a missing case would silently
		// return the value unchanged.
		const d = new DateTime("2026-01-15T10:30:45.123Z", "Europe/Zurich");
		expect(d.startOf("second").toISO()).toBe("2026-01-15T10:30:45.000Z");
		expect(d.endOf("second").toISO()).toBe("2026-01-15T10:30:45.999Z");
	});

	it("agrees with hasSame", () => {
		const a = new DateTime("2026-01-15T10:30:45.100Z");
		const b = new DateTime("2026-01-15T10:30:45.900Z");
		expect(a.hasSame(b, "second")).toBe(true);
		expect(a.hasSame(new DateTime("2026-01-15T10:30:46.000Z"), "second")).toBe(
			false,
		);
	});
});

describe("chronos > one boundary implementation, both paths", () => {
	/**
	 * The zoned path used to be a hand-written switch in TypeScript. It drifted
	 * from the Rust one, so the SAME call answered differently depending on the
	 * zone. Both now go through the same routine; these compare them unit by
	 * unit on an instant where the zone offset does not change the wall clock's
	 * boundary.
	 */
	const units = [
		"second",
		"minute",
		"hour",
		"day",
		"week",
		"month",
		"year",
	] as const;

	it("agrees with UTC for a zone whose offset is zero", () => {
		for (const unit of units) {
			const utc = new DateTime("2026-03-11T14:37:26.451Z");
			const zoned = new DateTime("2026-03-11T14:37:26.451Z", "UTC");
			expect(zoned.startOf(unit).toISO()).toBe(utc.startOf(unit).toISO());
			expect(zoned.endOf(unit).toISO()).toBe(utc.endOf(unit).toISO());
		}
	});

	it("supports every unit in a real zone, none silently ignored", () => {
		const d = new DateTime("2026-03-11T14:37:26.451Z", "Europe/Zurich");
		for (const unit of units) {
			const start = d.startOf(unit);
			const end = d.endOf(unit);
			// A missing case used to return the value unchanged.
			expect(start.toMillis()).toBeLessThanOrEqual(d.toMillis());
			expect(end.toMillis()).toBeGreaterThanOrEqual(d.toMillis());
			expect(end.toMillis()).toBeGreaterThan(start.toMillis());
		}
	});

	it("puts a zoned day boundary at local midnight, not UTC midnight", () => {
		const d = new DateTime("2026-03-11T01:30:00Z", "Europe/Zurich");
		// 01:30 UTC is 02:30 in Zurich, so the local day started at 23:00 UTC
		// the previous day — a UTC truncation would answer 00:00Z.
		expect(d.startOf("day").toISO()).toBe("2026-03-10T23:00:00.000Z");
	});
});
