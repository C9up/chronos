/**
 * Type stub for the WASM module emitted by `wasm-pack build` during the
 * chronos release pipeline. The actual `.js` + `.wasm` artifacts are not
 * checked into the source tree; they live alongside this `.d.ts` at
 * publish time so the browser/edge fallback path in `src/native.ts`
 * resolves at runtime. The stub lets `tsc --noEmit` typecheck during
 * development without forcing every contributor to run `wasm-pack`.
 *
 * Signature mirrors the wasm-bindgen-generated `chronos_engine_wasm.js`,
 * preserving Rust snake_case names that `src/native.ts` adapts to the
 * camelCase `NativeChronos` interface.
 */
export default function init(): Promise<unknown>;
export function add(iso: string, amount: bigint, unit: string): string;
export function diff(a: string, b: string, unit: string): bigint;
export function start_of(iso: string, unit: string): string;
export function end_of(iso: string, unit: string): string;
export function format(iso: string, pattern: string): string;
export function validate_timezone(zone: string): string;
export function to_zone(
	iso: string,
	zone: string,
): { iso: string; offsetMinutes: number; zoneName: string };
export function add_in_zone(
	iso: string,
	amount: bigint,
	unit: string,
	zone: string,
): string;
export function diff_in_zone(
	a: string,
	b: string,
	unit: string,
	zone: string,
): bigint;
export function zone_offset(iso: string, zone: string): number;
export function from_local(naive: string, zone: string): string;
export function parse_rfc2822(input: string): string;
export function parse_sql(input: string): string;
export function parse_http(input: string): string;
export function rrule_expand(
	start: string,
	rrule: string,
	limit: number,
): string[];
export function calendar_parts(iso: string): {
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
};
