/**
 * `DateTime.fromFormat` — read a string written with Luxon's format tokens
 * (`dd/MM/yyyy`, `dd LLL yyyy 'at' h:mm a`, `kkkk-'W'WW-c`, macros such as
 * `D` or `f`), the way Luxon's token parser does: the format becomes one
 * anchored, case-insensitive regular expression, names are matched against the
 * locale's lists, and the matched units are resolved as Luxon's `fromObject`
 * resolves them (larger units missing → now, smaller ones → their minimum).
 *
 * Digits are Latin only, as `toFormat` writes them. English names come from
 * the same lists `toFormat` prints for every `en` locale, so a value formatted
 * with chronos reads back.
 */

import {
	isEnglish,
	MACROS,
	MONTHS_LONG,
	parseFormat,
	type Token,
	WEEKDAYS_LONG,
} from "./format.js";

/** The units a format can name, before the missing ones are filled in. */
export interface ParsedFields {
	year?: number;
	month?: number;
	day?: number;
	ordinal?: number;
	weekYear?: number;
	weekNumber?: number;
	weekday?: number;
	hour?: number;
	minute?: number;
	second?: number;
	millisecond?: number;
}

export interface ParsedText {
	fields: ParsedFields;
	/** IANA zone named by the `z` token. */
	zone?: string;
	/** UTC offset in minutes, from `Z`, `ZZ` or `ZZZ`. */
	offset?: number;
}

interface Unit {
	token: Token;
	regex: string;
	/** Capture groups inside `regex`. */
	groups: number;
	literal: boolean;
	deser: (match: readonly string[]) => number | string;
}

type NameLength = "short" | "long";

interface NameLists {
	months(length: NameLength, format: boolean): readonly string[];
	weekdays(length: NameLength, format: boolean): readonly string[];
	meridiems(): readonly string[];
	eras(length: NameLength): readonly string[];
}

const ENGLISH_ERAS: Readonly<Record<NameLength, readonly string[]>> = {
	short: ["BC", "AD"],
	long: ["Before Christ", "Anno Domini"],
};

function intlPart(
	locale: string,
	options: Intl.DateTimeFormatOptions,
	ms: number,
	type: Intl.DateTimeFormatPartTypes,
): string {
	const parts = new Intl.DateTimeFormat(locale, {
		...options,
		timeZone: "UTC",
	}).formatToParts(new Date(ms));
	return parts.find((p) => p.type === type)?.value ?? "";
}

/** The dates Luxon reads its lists from: 2009 for months, the week of 2016-11-14 for weekdays. */
function nameLists(locale: string): NameLists {
	if (isEnglish(locale)) {
		const cut = (name: string, length: NameLength) =>
			length === "long" ? name : name.slice(0, 3);
		return {
			months: (length) => MONTHS_LONG.map((m) => cut(m, length)),
			weekdays: (length) => WEEKDAYS_LONG.map((d) => cut(d, length)),
			meridiems: () => ["AM", "PM"],
			eras: (length) => ENGLISH_ERAS[length],
		};
	}
	return {
		months: (length, format) =>
			Array.from({ length: 12 }, (_, i) =>
				intlPart(
					locale,
					format ? { month: length, day: "numeric" } : { month: length },
					Date.UTC(2009, i, 1),
					"month",
				),
			),
		weekdays: (length, format) =>
			Array.from({ length: 7 }, (_, i) =>
				intlPart(
					locale,
					format
						? {
								weekday: length,
								year: "numeric",
								month: "long",
								day: "numeric",
							}
						: { weekday: length },
					Date.UTC(2016, 10, 14 + i),
					"weekday",
				),
			),
		meridiems: () =>
			[9, 19].map((hour) =>
				intlPart(
					locale,
					{ hour: "numeric", hourCycle: "h12" },
					Date.UTC(2016, 10, 13, hour),
					"dayPeriod",
				),
			),
		eras: (length) =>
			[Date.UTC(-40, 0, 1), Date.UTC(2017, 0, 1)].map((ms) =>
				intlPart(locale, { era: length }, ms, "era"),
			),
	};
}

