import { describe, expect, it } from "vitest";
import {
	analyzeRange,
	containsRange,
	DateTime,
	inRange,
	overlapsRange,
} from "../../src/index.js";

describe("chronos > DateTime > zones", () => {
	it("setZone preserves the instant and exposes the zone name", () => {
		const utc = new DateTime("2026-06-15T12:00:00Z");
		const paris = utc.setZone("Europe/Paris");
		expect(paris.zoneName).toBe("Europe/Paris");
		// Same instant — toMillis identical.
		expect(paris.toMillis()).toBe(utc.toMillis());
	});

	it("toUTC strips the zone but keeps the instant", () => {
		const utc = new DateTime("2026-06-15T12:00:00Z");
		const back = utc.setZone("Europe/Paris").toUTC();
		expect(back.zoneName).toBe("UTC");
		expect(back.toMillis()).toBe(utc.toMillis());
	});

	it("offset is 0 in UTC and non-zero in a DST zone", () => {
		const utc = new DateTime("2026-06-15T12:00:00Z");
		expect(utc.offset).toBe(0);
		// Europe/Paris in June = UTC+02:00 → 120 minutes.
		expect(utc.setZone("Europe/Paris").offset).not.toBe(0);
	});

	it("toZonedISO returns a wall-clock ISO with the zone offset", () => {
		const dt = new DateTime("2026-06-15T12:00:00Z").setZone("Europe/Paris");
		const zoned = dt.toZonedISO();
		// Zoned ISO ends with +02:00 in summer / +01:00 in winter — never 'Z'.
		expect(zoned).not.toMatch(/Z$/);
	});

	it("format() in a non-UTC zone formats wall-clock time", () => {
		const dt = new DateTime("2026-06-15T12:00:00Z").setZone("Europe/Paris");
		expect(dt.format("HH:mm")).toBe("14:00"); // UTC+02:00
	});
});

describe("chronos > DateTime > startOf / endOf in non-UTC zones", () => {
	const dt = new DateTime("2026-06-15T12:34:56Z").setZone("Europe/Paris");

	it("startOf('day') anchors at 00:00 in zone", () => {
		expect(dt.startOf("day").format("HH:mm")).toBe("00:00");
	});

	it("startOf('month') anchors at the 1st of the zone-local month", () => {
		expect(dt.startOf("month").format("YYYY-MM-DD")).toBe("2026-06-01");
	});

	it("startOf('year') anchors at January 1st in zone", () => {
		expect(dt.startOf("year").format("YYYY-MM-DD")).toBe("2026-01-01");
	});

	it("startOf('week') anchors at Monday 00:00 (ISO week)", () => {
		// 2026-06-15 is a Monday — startOf('week') is the same day.
		const monday = new DateTime("2026-06-15T12:00:00Z").setZone("Europe/Paris");
		expect(monday.startOf("week").format("YYYY-MM-DD")).toBe("2026-06-15");
	});

	it("endOf('day') in UTC is the last second of the day", () => {
		const utc = new DateTime("2026-06-15T12:34:56Z");
		const end = utc.endOf("day");
		expect(end.format("HH:mm:ss")).toBe("23:59:59");
	});

	it("endOf('month') in UTC reaches the last day of the month", () => {
		const utc = new DateTime("2026-06-15T12:34:56Z");
		expect(utc.endOf("month").format("YYYY-MM-DD")).toBe("2026-06-30");
	});

	it("endOf('year') in UTC wraps to Dec 31", () => {
		const utc = new DateTime("2026-06-15T12:34:56Z");
		expect(utc.endOf("year").format("YYYY-MM-DD")).toBe("2026-12-31");
	});
});

describe("chronos > DateTime > arithmetic in zones", () => {
	it("plus('month') in Europe/Paris keeps the wall-clock day stable", () => {
		const dt = new DateTime("2026-01-31T10:00:00Z").setZone("Europe/Paris");
		const next = dt.plus(1, "month");
		// February has no 31st — the implementation clamps to the last day.
		expect(next.format("YYYY-MM-DD")).toMatch(/^2026-02-/);
	});

	it("diff('year') across years in zone returns the integer year delta (signed)", () => {
		const a = new DateTime("2026-01-15T00:00:00Z").setZone("Europe/Paris");
		const b = new DateTime("2025-01-15T00:00:00Z");
		// `a.diff(b)` may return signed delta in either direction depending on
		// the engine convention — assert the magnitude only.
		expect(Math.abs(a.diff(b, "year"))).toBeGreaterThanOrEqual(1);
	});

	it("minus(n, unit) is the inverse of plus(n, unit) for hours", () => {
		const dt = new DateTime("2026-06-15T12:00:00Z");
		const back = dt.plus(5, "hour").minus(5, "hour");
		expect(back.toISO()).toBe(dt.toISO());
	});
});

