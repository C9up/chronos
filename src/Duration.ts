/**
 * Duration — immutable time-span value object for the Ream framework.
 *
 * Represents a length of time as a bag of calendar + clock units. Closely
 * mirrors Luxon's `Duration` API so developers coming from AdonisJS feel at
 * home. Pure TypeScript — no Rust/NAPI dependency (durations are lightweight
 * arithmetic on small integers, not worth an FFI crossing).
 *
 * @implements Story 36.8
 */

export interface DurationObject {
	years?: number;
	months?: number;
	weeks?: number;
	days?: number;
	hours?: number;
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
}

export type DurationUnit = keyof DurationObject;

const ORDERED_UNITS: DurationUnit[] = [
	"years",
	"months",
	"weeks",
	"days",
	"hours",
	"minutes",
	"seconds",
	"milliseconds",
];

/** Millisecond equivalents for clock units. Calendar units (years/months) are
 *  not convertible to a fixed ms count — they depend on the anchor date. When
 *  converting, we use an approximation (30-day month, 365-day year) and
 *  document it. Luxon does the same. */
const MS_PER: Record<DurationUnit, number> = {
	years: 365.25 * 24 * 60 * 60 * 1000,
	months: 30 * 24 * 60 * 60 * 1000,
	weeks: 7 * 24 * 60 * 60 * 1000,
	days: 24 * 60 * 60 * 1000,
	hours: 60 * 60 * 1000,
	minutes: 60 * 1000,
	seconds: 1000,
	milliseconds: 1,
};

export class Duration {
	readonly #values: Readonly<Required<DurationObject>>;

