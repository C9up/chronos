/**
 * Shared helpers for DateTime and RRule modules.
 */

/**
 * Normalize an ISO 8601 string: strip the `.000` when subseconds are zero
 * for compact output that matches `new Date(iso).toISOString().replace('.000Z', 'Z')`.
 * When subseconds are non-zero, preserve them so precision isn't silently lost.
 */
export function normalizeIso(iso: string): string {
	return iso.replace(".000Z", "Z");
}
