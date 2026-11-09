/**
 * Interval — immutable half-open `[start, end)` time range.
 *
 * Provides set-style operations (`contains`, `overlaps`, `union`,
 * `intersection`, `splitBy`, `splitAt`) that the standalone range helpers
 * in `DateTime.ts` could not express cleanly as methods.
 *
 * @implements Story 36.9
 */
import { type DateInput, DateTime, type DateUnit } from "./DateTime.js";
import {
	Duration,
	type DurationObject,
	type DurationUnit,
} from "./Duration.js";

/**
 * Milliseconds in one unit, refusing a unit it does not know.
 *
 * Singular and plural both resolve, as they do upstream in Luxon: the rest of
 * chronos spells units in the singular (`plus(1, "day")`) while durations
 * spell them in the plural (`{ days: 1 }`), and a reader moving between the
 * two should not have to remember which door they are at.
 *
 * The table used to answer `1` for anything it did not recognise, so
 * `length("day")` returned 345600000 — milliseconds, presented as days — and
 * `splitBy` turned an unknown unit into a one-millisecond step, which on a
 * four-day interval is 345 million sub-intervals. Both were silent. An unknown
 * unit is a mistake in the calling code and says so now.
 */
const MS_PER_UNIT: Record<string, number> = {
	year: 365.25 * 86400000,
	month: 30 * 86400000,
	week: 7 * 86400000,
	day: 86400000,
	hour: 3600000,
	minute: 60000,
	second: 1000,
	millisecond: 1,
};

function msPerUnit(unit: string, caller: string): number {
	// Plural is the durations spelling; singular is the DateTime one.
	const ms = MS_PER_UNIT[unit.endsWith("s") ? unit.slice(0, -1) : unit];
	if (ms === undefined) {
		throw new Error(
			`${caller}: '${unit}' is not a unit. Use one of ${Object.keys(MS_PER_UNIT).join(", ")} (plural accepted).`,
		);
	}
	return ms;
}

/** The `{ amount, unit }` shorthand as a Duration; anything else as given. */
function toDuration(
	duration: Duration | DurationObject | { amount: number; unit: DateUnit },
): Duration {
	if (duration instanceof Duration) return duration;
	if ("amount" in duration && "unit" in duration) {
		return Duration.fromObject({ [`${duration.unit}s`]: duration.amount });
	}
	return Duration.fromObject(duration);
}

export class Interval {
	readonly #start: DateTime;
	readonly #end: DateTime;

	/**
	 * Private because an Interval is only ever built through the named factories, which validate the bounds.
	 *
	 * `private` and not `#`: a private CONSTRUCTOR has no native form. It is the
	 * one place the keyword expresses something `#` cannot.
	 */
	private constructor(start: DateTime, end: DateTime) {
		if (start.isAfter(end)) {
			throw new Error("Interval start must be <= end");
		}
		this.#start = start;
		this.#end = end;
	}

	// ─── Factories ──────────────────────────────────────────

	/** Build from two `DateInput` values. Half-open: `[start, end)`. */
	static fromDateTimes(start: DateInput, end: DateInput): Interval {
		return new Interval(DateTime.from(start), DateTime.from(end));
	}

	/**
	 * Build from a start and a duration forward, as Luxon does: the end is
	 * `start.plus(duration)`, calendar arithmetic in the start's zone — so
	 * January 31st plus one month ends on February 28th, not March 2nd.
	 */
	static after(
		start: DateInput,
		duration: Duration | DurationObject | { amount: number; unit: DateUnit },
	): Interval {
		const s = DateTime.from(start);
		return new Interval(s, s.plus(toDuration(duration)));
	}

	// ─── Accessors ──────────────────────────────────────────

	get start(): DateTime {
		return this.#start;
	}
	get end(): DateTime {
		return this.#end;
	}

	/** Length in the given unit (approximate for calendar units). */
	length(unit: DurationUnit | DateUnit = "milliseconds"): number {
		const ms = this.#end.toMillis() - this.#start.toMillis();
		return ms / msPerUnit(unit, "Interval.length");
	}