	private constructor(values: DurationObject) {
		this.#values = {
			years: values.years ?? 0,
			months: values.months ?? 0,
			weeks: values.weeks ?? 0,
			days: values.days ?? 0,
			hours: values.hours ?? 0,
			minutes: values.minutes ?? 0,
			seconds: values.seconds ?? 0,
			milliseconds: values.milliseconds ?? 0,
		};
	}

	// ─── Factories ──────────────────────────────────────────

	/** Build from a plain object of unit values. */
	static fromObject(obj: DurationObject): Duration {
		return new Duration(obj);
	}

	/** Build from a total number of milliseconds (approximates calendar units). */
	static fromMillis(ms: number): Duration {
		return new Duration({ milliseconds: ms });
	}

	/**
	 * Parse an ISO 8601 duration string (`P1Y2M3DT4H5M6.789S`).
	 *
	 * Supports the full `PnYnMnDTnHnMnS` form. Fractional seconds are
	 * rounded to the nearest millisecond. Weeks (`PnW`) are a separate form
	 * that cannot be mixed with other designators per the spec.
	 */
	static fromISO(iso: string): Duration {
		const trimmed = iso.trim();
		// A leading '-' marks a negative duration (the extension toISO emits).
		const negative = trimmed.startsWith("-P");
		const s = negative ? trimmed.slice(1) : trimmed;
		if (!s.startsWith("P"))
			throw new Error(`Invalid ISO 8601 duration: ${iso}`);
		const apply = (d: Duration): Duration => (negative ? d.negate() : d);

		// Week form: P3W
		const weekMatch = /^P(\d+(?:\.\d+)?)W$/.exec(s);
		if (weekMatch) {
			return apply(new Duration({ weeks: Number.parseFloat(weekMatch[1]) }));
		}

		const match =
			/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(
				s,
			);
		if (!match) throw new Error(`Invalid ISO 8601 duration: ${iso}`);

		const [, y, mo, d, h, mi, sec] = match;
		// The all-optional regex also matches bare "P"/"PT" — a duration needs at
		// least one component. An explicit zero ("PT0S", "P0D") still parses.
		if (!y && !mo && !d && !h && !mi && !sec) {
			throw new Error(`Invalid ISO 8601 duration: ${iso}`);
		}
		const seconds = sec ? Math.floor(Number.parseFloat(sec)) : 0;
		const milliseconds = sec
			? Math.round((Number.parseFloat(sec) - seconds) * 1000)
			: 0;
		return apply(
			new Duration({
				years: y ? Number(y) : 0,
				months: mo ? Number(mo) : 0,
				days: d ? Number(d) : 0,
				hours: h ? Number(h) : 0,
				minutes: mi ? Number(mi) : 0,
				seconds,
				milliseconds,
			}),
		);
	}

	// ─── Accessors ──────────────────────────────────────────

	get years(): number {
		return this.#values.years;
	}
	get months(): number {
		return this.#values.months;
	}
	get weeks(): number {
		return this.#values.weeks;
	}
	get days(): number {
		return this.#values.days;
	}
	get hours(): number {
		return this.#values.hours;
	}
	get minutes(): number {
		return this.#values.minutes;
	}
	get seconds(): number {
		return this.#values.seconds;
	}
	get milliseconds(): number {
		return this.#values.milliseconds;
	}

	/** Get a specific unit. */
	get(unit: DurationUnit): number {
		return this.#values[unit];
	}

	/** Return the internal bag as a plain object. */
	toObject(): Required<DurationObject> {
		return { ...this.#values };
	}

	// ─── Arithmetic ─────────────────────────────────────────

	/** Add another duration to this one (per-unit addition). */
	plus(other: Duration | DurationObject): Duration {
		const o = other instanceof Duration ? other.#values : other;
		return new Duration({
			years: this.#values.years + (o.years ?? 0),
			months: this.#values.months + (o.months ?? 0),
			weeks: this.#values.weeks + (o.weeks ?? 0),
			days: this.#values.days + (o.days ?? 0),
			hours: this.#values.hours + (o.hours ?? 0),
			minutes: this.#values.minutes + (o.minutes ?? 0),
			seconds: this.#values.seconds + (o.seconds ?? 0),
			milliseconds: this.#values.milliseconds + (o.milliseconds ?? 0),
		});
	}

	/** Subtract another duration from this one. */
	minus(other: Duration | DurationObject): Duration {
		const o = other instanceof Duration ? other.#values : other;
		return new Duration({
			years: this.#values.years - (o.years ?? 0),
			months: this.#values.months - (o.months ?? 0),
			weeks: this.#values.weeks - (o.weeks ?? 0),
			days: this.#values.days - (o.days ?? 0),
			hours: this.#values.hours - (o.hours ?? 0),
			minutes: this.#values.minutes - (o.minutes ?? 0),
			seconds: this.#values.seconds - (o.seconds ?? 0),
			milliseconds: this.#values.milliseconds - (o.milliseconds ?? 0),
		});
	}

	/** Flip the sign on every unit. */
	negate(): Duration {
		return new Duration({
			years: -this.#values.years,
			months: -this.#values.months,
			weeks: -this.#values.weeks,
			days: -this.#values.days,
			hours: -this.#values.hours,
			minutes: -this.#values.minutes,
			seconds: -this.#values.seconds,
			milliseconds: -this.#values.milliseconds,
		});
	}

	// ─── Conversion ─────────────────────────────────────────

	/**
	 * Normalize clock units — cascade overflows upward so that e.g. 90 seconds
	 * becomes 1 minute 30 seconds. Calendar units (years, months) are left
	 * untouched because normalizing months→years requires knowing *which* year.
	 *
	 * Weeks are not cascaded into months — they stay as weeks unless the source
	 * explicitly had weeks. This matches Luxon's behavior.
	 */
	normalize(): Duration {
		let ms = this.#values.milliseconds;
		let sec = this.#values.seconds;
		let min = this.#values.minutes;
		let hrs = this.#values.hours;
		let days = this.#values.days;

		// Use a carry function that handles negative values correctly.
		// JS `%` is remainder (preserves sign), not modulo. For negative
		// durations we need true modulo so the remainder is always non-negative
		// relative to its parent unit, matching the mathematical convention.
		const carry = (value: number, divisor: number): [number, number] => {
			const quot = Math.trunc(value / divisor);
			const rem = value - quot * divisor;
			return [quot, rem];
		};

		let c: number;
		[c, ms] = carry(ms, 1000);
		sec += c;
		[c, sec] = carry(sec, 60);
		min += c;
		[c, min] = carry(min, 60);
		hrs += c;
		[c, hrs] = carry(hrs, 24);
		days += c;

		return new Duration({
			years: this.#values.years,
			months: this.#values.months,
			weeks: this.#values.weeks,
			days,
			hours: hrs,
			minutes: min,
			seconds: sec,
			milliseconds: ms,
		});
	}

	/**
	 * Re-project this duration into the given units. Uses approximate
	 * conversions for calendar units (365.25d/year, 30d/month). The result
	 * is expressed only in the requested units; all others are zero.
	 *
	 *     Duration.fromObject({ hours: 25 }).shiftTo('days', 'hours')
	 *     // → { days: 1, hours: 1 }
	 */
	shiftTo(...units: DurationUnit[]): Duration {
		if (units.length === 0) return this;

		// Convert the entire duration to approximate milliseconds, then greedily
		// distribute into the requested units from largest to smallest.
		let totalMs = 0;
		for (const unit of ORDERED_UNITS) {
			totalMs += this.#values[unit] * MS_PER[unit];
		}

		const sorted = [...units].sort(
			(a, b) => ORDERED_UNITS.indexOf(a) - ORDERED_UNITS.indexOf(b),
		);
		const result: DurationObject = {};
		for (const unit of sorted) {
			const value = Math.trunc(totalMs / MS_PER[unit]);
			totalMs -= value * MS_PER[unit];
			result[unit] = value;
		}
		// Any leftover ms goes into the smallest requested unit as a fractional part.
		if (totalMs !== 0 && sorted.length > 0) {
			const smallest = sorted[sorted.length - 1];
			result[smallest] = (result[smallest] ?? 0) + totalMs / MS_PER[smallest];
		}
		return new Duration(result);
	}

	/**
	 * Express the total duration in a single unit (approximate for calendar
	 * units — same caveat as `shiftTo`).
	 */
	as(unit: DurationUnit): number {
		let totalMs = 0;
		for (const u of ORDERED_UNITS) {
			totalMs += this.#values[u] * MS_PER[u];
		}
		return totalMs / MS_PER[unit];
	}

	// ─── Formatting ─────────────────────────────────────────

	/**
	 * ISO 8601 duration string (`P1Y2M3DT4H5M6S`). Always round-trips through
	 * {@link fromISO}.
	 *
	 * Two spec constraints are honoured: the week form (`PnW`) cannot mix with
	 * other designators — so weeks are emitted alone as `PnW`, otherwise folded
	 * into days; and durations are non-negative — a uniformly-negative duration
	 * (e.g. from {@link negate}) is emitted with a single leading `-` over
	 * absolute components, which `fromISO` parses back.
	 */
	toISO(): string {
		const v = this.#values;
		const units = ORDERED_UNITS.map((u) => v[u]);
		const negative = units.some((n) => n < 0) && units.every((n) => n <= 0);
		const sign = negative ? "-" : "";
		const a = (n: number): number => (negative ? Math.abs(n) : n);

		// Week form only when weeks is the sole unit; never combined with others.
		const onlyWeeks =
			v.weeks !== 0 &&
			v.years === 0 &&
			v.months === 0 &&
			v.days === 0 &&
			v.hours === 0 &&
			v.minutes === 0 &&
			v.seconds === 0 &&
			v.milliseconds === 0;
		if (onlyWeeks) return `${sign}P${a(v.weeks)}W`;

		const days = v.days + v.weeks * 7;
		let date = "";
		if (v.years) date += `${a(v.years)}Y`;
		if (v.months) date += `${a(v.months)}M`;
		if (days) date += `${a(days)}D`;
		let time = "";
		if (v.hours) time += `${a(v.hours)}H`;
		if (v.minutes) time += `${a(v.minutes)}M`;
		const totalSec = v.seconds + v.milliseconds / 1000;
		if (totalSec) time += `${a(totalSec)}S`;
		if (!date && !time) return "PT0S";
		return `${sign}P${date}${time ? `T${time}` : ""}`;
	}

	/**
	 * Simple pattern format: `hh:mm:ss`, `HH:mm`, etc. Supported tokens:
	 * `Y` (years), `M` (months), `d` (days), `h`/`hh` (hours), `m`/`mm`
	 * (minutes), `s`/`ss` (seconds), `S`/`SSS` (milliseconds).
	 *
	 * Wrap literal text in square brackets so its letters aren't read as tokens:
	 * `"h [hours], m [min]"` → `"2 hours, 30 min"`. A single left-to-right scan
	 * (longest token first) means substituted values are never re-scanned and
	 * literal/overlapping text is left intact.
	 */
	toFormat(pattern: string): string {
		const v = this.normalize().#values;
		const tokens: Record<string, string> = {
			SSS: String(v.milliseconds).padStart(3, "0"),
			hh: String(v.hours).padStart(2, "0"),
			mm: String(v.minutes).padStart(2, "0"),
			ss: String(v.seconds).padStart(2, "0"),
			S: String(v.milliseconds),
			h: String(v.hours),
			m: String(v.minutes),
			s: String(v.seconds),
			Y: String(v.years),
			M: String(v.months),
			d: String(v.days),
		};
		const order = ["SSS", "hh", "mm", "ss", "S", "h", "m", "s", "Y", "M", "d"];
		let out = "";
		let i = 0;
		while (i < pattern.length) {
			if (pattern[i] === "[") {
				i++;
				while (i < pattern.length && pattern[i] !== "]") {
					out += pattern[i];
					i++;
				}
				if (i < pattern.length) i++; // skip the closing ']'
				continue;
			}
			let matched = false;
			for (const key of order) {
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

	/**
	 * Human-readable form: "2 hours, 15 minutes". Uses English hardcoded —
	 * locale-aware formatting will go through Rosetta once Story 36.12 lands.
	 */
	toHuman(): string {
		const v = this.normalize().#values;
		const parts: string[] = [];
		if (v.years) parts.push(`${v.years} ${v.years === 1 ? "year" : "years"}`);
		if (v.months)
			parts.push(`${v.months} ${v.months === 1 ? "month" : "months"}`);
		if (v.weeks) parts.push(`${v.weeks} ${v.weeks === 1 ? "week" : "weeks"}`);
		if (v.days) parts.push(`${v.days} ${v.days === 1 ? "day" : "days"}`);
		if (v.hours) parts.push(`${v.hours} ${v.hours === 1 ? "hour" : "hours"}`);
		if (v.minutes)
			parts.push(`${v.minutes} ${v.minutes === 1 ? "minute" : "minutes"}`);
		if (v.seconds)
			parts.push(`${v.seconds} ${v.seconds === 1 ? "second" : "seconds"}`);
		if (v.milliseconds)
			parts.push(
				`${v.milliseconds} ${v.milliseconds === 1 ? "millisecond" : "milliseconds"}`,
			);
		return parts.length > 0 ? parts.join(", ") : "0 seconds";
	}

	toString(): string {
		return this.toISO();
	}
	toJSON(): string {
		return this.toISO();
	}
}