function escapeRegex(text: string): string {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/** A name in a list: its dots optional, a space and a no-break space alike. */
function listEntryRegex(name: string): string {
	return name
		.split(".")
		.map((piece) => escapeRegex(piece).replace(/\\ |\\ /g, "[  ]"))
		.join("\\.?");
}

function stripInsensitivities(name: string): string {
	return name.replace(/\./g, "").replace(/[  ]/g, " ").toLowerCase();
}

function oneOf(
	token: Token,
	names: readonly string[],
	startIndex: number,
): Unit {
	return {
		token,
		regex: names.map(listEntryRegex).join("|"),
		groups: 0,
		literal: false,
		deser: ([text = ""]) =>
			names.findIndex(
				(name) => stripInsensitivities(name) === stripInsensitivities(text),
			) + startIndex,
	};
}

function intUnit(
	token: Token,
	regex: string,
	post: (value: number) => number = (value) => value,
): Unit {
	return {
		token,
		regex,
		groups: 0,
		literal: false,
		deser: ([text = ""]) => post(Number.parseInt(text, 10)),
	};
}

function simple(token: Token, regex: string): Unit {
	return {
		token,
		regex,
		groups: 0,
		literal: false,
		deser: ([text = ""]) => text,
	};
}

/** Minutes of `+02:00` / `-5` / `+0530`; `-0:30` keeps its sign. */
function signedOffset(hours: string, minutes: string | undefined): number {
	const h = Number.parseInt(hours, 10);
	const m = Number.parseInt(minutes ?? "0", 10) || 0;
	return h * 60 + (hours.startsWith("-") ? -m : m);
}

function offsetUnit(token: Token, regex: string): Unit {
	return {
		token,
		regex,
		groups: 2,
		literal: false,
		deser: ([, hours = "0", minutes]) => signedOffset(hours, minutes),
	};
}

/** Luxon's cut-off: `yy` above 60 is the 1900s, the rest the 2000s. */
function untruncateYear(year: number): number {
	if (year > 99) return year;
	return year > 60 ? 1900 + year : 2000 + year;
}

function unitForToken(token: Token, names: NameLists): Unit {
	const literal: Unit = {
		token,
		regex: escapeRegex(token.val),
		groups: 0,
		literal: true,
		deser: ([text = ""]) => text,
	};
	if (token.literal) return literal;
	switch (token.val) {
		case "G":
			return oneOf(token, names.eras("short"), 0);
		case "GG":
			return oneOf(token, names.eras("long"), 0);
		case "y":
			return intUnit(token, "\\d{1,6}");
		case "yy":
			return intUnit(token, "\\d{2,4}", untruncateYear);
		case "yyyy":
			return intUnit(token, "\\d{4}");
		case "yyyyy":
			return intUnit(token, "\\d{4,6}");
		case "yyyyyy":
			return intUnit(token, "\\d{6}");
		case "M":
		case "L":
		case "d":
		case "H":
		case "h":
		case "m":
		case "s":
		case "q":
		case "W":
			return intUnit(token, "\\d{1,2}");
		case "MM":
		case "LL":
		case "dd":
		case "HH":
		case "hh":
		case "mm":
		case "ss":
		case "qq":
		case "WW":
			return intUnit(token, "\\d{2}");
		case "MMM":
			return oneOf(token, names.months("short", true), 1);
		case "MMMM":
			return oneOf(token, names.months("long", true), 1);
		case "LLL":
			return oneOf(token, names.months("short", false), 1);
		case "LLLL":
			return oneOf(token, names.months("long", false), 1);
		case "o":
		case "S":
			return intUnit(token, "\\d{1,3}");
		case "ooo":
		case "SSS":
			return intUnit(token, "\\d{3}");
		case "u":
			return simple(token, "\\d{1,9}");
		case "uu":
			return simple(token, "\\d{1,2}");
		case "uuu":
			return intUnit(token, "\\d");
		case "a":
			return oneOf(token, names.meridiems(), 0);
		case "kkkk":
			return intUnit(token, "\\d{4}");
		case "kk":
			return intUnit(token, "\\d{2,4}", untruncateYear);
		case "E":
		case "c":
			return intUnit(token, "\\d");
		case "EEE":
			return oneOf(token, names.weekdays("short", false), 1);
		case "EEEE":
			return oneOf(token, names.weekdays("long", false), 1);
		case "ccc":
			return oneOf(token, names.weekdays("short", true), 1);
		case "cccc":
			return oneOf(token, names.weekdays("long", true), 1);
		case "Z":
		case "ZZ":
			return offsetUnit(token, "([+-]\\d{1,2})(?::(\\d{2}))?");
		case "ZZZ":
			return offsetUnit(token, "([+-]\\d{1,2})(\\d{2})?");
		case "z":
			return simple(token, "[a-z_+-/]{1,256}?");
		// Where a macro expanded into white space: one blank, newlines excepted.
		case " ":
			return simple(token, "[^\\S\\n\\r]");
		default:
			return literal;
	}
}

function pick(
	table: Readonly<Record<string, string>>,
	style: string | undefined,
): Token | undefined {
	if (style === undefined || !Object.hasOwn(table, style)) return undefined;
	const val = table[style];
	return val === undefined ? undefined : { literal: false, val };
}

/** One part of a macro's Intl rendering, as the token that reads it back. */
function tokenForPart(
	part: Intl.DateTimeFormatPart,
	options: Intl.DateTimeFormatOptions,
	resolved: Intl.ResolvedDateTimeFormatOptions,
): Token | undefined {
	switch (part.type) {
		case "literal": {
			const isSpace = /^\s+$/.test(part.value);
			return { literal: !isSpace, val: isSpace ? " " : part.value };
		}
		case "year":
			return pick({ "2-digit": "yy", numeric: "yyyyy" }, options.year);
		case "month":
			return pick(
				{ numeric: "M", "2-digit": "MM", short: "MMM", long: "MMMM" },
				options.month,
			);
		case "day":
			return pick({ numeric: "d", "2-digit": "dd" }, options.day);
		case "weekday":
			return pick({ short: "EEE", long: "EEEE" }, options.weekday);
		case "dayPeriod":
			return { literal: false, val: "a" };
		case "hour": {
			const twelve =
				options.hour12 ??
				(options.hourCycle === undefined
					? resolved.hour12 === true
					: options.hourCycle === "h11" || options.hourCycle === "h12");
			return pick(
				twelve
					? { numeric: "h", "2-digit": "hh" }
					: { numeric: "H", "2-digit": "HH" },
				options.hour,
			);
		}
		case "minute":
			return pick({ numeric: "m", "2-digit": "mm" }, options.minute);
		case "second":
			return pick({ numeric: "s", "2-digit": "ss" }, options.second);
		case "timeZoneName":
			return pick({ long: "ZZZZZ", short: "ZZZ" }, options.timeZoneName);
		default:
			return undefined;
	}
}

/** A macro token (`D`, `f`, `T`…) as the tokens of its rendering in `locale`. */
function expandMacro(token: Token, locale: string): Token[] {
	const options =
		!token.literal && Object.hasOwn(MACROS, token.val)
			? MACROS[token.val]
			: undefined;
	if (options === undefined) return [token];
	const dtf = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
	const resolved = dtf.resolvedOptions();
	const tokens: Token[] = [];
	for (const part of dtf.formatToParts(new Date(1555555555555))) {
		const expanded = tokenForPart(part, options, resolved);
		if (expanded === undefined) return [token];
		tokens.push(expanded);
	}
	return tokens;
}

/** Fraction digits as milliseconds: `5` → 500, `42` → 420. */
function parseMillis(fraction: string): number {
	return Math.floor(Number.parseFloat(`0.${fraction}`) * 1000);
}

const FIELD_OF_KEY: Readonly<Record<string, keyof ParsedFields>> = {
	S: "millisecond",
	s: "second",
	m: "minute",
	h: "hour",
	H: "hour",
	d: "day",
	o: "ordinal",
	L: "month",
	M: "month",
	y: "year",
	E: "weekday",
	c: "weekday",
	W: "weekNumber",
	k: "weekYear",
};

/**
 * Match `text` against `format`. `null` when it does not match; throws when the
 * format names a meridiem together with a 24-hour hour.
 */
export function parseWithFormat(
	text: string,
	format: string,
	locale: string,
): ParsedText | null {
	const names = nameLists(locale);
	const tokens = parseFormat(format).flatMap((t) => expandMacro(t, locale));
	const units = tokens.map((t) => unitForToken(t, names));
	const regex = new RegExp(
		`^${units.map((u) => `(${u.regex})`).join("")}$`,
		"i",
	);
	const match = regex.exec(text);
	if (match === null) return null;

	// Keyed by the token's letter, the last one written winning, as Luxon does.
	const matches = new Map<string, number | string>();
	let index = 1;
	for (const unit of units) {
		const groups = unit.groups + 1;
		const key = unit.token.val[0];
		if (!unit.literal && key !== undefined) {
			matches.set(key, unit.deser(match.slice(index, index + groups)));
		}
		index += groups;
	}
	if (matches.has("a") && matches.has("H")) {
		throw new Error("Can't include meridiem when specifying 24-hour format");
	}
	const num = (key: string): number | undefined => {
		const value = matches.get(key);
		return typeof value === "number" ? value : undefined;
	};

	const out: ParsedText = { fields: {} };
	const zone = matches.get("z");
	if (typeof zone === "string") out.zone = zone;
	const offset = num("Z");
	if (offset !== undefined) out.offset = offset;

	const quarter = num("q");
	if (quarter !== undefined) matches.set("M", (quarter - 1) * 3 + 1);
	const hour12 = num("h");
	const meridiem = num("a");
	if (hour12 !== undefined) {
		if (hour12 < 12 && meridiem === 1) matches.set("h", hour12 + 12);
		else if (hour12 === 12 && meridiem === 0) matches.set("h", 0);
	}
	const year = num("y");
	if (num("G") === 0 && year) matches.set("y", -year);
	const fraction = matches.get("u");
	if (fraction !== undefined) matches.set("S", parseMillis(String(fraction)));

	for (const [key, value] of matches) {
		const field = Object.hasOwn(FIELD_OF_KEY, key)
			? FIELD_OF_KEY[key]
			: undefined;
		if (field !== undefined && typeof value === "number") {
			out.fields[field] = value;
		}
	}
	return out;
}

// ─── Calendar conversions (ISO weeks, ordinal days) ──────────

const DAY_MS = 86_400_000;

export interface CalendarDay {
	year: number;
	month: number;
	day: number;
}

/** Epoch milliseconds of a UTC midnight; years 0-99 stay literal. */
export function utcDayMs(year: number, month: number, day: number): number {
	const d = new Date(0);
	d.setUTCFullYear(year, month - 1, day);
	return d.getTime();
}

export function dayOfMs(ms: number): CalendarDay {
	const d = new Date(ms);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
	};
}

