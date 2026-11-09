/**
 * DateTime — immutable UTC datetime value object for the Ream framework.
 *
 * **All operations route through the Rust `chronos-engine` via NAPI.** There
 * is no TS fallback — timezone math, DST transitions, and RFC 5545 recurrence
 * are too complex to maintain a correct TS mirror. If the NAPI binary is
 * missing, every method throws immediately with a clear "build the engine"
 * message. This is the same contract as Atlas (SQL compilation requires the
 * Rust atlas-query binary).
 *
 * @implements Epic 36 — Chronos
 */
import { nativeChronos } from "./native.js";
import { normalizeIso } from "./utils.js";

export type DateUnit =
	| "second"
	| "minute"
	| "hour"
	| "day"
	| "week"
	| "month"
	| "year";
export type BoundUnit =
	| "second"
	| "minute"
	| "hour"
	| "day"
	| "week"
	| "month"
	| "year";
export type DateInput = string | Date | DateTime;
export interface DateRange {
	start: DateInput;
	end: DateInput;
}
export interface RangeCompareOptions {
	inclusiveStart?: boolean;
	inclusiveEnd?: boolean;
}
export interface RangeRelation {
	overlaps: boolean;
	aContainsB: boolean;
	bContainsA: boolean;
	aStartInB: boolean;
	aEndInB: boolean;
	bStartInA: boolean;
	bEndInA: boolean;
}
export interface CalendarParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
	weekday: number;
	weekNumber: number;
	weekYear: number;
	ordinal: number;
	quarter: number;
	daysInMonth: number;
	daysInYear: number;
	isLeapYear: boolean;
}

// ─── Internal helpers ────────────────────────────────────────

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function isLeapYearOf(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysPerMonthOf(year: number): number[] {
	return [
		31,
		isLeapYearOf(year) ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	];
}

function daysInMonthOf(year: number, month: number): number {
	// Callers pass a validated 1-12 month, so the lookup lands; the fallback is
	// where that is stated instead of asserted past.
	return daysPerMonthOf(year)[month - 1] ?? 31;
}

/**
 * The only strings a `DateTime` reads: ISO 8601 calendar dates, optionally with
 * a time (`T` or, as SQL writes it, a space) and an offset (`Z`, `±HH`,
 * `±HHMM`, `±HH:MM`). Anything else is refused: V8's fallback parser turns
 * `"1"` or `"foo 2026"` into a date, and reads an offset-less time in the
 * HOST zone, so the same text named a different instant on every machine.
 */
const ISO_8601 =
	/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:\s?([Zz])|\s?([+-])(\d{2})(?::?(\d{2}))?)?)?$/;

/** First and last instants a value may hold: what a four-digit ISO year writes. */
const MIN_MS = -62_167_219_200_000; // 0000-01-01T00:00:00.000Z
const MAX_MS = 253_402_300_799_999; // 9999-12-31T23:59:59.999Z

interface WallClock {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
}

/**
 * Refuse a wall-clock value that does not exist, instead of sliding to the
 * next one that does.
 *
 * `new Date('2026-02-30')` answers 2026-03-02 and `Date.UTC(…, 10, 90)` reads
 * minute 90 as 11:30: the overflow semantics are right for arithmetic — adding
 * a month to January 31st has to land somewhere — and wrong for reading input,
 * where the same slide turns a typo into a fact. Only the written value is
 * examined, never the instant it resolves to, so an offset that legitimately
 * moves the UTC day ('2026-08-10T23:00:00-05:00' → the 11th) is untouched.
 */
