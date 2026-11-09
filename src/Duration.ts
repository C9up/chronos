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
/** A unit name as Luxon accepts it: plural or singular. */
export type DurationUnitLike =
	| DurationUnit
	| "year"
	| "month"
	| "week"
	| "day"
	| "hour"
	| "minute"
	| "second"
	| "millisecond";

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

/**
 * Luxon's casual conversion matrix: how many of the lower unit one higher unit
 * holds. It is not self-consistent (a month is 30 days but 4 weeks) — that is
 * Luxon's, and `shiftTo` follows it so the same call gives the same units.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MATRIX: Readonly<
	Record<DurationUnit, Partial<Record<DurationUnit, number>>>
> = {
	years: {
		months: 12,
		weeks: 52,
		days: 365,
		hours: 365 * 24,
		minutes: 365 * 24 * 60,
		seconds: 365 * 24 * 60 * 60,
		milliseconds: 365 * DAY_MS,
	},
	months: {
		weeks: 4,
		days: 30,
		hours: 30 * 24,
		minutes: 30 * 24 * 60,
		seconds: 30 * 24 * 60 * 60,
		milliseconds: 30 * DAY_MS,
	},
	weeks: {
		days: 7,
		hours: 7 * 24,
		minutes: 7 * 24 * 60,
		seconds: 7 * 24 * 60 * 60,
		milliseconds: 7 * DAY_MS,
	},
	days: {
		hours: 24,
		minutes: 24 * 60,
		seconds: 24 * 60 * 60,
		milliseconds: DAY_MS,
	},
	hours: { minutes: 60, seconds: 60 * 60, milliseconds: 60 * 60 * 1000 },
	minutes: { seconds: 60, milliseconds: 60 * 1000 },
	seconds: { milliseconds: 1000 },
	milliseconds: {},
};

/** How many `lower` one `higher` holds; both are units of the matrix. */
function conv(higher: DurationUnit, lower: DurationUnit): number {
	return MATRIX[higher][lower] ?? 1;
}

/**
 * Luxon's `normalizeValues` over `units` (in descending order): carry each
 * unit into the next one up against the sign of the whole, then push
 * fractions down. Mutates `vals`.
 */
function normalizeValues(
	vals: Record<DurationUnit, number>,
	units: readonly DurationUnit[],
): void {
	let total = 0;
	for (const u of ORDERED_UNITS) total += vals[u] * MS_PER[u];
	const factor = total < 0 ? -1 : 1;
	for (let i = units.length - 1; i > 0; i--) {
		const current = units[i - 1];
		const previous = units[i];
		if (current === undefined || previous === undefined) continue;
		const c = conv(current, previous);
		const rollUp = Math.floor((vals[previous] * factor) / c);
		vals[current] += rollUp * factor;
		vals[previous] -= rollUp * c * factor;
	}
	for (let i = 1; i < units.length; i++) {
		const previous = units[i - 1];
		const current = units[i];
		if (current === undefined || previous === undefined) continue;
		const fraction = vals[previous] % 1;
		vals[previous] -= fraction;
		vals[current] += fraction * conv(previous, current);
	}
}

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
	get(unit: DurationUnitLike): number {
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

	/** Total length in milliseconds, on the casual matrix (Luxon's `toMillis`). */
	toMillis(): number {
		return this.as("milliseconds");
	}

	/** Milliseconds, so durations compare and subtract like numbers. */
	valueOf(): number {
		return this.toMillis();
	}

	/** Spread over every unit, years down to milliseconds (Luxon's `shiftToAll`). */
	shiftToAll(): Duration {
		return this.shiftTo(...ORDERED_UNITS);
	}

	/**
	 * Re-express in the largest units that fit: 90 000 ms becomes 1 minute
	 * 30 seconds (Luxon's `rescale`).
	 */
	rescale(): Duration {
		return this.normalize().shiftToAll();
	}

	/** A Duration with `fn` applied to every unit's value (Luxon's `mapUnits`). */
	mapUnits(fn: (value: number, unit: DurationUnit) => number): Duration {
		const out: DurationObject = {};
		for (const unit of ORDERED_UNITS) {
			out[unit] = asNumber(fn(this.#values[unit], unit));
		}
		return new Duration(out);
	}

	/** Flip the sign on every unit (a zero stays 0, never -0, as in Luxon). */
	negate(): Duration {
		return this.mapUnits((value) => (value === 0 ? 0 : -value));
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
		normalizeValues(vals, [
			"days",
			"hours",
			"minutes",
			"seconds",
			"milliseconds",
		]);
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
	shiftTo(...requested: DurationUnitLike[]): Duration {
		if (requested.length === 0) return this;
		const units = requested.map(normalizeUnit);
		const ordered = ORDERED_UNITS.filter((u) => units.includes(u));
		const built: Record<DurationUnit, number> = {
			years: 0,
			months: 0,
			weeks: 0,
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			milliseconds: 0,
		};
		const accumulated = new Map<DurationUnit, number>();
		let last: DurationUnit | undefined;
		// Luxon's shiftTo: higher units not asked for flow down into the next
		// requested one, each requested unit keeps its integer part, and what is
		// left over becomes the fraction of the last one.
		for (const k of ORDERED_UNITS) {
			if (ordered.includes(k)) {
				last = k;
				let own = 0;
				for (const [ak, value] of accumulated) {
					own += conv(ak, k) * value;
					accumulated.set(ak, 0);
				}
				own += this.#values[k];
				const whole = Math.trunc(own);
				built[k] = whole;
				accumulated.set(k, (own * 1000 - whole * 1000) / 1000);
			} else {
				accumulated.set(k, this.#values[k]);
			}
		}
		if (last !== undefined) {
			for (const [key, value] of accumulated) {
				if (value === 0) continue;
				built[last] += key === last ? value : value / conv(last, key);
			}
		}
		normalizeValues(built, ordered);
		return new Duration(built);
	}

	/**
	 * Express the total duration in a single unit (approximate for calendar
	 * units — same caveat as `shiftTo`).
	 */
	as(unit: DurationUnitLike): number {
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