/** ISO weekday, 1 = Monday. */
export function isoWeekday(day: CalendarDay): number {
	const js = new Date(utcDayMs(day.year, day.month, day.day)).getUTCDay();
	return js === 0 ? 7 : js;
}

/** Monday of ISO week 1: the week holding January 4th. */
function firstIsoMonday(weekYear: number): number {
	const jan4 = { year: weekYear, month: 1, day: 4 };
	return utcDayMs(weekYear, 1, 4) - (isoWeekday(jan4) - 1) * DAY_MS;
}

export function isoWeeksInYear(weekYear: number): number {
	return Math.round(
		(firstIsoMonday(weekYear + 1) - firstIsoMonday(weekYear)) / (7 * DAY_MS),
	);
}

export function daysInYearOf(year: number): number {
	return Math.round((utcDayMs(year + 1, 1, 1) - utcDayMs(year, 1, 1)) / DAY_MS);
}

export function isoWeekToDay(
	weekYear: number,
	weekNumber: number,
	weekday: number,
): CalendarDay {
	return dayOfMs(
		firstIsoMonday(weekYear) + ((weekNumber - 1) * 7 + weekday - 1) * DAY_MS,
	);
}

export function dayToIsoWeek(day: CalendarDay): {
	weekYear: number;
	weekNumber: number;
	weekday: number;
} {
	const ms = utcDayMs(day.year, day.month, day.day);
	let weekYear = day.year + 1;
	while (firstIsoMonday(weekYear) > ms) weekYear -= 1;
	return {
		weekYear,
		weekNumber: Math.floor((ms - firstIsoMonday(weekYear)) / (7 * DAY_MS)) + 1,
		weekday: isoWeekday(day),
	};
}

export function ordinalToDay(year: number, ordinal: number): CalendarDay {
	return dayOfMs(utcDayMs(year, 1, 1) + (ordinal - 1) * DAY_MS);
}

export function dayToOrdinal(day: CalendarDay): number {
	const start = utcDayMs(day.year, 1, 1);
	return (
		Math.round((utcDayMs(day.year, day.month, day.day) - start) / DAY_MS) + 1
	);
}