function assertWallClock(c: WallClock, raw: string): void {
	const integer = (unit: string, value: number, min: number, max: number) => {
		if (!Number.isInteger(value) || value < min || value > max) {
			throw new RangeError(
				`Invalid date '${raw}': ${unit} ${String(value)} is out of range (${min}-${max}).`,
			);
		}
	};
	integer("year", c.year, 0, 9999);
	if (!Number.isInteger(c.month) || c.month < 1 || c.month > 12) {
		throw new RangeError(
			`Invalid date '${raw}': there is no month ${String(c.month)}.`,
		);
	}
	const lastDay = daysInMonthOf(c.year, c.month);
	if (!Number.isInteger(c.day) || c.day < 1 || c.day > lastDay) {
		throw new RangeError(
			`Invalid date '${raw}': ${MONTH_NAMES[c.month - 1]} ${c.year} has ${lastDay} days, so there is no day ${String(c.day)}.`,
		);
	}
	integer("hour", c.hour, 0, 23);
	integer("minute", c.minute, 0, 59);
	integer("second", c.second, 0, 59);
	integer("millisecond", c.millisecond, 0, 999);
}

/** Epoch milliseconds of a UTC wall clock; years 0-99 stay literal (Date.UTC maps them to 19xx). */
function utcMs(c: WallClock): number {
	const d = new Date(0);
	d.setUTCFullYear(c.year, c.month - 1, c.day);
	d.setUTCHours(c.hour, c.minute, c.second, c.millisecond);
	return d.getTime();
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Epoch milliseconds of a wall clock read in `zone`. */
function wallClockMs(c: WallClock, zone: string): number {
	if (zone === "UTC") return utcMs(c);
	const naive = `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;
	return Date.parse(nativeChronos().fromLocal(naive, zone)) + c.millisecond;
}

/** The canonical UTC ISO string of an instant, refusing what chronos cannot hold. */
function isoOfMs(ms: number, input: () => string): string {
	if (!Number.isFinite(ms)) throw new RangeError(`Invalid date ${input()}`);
	if (ms < MIN_MS || ms > MAX_MS) {
		throw new RangeError(
			`Date ${input()} is out of range: years are limited to 0000-9999.`,
		);
	}
	return new Date(ms).toISOString();
}

/** Read an ISO 8601 string; an offset-less one is a wall clock in `zone`. */
function parseIso(raw: string, zone: string): string {
	const m = ISO_8601.exec(raw);
	if (!m) {
		throw new RangeError(
			`Invalid date '${raw}': expected ISO 8601 (YYYY-MM-DD, optionally with THH:mm[:ss[.SSS]] and an offset).`,
		);
	}
	const c: WallClock = {
		year: Number(m[1]),
		month: Number(m[2]),
		day: Number(m[3]),
		hour: Number(m[4] ?? 0),
		minute: Number(m[5] ?? 0),
		second: Number(m[6] ?? 0),
		millisecond: Math.floor(Number(`0.${m[7] ?? "0"}`) * 1000),
	};
	assertWallClock(c, raw);
	let ms: number;
	if (m[8] !== undefined) {
		ms = utcMs(c);
	} else if (m[9] !== undefined) {
		const hours = Number(m[10]);
		const minutes = Number(m[11] ?? 0);
		if (hours > 23 || minutes > 59) {
			throw new RangeError(
				`Invalid date '${raw}': the offset is out of range.`,
			);
		}
		const sign = m[9] === "-" ? -1 : 1;
		ms = utcMs(c) - sign * (hours * 60 + minutes) * 60_000;
	} else {
		ms = wallClockMs(c, zone);
	}
	return isoOfMs(ms, () => `'${raw}'`);
}

function toIso(value: DateInput, zone = "UTC"): string {
	if (value instanceof DateTime) return value.toISO();
	if (value instanceof Date) {
		return normalizeIso(isoOfMs(value.getTime(), () => "(JS Date)"));
	}
	if (typeof value !== "string") {
		throw new TypeError(
			`Invalid date input: expected a string, a Date or a DateTime, got ${typeof value}`,
		);
	}
	return normalizeIso(parseIso(value, zone));
}

function toMs(value: DateInput): number {
	return new Date(toIso(value)).getTime();
}

const CASUAL_UNIT_MS: Readonly<Record<string, number>> = {
	second: 1_000,
	minute: 60_000,
	hour: 3_600_000,
	day: 86_400_000,
	week: 604_800_000,
	month: 30 * 86_400_000,
	year: 365 * 86_400_000,
};

/** Milliseconds in one unit on Luxon's casual matrix; throws on an unknown unit. */
function casualUnitMs(unit: string): number {
	const singular = unit.endsWith("s") ? unit.slice(0, -1) : unit;
	const ms = Object.hasOwn(CASUAL_UNIT_MS, singular)
		? CASUAL_UNIT_MS[singular]
		: undefined;
	if (ms === undefined) throw new Error(`Unsupported unit: ${unit}`);
	return ms;
}

function isCalendarUnit(unit: DateUnit): boolean {
	return (
		unit === "day" || unit === "week" || unit === "month" || unit === "year"
	);
}

/**
 * Format from a pre-composed ISO string by extracting components directly
 * from the string (no `new Date()` which normalizes to UTC).
 */
function formatFromIsoString(iso: string, pattern: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(iso);
	if (!match) throw new Error(`Cannot parse ISO for format: ${iso}`);
	// Every group in the pattern is required, so a match carries all six.
	const [, y, mo, d, h, mi, s] = match;
	if (
		y === undefined ||
		mo === undefined ||
		d === undefined ||
		h === undefined ||
		mi === undefined ||
		s === undefined
	) {
		throw new Error(`Cannot parse ISO for format: ${iso}`);
	}
	const tokens: Record<string, string> = {
		YYYY: y,
		YY: y.slice(-2),
		MM: mo,
		DD: d,
		HH: h,
		mm: mi,
		ss: s,
		Z: iso.slice(-6),
	};
	let out = "";
	let i = 0;
	while (i < pattern.length) {
		if (pattern[i] === "[") {
			i++;
			while (i < pattern.length && pattern[i] !== "]") {
				out += pattern[i];
				i++;
			}
			if (i < pattern.length) i++;
			continue;
		}
		let matched = false;
		for (const key of ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss", "Z"]) {
			if (pattern.startsWith(key, i)) {
				out += tokens[key];
				i += key.length;
				matched = true;
				break;
			}
		}
		if (!matched) {
			out += pattern[i];
			i++;
		}
	}
	return out;
}

function calendarPartsFromIso(iso: string): CalendarParts {
	// Parse from ISO string directly — handles both UTC and zoned strings.
	const isoMatch =
		/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(iso);
	if (!isoMatch) throw new Error(`Cannot parse ISO for calendar: ${iso}`);
	const year = Number(isoMatch[1]);
	const month = Number(isoMatch[2]);
	const day = Number(isoMatch[3]);
	const hour = Number(isoMatch[4]);
	const minute = Number(isoMatch[5]);
	const second = Number(isoMatch[6]);
	const millisecond =
		isoMatch[7] != null ? Math.round(Number(`0.${isoMatch[7]}`) * 1000) : 0;
	const isLeapYear = isLeapYearOf(year);
	const daysPerMonth = daysPerMonthOf(year);
	const daysInMonth = daysPerMonth[month - 1] ?? 31;
	const daysInYear = isLeapYear ? 366 : 365;
	let ordinal = day;
	for (const days of daysPerMonth.slice(0, month - 1)) ordinal += days;
	const localDate = new Date(Date.UTC(year, month - 1, day));
	const weekday = localDate.getUTCDay() || 7;
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const startOfIsoYear = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000);
	const weekMs = localDate.getTime() - startOfIsoYear.getTime();
	let weekNumber = Math.floor(weekMs / 604_800_000) + 1;
	let weekYear = year;
	const isoWeeksInYear = (y: number): number => {
		const j1 = new Date(Date.UTC(y, 0, 1)).getUTCDay();
		const d31 = new Date(Date.UTC(y, 11, 31)).getUTCDay();
		return j1 === 4 || d31 === 4 ? 53 : 52;
	};
	if (weekNumber < 1) {
		weekYear--;
		weekNumber = isoWeeksInYear(weekYear);
	} else if (weekNumber > isoWeeksInYear(year)) {
		weekYear++;
		weekNumber = 1;
	}
	return {
		year,
		month,
		day,
		hour,
		minute,
		second,
		millisecond,
		weekday,
		weekNumber,
		weekYear,
		ordinal,
		quarter: Math.ceil(month / 3),
		daysInMonth,
		daysInYear,
		isLeapYear,
	};
}

// ─── Range helpers (no NAPI needed — pure ms comparison) ─────

function normalizeRange(range: DateRange): { start: number; end: number } {
	const start = toMs(range.start);
	const end = toMs(range.end);
	if (Number.isNaN(start) || Number.isNaN(end))
		throw new Error("Invalid date range");
	if (start > end) throw new Error("Invalid date range: start must be <= end");
	return { start, end };
}
function rangeContains(
	outer: DateRange,
	inner: DateRange,
	opt: RangeCompareOptions = {},
): boolean {
	const o = normalizeRange(outer);
	const i = normalizeRange(inner);
	return (
		((opt.inclusiveStart ?? true) ? i.start >= o.start : i.start > o.start) &&
		((opt.inclusiveEnd ?? true) ? i.end <= o.end : i.end < o.end)
	);
}
function pointInRange(
	point: number,
	range: { start: number; end: number },
	opt: RangeCompareOptions,
): boolean {
	return (
		((opt.inclusiveStart ?? true)
			? point >= range.start
			: point > range.start) &&
		((opt.inclusiveEnd ?? true) ? point <= range.end : point < range.end)
	);
}
function rangesOverlap(
	a: DateRange,
	b: DateRange,
	opt: RangeCompareOptions = {},
): boolean {
	const na = normalizeRange(a);
	const nb = normalizeRange(b);
	// Two ranges that merely touch share exactly one instant: the later one's
	// start and the earlier one's end. It belongs to both only when BOTH bounds
	// are closed — with `||`, `[a,b)` and `[b,c)` were called overlapping even
	// though b is in neither the first range nor... it is in the second's start
	// only. An `&&` is what "the touching point is in both" means.
	const inc = (opt.inclusiveStart ?? true) && (opt.inclusiveEnd ?? true);
	return inc
		? Math.max(na.start, nb.start) <= Math.min(na.end, nb.end)
		: Math.max(na.start, nb.start) < Math.min(na.end, nb.end);
}

// ─── Zone validation ─────────────────────────────────────────

/**
 * Zones the engine has already accepted, exactly as it names them.
 *
 * Every derived value (`plus`, `startOf`, …) is built through the constructor
 * with the zone of the value it came from, so without this each one would pay
 * a native call to re-validate a zone that was checked on the way in. Only a
 * name equal to the engine's canonical spelling is remembered: the set is then
 * bounded by the tz database, whatever spellings a caller sends.
 */
const acceptedZones = new Set<string>(["UTC"]);

/**
 * Throw on a zone the tz database does not know — the one check behind every
 * entry that takes a zone (`new DateTime(input, zone)`, `DateTime.now(zone)`,
 * `setZone`), so all three refuse the same names with the same message.
 */
function assertZone(zone: string): void {
	if (acceptedZones.has(zone)) return;
	const canonical = nativeChronos().validateTimezone(zone);
	if (canonical === zone) acceptedZones.add(zone);
}

// ─── DateTime class ──────────────────────────────────────────

export class DateTime {
	#iso: string;
	#zone: string;

	/**
	 * @throws on a zone the tz database does not know. An unknown zone used to
	 * be stored as given and break later, on the first offset or format.
	 */
	constructor(input: string | Date = new Date(), zone = "UTC") {
		assertZone(zone);
		this.#iso = toIso(input, zone);
		this.#zone = zone;
	}

	static from(input: DateInput): DateTime {
		if (input instanceof DateTime) return new DateTime(input.#iso, input.#zone);
		return new DateTime(toIso(input));
	}
	static now(zone?: string): DateTime {
		return new DateTime(new Date(), zone ?? "UTC");
	}
	static fromMillis(ms: number): DateTime {
		if (typeof ms !== "number") {
			throw new TypeError(`fromMillis expects a number, got ${typeof ms}`);
		}
		return new DateTime(new Date(ms));
	}
	static fromSeconds(seconds: number): DateTime {
		return new DateTime(new Date(seconds * 1000));
	}
	static fromUnix(seconds: number): DateTime {
		return DateTime.fromSeconds(seconds);
	}
	static fromJSDate(date: Date): DateTime {
		if (!Number.isFinite(date.getTime())) throw new Error("Invalid Date");
		return new DateTime(date);
	}
	/**
	 * Read an ISO 8601 string. An offset-less one is a wall clock in
	 * `options.zone` (UTC by default), and the result is in that zone.
	 */
	static fromISO(text: string, options: { zone?: string } = {}): DateTime {
		return new DateTime(text, options.zone ?? "UTC");
	}

	/**
	 * Build from calendar fields, read as a wall clock in `options.zone` (UTC by
	 * default). Every field is checked: an integer within its range (minute
	 * 0-59, …), and a year read literally (50 is year 0050, not 1950).
	 */
	static fromObject(
		obj: {
			year: number;
			month: number;
			day: number;
			hour?: number;
			minute?: number;
			second?: number;
			millisecond?: number;
			/** @deprecated spelled `millisecond`, as Luxon does. */
			ms?: number;
		},
		options: { zone?: string } = {},
	): DateTime {
		const zone = options.zone ?? "UTC";
		assertZone(zone);
		const c: WallClock = {
			year: obj.year,
			month: obj.month,
			day: obj.day,
			hour: obj.hour ?? 0,
			minute: obj.minute ?? 0,
			second: obj.second ?? 0,
			millisecond: obj.millisecond ?? obj.ms ?? 0,
		};
		assertWallClock(c, JSON.stringify(obj));
		return new DateTime(
			isoOfMs(wallClockMs(c, zone), () => JSON.stringify(obj)),
			zone,
		);
	}
	static fromRFC2822(input: string): DateTime {
		return new DateTime(nativeChronos().parseRfc2822(input));
	}
	/**
	 * Read a SQL literal: `YYYY-MM-DD`, or `YYYY-MM-DD HH:mm[:ss[.fff]]` with an
	 * optional offset (`+00`, `+02:00` — PostgreSQL's `timestamptz` text) or
	 * IANA zone. Without one, the value is a wall clock in `options.zone` (UTC
	 * by default), and the result is in that zone.
	 */
	static fromSQL(input: string, options: { zone?: string } = {}): DateTime {
		const zone = options.zone ?? "UTC";
		assertZone(zone);
		return new DateTime(
			nativeChronos().parseSql(input, zone === "UTC" ? undefined : zone),
			zone,
		);
	}
	static fromHTTP(input: string): DateTime {
		return new DateTime(nativeChronos().parseHttp(input));
	}

	// ─── Timezone ───────────────────────────────────────────

	get zoneName(): string {
		return this.#zone;
	}
	get offset(): number {
		if (this.#zone === "UTC") return 0;
		return nativeChronos().zoneOffset(this.#iso, this.#zone);
	}

	setZone(zone: string): DateTime {
		return new DateTime(this.#iso, zone);
	}
	toUTC(): DateTime {
		return new DateTime(this.#iso, "UTC");
	}

	toZonedISO(): string {
		if (this.#zone === "UTC") return this.#iso;
		return nativeChronos().toZone(this.#iso, this.#zone).iso;
	}

	// ─── Arithmetic ─────────────────────────────────────────

	/**
	 * Move by `amount` units. The whole part moves on the calendar (in the
	 * value's zone for day/week/month/year); a fraction is carried as elapsed
	 * time at Luxon's casual lengths (day 24 h, month 30 days, year 365 days),
	 * so `plus(1.5, "day")` is one calendar day and twelve hours.
	 *
	 * @throws RangeError on a non-finite amount (NaN, ±Infinity, a non-number),
	 * which the native boundary would otherwise read as 0, and on a result
	 * outside years 0000-9999.
	 */
	plus(amount: number, unit: DateUnit): DateTime {
		if (typeof amount !== "number" || !Number.isFinite(amount)) {
			throw new RangeError(
				`Invalid unit value ${String(amount)}: plus/minus take a finite number`,
			);
		}
		const unitMs = casualUnitMs(unit);
		const whole = Math.trunc(amount);
		if (!Number.isSafeInteger(whole)) {
			throw new RangeError(
				`plus(${amount}, '${unit}') is out of range: years are limited to 0000-9999`,
			);
		}
		const n = nativeChronos();
		const shifted =
			whole === 0
				? this.#iso
				: this.#zone !== "UTC" && isCalendarUnit(unit)
					? n.addInZone(this.#iso, whole, unit, this.#zone)
					: n.add(this.#iso, whole, unit);
		const fraction = amount - whole;
		if (fraction === 0) return new DateTime(shifted, this.#zone);
		return new DateTime(
			new Date(Date.parse(shifted) + Math.round(fraction * unitMs)),
			this.#zone,
		);
	}
	minus(amount: number, unit: DateUnit): DateTime {
		return this.plus(-amount, unit);
	}

	diff(other: DateInput, unit: DateUnit): number {
		const n = nativeChronos();
		const otherIso = toIso(other);
		// Calendar units count on the value's calendar: across a DST change a
		// day is still one day, as plus(1, "day") made it.
		return this.#zone !== "UTC" && isCalendarUnit(unit)
			? n.diffInZone(this.#iso, otherIso, unit, this.#zone)
			: n.diff(this.#iso, otherIso, unit);
	}

	// ─── Comparison ─────────────────────────────────────────

	equals(other: DateInput): boolean {
		return this.#iso === toIso(other);
	}
	isBefore(other: DateInput): boolean {
		return toMs(this) < toMs(other);
	}
	isAfter(other: DateInput): boolean {
		return toMs(this) > toMs(other);
	}
	hasSame(other: DateInput, unit: BoundUnit): boolean {
		return (
			this.startOf(unit).toISO() === DateTime.from(other).startOf(unit).toISO()
		);
	}
	isSameDay(other: DateInput): boolean {
		return this.hasSame(other, "day");
	}

	// ─── Boundaries ─────────────────────────────────────────

	/**
	 * Truncate to the start of `unit`.
	 *
	 * Both the UTC and the zoned path go through the SAME Rust routine. The
	 * zoned one used to be a hand-written switch here, and the two drifted:
	 * `second` was added to one and not the other, so the same call answered
	 * differently depending on the zone.
	 */
	startOf(unit: BoundUnit): DateTime {
		const n = nativeChronos();
		return new DateTime(
			this.#zone === "UTC"
				? n.startOf(this.#iso, unit)
				: n.startOfInZone(this.#iso, unit, this.#zone),
			this.#zone,
		);
	}

	/** The last instant of `unit` — see {@link startOf} on the shared routine. */
	endOf(unit: BoundUnit): DateTime {
		const n = nativeChronos();
		return new DateTime(
			this.#zone === "UTC"
				? n.endOf(this.#iso, unit)
				: n.endOfInZone(this.#iso, unit, this.#zone),
			this.#zone,
		);
	}

	// ─── Range ──────────────────────────────────────────────

	isWithin(range: DateRange, options: RangeCompareOptions = {}): boolean {
		return rangeContains(range, { start: this.#iso, end: this.#iso }, options);
	}

	// ─── Formatting ─────────────────────────────────────────

	format(pattern = "YYYY-MM-DD HH:mm:ss"): string {
		if (this.#zone !== "UTC") {
			return formatFromIsoString(
				nativeChronos().toZone(this.#iso, this.#zone).iso,
				pattern,
			);
		}
		return nativeChronos().format(this.#iso, pattern);
	}

	toDate(): Date {
		return new Date(this.#iso);
	}
	toISO(): string {
		return this.#iso;
	}
	toString(): string {
		return this.#iso;
	}
	toJSON(): string {
		return this.#iso;
	}
	toMillis(): number {
		return new Date(this.#iso).getTime();
	}
	toSeconds(): number {
		return Math.floor(this.toMillis() / 1000);
	}

	toLocaleString(
		locale?: Intl.LocalesArgument,
		options?: Intl.DateTimeFormatOptions,
	): string {
		// The value's own zone, UTC included: without it Intl falls back to the
		// host's zone and the same value prints differently per machine.
		return new Intl.DateTimeFormat(locale, {
			timeZone: this.#zone,
			...options,
		}).format(this.toDate());
	}

	toRelative(options?: {
		base?: DateInput;
		locale?: Intl.LocalesArgument;
	}): string {
		const base = options?.base ? DateTime.from(options.base) : new DateTime();
		const diffMs = this.toMillis() - base.toMillis();
		const abs = Math.abs(diffMs);
		let unit: Intl.RelativeTimeFormatUnit;
		let value: number;
		if (abs < 60_000) {
			unit = "second";
			value = Math.round(diffMs / 1000);
		} else if (abs < 3_600_000) {
			unit = "minute";
			value = Math.round(diffMs / 60_000);
		} else if (abs < 86_400_000) {
			unit = "hour";
			value = Math.round(diffMs / 3_600_000);
		} else if (abs < 2_592_000_000) {
			unit = "day";
			value = Math.round(diffMs / 86_400_000);
		} else if (abs < 31_536_000_000) {
			unit = "month";
			value = Math.round(diffMs / 2_592_000_000);
		} else {
			unit = "year";
			value = Math.round(diffMs / 31_536_000_000);
		}
		return new Intl.RelativeTimeFormat(options?.locale, {
			numeric: "auto",
		}).format(value, unit);
	}

	// ─── Calendar accessors ─────────────────────────────────

	get calendar(): CalendarParts {
		if (this.#zone !== "UTC") {
			return calendarPartsFromIso(
				nativeChronos().toZone(this.#iso, this.#zone).iso,
			);
		}
		return nativeChronos().calendarParts(this.#iso);
	}
	get weekday(): number {
		return this.calendar.weekday;
	}
	get weekNumber(): number {
		return this.calendar.weekNumber;
	}
	get weekYear(): number {
		return this.calendar.weekYear;
	}
	get ordinal(): number {
		return this.calendar.ordinal;
	}
	get quarter(): number {
		return this.calendar.quarter;
	}
	get daysInMonth(): number {
		return this.calendar.daysInMonth;
	}
	get daysInYear(): number {
		return this.calendar.daysInYear;
	}
	get isInLeapYear(): boolean {
		return this.calendar.isLeapYear;
	}
	get year(): number {
		return this.calendar.year;
	}
	get month(): number {
		return this.calendar.month;
	}
	get day(): number {
		return this.calendar.day;
	}
	get hour(): number {
		return this.calendar.hour;
	}
	get minute(): number {
		return this.calendar.minute;
	}
	get second(): number {
		return this.calendar.second;
	}
	get millisecond(): number {
		return this.calendar.millisecond;
	}
}

// ─── Standalone range helpers ────────────────────────────────

export function inRange(
	input: DateInput,
	range: DateRange,
	options: RangeCompareOptions = {},
): boolean {
	return DateTime.from(input).isWithin(range, options);
}
export function containsRange(
	outer: DateRange,
	inner: DateRange,
	options: RangeCompareOptions = {},
): boolean {
	return rangeContains(outer, inner, options);
}
export function overlapsRange(
	a: DateRange,
	b: DateRange,
	options: RangeCompareOptions = {},
): boolean {
	return rangesOverlap(a, b, options);
}
export function analyzeRange(
	a: DateRange,
	b: DateRange,
	options: RangeCompareOptions = {},
): RangeRelation {
	const na = normalizeRange(a);
	const nb = normalizeRange(b);
	return {
		overlaps: rangesOverlap(a, b, options),
		aContainsB: rangeContains(a, b, options),
		bContainsA: rangeContains(b, a, options),
		aStartInB: pointInRange(na.start, nb, options),
		aEndInB: pointInRange(na.end, nb, options),
		bStartInA: pointInRange(nb.start, na, options),
		bEndInA: pointInRange(nb.end, na, options),
	};
}
