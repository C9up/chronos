/**
 * @c9up/chronos — advanced date/time and recurrence.
 * The Rust N-API binary is required — there is no JS/TS fallback.
 */

export type {
	BoundUnit,
	CalendarParts,
	DateInput,
	DateRange,
	DateUnit,
	RangeCompareOptions,
	RangeRelation,
} from "./DateTime.js";
export {
	analyzeRange,
	containsRange,
	DateTime,
	inRange,
	overlapsRange,
} from "./DateTime.js";
export type { DurationObject, DurationUnit } from "./Duration.js";
export { Duration } from "./Duration.js";
export { Interval } from "./Interval.js";
export type { RRuleBuild } from "./rrule.js";
export { expandRRule, toRRuleString } from "./rrule.js";

// `isNativeAvailable` removed — NAPI is now mandatory (no fallback).

import {
	analyzeRange,
	containsRange,
	type DateRange,
	DateTime,
	type DateUnit,
	inRange,
	overlapsRange,
	type RangeCompareOptions,
} from "./DateTime.js";
import { expandRRule, type RRuleBuild, toRRuleString } from "./rrule.js";

export function at(input?: string | Date): DateTime {
	return new DateTime(input);
}

export const Chronos = {
	at,
	now: (): DateTime => new DateTime(),
	parse: (input: string | Date): DateTime => new DateTime(input),
	add: (input: string | Date, amount: number, unit: DateUnit): DateTime =>
		new DateTime(input).plus(amount, unit),
	subtract: (input: string | Date, amount: number, unit: DateUnit): DateTime =>
		new DateTime(input).minus(amount, unit),
	diff: (a: string | Date, b: string | Date, unit: DateUnit): number =>
		new DateTime(a).diff(b, unit),
	inRange,
	rangeContains: (
		outer: DateRange,
		inner: DateRange,
		options?: RangeCompareOptions,
	): boolean => containsRange(outer, inner, options),
	rangesOverlap: (
		a: DateRange,
		b: DateRange,
		options?: RangeCompareOptions,
	): boolean => overlapsRange(a, b, options),
	rangeRelation: (a: DateRange, b: DateRange, options?: RangeCompareOptions) =>
		analyzeRange(a, b, options),
	rrule: (
		startIso: string,
		rrule: string | RRuleBuild,
		limit = 100,
	): string[] => expandRRule(startIso, rrule, limit),
	buildRRule: (rule: RRuleBuild): string => toRRuleString(rule),
};
