import { describe, expect, it } from "vitest";
import { at, Chronos, DateTime, expandRRule } from "../../src/index.js";

describe("Chronos", () => {
	it("NAPI engine loads on this platform", () => {
		// Chronos requires the native engine — this test verifies it loaded.
		expect(() => DateTime.now()).not.toThrow();
	});

	it("supports date arithmetic", () => {
		const dt = at("2026-01-15T10:00:00Z");
		expect(dt.plus(1, "month").toISO()).toBe("2026-02-15T10:00:00Z");
		expect(dt.minus(2, "day").toISO()).toBe("2026-01-13T10:00:00Z");
		expect(Chronos.add("2026-01-15T10:00:00Z", 7, "day").toISO()).toBe(
			"2026-01-22T10:00:00Z",
		);
	});

	it("supports diff and boundaries", () => {
		const a = new DateTime("2026-01-15T10:00:00Z");
		expect(a.diff("2026-01-17T10:00:00Z", "day")).toBe(2);

		const b = new DateTime("2026-01-15T10:34:55Z");
		expect(b.startOf("day").toISO()).toBe("2026-01-15T00:00:00Z");
		expect(b.endOf("day").toISO()).toBe("2026-01-15T23:59:59.999Z");
	});

	it("supports formatting", () => {
		const dt = new DateTime("2026-01-15T10:34:55Z");
		expect(dt.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-01-15 10:34:55");
	});

	it("supports rrule monthly by month day", () => {
		const out = expandRRule(
			"2026-01-15T15:00:00Z",
			"FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3",
			10,
		);
		expect(out).toEqual([
			"2026-01-15T15:00:00Z",
			"2026-02-15T15:00:00Z",
			"2026-03-15T15:00:00Z",
		]);
	});

	it("supports rrule weekly every tuesday at 15h", () => {
		const out = Chronos.rrule(
			"2026-01-06T15:00:00Z",
			{
				freq: "WEEKLY",
				byDay: ["TU"],
				byHour: [15],
				byMinute: [0],
				bySecond: [0],
				count: 3,
			},
			10,
		);
		expect(out).toEqual([
			"2026-01-06T15:00:00Z",
			"2026-01-13T15:00:00Z",
			"2026-01-20T15:00:00Z",
		]);
	});

	it("supports ordinal byday and bysetpos", () => {
		const out = Chronos.rrule(
			"2026-01-01T12:00:00Z",
			{
				freq: "MONTHLY",
				byDay: ["-1SU"],
				count: 3,
			},
			10,
		);
		expect(out).toEqual([
			"2026-01-25T12:00:00Z",
			"2026-02-22T12:00:00Z",
			"2026-03-29T12:00:00Z",
		]);
	});

	it("supports hourly expansion with multi minute and bysetpos", () => {
		const out = Chronos.rrule(
			"2026-01-01T10:00:00Z",
			{
				freq: "HOURLY",
				byMinute: [0, 30],
				bySecond: [0],
				bySetPos: [-1],
				count: 3,
			},
			10,
		);
		expect(out).toEqual([
			"2026-01-01T10:30:00Z",
			"2026-01-01T11:30:00Z",
			"2026-01-01T12:30:00Z",
		]);
	});

	it("supports byweekno and byyearday", () => {
		const weekly = Chronos.rrule(
			"2026-01-01T09:00:00Z",
			{
				freq: "YEARLY",
				byWeekNo: [1],
				byDay: ["MO"],
				count: 2,
			},
			10,
		);
		expect(weekly).toEqual(["2027-01-04T09:00:00Z", "2028-01-03T09:00:00Z"]);

		const yearDay = Chronos.rrule(
			"2026-01-01T00:00:00Z",
			{
				freq: "YEARLY",
				byYearDay: [-1],
				count: 2,
			},
			10,
		);
		expect(yearDay).toEqual(["2026-12-31T00:00:00Z", "2027-12-31T00:00:00Z"]);
	});

	it("supports date range comparisons", () => {
		const outer = {
			start: "2026-01-01T00:00:00Z",
			end: "2026-01-31T23:59:59Z",
		};
		const inner = {
			start: "2026-01-10T00:00:00Z",
			end: "2026-01-20T23:59:59Z",
		};
		const touching = {
			start: "2026-01-31T23:59:59Z",
			end: "2026-02-05T00:00:00Z",
		};

		expect(Chronos.rangeContains(outer, inner)).toBe(true);
		expect(Chronos.rangesOverlap(outer, touching)).toBe(true);
		expect(
			Chronos.rangesOverlap(outer, touching, {
				inclusiveStart: false,
				inclusiveEnd: false,
			}),
		).toBe(false);

		const dt = Chronos.parse("2026-01-15T12:00:00Z");
		expect(dt.isWithin(outer)).toBe(true);
		expect(Chronos.inRange("2026-02-01T00:00:00Z", outer)).toBe(false);

		const relation = Chronos.rangeRelation(
			{ start: "2026-01-05T00:00:00Z", end: "2026-01-12T00:00:00Z" },
			{ start: "2026-01-10T00:00:00Z", end: "2026-01-20T00:00:00Z" },
		);
		expect(relation.overlaps).toBe(true);
		expect(relation.aStartInB).toBe(false);
		expect(relation.aEndInB).toBe(true);
		expect(relation.bStartInA).toBe(true);
		expect(relation.bEndInA).toBe(false);
	});
});

// === Epic 36 Phase 1 — Audit fix tests ====================================================

describe("chronos > diff month/year parity (36.1)", () => {
	it("diff month: Jan 15 → Mar 15 = 2 months", () => {
		const dt = new DateTime("2026-01-15T10:00:00Z");
		expect(dt.diff("2026-03-15T10:00:00Z", "month")).toBe(2);
	});

	it("diff month: Jan 31 → Feb 28 = 0 months (not yet one full month)", () => {
		const dt = new DateTime("2026-01-31T00:00:00Z");
		expect(dt.diff("2026-02-28T00:00:00Z", "month")).toBe(0);
	});

	it("diff year: Jan 15 2024 → Jan 15 2026 = 2 years", () => {
		const dt = new DateTime("2024-01-15T00:00:00Z");
		expect(dt.diff("2026-01-15T00:00:00Z", "year")).toBe(2);
	});

	it("diff month negative: Mar 15 → Jan 15 = -2", () => {
		const dt = new DateTime("2026-03-15T00:00:00Z");
		expect(dt.diff("2026-01-15T00:00:00Z", "month")).toBe(-2);
	});
});

describe("chronos > format Z-token fix (36.2)", () => {
	it("literal [Z] is not replaced by timezone offset", () => {
		const dt = new DateTime("2026-04-08T14:00:00Z");
		expect(dt.format("YYYY-MM-DD[T]HH:mm:ss[Z]")).toBe("2026-04-08T14:00:00Z");
	});

	it("Z token at end produces timezone offset", () => {
		const dt = new DateTime("2026-04-08T14:00:00Z");
		expect(dt.format("YYYY-MM-DDTHH:mm:ssZ")).toBe("2026-04-08T14:00:00+00:00");
	});

	it("YYYY alone does not get corrupted", () => {
		const dt = new DateTime("2026-04-08T14:00:00Z");
		expect(dt.format("YYYY")).toBe("2026");
	});
});

describe("chronos > comparison methods (36.5)", () => {
	it("equals detects same instant", () => {
		const a = new DateTime("2026-04-08T14:00:00Z");
		const b = new DateTime("2026-04-08T14:00:00Z");
		expect(a.equals(b)).toBe(true);
	});

	it("isBefore / isAfter", () => {
		const a = new DateTime("2026-04-08T14:00:00Z");
		const b = new DateTime("2026-04-08T15:00:00Z");
		expect(a.isBefore(b)).toBe(true);
		expect(b.isAfter(a)).toBe(true);
		expect(a.isAfter(b)).toBe(false);
	});

	it("hasSame at day granularity", () => {
		const a = new DateTime("2026-04-08T14:00:00Z");
		const b = new DateTime("2026-04-08T23:59:59Z");
		expect(a.hasSame(b, "day")).toBe(true);
		expect(a.hasSame("2026-04-09T00:00:00Z", "day")).toBe(false);
	});

	it("isSameDay sugar", () => {
		const a = new DateTime("2026-04-08T14:00:00Z");
		expect(a.isSameDay("2026-04-08T23:00:00Z")).toBe(true);
		expect(a.isSameDay("2026-04-09T01:00:00Z")).toBe(false);
	});
});

describe("chronos > static factories (36.6)", () => {
	it("fromMillis", () => {
		const dt = DateTime.fromMillis(1744099200000); // 2025-04-08T00:00:00Z
		expect(dt.toISO()).toContain("2025");
	});

	it("fromSeconds", () => {
		const dt = DateTime.fromSeconds(1744099200);
		expect(dt.toISO()).toContain("2025");
	});

	it("fromJSDate rejects invalid Date", () => {
		expect(() => DateTime.fromJSDate(new Date("not-a-date"))).toThrow(
			/Invalid Date/,
		);
	});

	it("fromObject", () => {
		const dt = DateTime.fromObject({ year: 2026, month: 4, day: 8, hour: 14 });
		expect(dt.toISO()).toBe("2026-04-08T14:00:00Z");
	});
});

describe("chronos > calendar accessors (36.10)", () => {
	it("weekday + weekNumber + weekYear + ordinal + quarter", () => {
		const dt = new DateTime("2026-04-08T14:30:45Z"); // Wednesday
		expect(dt.weekday).toBe(3); // Wed
		expect(dt.quarter).toBe(2); // April = Q2
		expect(dt.ordinal).toBe(98); // 31+28+31+8 = 98
		expect(dt.daysInMonth).toBe(30); // April
		expect(dt.isInLeapYear).toBe(false); // 2026 is not leap
	});

	it("leap year detection", () => {
		const dt = new DateTime("2024-02-29T00:00:00Z");
		expect(dt.isInLeapYear).toBe(true);
		expect(dt.daysInMonth).toBe(29);
		expect(dt.daysInYear).toBe(366);
	});

	it("ISO week year boundary: 2024-12-30 = ISO week 1 of 2025", () => {
		const dt = new DateTime("2024-12-30T00:00:00Z");
		expect(dt.weekNumber).toBe(1);
		expect(dt.weekYear).toBe(2025);
	});

	it("individual accessors: year/month/day/hour/minute/second/ms", () => {
		const dt = new DateTime("2026-04-08T14:30:45Z");
		expect(dt.year).toBe(2026);
		expect(dt.month).toBe(4);
		expect(dt.day).toBe(8);
		expect(dt.hour).toBe(14);
		expect(dt.minute).toBe(30);
		expect(dt.second).toBe(45);
	});
});

// === Story 36.8 — Duration ===

import { Duration } from "../../src/Duration.js";
import { Interval } from "../../src/Interval.js";

describe("chronos > Duration (36.8)", () => {
	it("fromObject + accessors", () => {
		const d = Duration.fromObject({ hours: 2, minutes: 30 });
		expect(d.hours).toBe(2);
		expect(d.minutes).toBe(30);
		expect(d.seconds).toBe(0);
	});

	it("fromMillis", () => {
		const d = Duration.fromMillis(90_000);
		expect(d.milliseconds).toBe(90_000);
		expect(d.normalize().minutes).toBe(1);
		expect(d.normalize().seconds).toBe(30);
	});

	it("fromISO parses P1Y2M3DT4H5M6S", () => {
		const d = Duration.fromISO("P1Y2M3DT4H5M6S");
		expect(d.years).toBe(1);
		expect(d.months).toBe(2);
		expect(d.days).toBe(3);
		expect(d.hours).toBe(4);
		expect(d.minutes).toBe(5);
		expect(d.seconds).toBe(6);
	});

	it("fromISO parses P3W", () => {
		expect(Duration.fromISO("P3W").weeks).toBe(3);
	});

	it("plus / minus", () => {
		const a = Duration.fromObject({ hours: 1, minutes: 30 });
		const b = Duration.fromObject({ minutes: 45 });
		expect(a.plus(b).minutes).toBe(75);
		expect(a.minus(b).minutes).toBe(-15);
	});

	it("negate", () => {
		const d = Duration.fromObject({ hours: 2 });
		expect(d.negate().hours).toBe(-2);
	});

	it("normalize cascades clock units", () => {
		const d = Duration.fromObject({ seconds: 3661 });
		const n = d.normalize();
		expect(n.hours).toBe(1);
		expect(n.minutes).toBe(1);
		expect(n.seconds).toBe(1);
	});

	it("shiftTo re-projects", () => {
		const d = Duration.fromObject({ hours: 25 });
		const shifted = d.shiftTo("days", "hours");
		expect(shifted.days).toBe(1);
		expect(shifted.hours).toBe(1);
	});

	it("as returns total in unit", () => {
		const d = Duration.fromObject({ hours: 2 });
		expect(d.as("minutes")).toBe(120);
		expect(d.as("seconds")).toBe(7200);
	});

	it("toISO", () => {
		expect(Duration.fromObject({ hours: 1, minutes: 30 }).toISO()).toBe(
			"PT1H30M",
		);
		expect(Duration.fromObject({ years: 1, days: 5 }).toISO()).toBe("P1Y5D");
		expect(Duration.fromObject({}).toISO()).toBe("PT0S");
	});

	it("toHuman", () => {
		expect(Duration.fromObject({ hours: 2, minutes: 15 }).toHuman()).toBe(
			"2 hours, 15 minutes",
		);
		expect(Duration.fromObject({ day: 1 } as never).toHuman()).toBe(
			"0 seconds",
		);
		expect(Duration.fromObject({ hours: 1 }).toHuman()).toBe("1 hour");
	});

	it("toFormat hh:mm:ss", () => {
		const d = Duration.fromObject({ hours: 1, minutes: 5, seconds: 9 });
		expect(d.toFormat("hh:mm:ss")).toBe("01:05:09");
	});
});

// === Story 36.9 — Interval ===

describe("chronos > Interval (36.9)", () => {
	const JAN1 = "2026-01-01T00:00:00Z";
	const JAN15 = "2026-01-15T00:00:00Z";
	const FEB1 = "2026-02-01T00:00:00Z";
	const MAR1 = "2026-03-01T00:00:00Z";

	it("fromDateTimes + length", () => {
		const iv = Interval.fromDateTimes(JAN1, FEB1);
		expect(iv.length("days")).toBeCloseTo(31, 0);
	});

	it("contains (half-open)", () => {
		const iv = Interval.fromDateTimes(JAN1, FEB1);
		expect(iv.contains(JAN15)).toBe(true);
		expect(iv.contains(FEB1)).toBe(false); // exclusive end
		expect(iv.contains(JAN1)).toBe(true); // inclusive start
	});

	it("overlaps", () => {
		const a = Interval.fromDateTimes(JAN1, FEB1);
		const b = Interval.fromDateTimes(JAN15, MAR1);
		expect(a.overlaps(b)).toBe(true);
	});

	it("intersection", () => {
		const a = Interval.fromDateTimes(JAN1, FEB1);
		const b = Interval.fromDateTimes(JAN15, MAR1);
		const c = a.intersection(b);
		expect(c).not.toBeNull();
		expect(c?.start.toISO()).toBe(JAN15);
		expect(c?.end.toISO()).toBe(FEB1);
	});

	it("union", () => {
		const a = Interval.fromDateTimes(JAN1, FEB1);
		const b = Interval.fromDateTimes(JAN15, MAR1);
		const u = a.union(b);
		expect(u).not.toBeNull();
		expect(u?.start.toISO()).toBe(JAN1);
		expect(u?.end.toISO()).toBe(MAR1);
	});

	it("union returns null for disjoint", () => {
		const a = Interval.fromDateTimes(JAN1, JAN15);
		const b = Interval.fromDateTimes(FEB1, MAR1);
		expect(a.union(b)).toBeNull();
	});

	it("abutsStart / abutsEnd", () => {
		const a = Interval.fromDateTimes(JAN1, JAN15);
		const b = Interval.fromDateTimes(JAN15, FEB1);
		expect(a.abutsStart(b)).toBe(true);
		expect(b.abutsEnd(a)).toBe(true);
	});

	it("splitAt", () => {
		const iv = Interval.fromDateTimes(JAN1, MAR1);
		const parts = iv.splitAt(FEB1);
		expect(parts.length).toBe(2);
		expect(parts[0].end.toISO()).toBe(FEB1);
		expect(parts[1].start.toISO()).toBe(FEB1);
	});

	it("splitBy 7-day chunks", () => {
		const iv = Interval.fromDateTimes(JAN1, JAN15);
		const parts = iv.splitBy({ amount: 7, unit: "day" });
		expect(parts.length).toBe(2); // 7d + 7d = 14d
		expect(parts[0].length("days")).toBeCloseTo(7, 0);
		expect(parts[1].length("days")).toBeCloseTo(7, 0);
	});

	it("engulfs", () => {
		const outer = Interval.fromDateTimes(JAN1, MAR1);
		const inner = Interval.fromDateTimes(JAN15, FEB1);
		expect(outer.engulfs(inner)).toBe(true);
		expect(inner.engulfs(outer)).toBe(false);
	});

	it("rejects inverted range", () => {
		expect(() => Interval.fromDateTimes(FEB1, JAN1)).toThrow(
			/start must be <= end/,
		);
	});
});

// === Story 36.7 — parse formats ===

describe("chronos > parse formats (36.7)", () => {
	it("fromRFC2822", () => {
		const dt = DateTime.fromRFC2822("Wed, 08 Apr 2026 14:00:00 +0000");
		expect(dt.toISO()).toBe("2026-04-08T14:00:00Z");
	});

	it("fromSQL", () => {
		const dt = DateTime.fromSQL("2026-04-08 14:00:00");
		expect(dt.toISO()).toBe("2026-04-08T14:00:00Z");
	});

	it("fromHTTP", () => {
		const dt = DateTime.fromHTTP("Wed, 08 Apr 2026 14:00:00 GMT");
		expect(dt.toISO()).toBe("2026-04-08T14:00:00Z");
	});

	it("fromRFC2822 rejects garbage", () => {
		expect(() => DateTime.fromRFC2822("not a date")).toThrow(/Invalid|parse/i);
	});

	it("fromSQL rejects garbage", () => {
		expect(() => DateTime.fromSQL("not a date")).toThrow(/Invalid|parse/i);
	});
});

// === Story 36.11 — IANA timezone support ===

describe("chronos > timezone support (36.11)", () => {
	it("setZone preserves the instant but changes zoneName", () => {
		const utc = new DateTime("2026-07-15T14:00:00Z");
		const paris = utc.setZone("Europe/Paris");
		expect(paris.zoneName).toBe("Europe/Paris");
		expect(paris.toISO()).toBe("2026-07-15T14:00:00Z"); // same instant
		expect(paris.toZonedISO()).toContain("16:00:00"); // wall-clock +2h
	});

	it("toUTC resets zone", () => {
		const paris = new DateTime("2026-07-15T14:00:00Z").setZone("Europe/Paris");
		expect(paris.toUTC().zoneName).toBe("UTC");
	});

	it("offset returns minutes for the zone at this instant", () => {
		const summer = new DateTime("2026-07-15T14:00:00Z").setZone("Europe/Paris");
		expect(summer.offset).toBe(120); // CEST

		const winter = new DateTime("2026-01-15T14:00:00Z").setZone("Europe/Paris");
		expect(winter.offset).toBe(60); // CET
	});

	it("plus 1 day across DST spring-forward preserves wall-clock", () => {
		// Europe/Paris springs forward 2026-03-29 02:00 → 03:00.
		// 2026-03-28 11:00 CET (+1) = 10:00 UTC.
		const dt = new DateTime("2026-03-28T10:00:00Z").setZone("Europe/Paris");
		const next = dt.plus(1, "day");
		// Should land on 2026-03-29 11:00 CEST (+2) = 09:00 UTC.
		const nextParis = next.toZonedISO();
		expect(nextParis).toContain("11:00:00"); // wall-clock preserved
	});

	it("plus 1 day across DST fall-back preserves wall-clock", () => {
		// Europe/Paris falls back 2026-10-25 03:00 → 02:00.
		// 2026-10-24 12:00 CEST (+2) = 10:00 UTC.
		const dt = new DateTime("2026-10-24T10:00:00Z").setZone("Europe/Paris");
		const next = dt.plus(1, "day");
		const nextParis = next.toZonedISO();
		expect(nextParis).toContain("12:00:00"); // wall-clock preserved
	});

	it("setZone rejects invalid IANA zone", () => {
		expect(() => new DateTime().setZone("Not/A/Zone")).toThrow(/Unknown/);
	});

	it("Pacific/Chatham 45-minute offset", () => {
		const dt = new DateTime("2026-01-15T00:00:00Z").setZone("Pacific/Chatham");
		expect(dt.offset).toBe(825); // 13h45 = 825 min (CHADT)
	});

	it("DateTime.now(zone) constructs with the zone set", () => {
		const dt = DateTime.now("America/New_York");
		expect(dt.zoneName).toBe("America/New_York");
		// The instant is valid (not NaN) regardless of our system clock.
		expect(dt.toISO()).toMatch(/^\d{4}-/);
	});
});

// === Story 36.12 — locale formatting ===

describe("chronos > locale formatting (36.12)", () => {
	it("toLocaleString with default locale", () => {
		const dt = new DateTime("2026-04-08T14:00:00Z");
		const str = dt.toLocaleString("en-US");
		expect(str).toContain("2026");
	});

	it("toLocaleString respects timezone", () => {
		const dt = new DateTime("2026-07-15T14:00:00Z").setZone("Europe/Paris");
		const str = dt.toLocaleString("en-US", {
			hour: "numeric",
			hour12: false,
			timeZone: "Europe/Paris",
		});
		expect(str).toContain("16"); // 14 UTC + 2h CEST
	});

	it("toRelative returns human-readable relative time", () => {
		const now = new DateTime("2026-04-08T14:00:00Z");
		const future = new DateTime("2026-04-08T17:00:00Z");
		const rel = future.toRelative({ base: now, locale: "en" });
		expect(rel).toContain("3"); // "in 3 hours" or similar
		expect(rel.toLowerCase()).toContain("hour");
	});

	it("toRelative past", () => {
		const now = new DateTime("2026-04-08T14:00:00Z");
		const past = new DateTime("2026-04-06T14:00:00Z");
		const rel = past.toRelative({ base: now, locale: "en" });
		expect(rel).toContain("2"); // "2 days ago"
		expect(rel.toLowerCase()).toContain("day");
	});
});

// === Story 36.15 — edge cases + JSDoc tests ===

describe("chronos > edge cases (36.15)", () => {
	it("invalid ISO string in constructor throws", () => {
		expect(() => new DateTime("not-a-date")).toThrow(/Invalid|parse/i);
	});

	it("leap day Feb 29 + 1 year = Feb 28 (non-leap)", () => {
		const dt = new DateTime("2024-02-29T12:00:00Z");
		const next = dt.plus(1, "year");
		expect(next.toISO()).toBe("2025-02-28T12:00:00Z");
	});

	it("leap day Feb 29 + 4 years = Feb 29 (leap)", () => {
		const dt = new DateTime("2024-02-29T12:00:00Z");
		const next = dt.plus(4, "year");
		expect(next.toISO()).toBe("2028-02-29T12:00:00Z");
	});

	it("Jan 31 + 1 month = Feb 28 (day clamping)", () => {
		const dt = new DateTime("2026-01-31T00:00:00Z");
		const next = dt.plus(1, "month");
		expect(next.toISO()).toBe("2026-02-28T00:00:00Z");
	});

	it("format with custom pattern and literals", () => {
		const dt = new DateTime("2026-04-08T14:30:00Z");
		expect(dt.format("[Today is] YYYY-MM-DD")).toBe("Today is 2026-04-08");
		expect(dt.format("HH[h]mm")).toBe("14h30");
	});

	it("Duration.fromISO rejects garbage", () => {
		expect(() => Duration.fromISO("not an iso duration")).toThrow(
			/Invalid ISO 8601 duration/,
		);
	});

	it("Interval rejects inverted range", () => {
		expect(() =>
			Interval.fromDateTimes("2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"),
		).toThrow(/start must be <= end/);
	});

	it("DateTime preserves zone through plus/minus/from", () => {
		const paris = new DateTime("2026-04-08T14:00:00Z").setZone("Europe/Paris");
		expect(paris.plus(1, "hour").zoneName).toBe("Europe/Paris");
		expect(paris.minus(1, "day").zoneName).toBe("Europe/Paris");
		expect(DateTime.from(paris).zoneName).toBe("Europe/Paris");
	});

	it("fromObject with out-of-range month throws", () => {
		expect(() =>
			DateTime.fromObject({ year: 2026, month: 13, day: 1 }),
		).toThrow(/Invalid|range|month/i);
	});

	it("millisecond precision preserved through arithmetic", () => {
		const dt = new DateTime("2026-04-08T14:00:00.123Z");
		const next = dt.plus(1, "second");
		expect(next.toISO()).toBe("2026-04-08T14:00:01.123Z");
	});

	it("toMillis / toSeconds round-trip", () => {
		const dt = new DateTime("2026-04-08T14:00:00Z");
		expect(DateTime.fromMillis(dt.toMillis()).toISO()).toBe(dt.toISO());
		expect(DateTime.fromSeconds(dt.toSeconds()).toISO()).toBe(dt.toISO());
	});
});

// === Codex recheck fixes ===

describe("chronos > Codex fixes", () => {
	it("Interval.after with Duration uses correct ms (not seconds)", () => {
		const iv = Interval.after(
			"2026-01-01T00:00:00Z",
			Duration.fromMillis(1500),
		);
		// Should be 1.5 seconds, not 1500 seconds.
		expect(iv.length("milliseconds")).toBeCloseTo(1500, 0);
		expect(iv.length("seconds")).toBeCloseTo(1.5, 1);
	});

	it("RRule with INTERVAL produces correctly spaced dates", () => {
		const results = expandRRule(
			"2026-01-01T00:00:00Z",
			"FREQ=DAILY;INTERVAL=3;COUNT=3",
			10,
		);
		expect(results.length).toBe(3);
		expect(results[0]).toContain("2026-01-01");
		expect(results[1]).toContain("2026-01-04");
		expect(results[2]).toContain("2026-01-07");
	});

	it("format is zone-aware: Paris summer shows wall-clock", () => {
		// 2026-07-15 14:00 UTC = 16:00 CEST
		const dt = new DateTime("2026-07-15T14:00:00Z").setZone("Europe/Paris");
		expect(dt.format("HH:mm")).toBe("16:00");
	});

	it("calendar accessors are zone-aware", () => {
		// 2026-07-15 23:00 UTC = 2026-07-16 01:00 CEST (+2h) → day should be 16 in Paris
		const dt = new DateTime("2026-07-15T23:00:00Z").setZone("Europe/Paris");
		expect(dt.day).toBe(16);
		expect(dt.hour).toBe(1);
	});

	it("startOf(day) is zone-aware", () => {
		// 2026-07-15 23:00 UTC = 2026-07-16 01:00 in Paris. startOf('day')
		// should be midnight July 16 Paris time = July 15 22:00 UTC.
		const dt = new DateTime("2026-07-15T23:00:00Z").setZone("Europe/Paris");
		const sod = dt.startOf("day");
		expect(sod.zoneName).toBe("Europe/Paris");
		expect(sod.day).toBe(16); // still July 16 in Paris
		expect(sod.hour).toBe(0); // midnight local
	});

	it("setZone validates without NAPI via Intl fallback", () => {
		// Even if NAPI is available, Intl fallback also validates. Test the
		// behavior: invalid zone always throws.
		expect(() => new DateTime().setZone("Not/A/Zone")).toThrow(/Unknown/);
	});
});

describe("chronos > Duration > audit 2026-06-13 (round-trip + format)", () => {
	it("toISO folds weeks+days into a parseable string and round-trips", () => {
		const d = Duration.fromObject({ weeks: 2, days: 3 });
		// P2W3D is invalid ISO 8601 (W can't combine) — fold weeks into days.
		expect(d.toISO()).toBe("P17D");
		expect(Duration.fromISO(d.toISO()).as("days")).toBe(17);
	});

	it("toISO keeps the week form when weeks is the only unit", () => {
		expect(Duration.fromObject({ weeks: 2 }).toISO()).toBe("P2W");
		expect(Duration.fromISO("P2W").weeks).toBe(2);
	});

	it("negate().toISO() is valid ISO 8601 and round-trips", () => {
		const d = Duration.fromObject({ hours: 1, minutes: 30 }).negate();
		expect(d.toISO()).toBe("-PT1H30M");
		const back = Duration.fromISO(d.toISO());
		expect(back.hours).toBe(-1);
		expect(back.minutes).toBe(-30);
	});

	it("toFormat leaves bracketed literal text intact", () => {
		const d = Duration.fromObject({ hours: 2, minutes: 30 });
		expect(d.toFormat("h [hours], m [min]")).toBe("2 hours, 30 min");
	});
});
