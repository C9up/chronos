import { nativeChronos } from "./native.js";

export type RRuleWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type RRuleByDayToken = RRuleWeekday | `${number}${RRuleWeekday}`;

export interface RRuleBuild {
	freq:
		| "SECONDLY"
		| "MINUTELY"
		| "HOURLY"
		| "DAILY"
		| "WEEKLY"
		| "MONTHLY"
		| "YEARLY";
	interval?: number;
	wkst?: RRuleWeekday;
	byDay?: RRuleByDayToken[];
	byMonthDay?: number[];
	byMonth?: number[];
	byWeekNo?: number[];
	byYearDay?: number[];
	bySetPos?: number[];
	byHour?: number[];
	byMinute?: number[];
	bySecond?: number[];
	count?: number;
	until?: string;
}

const FREQUENCIES: ReadonlySet<string> = new Set([
	"SECONDLY",
	"MINUTELY",
	"HOURLY",
	"DAILY",
	"WEEKLY",
	"MONTHLY",
	"YEARLY",
]);
const WEEKDAYS: ReadonlySet<string> = new Set([
	"MO",
	"TU",
	"WE",
	"TH",
	"FR",
	"SA",
	"SU",
]);
const BYDAY_TOKEN =
	/^(?:[+-]?(?:[1-9]|[1-4]\d|5[0-3]))?(?:MO|TU|WE|TH|FR|SA|SU)$/;

/**
 * The structured input is only typed, never trusted: a value that reaches the
 * rule text unchecked (`byDay: ["MO;BYSECOND=0,0,…"]` from a JSON body) adds
 * parts the caller never wrote.
 */
function invalid(field: string, value: unknown): never {
	throw new RangeError(`toRRuleString: invalid ${field} ${String(value)}`);
}

function checkInteger(
	field: string,
	value: unknown,
	min: number,
	max: number,
	allowZero = true,
): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < min ||
		value > max ||
		(value === 0 && !allowZero)
	) {
		return invalid(field, value);
	}
	return value;
}

function pushNumericList(
	parts: string[],
	key: string,
	field: string,
	values: readonly unknown[] | undefined,
	range: [min: number, max: number, allowZero: boolean],
): void {
	if (values === undefined) return;
	if (!Array.isArray(values)) invalid(field, values);
	if (values.length === 0) return;
	const checked = values.map((v) => checkInteger(field, v, ...range));
	parts.push(`${key}=${checked.join(",")}`);
}

export function toRRuleString(rule: RRuleBuild): string {
	if (!FREQUENCIES.has(rule.freq)) invalid("freq", rule.freq);
	const parts: string[] = [`FREQ=${rule.freq}`];

	if (rule.interval !== undefined) {
		const interval = checkInteger("interval", rule.interval, 1, 1_000_000_000);
		if (interval !== 1) parts.push(`INTERVAL=${interval}`);
	}
	if (rule.wkst !== undefined) {
		if (!WEEKDAYS.has(rule.wkst)) invalid("wkst", rule.wkst);
		parts.push(`WKST=${rule.wkst}`);
	}
	if (rule.byDay !== undefined) {
		if (!Array.isArray(rule.byDay)) invalid("byDay", rule.byDay);
		for (const token of rule.byDay) {
			if (typeof token !== "string" || !BYDAY_TOKEN.test(token))
				invalid("byDay", token);
		}
		if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(",")}`);
	}

	pushNumericList(parts, "BYMONTHDAY", "byMonthDay", rule.byMonthDay, [
		-31,
		31,
		false,
	]);
	pushNumericList(parts, "BYMONTH", "byMonth", rule.byMonth, [1, 12, false]);
	pushNumericList(parts, "BYWEEKNO", "byWeekNo", rule.byWeekNo, [
		-53,
		53,
		false,
	]);
	pushNumericList(parts, "BYYEARDAY", "byYearDay", rule.byYearDay, [
		-366,
		366,
		false,
	]);
	pushNumericList(parts, "BYSETPOS", "bySetPos", rule.bySetPos, [
		-366,
		366,
		false,
	]);
	pushNumericList(parts, "BYHOUR", "byHour", rule.byHour, [0, 23, true]);
	pushNumericList(parts, "BYMINUTE", "byMinute", rule.byMinute, [0, 59, true]);
	pushNumericList(parts, "BYSECOND", "bySecond", rule.bySecond, [0, 59, true]);

	if (rule.count !== undefined)
		parts.push(`COUNT=${checkInteger("count", rule.count, 0, 1_000_000_000)}`);
	if (rule.until !== undefined) {
		const ms =
			typeof rule.until === "string" ? Date.parse(rule.until) : Number.NaN;
		if (!Number.isFinite(ms)) invalid("until", rule.until);
		// RFC 5545 §3.3.10 UNTIL format: YYYYMMDDTHHMMSSZ (no hyphens/colons/ms).
		parts.push(
			`UNTIL=${new Date(ms)
				.toISOString()
				.replace(/[-:]/g, "")
				.replace(/\.\d+Z$/, "Z")}`,
		);
	}

	return parts.join(";");
}

/**
 * Expand an RRULE into concrete occurrence dates. **NAPI-only** — the Rust
 * engine handles the full RFC 5545 spec (BYDAY, BYSETPOS, BYMONTHDAY,
 * BYWEEKNO, BYYEARDAY, UNTIL, COUNT, INTERVAL, WKST). No TS fallback.
 */
/**
 * Hard cap on `expandRRule(... , limit)` so a caller passing an absurd
 * number (or one derived from user input) can't ask the Rust engine to
 * allocate gigabytes / run for seconds. 10_000 covers any realistic
 * pagination + cushion (a year of every-minute occurrences = ~525k, so
 * apps wanting that should iterate or stream, not call once).
 */
const MAX_RRULE_EXPAND = 10_000;

export function expandRRule(
	startIso: string,
	rrule: string | RRuleBuild,
	limit = 100,
): string[] {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError(
			`expandRRule(limit) must be a positive integer (got ${String(limit)})`,
		);
	}
	if (limit > MAX_RRULE_EXPAND) {
		throw new RangeError(
			`expandRRule(limit=${limit}) exceeds the safety cap of ${MAX_RRULE_EXPAND}. ` +
				"Page through the result set instead of asking for everything at once.",
		);
	}
	const built = typeof rrule === "string" ? rrule : toRRuleString(rrule);
	return nativeChronos().rruleExpand(startIso, built, limit);
}
