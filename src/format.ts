/**
 * `toFormat` — Luxon's format tokens (`yyyy-MM-dd HH:mm`, `dd LLL yyyy`,
 * `EEEE`, `ZZ`, …), with Luxon's quoting (`'literal'`, `''` for a quote) and
 * its macro tokens (`D`, `DD`, `t`, `f`, …) rendered through Intl.
 *
 * Numbers are written with Latin digits and names in English unless a locale
 * is given; Luxon reads the host's default locale instead, which made the
 * same call print differently per machine.
 */

export interface FormatParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
	/** ISO weekday, 1 = Monday. */
	weekday: number;
	weekNumber: number;
	weekYear: number;
	ordinal: number;
	quarter: number;
}

export interface FormatContext {
	parts: FormatParts;
	/** Epoch milliseconds. */
	ts: number;
	/** UTC offset in minutes. */
	offset: number;
	zone: string;
	locale: string;
	/** Write a zero offset as `Z` (the UTC zone), as Luxon's ISO and SQL output do. */
	allowZ?: boolean;
}

const MONTHS_LONG = [
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
const WEEKDAYS_LONG = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];

type NameLength = "short" | "long" | "narrow";

const MACROS: Readonly<Record<string, Intl.DateTimeFormatOptions>> = {
	D: { year: "numeric", month: "numeric", day: "numeric" },
	DD: { year: "numeric", month: "short", day: "numeric" },
	DDD: { year: "numeric", month: "long", day: "numeric" },
	DDDD: { year: "numeric", month: "long", day: "numeric", weekday: "long" },
	t: { hour: "numeric", minute: "numeric" },
	tt: { hour: "numeric", minute: "numeric", second: "numeric" },
	ttt: {
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		timeZoneName: "short",
	},
	tttt: {
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		timeZoneName: "long",
	},
	T: { hour: "numeric", minute: "numeric", hourCycle: "h23" },
	TT: {
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hourCycle: "h23",
	},
	TTT: {
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hourCycle: "h23",
		timeZoneName: "short",
	},
	TTTT: {
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hourCycle: "h23",
		timeZoneName: "long",
	},
	f: {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	},
	ff: {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	},
	fff: {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		timeZoneName: "short",
	},
	ffff: {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "long",
		hour: "numeric",
		minute: "numeric",
		timeZoneName: "long",
	},
	F: {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	},
	FF: {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	},
	FFF: {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		timeZoneName: "short",
	},
	FFFF: {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "long",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		timeZoneName: "long",
	},
};

interface Token {
	literal: boolean;
	val: string;
}

/** Luxon's `Formatter.parseFormat`: runs of one letter are a token, `'…'` is literal. */
function parseFormat(fmt: string): Token[] {
	let current: string | null = null;
	let currentFull = "";
	let bracketed = false;
	const splits: Token[] = [];
	for (const c of fmt) {
		if (c === "'") {
			if (currentFull.length > 0 || bracketed) {
				splits.push({
					literal: bracketed || /^\s+$/.test(currentFull),
					val: currentFull === "" ? "'" : currentFull,
				});
			}
			current = null;
			currentFull = "";
			bracketed = !bracketed;
		} else if (bracketed) {
			currentFull += c;
		} else if (c === current) {
			currentFull += c;
		} else {
			if (currentFull.length > 0) {
				splits.push({ literal: /^\s+$/.test(currentFull), val: currentFull });
			}
			currentFull = c;
			current = c;
		}
	}
	if (currentFull.length > 0) {
		splits.push({
			literal: bracketed || /^\s+$/.test(currentFull),
			val: currentFull,
		});
	}
	return splits;
}

function pad(n: number | string, width = 0): string {
	const value = typeof n === "number" ? n : Number(n);
	const sign = value < 0 ? "-" : "";
	return sign + String(Math.abs(value)).padStart(width, "0");
}