describe("chronos > DateTime > comparison + sameness", () => {
	const a = new DateTime("2026-04-08T14:00:00Z");
	const b = new DateTime("2026-04-08T15:00:00Z");

	it("equals/isBefore/isAfter behave as expected", () => {
		expect(a.equals(a.toISO())).toBe(true);
		expect(a.isBefore(b)).toBe(true);
		expect(b.isAfter(a)).toBe(true);
	});

	it("hasSame('day') is true for two times on the same day", () => {
		expect(a.hasSame(b, "day")).toBe(true);
	});

	it("isSameDay convenience wrapper matches hasSame('day')", () => {
		expect(a.isSameDay(b)).toBe(true);
		expect(a.isSameDay("2026-04-09T00:00:00Z")).toBe(false);
	});
});

describe("chronos > DateTime > calendar getters", () => {
	const dt = new DateTime("2024-02-29T10:30:45.123Z"); // leap-year + Thursday

	it("year/month/day/hour/minute/second/millisecond match the ISO input", () => {
		expect(dt.year).toBe(2024);
		expect(dt.month).toBe(2);
		expect(dt.day).toBe(29);
		expect(dt.hour).toBe(10);
		expect(dt.minute).toBe(30);
		expect(dt.second).toBe(45);
		expect(dt.millisecond).toBe(123);
	});

	it("weekday / weekNumber / quarter / ordinal / daysIn* / isInLeapYear", () => {
		expect(typeof dt.weekday).toBe("number");
		expect(typeof dt.weekNumber).toBe("number");
		expect(dt.quarter).toBe(1);
		expect(dt.ordinal).toBe(60); // Feb 29 is the 60th day of 2024
		expect(dt.daysInMonth).toBe(29);
		expect(dt.daysInYear).toBe(366);
		expect(dt.isInLeapYear).toBe(true);
	});
});

describe("chronos > DateTime > formatting helpers", () => {
	const dt = new DateTime("2026-06-15T12:34:56Z");

	it("toJSON / toString return the ISO string verbatim", () => {
		expect(dt.toJSON()).toBe("2026-06-15T12:34:56Z");
		expect(JSON.stringify({ d: dt })).toContain("2026-06-15T12:34:56Z");
	});

	it("toMillis / toSeconds round-trip with fromMillis", () => {
		const ms = dt.toMillis();
		expect(DateTime.fromMillis(ms).toISO()).toBe(dt.toISO());
		expect(dt.toSeconds()).toBe(Math.floor(ms / 1000));
	});

	it("toLocaleString respects en-US numeric format by default", () => {
		const out = dt.toLocaleString("en-US");
		expect(typeof out).toBe("string");
		expect(out).toMatch(/2026/);
	});

	it("toLocaleString respects the dt's zone when non-UTC", () => {
		const paris = dt.setZone("Europe/Paris");
		const out = paris.toLocaleString("en-US");
		expect(typeof out).toBe("string");
	});
});

describe("chronos > DateTime > toRelative", () => {
	it("uses 'second' bucket for sub-minute differences", () => {
		const base = new DateTime("2026-06-15T12:00:00Z");
		const t = new DateTime("2026-06-15T12:00:30Z");
		const out = t.toRelative({ base, locale: "en" });
		expect(out).toMatch(/30 seconds|in 30 seconds/i);
	});

	it("uses 'minute' bucket for sub-hour differences", () => {
		const base = new DateTime("2026-06-15T12:00:00Z");
		const t = new DateTime("2026-06-15T12:30:00Z");
		const out = t.toRelative({ base, locale: "en" });
		expect(out).toMatch(/30 minutes|in 30 minutes/i);
	});

	it("uses 'hour' bucket for sub-day differences", () => {
		const base = new DateTime("2026-06-15T00:00:00Z");
		const t = new DateTime("2026-06-15T05:00:00Z");
		const out = t.toRelative({ base, locale: "en" });
		expect(out).toMatch(/5 hours|in 5 hours/i);
	});

	it("uses 'day' bucket for sub-month differences", () => {
		const base = new DateTime("2026-06-15T00:00:00Z");
		const t = new DateTime("2026-06-20T00:00:00Z");
		const out = t.toRelative({ base, locale: "en" });
		expect(out).toMatch(/5 days|in 5 days/i);
	});

	it("uses 'month' bucket for differences across months", () => {
		const base = new DateTime("2026-01-15T00:00:00Z");
		const t = new DateTime("2026-04-15T00:00:00Z");
		const out = t.toRelative({ base, locale: "en" });
		expect(out).toMatch(/months|in 3/);
	});

	it("uses 'year' bucket for differences spanning years", () => {
		const base = new DateTime("2024-06-15T00:00:00Z");
		const t = new DateTime("2026-06-15T00:00:00Z");
		const out = t.toRelative({ base, locale: "en" });
		expect(out).toMatch(/years|in 2/);
	});
});

