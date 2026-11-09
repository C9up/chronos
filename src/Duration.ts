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

/** Millisecond equivalents. Calendar units (years/months) have no fixed length
 *  — they depend on the anchor date — so conversions use Luxon's casual matrix:
 *  a 30-day month and a 365-day year. */
const MS_PER: Record<DurationUnit, number> = {
	years: 365 * 24 * 60 * 60 * 1000,
	months: 30 * 24 * 60 * 60 * 1000,
	weeks: 7 * 24 * 60 * 60 * 1000,
	days: 24 * 60 * 60 * 1000,
	hours: 60 * 60 * 1000,
	minutes: 60 * 1000,
	seconds: 1000,
	milliseconds: 1,
};

const UNIT_NAMES: Readonly<Record<string, DurationUnit>> = {
	year: "years",
	years: "years",
	month: "months",
	months: "months",
	week: "weeks",
	weeks: "weeks",
	day: "days",
	days: "days",
	hour: "hours",
	hours: "hours",
	minute: "minutes",
	minutes: "minutes",
	second: "seconds",
	seconds: "seconds",
	millisecond: "milliseconds",
	milliseconds: "milliseconds",
};

/** A unit name, singular or plural, any case (Luxon's `normalizeUnit`). */
function normalizeUnit(unit: string): DurationUnit {
	const key = typeof unit === "string" ? unit.toLowerCase() : "";
	const normalized = Object.hasOwn(UNIT_NAMES, key)
		? UNIT_NAMES[key]
		: undefined;
	if (normalized === undefined) {
		throw new RangeError(`Invalid duration unit: ${String(unit)}`);
	}
	return normalized;
}

/**
 * A unit value as Luxon's `asNumber` reads it: a numeric string is coerced, and
 * anything that is not a finite number (NaN, ±Infinity, a boolean, "") is
 * refused rather than stored — stored, NaN printed as `PT0S` and a string
 * concatenated in `plus`.
 */
function asNumber(value: unknown): number {
	const numeric = Number(value);
	if (typeof value === "boolean" || value === "" || !Number.isFinite(numeric)) {
		throw new RangeError(`Invalid unit value ${String(value)}`);
	}
	return numeric;
}

/** Validate a duration-like object into canonical unit names. */
function normalizeObject(obj: unknown): DurationObject {
	if (typeof obj !== "object" || obj === null) {
		throw new TypeError(
			`Invalid duration: expected an object of units, got ${typeof obj}`,
		);
	}
	const out: DurationObject = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined || value === null) continue;
		const unit = normalizeUnit(key);
		out[unit] = (out[unit] ?? 0) + asNumber(value);
	}
	return out;
}

/**
 * ISO 8601 durations as Luxon reads them: a sign on the whole and on each
 * component, a fraction on any of them, weeks mixable with the rest, and at
 * most 20 digits per number so a value cannot overflow to Infinity.
 */
const ISO_DURATION =
	/^-?P(?:(?:(-?\d{1,20}(?:\.\d{1,20})?)Y)?(?:(-?\d{1,20}(?:\.\d{1,20})?)M)?(?:(-?\d{1,20}(?:\.\d{1,20})?)W)?(?:(-?\d{1,20}(?:\.\d{1,20})?)D)?(?:T(?:(-?\d{1,20}(?:\.\d{1,20})?)H)?(?:(-?\d{1,20}(?:\.\d{1,20})?)M)?(?:(-?\d{1,20})(?:[.,](-?\d{1,20}))?S)?)?)$/;

export class Duration {
	readonly #values: Readonly<Required<DurationObject>>;

	/**
	 * Private because a Duration is only ever built through the named factories, which normalise the units.
	 *
	 * `private` and not `#`: a private CONSTRUCTOR has no native form. It is the
	 * one place the keyword expresses something `#` cannot.
	 */
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

	/**
	 * Build from a plain object of unit values. Unit names may be singular or
	 * plural; every value must be a finite number (a numeric string is coerced).
	 *
	 * @throws RangeError on an unknown unit or a non-finite value.
	 */
	static fromObject(obj: DurationObject): Duration {
		return new Duration(normalizeObject(obj));
	}

	/** Build from a total number of milliseconds (approximates calendar units). */
	static fromMillis(ms: number): Duration {
		return new Duration({ milliseconds: asNumber(ms) });
	}

