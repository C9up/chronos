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

function pushNumericList(
	parts: string[],
	key: string,
	values: number[] | undefined,
): void {
	if (!values || values.length === 0) return;
	parts.push(`${key}=${values.join(",")}`);
}

export function toRRuleString(rule: RRuleBuild): string {
	const parts: string[] = [`FREQ=${rule.freq}`];

	if (rule.interval && rule.interval !== 1)
		parts.push(`INTERVAL=${rule.interval}`);
	if (rule.wkst) parts.push(`WKST=${rule.wkst}`);
	if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);

	pushNumericList(parts, "BYMONTHDAY", rule.byMonthDay);
	pushNumericList(parts, "BYMONTH", rule.byMonth);
	pushNumericList(parts, "BYWEEKNO", rule.byWeekNo);
	pushNumericList(parts, "BYYEARDAY", rule.byYearDay);
	pushNumericList(parts, "BYSETPOS", rule.bySetPos);
	pushNumericList(parts, "BYHOUR", rule.byHour);
	pushNumericList(parts, "BYMINUTE", rule.byMinute);
	pushNumericList(parts, "BYSECOND", rule.bySecond);

	if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
	if (rule.until) {
		// RFC 5545 §3.3.10 UNTIL format: YYYYMMDDTHHMMSSZ (no hyphens/colons/ms).
		parts.push(
			`UNTIL=${new Date(rule.until)
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
