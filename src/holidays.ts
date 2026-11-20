import { DateTime } from "./DateTime.js";
import { nativeChronos } from "./native.js";

/** The countries chronos has a public-holiday calendar for. */
export type HolidayCountry = "CH" | "FR";

/** The 26 Swiss cantons by their two-letter codes, in the federal order. */
export const SWISS_CANTONS = [
	"ZH",
	"BE",
	"LU",
	"UR",
	"SZ",
	"OW",
	"NW",
	"GL",
	"ZG",
	"FR",
	"SO",
	"BS",
	"BL",
	"SH",
	"AR",
	"AI",
	"SG",
	"GR",
	"AG",
	"TG",
	"TI",
	"VD",
	"VS",
	"NE",
	"GE",
	"JU",
] as const;

export type SwissCanton = (typeof SWISS_CANTONS)[number];

/**
 * Where the holidays apply: a country, and for Switzerland optionally a
 * canton. Without one, Switzerland's answer is its three federal days only.
 */
export type HolidayOptions =
	| { country: "CH"; region?: SwissCanton }
	| { country: "FR"; region?: undefined };

/** The stable keys a holiday carries, for the application to translate. */
export type HolidayKey =
	| "new_year"
	| "saint_berchtold"
	| "epiphany"
	| "republic_day"
	| "saint_joseph"
	| "naefelser_fahrt"
	| "good_friday"
	| "easter_monday"
	| "labour_day"
	| "victory_in_europe"
	| "ascension"
	| "whit_monday"
	| "corpus_christi"
	| "plebiscite_commemoration"
	| "saints_peter_and_paul"
	| "national_day"
	| "assumption"
	| "geneva_fast"
	| "federal_fast_monday"
	| "nicholas_of_flue"
	| "all_saints"
	| "armistice"
	| "immaculate_conception"
	| "christmas"
	| "saint_stephen"
	| "restoration_of_the_republic";

/** One public holiday: its calendar date (`YYYY-MM-DD`) and its key. */
export interface Holiday {
	date: string;
	key: HolidayKey;
}

const HOLIDAY_KEYS: ReadonlySet<string> = new Set<HolidayKey>([
	"new_year",
	"saint_berchtold",
	"epiphany",
	"republic_day",
	"saint_joseph",
	"naefelser_fahrt",
	"good_friday",
	"easter_monday",
	"labour_day",
	"victory_in_europe",
	"ascension",
	"whit_monday",
	"corpus_christi",
	"plebiscite_commemoration",
	"saints_peter_and_paul",
	"national_day",
	"assumption",
	"geneva_fast",
	"federal_fast_monday",
	"nicholas_of_flue",
	"all_saints",
	"armistice",
	"immaculate_conception",
	"christmas",
	"saint_stephen",
	"restoration_of_the_republic",
]);

function isHolidayKey(key: string): key is HolidayKey {
	return HOLIDAY_KEYS.has(key);
}

/**
 * Easter Sunday of `year` (Gregorian computus, years 1583-9999), as
 * `YYYY-MM-DD`. Throws `E_CHRONOS_INVALID_YEAR` outside that range.
 */
export function easterDate(year: number): string {
	return nativeChronos().easterDate(checkYear(year));
}

/**
 * The public holidays of `year`, sorted by date then key. Two holidays on one
 * day are both listed. An unknown country or canton is refused
 * (`E_CHRONOS_UNKNOWN_COUNTRY`, `E_CHRONOS_UNKNOWN_REGION`), never answered
 * with an empty list.
 */
export function holidays(year: number, options: HolidayOptions): Holiday[] {
	return nativeChronos()
		.holidays(checkYear(year), options.country, options.region)
		.map(({ date, key }) => {
			if (!isHolidayKey(key)) {
				throw new Error(`chronos engine returned an unknown holiday ${key}`);
			}
			return { date, key };
		});
}

/**
 * Whether a day is a public holiday. A `DateTime` is read on its own wall
 * clock (its zone's calendar date); a string must be a calendar date
 * `YYYY-MM-DD` (`E_CHRONOS_INVALID_DATE` otherwise).
 */
export function isHoliday(
	date: string | DateTime,
	options: HolidayOptions,
): boolean {
	const day = date instanceof DateTime ? date.toISODate() : date;
	return nativeChronos().isHoliday(day, options.country, options.region);
}

/** The engine takes an i32: a fraction or a huge number is refused first. */
function checkYear(year: number): number {
	if (!Number.isInteger(year) || year < 1583 || year > 9999) {
		throw new RangeError(
			`E_CHRONOS_INVALID_YEAR: the Gregorian Easter date is computed for years 1583-9999, got ${year}`,
		);
	}
	return year;
}