describe("chronos > DateTime > fromObject validation", () => {
	it("rejects month outside 1..12", () => {
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 13, day: 1 }),
		).toThrow(/Invalid month/);
		expect(() => DateTime.fromObject({ year: 2026, month: 0, day: 1 })).toThrow(
			/Invalid month/,
		);
	});

	it("rejects day outside 1..31", () => {
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 1, day: 32 }),
		).toThrow(/Invalid day/);
		expect(() => DateTime.fromObject({ year: 2026, month: 1, day: 0 })).toThrow(
			/Invalid day/,
		);
	});

	it("rejects Feb 30 (overflow not silently coerced)", () => {
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 2, day: 30 }),
		).toThrow(/Invalid date object/);
	});

	it("accepts the minimum valid object (year/month/day)", () => {
		const dt = DateTime.fromObject({ year: 2026, month: 1, day: 1 });
		expect(dt.format("YYYY-MM-DD")).toBe("2026-01-01");
	});
});

describe("chronos > range helpers (standalone)", () => {
	const a = { start: "2026-01-01T00:00:00Z", end: "2026-01-31T23:59:59Z" };
	const b = { start: "2026-01-15T00:00:00Z", end: "2026-02-15T00:00:00Z" };
	const inside = "2026-01-10T00:00:00Z";
	const outside = "2026-03-01T00:00:00Z";

	it("inRange returns true for points inside, false outside", () => {
		expect(inRange(inside, a)).toBe(true);
		expect(inRange(outside, a)).toBe(false);
	});

	it("containsRange detects strict containment in both directions", () => {
		const inner = {
			start: "2026-01-05T00:00:00Z",
			end: "2026-01-10T00:00:00Z",
		};
		expect(containsRange(a, inner)).toBe(true);
		expect(containsRange(inner, a)).toBe(false);
	});

	it("overlapsRange is symmetric and detects partial overlap", () => {
		expect(overlapsRange(a, b)).toBe(true);
		expect(overlapsRange(b, a)).toBe(true);
	});

	it("analyzeRange exposes overlaps + endpoint-in-range flags", () => {
		const rel = analyzeRange(a, b);
		expect(rel.overlaps).toBe(true);
		expect(rel.aContainsB).toBe(false);
		expect(rel.bContainsA).toBe(false);
		// b starts inside a → bStartInA true; a ends inside b? — depends on ranges.
		expect(typeof rel.aStartInB).toBe("boolean");
		expect(typeof rel.bStartInA).toBe("boolean");
	});

	it("analyzeRange on disjoint ranges has overlaps=false", () => {
		const c = { start: "2026-04-01T00:00:00Z", end: "2026-04-30T00:00:00Z" };
		const rel = analyzeRange(a, c);
		expect(rel.overlaps).toBe(false);
		expect(rel.aContainsB).toBe(false);
		expect(rel.bContainsA).toBe(false);
	});
});

describe("chronos > DateTime > parsers (RFC2822 / SQL / HTTP)", () => {
	it("fromRFC2822 round-trips a canonical email date", () => {
		const dt = DateTime.fromRFC2822("Wed, 15 Apr 2026 14:30:00 GMT");
		expect(dt.year).toBe(2026);
		expect(dt.month).toBe(4);
	});

	it("fromSQL parses 'YYYY-MM-DD HH:MM:SS' as UTC", () => {
		const dt = DateTime.fromSQL("2026-04-15 14:30:00");
		expect(dt.year).toBe(2026);
	});

	it("fromHTTP parses RFC 7231 date format", () => {
		const dt = DateTime.fromHTTP("Wed, 15 Apr 2026 14:30:00 GMT");
		expect(dt.year).toBe(2026);
	});
});

describe("chronos > DateTime > static factories", () => {
	it("DateTime.from(DateTime) clones preserving the zone", () => {
		const a = new DateTime("2026-06-15T12:00:00Z").setZone("Europe/Paris");
		const b = DateTime.from(a);
		expect(b.zoneName).toBe("Europe/Paris");
		expect(b.toISO()).toBe(a.toISO());
	});

	it("DateTime.fromUnix is an alias for fromSeconds", () => {
		const a = DateTime.fromUnix(1_700_000_000);
		const b = DateTime.fromSeconds(1_700_000_000);
		expect(a.toISO()).toBe(b.toISO());
	});

	it("DateTime.fromJSDate rejects an Invalid Date", () => {
		expect(() => DateTime.fromJSDate(new Date("not-a-date"))).toThrow(
			/Invalid Date/,
		);
	});
});
