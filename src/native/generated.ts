// GENERATED FROM THE RUST — do not edit.
//
// Produced by scripts/generate-napi-types.mjs from napi-derive's type-def
// output. Editing this file by hand puts it back where it started: a
// description that can disagree with the code it describes.

export interface CalendarPartsNapi {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	millisecond: number;
	weekday: number;
	weekNumber: number;
	weekYear: number;
	ordinal: number;
	quarter: number;
	daysInMonth: number;
	daysInYear: number;
	isLeapYear: boolean;
}

export interface ZonedOutputNapi {
	iso: string;
	offsetMinutes: number;
	zoneName: string;
}

export declare function add(iso: string, amount: number, unit: string): string;

export declare function diff(aIso: string, bIso: string, unit: string): number;

export declare function startOf(iso: string, unit: string): string;

export declare function endOf(iso: string, unit: string): string;

export declare function format(iso: string, pattern: string): string;

export declare function calendarParts(iso: string): CalendarPartsNapi;

export declare function validateTimezone(zone: string): string;

export declare function toZone(utcIso: string, zone: string): ZonedOutputNapi;

export declare function addInZone(
	utcIso: string,
	amount: number,
	unit: string,
	zone: string,
): string;

export declare function startOfInZone(
	utcIso: string,
	unit: string,
	zone: string,
): string;

export declare function endOfInZone(
	utcIso: string,
	unit: string,
	zone: string,
): string;

export declare function diffInZone(
	aUtc: string,
	bUtc: string,
	unit: string,
	zone: string,
): number;

export declare function zoneOffset(utcIso: string, zone: string): number;

export declare function fromLocal(naiveIso: string, zone: string): string;

export declare function parseRfc2822(input: string): string;

export declare function parseSql(input: string): string;

export declare function parseHttp(input: string): string;

export declare function rruleExpand(
	startIso: string,
	rrule: string,
	limit: number,
): Array<string>;
