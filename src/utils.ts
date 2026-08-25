/**
 * Shared helpers for DateTime and RRule modules.
 */

/**
 * Normalize an ISO 8601 string.
 *
 * Milliseconds are KEPT even when zero, so `toISO()` reads
 * `2026-07-15T10:00:00.000Z` — what Luxon's `toISO()` returns, and therefore
 * what `@adonisjs/lucid` puts in a serialized model. Chronos used to strip
 * `.000`, which is Luxon's opt-in `toISO({ suppressMilliseconds: true })`:
 * the same instant, a different literal, and a silent difference in every JSON
 * payload carrying a date.
 */
export function normalizeIso(iso: string): string {
	return iso;
}
