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
 * Refuse a calendar date that does not exist, instead of sliding to the next
 * one that does.
 *
 * `new Date('2026-02-30')` answers 2026-03-02: the overflow semantics are right
 * for arithmetic — adding a month to January 31st has to land somewhere — and
 * wrong for reading input, where the same slide turns a typo into a fact. The
 * inconsistency was the dangerous part: '2026-13-45' threw while '2026-02-30'
 * came back as a date, so a caller wrapping this in try/catch had covered the
 * loud half and left the half that writes something false to the database.
 *
 * `fromObject` has always refused the same input; this is that check on the
 * door that was missing it. Only the written date is examined, never the
 * instant it resolves to, so an offset that legitimately moves the UTC day
 * ('2026-08-10T23:00:00-05:00' → the 11th) is untouched.
 */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?=$|[T ])/;

function assertCalendarDateExists(raw: string): void {
	const match = CALENDAR_DATE.exec(raw);
	// Anything else — RFC 2822, a bare year, a basic-format string — is left to
	// `Date`, which already refuses what it cannot read.
	if (!match) return;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12) {
		throw new Error(`Invalid date '${raw}': there is no month ${month}.`);
	}
	const lastDay = daysInMonthOf(year, month);
	if (day < 1 || day > lastDay) {
		throw new Error(
			`Invalid date '${raw}': ${MONTH_NAMES[month - 1]} ${year} has ${lastDay} days, so there is no day ${day}.`,
		);
	}
}

function toIso(value: DateInput): string {
	if (value instanceof DateTime) return value.toISO();
	if (value instanceof Date) return normalizeIso(value.toISOString());
	if (typeof value === "string") assertCalendarDateExists(value);
	return normalizeIso(new Date(value).toISOString());
}

function toMs(value: DateInput): number {
	return new Date(toIso(value)).getTime();
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

// ─── DateTime class ──────────────────────────────────────────

export class DateTime {
	#iso: string;
	#zone: string;

	constructor(input: string | Date = new Date(), zone = "UTC") {
		this.#iso = toIso(input);
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
	static fromObject(obj: {
		year: number;
		month: number;
		day: number;
		hour?: number;
		minute?: number;
		second?: number;
		ms?: number;
	}): DateTime {
		if (obj.month < 1 || obj.month > 12)
			throw new Error(`Invalid month: ${obj.month}`);
		if (obj.day < 1 || obj.day > 31) throw new Error(`Invalid day: ${obj.day}`);
		const d = new Date(
			Date.UTC(
				obj.year,
				obj.month - 1,
				obj.day,
				obj.hour ?? 0,
				obj.minute ?? 0,
				obj.second ?? 0,
				obj.ms ?? 0,
			),
		);
		if (d.getUTCMonth() !== obj.month - 1 || d.getUTCDate() !== obj.day) {
			throw new Error(`Invalid date object: ${JSON.stringify(obj)}`);
		}
		return new DateTime(d);
	}
	static fromRFC2822(input: string): DateTime {
		return new DateTime(nativeChronos().parseRfc2822(input));
	}
	static fromSQL(input: string): DateTime {
		return new DateTime(nativeChronos().parseSql(input));
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
		nativeChronos().validateTimezone(zone);
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

	plus(amount: number, unit: DateUnit): DateTime {
		const n = nativeChronos();
		const out =
			this.#zone !== "UTC" && isCalendarUnit(unit)
				? n.addInZone(this.#iso, amount, unit, this.#zone)
				: n.add(this.#iso, amount, unit);
		return new DateTime(out, this.#zone);
	}
	minus(amount: number, unit: DateUnit): DateTime {
		return this.plus(-amount, unit);
	}

	diff(other: DateInput, unit: DateUnit): number {
		const n = nativeChronos();
		const otherIso = toIso(other);
		return this.#zone !== "UTC" && (unit === "month" || unit === "year")
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
		return new Intl.DateTimeFormat(locale, {
			...(this.#zone !== "UTC" ? { timeZone: this.#zone } : {}),
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
		return new Intl.RelativeTimeFormat(options?.locale as string | undefined, {
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
		return nativeChronos().calendarParts(this.#iso) as CalendarParts;
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