	/** Duration object between start and end. */
	toDuration(): Duration {
		return Duration.fromMillis(this.#end.toMillis() - this.#start.toMillis());
	}

	// ─── Containment ────────────────────────────────────────

	/** Does this interval contain the given instant? Half-open: `[start, end)`. */
	contains(dt: DateInput): boolean {
		const t = DateTime.from(dt).toMillis();
		return t >= this.#start.toMillis() && t < this.#end.toMillis();
	}

	/** Is the given instant strictly before this interval? */
	isBefore(dt: DateInput): boolean {
		return DateTime.from(dt).toMillis() >= this.#end.toMillis();
	}

	/** Is the given instant strictly after this interval? */
	isAfter(dt: DateInput): boolean {
		return DateTime.from(dt).toMillis() < this.#start.toMillis();
	}

	/** Is this interval empty (zero length)? */
	isEmpty(): boolean {
		return this.#start.toMillis() === this.#end.toMillis();
	}

	// ─── Set operations ─────────────────────────────────────

	/** Do the two intervals share any time? */
	overlaps(other: Interval): boolean {
		return (
			this.#start.toMillis() < other.#end.toMillis() &&
			other.#start.toMillis() < this.#end.toMillis()
		);
	}

	/** Does this interval fully enclose `other`? */
	engulfs(other: Interval): boolean {
		return (
			this.#start.toMillis() <= other.#start.toMillis() &&
			this.#end.toMillis() >= other.#end.toMillis()
		);
	}

	/** Does `other`'s start touch this interval's end (no overlap, no gap)? */
	abutsStart(other: Interval): boolean {
		return this.#end.toMillis() === other.#start.toMillis();
	}

	/** Does `other`'s end touch this interval's start? */
	abutsEnd(other: Interval): boolean {
		return other.#end.toMillis() === this.#start.toMillis();
	}

	/** The overlapping sub-interval, or `null` if disjoint. */
	intersection(other: Interval): Interval | null {
		const s = this.#start.isBefore(other.#start) ? other.#start : this.#start;
		const e = this.#end.isAfter(other.#end) ? other.#end : this.#end;
		if (!s.isBefore(e)) return null;
		return new Interval(s, e);
	}

	/**
	 * The interval from the earlier start to the later end, gap included, as
	 * Luxon's `union`. Use {@link Interval.merge} to keep disjoint pieces apart.
	 */
	union(other: Interval): Interval {
		return new Interval(
			other.#start.isBefore(this.#start) ? other.#start : this.#start,
			other.#end.isAfter(this.#end) ? other.#end : this.#end,
		);
	}

	/**
	 * The minimal set of intervals covering the same time: overlapping and
	 * abutting intervals are joined, disjoint ones kept, in ascending order.
	 */
	static merge(intervals: readonly Interval[]): Interval[] {
		const sorted = [...intervals].sort(
			(a, b) => a.#start.toMillis() - b.#start.toMillis(),
		);
		const out: Interval[] = [];
		let current: Interval | undefined;
		for (const item of sorted) {
			if (current === undefined) {
				current = item;
			} else if (current.overlaps(item) || current.abutsStart(item)) {
				current = current.union(item);
			} else {
				out.push(current);
				current = item;
			}
		}
		if (current !== undefined) out.push(current);
		return out;
	}

	// ─── Split ──────────────────────────────────────────────

	/**
	 * Split into consecutive pieces of `duration`, the last one shorter if it
	 * does not divide evenly. Each boundary is `start.plus(duration × n)`, as in
	 * Luxon, so months split on month boundaries and days on the zone's days.
	 */
	splitBy(
		duration: Duration | DurationObject | { amount: number; unit: DateUnit },
	): Interval[] {
		if ("unit" in duration && !(duration instanceof Duration)) {
			msPerUnit(duration.unit, "Interval.splitBy");
		}
		const step = toDuration(duration);
		if (step.as("milliseconds") <= 0) {
			throw new Error("splitBy duration must be positive");
		}
		const result: Interval[] = [];
		let cursor = this.#start;
		for (let n = 1; cursor.isBefore(this.#end); n++) {
			const added = this.#start.plus(step.mapUnits((value) => value * n));
			const next = added.isAfter(this.#end) ? this.#end : added;
			result.push(new Interval(cursor, next));
			cursor = next;
		}
		return result;
	}

	/** Split at specific instants. Instants outside the interval are ignored. */
	splitAt(...dts: DateInput[]): Interval[] {
		const points = dts
			.map((d) => DateTime.from(d).toMillis())
			.filter((ms) => ms > this.#start.toMillis() && ms < this.#end.toMillis())
			.sort((a, b) => a - b);

		const result: Interval[] = [];
		let prev = this.#start.toMillis();
		for (const p of points) {
			result.push(
				Interval.fromDateTimes(
					DateTime.fromMillis(prev),
					DateTime.fromMillis(p),
				),
			);
			prev = p;
		}
		result.push(Interval.fromDateTimes(DateTime.fromMillis(prev), this.#end));
		return result;
	}

	// ─── Serialization ──────────────────────────────────────

	toString(): string {
		return `[${this.#start.toISO()}, ${this.#end.toISO()})`;
	}

	toJSON(): { start: string; end: string } {
		return { start: this.#start.toISO(), end: this.#end.toISO() };
	}
}
