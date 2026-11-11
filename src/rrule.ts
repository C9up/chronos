import { type DateInput, DateTime } from "./DateTime.js";
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
	/** Last instant of the series: a strict ISO 8601 string (UTC when offset-less) or a DateTime. */
	until?: string | DateTime;
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

/**
 * `until` goes through the same strict ISO 8601 door as every other date
 * string: an offset-less value is UTC, and what V8's fallback parser would
 * turn into a date (`"1"`, `"March 7"`) is refused instead of read in the
 * host zone.
 */
function readUntil(value: unknown): DateTime {
	if (value instanceof DateTime) return value;
	if (typeof value !== "string") return invalid("until", value);
	try {
		return DateTime.from(value);
	} catch (cause) {
		throw new RangeError(`toRRuleString: invalid until ${value}`, { cause });
	}
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
		// RFC 5545 §3.3.10 UNTIL format: YYYYMMDDTHHMMSSZ (no hyphens/colons/ms).
		parts.push(
			`UNTIL=${readUntil(rule.until)
				.toUTC()
				.toISO()
				.replace(/[-:]/g, "")
				.replace(/\.\d+Z$/, "Z")}`,
		);
	}

	return parts.join(";");
}

/**
 * Hard cap on the number of occurrences one call returns, so a caller passing
 * an absurd limit (or one derived from user input) cannot ask for an unbounded
 * result. 10 000 covers any realistic page; page through the series (start
 * from the last occurrence) for more.
 */
const MAX_RRULE_EXPAND = 10_000;

export interface ExpandRRuleOptions {
	/** Most occurrences to return (1 – 10 000, default 100). */
	limit?: number;
	/**
	 * IANA zone whose wall clock the rule runs on (RFC 5545 DTSTART;TZID): a
	 * weekly 09:00 series stays at 09:00 local across DST. Defaults to the zone
	 * of a zoned `DateTime` start, else UTC.
	 */
	tzid?: string;
}

function isRRuleBuild(value: unknown): value is RRuleBuild {
	return typeof value === "object" && value !== null && "freq" in value;
}

function readOptions(
	options: number | ExpandRRuleOptions | undefined,
): ExpandRRuleOptions {
	if (options === undefined) return {};
	if (typeof options === "number") return { limit: options };
	return options;
}

function checkLimit(limit: number): number {
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
	return limit;
}

/**
 * Expand an RRULE (RFC 5545) into occurrences, returned as UTC ISO strings.
 *
 * - `expandRRule(start, rule, limit | { limit, tzid })` — `start` is DTSTART;
 *   a zoned `DateTime` makes the rule run on its zone's wall clock.
 * - `expandRRule("DTSTART;TZID=Europe/Paris:20260323T090000\nRRULE:…", options)`
 *   — the iCalendar form, DTSTART read from the text.
 *
 * The Rust engine bounds the work whatever the rule says (BY* lists are sets,
 * the text is capped at 8 KB, iteration ends at year 9999), so a rule taken
 * from user input or an imported .ics cannot exhaust memory or hold the thread.
 */
export function expandRRule(
	start: DateInput,
	rrule: string | RRuleBuild,
	options?: number | ExpandRRuleOptions,
): string[];
export function expandRRule(
	rule: string,
	options?: number | ExpandRRuleOptions,
): string[];
export function expandRRule(
	start: DateInput,
	rruleOrOptions?: string | RRuleBuild | number | ExpandRRuleOptions,
	maybeOptions?: number | ExpandRRuleOptions,
): string[] {
	if (typeof rruleOrOptions === "string" || isRRuleBuild(rruleOrOptions)) {
		const options = readOptions(maybeOptions);
		const limit = checkLimit(options.limit ?? 100);
		const from = DateTime.from(start);
		const tzid =
			options.tzid ?? (from.zoneName === "UTC" ? undefined : from.zoneName);
		const rule =
			typeof rruleOrOptions === "string"
				? rruleOrOptions
				: toRRuleString(rruleOrOptions);
		return nativeChronos().rruleExpand(from.toISO(), rule, limit, tzid);
	}
	if (typeof start !== "string") {
		throw new TypeError(
			"expandRRule(rule, options) takes the rule text, with its DTSTART line, as the first argument",
		);
	}
	const options = readOptions(rruleOrOptions);
	return nativeChronos().rruleExpand(
		undefined,
		start,
		checkLimit(options.limit ?? 100),
		options.tzid,
	);
}