function formatOffset(
	offset: number,
	format: "narrow" | "short" | "techie",
	allowZ = false,
): string {
	if (allowZ && offset === 0) return "Z";
	const hours = Math.trunc(Math.abs(offset / 60));
	const minutes = Math.trunc(Math.abs(offset % 60));
	const sign = offset >= 0 ? "+" : "-";
	switch (format) {
		case "short":
			return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}`;
		case "narrow":
			return `${sign}${hours}${minutes > 0 ? `:${minutes}` : ""}`;
		default:
			return `${sign}${pad(hours, 2)}${pad(minutes, 2)}`;
	}
}

function isEnglish(locale: string): boolean {
	return /^en(?:-|$)/i.test(locale);
}

/** One part of an Intl rendering of the instant, in its zone. */
function intlPart(
	ctx: FormatContext,
	options: Intl.DateTimeFormatOptions,
	type: Intl.DateTimeFormatPartTypes,
): string {
	const parts = new Intl.DateTimeFormat(ctx.locale, {
		...options,
		timeZone: ctx.zone,
	}).formatToParts(new Date(ctx.ts));
	return parts.find((p) => p.type === type)?.value ?? "";
}

function monthName(
	ctx: FormatContext,
	length: NameLength,
	standalone: boolean,
): string {
	if (isEnglish(ctx.locale)) {
		const name = MONTHS_LONG[ctx.parts.month - 1] ?? "";
		if (length === "long") return name;
		return length === "short" ? name.slice(0, 3) : name.slice(0, 1);
	}
	return intlPart(
		ctx,
		standalone ? { month: length } : { month: length, day: "numeric" },
		"month",
	);
}

function weekdayName(
	ctx: FormatContext,
	length: NameLength,
	standalone: boolean,
): string {
	if (isEnglish(ctx.locale)) {
		const name = WEEKDAYS_LONG[ctx.parts.weekday - 1] ?? "";
		if (length === "long") return name;
		return length === "short" ? name.slice(0, 3) : name.slice(0, 1);
	}
	return intlPart(
		ctx,
		standalone
			? { weekday: length }
			: { weekday: length, month: "long", day: "numeric" },
		"weekday",
	);
}

function tokenToString(token: string, ctx: FormatContext): string {
	const p = ctx.parts;
	const english = isEnglish(ctx.locale);
	switch (token) {
		case "S":
			return pad(p.millisecond);
		case "u":
		case "SSS":
			return pad(p.millisecond, 3);
		case "s":
			return pad(p.second);
		case "ss":
			return pad(p.second, 2);
		case "uu":
			return pad(Math.floor(p.millisecond / 10), 2);
		case "uuu":
			return pad(Math.floor(p.millisecond / 100));
		case "m":
			return pad(p.minute);
		case "mm":
			return pad(p.minute, 2);
		case "h":
			return pad(p.hour % 12 === 0 ? 12 : p.hour % 12);
		case "hh":
			return pad(p.hour % 12 === 0 ? 12 : p.hour % 12, 2);
		case "H":
			return pad(p.hour);
		case "HH":
			return pad(p.hour, 2);
		case "Z":
			return formatOffset(ctx.offset, "narrow", ctx.allowZ);
		case "ZZ":
			return formatOffset(ctx.offset, "short", ctx.allowZ);
		case "ZZZ":
			return formatOffset(ctx.offset, "techie", ctx.allowZ);
		case "ZZZZ":
			return intlPart(ctx, { timeZoneName: "short" }, "timeZoneName");
		case "ZZZZZ":
			return intlPart(ctx, { timeZoneName: "long" }, "timeZoneName");
		case "z":
			return ctx.zone;
		case "a":
			return english
				? p.hour < 12
					? "AM"
					: "PM"
				: intlPart(ctx, { hour: "numeric", hourCycle: "h12" }, "dayPeriod");
		case "d":
			return pad(p.day);
		case "dd":
			return pad(p.day, 2);
		case "c":
		case "E":
			return pad(p.weekday);
		case "ccc":
			return weekdayName(ctx, "short", true);
		case "cccc":
			return weekdayName(ctx, "long", true);
		case "ccccc":
			return weekdayName(ctx, "narrow", true);
		case "EEE":
			return weekdayName(ctx, "short", false);
		case "EEEE":
			return weekdayName(ctx, "long", false);
		case "EEEEE":
			return weekdayName(ctx, "narrow", false);
		case "L":
		case "M":
			return pad(p.month);
		case "LL":
		case "MM":
			return pad(p.month, 2);
		case "LLL":
			return monthName(ctx, "short", true);
		case "LLLL":
			return monthName(ctx, "long", true);
		case "LLLLL":
			return monthName(ctx, "narrow", true);
		case "MMM":
			return monthName(ctx, "short", false);
		case "MMMM":
			return monthName(ctx, "long", false);
		case "MMMMM":
			return monthName(ctx, "narrow", false);
		case "y":
			return pad(p.year);
		case "yy":
			return pad(p.year.toString().slice(-2), 2);
		case "yyyy":
			return pad(p.year, 4);
		case "yyyyyy":
			return pad(p.year, 6);
		case "G":
			return english
				? p.year > 0
					? "AD"
					: "BC"
				: intlPart(ctx, { era: "short" }, "era");
		case "GG":
			return english
				? p.year > 0
					? "Anno Domini"
					: "Before Christ"
				: intlPart(ctx, { era: "long" }, "era");
		case "GGGGG":
			return english
				? p.year > 0
					? "A"
					: "B"
				: intlPart(ctx, { era: "narrow" }, "era");
		case "kk":
			return pad(p.weekYear.toString().slice(-2), 2);
		case "kkkk":
			return pad(p.weekYear, 4);
		case "W":
			return pad(p.weekNumber);
		case "WW":
			return pad(p.weekNumber, 2);
		case "o":
			return pad(p.ordinal);
		case "ooo":
			return pad(p.ordinal, 3);
		case "q":
			return pad(p.quarter);
		case "qq":
			return pad(p.quarter, 2);
		case "X":
			return pad(Math.floor(ctx.ts / 1000));
		case "x":
			return pad(ctx.ts);
		default: {
			const macro = Object.hasOwn(MACROS, token) ? MACROS[token] : undefined;
			if (macro === undefined) return token;
			const dtf = new Intl.DateTimeFormat(ctx.locale, {
				...macro,
				timeZone: ctx.zone,
			});
			// Luxon renders a UTC value from its parts, which keep ICU's narrow
			// no-break space before AM/PM; `format()` swaps it for a plain one.
			return ctx.zone === "UTC"
				? dtf
						.formatToParts(new Date(ctx.ts))
						.map((part) => part.value)
						.join("")
				: dtf.format(new Date(ctx.ts));
		}
	}
}

export function formatLuxon(fmt: string, ctx: FormatContext): string {
	let out = "";
	for (const token of parseFormat(fmt)) {
		out += token.literal ? token.val : tokenToString(token.val, ctx);
	}
	return out;
}
