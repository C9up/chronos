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
import { Duration, type DurationUnit } from "./Duration.js";

export class Interval {
	readonly #start: DateTime;
	readonly #end: DateTime;

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

	/** Build from a start + duration forward. */
	static after(
		start: DateInput,
		duration: Duration | { amount: number; unit: DateUnit },
	): Interval {
		const s = DateTime.from(start);
		// For Duration objects, convert to total milliseconds and add as ms —
		// NOT as seconds (which was the original bug: Duration.fromMillis(1500)
		// was being treated as 1500 seconds instead of 1.5 seconds).
		const e =
			"amount" in duration
				? s.plus(duration.amount, duration.unit as DateUnit)
				: DateTime.fromMillis(
						s.toMillis() + Math.round(duration.as("milliseconds")),
					);
		return new Interval(s, e);
	}

	// ─── Accessors ──────────────────────────────────────────

	get start(): DateTime {
		return this.#start;
	}
	get end(): DateTime {
		return this.#end;
	}

	/** Length in the given unit (approximate for calendar units). */
	length(unit: DurationUnit = "milliseconds"): number {
		const ms = this.#end.toMillis() - this.#start.toMillis();
		const MS_PER: Record<string, number> = {
			years: 365.25 * 86400000,
			months: 30 * 86400000,
			weeks: 7 * 86400000,
			days: 86400000,
			hours: 3600000,
			minutes: 60000,
			seconds: 1000,
			milliseconds: 1,
		};
		return ms / (MS_PER[unit] ?? 1);
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
		const s = Math.max(this.#start.toMillis(), other.#start.toMillis());
		const e = Math.min(this.#end.toMillis(), other.#end.toMillis());
		if (s >= e) return null;
		return Interval.fromDateTimes(
			DateTime.fromMillis(s),
			DateTime.fromMillis(e),
		);
	}

	/** The smallest interval that covers both, or `null` if they don't overlap or abut. */
	union(other: Interval): Interval | null {
		if (
			!this.overlaps(other) &&
			!this.abutsStart(other) &&
			!this.abutsEnd(other)
		) {
			return null;
		}
		return Interval.fromDateTimes(
			DateTime.fromMillis(
				Math.min(this.#start.toMillis(), other.#start.toMillis()),
			),
			DateTime.fromMillis(
				Math.max(this.#end.toMillis(), other.#end.toMillis()),
			),
		);
	}

	// ─── Split ──────────────────────────────────────────────

	/** Split this interval into N sub-intervals of roughly equal `duration` length. */
	splitBy(duration: Duration | { amount: number; unit: DateUnit }): Interval[] {
		const unitMs: Record<string, number> = {
			year: 365.25 * 86400000,
			month: 30 * 86400000,
			week: 7 * 86400000,
			day: 86400000,
			hour: 3600000,
			minute: 60000,
			second: 1000,
		};
		const stepMs =
			"amount" in duration
				? duration.amount * (unitMs[duration.unit] ?? 1)
				: duration.as("milliseconds");
		if (stepMs <= 0) throw new Error("splitBy duration must be positive");

		const result: Interval[] = [];
		let cursor = this.#start.toMillis();
		const endMs = this.#end.toMillis();
		while (cursor < endMs) {
			const next = Math.min(cursor + stepMs, endMs);
			result.push(
				Interval.fromDateTimes(
					DateTime.fromMillis(cursor),
					DateTime.fromMillis(next),
				),
			);
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