	/**
	 * Parse an ISO 8601 duration string (`P1Y2M3DT4H5M6.789S`, `P2W`, `P1.5D`,
	 * `PT-5M`, `-P1D`), with Luxon's grammar.
	 */
	static fromISO(iso: string): Duration {
		const m = typeof iso === "string" ? ISO_DURATION.exec(iso) : null;
		// The all-optional grammar also matches a bare "P"/"PT": a duration
		// needs at least one component. An explicit zero ("PT0S") still parses.
		if (!m || m.slice(1).every((part) => part === undefined)) {
			throw new RangeError(`Invalid ISO 8601 duration: ${String(iso)}`);
		}
		const [, y, mo, w, d, h, mi, sec, frac] = m;
		// ISO 8601 requires a time component after "T"; Luxon lets "P1DT" through.
		if (
			iso.includes("T") &&
			h === undefined &&
			mi === undefined &&
			sec === undefined
		) {
			throw new RangeError(`Invalid ISO 8601 duration: ${iso}`);
		}
		const negativePrefix = iso.startsWith("-");
		const read = (part: string | undefined): number | undefined => {
			if (part === undefined) return undefined;
			const value = Number.parseFloat(part);
			return negativePrefix && value !== 0 ? -value : value;
		};
		let milliseconds: number | undefined;
		if (frac !== undefined) {
			const ms = Math.floor(Number.parseFloat(`0.${frac}`) * 1000);
			const negativeSeconds = sec?.startsWith("-") === true;
			milliseconds = negativeSeconds !== negativePrefix ? -ms : ms;
		}
		const values: DurationObject = {
			years: read(y),
			months: read(mo),
			weeks: read(w),
			days: read(d),
			hours: read(h),
			minutes: read(mi),
			seconds: sec === "-0" && !negativePrefix ? -0 : read(sec),
			milliseconds,
		};
		return new Duration(normalizeObject(values));
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

	/** Get a specific unit (singular or plural name). */
	get(unit: DurationUnit): number {
		return this.#values[normalizeUnit(unit)];
	}

	/** Return the internal bag as a plain object. */
	toObject(): Required<DurationObject> {
		return { ...this.#values };
	}

	// ─── Arithmetic ─────────────────────────────────────────

	/** Add another duration (a Duration, an object of units, or milliseconds). */
	plus(other: Duration | DurationObject | number): Duration {
		const o = Duration.#valuesOf(other);
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
	minus(other: Duration | DurationObject | number): Duration {
		const o = Duration.#valuesOf(other);
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

	static #valuesOf(other: Duration | DurationObject | number): DurationObject {
		if (other instanceof Duration) return other.#values;
		if (typeof other === "number") return { milliseconds: asNumber(other) };
		return normalizeObject(other);
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
	 * Normalize days and the clock units with Luxon's `normalizeValues`: carry
	 * overflows upward (90 seconds becomes 1 minute 30 seconds), rebalance mixed
	 * signs against the sign of the whole (`{ hours: -1, minutes: 30 }` is
	 * thirty minutes back, `{ minutes: -30 }`), and push fractions down into
	 * the next unit. Years, months and weeks are left as they are: rolling days
	 * into them would need an anchor date.
	 */
	normalize(): Duration {
		const vals = { ...this.#values };
		const units: DurationUnit[] = [
			"days",
			"hours",
			"minutes",
			"seconds",
			"milliseconds",
		];
		const factor = this.as("milliseconds") < 0 ? -1 : 1;
		for (let i = units.length - 1; i > 0; i--) {
			const current = units[i - 1];
			const previous = units[i];
			if (current === undefined || previous === undefined) continue;
			const conv = MS_PER[current] / MS_PER[previous];
			const rollUp = Math.floor((vals[previous] * factor) / conv);
			vals[current] += rollUp * factor;
			vals[previous] -= rollUp * conv * factor;
		}
		for (let i = 1; i < units.length; i++) {
			const previous = units[i - 1];
			const current = units[i];
			if (current === undefined || previous === undefined) continue;
			const fraction = vals[previous] % 1;
			vals[previous] -= fraction;
			vals[current] += (fraction * MS_PER[previous]) / MS_PER[current];
		}
		return new Duration(vals);
	}

	/**
	 * Re-project this duration into the given units. Uses approximate
	 * conversions for calendar units (365.25d/year, 30d/month). The result
	 * is expressed only in the requested units; all others are zero.
	 *
	 *     Duration.fromObject({ hours: 25 }).shiftTo('days', 'hours')
	 *     // → { days: 1, hours: 1 }
	 */
	shiftTo(...requested: DurationUnit[]): Duration {
		if (requested.length === 0) return this;
		const units = requested.map(normalizeUnit);

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
		const smallest = sorted.at(-1);
		if (totalMs !== 0 && smallest !== undefined) {
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
		return totalMs / MS_PER[normalizeUnit(unit)];
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
