/**
 * `@c9up/chronos/atlas` — Atlas column-type adapter for {@link DateTime}.
 *
 * Wires `Chronos.DateTime` into Atlas's `@Column({ prepare, consume })` opt-in
 * column pipeline. Lives on a sub-export so the default `@c9up/chronos` import
 * surface stays adapter-free.
 *
 * Mirrors Adonis Lucid's `@column.prepare` / `@column.consume` pattern —
 * callbacks are baked into the entity definition; no global registry, no
 * boot-time wiring. Same shape as `@c9up/atom/atlas` (story 35.10).
 *
 * Usage (imports referenced here as prose to keep this JSDoc free of literal
 * `from "@c9up/<sibling>"` strings — that pattern would create false positives
 * for the no-cross-package-import grep gate):
 *
 *     // Pull `Column`, `Entity`, `BaseEntity`, `PrimaryKey` from @c9up/atlas
 *     // Pull `DateTime` from @c9up/chronos
 *     // Pull `dateTimeAtlasAdapter` from @c9up/chronos/atlas
 *
 *     @Entity('events')
 *     class Event extends BaseEntity {
 *       @PrimaryKey() id!: number
 *       @Column(dateTimeAtlasAdapter) createdAt!: DateTime | null
 *     }
 *
 * @implements Story 36.14
 */

import { DateTime } from "./DateTime.js";

/**
 * Cross-realm-safe `DateTime` check. Returns `true` if `value` is either:
 *   - a `DateTime` from the current module-realm (`instanceof` matches), OR
 *   - a structurally-compatible `DateTime` from another realm — i.e. an
 *     object exposing both `toISO(): string` and `equals(other): boolean`,
 *     the two methods this adapter relies on.
 *
 * The fallback is needed when pnpm hoisting + transitive duplication produce
 * two distinct `DateTime` constructors at runtime (workspace symlinks +
 * a separately-installed copy under a parent `node_modules`). Without it,
 * `instanceof` returns `false` for instances built from the consumer's
 * own import, and `prepare` would reject perfectly valid `DateTime` values.
 */
function isDateTimeLike(value: unknown): value is DateTime {
	if (value instanceof DateTime) return true;
	if (value === null || typeof value !== "object") return false;
	const obj = value as { toISO?: unknown; equals?: unknown };
	return typeof obj.toISO === "function" && typeof obj.equals === "function";
}

/**
 * Atlas adapter for `timestamp` / `timestamptz` / `datetime` columns.
 * `consume` lifts string / `Date` / `number` / `bigint` DB values into a
 * {@link DateTime}; `prepare` lowers a `DateTime` back to its ISO 8601 string
 * for the SQL bind parameter.
 *
 * - `consume(null)` / `consume(undefined)` returns `null` so nullable columns
 *   keep their semantics through the adapter pipeline.
 * - `consume(existingDateTime)` is idempotent — re-consuming an already-
 *   hydrated value returns the same instance untouched.
 * - `consume(number)` and `consume(bigint)` are interpreted as **epoch
 *   milliseconds** (matches `Date(ms)` and `DateTime.fromMillis`). If a driver
 *   returns timestamps as integer seconds (e.g., a Postgres `int8` column
 *   storing unix epochs), wrap them yourself: `new DateTime(seconds * 1000)`.
 * - `prepare(null)` / `prepare(undefined)` returns `null` symmetrically.
 * - `prepare` rejects anything that is not a `DateTime` instance — protects
 *   against the common "I forgot to wrap" footgun where a JS `Date` or ISO
 *   string would otherwise silently land in the bind parameter and bypass the
 *   chronos engine's normalization.
 *
 * **Round-trip canonicalization:** chronos's internal ISO normalization
 * collapses trailing `.000Z` to a bare `Z`. So
 * `prepare(consume('2026-04-30T12:00:00.000Z'))` returns
 * `'2026-04-30T12:00:00Z'` — same instant, compact form. Subsecond precision
 * with non-zero digits (e.g., `.123Z`) is preserved verbatim.
 *
 * **Driver expectations:** `timestamp` columns may come back from the driver
 * as either an ISO 8601 `string`, a JS `Date`, or (rarely) an integer epoch.
 * `node-postgres` returns `Date` for `timestamp` / `timestamptz` by default;
 * SQLite returns whatever the bound type was; configuring drivers to emit
 * ISO strings or `Date` is the supported path. Strings that are NOT parseable
 * ISO 8601 will surface a `RangeError: Invalid time value` from the
 * underlying `Date` constructor — align your DB column / driver settings with
 * ISO 8601 wire format.
 *
 * **Timezone handling — UTC-only:** chronos's internal storage is always UTC.
 * Consequences for this adapter:
 *   - Z-suffixed ISO (`'2026-04-30T12:00:00Z'`) → exactly UTC, no
 *     transformation.
 *   - Offset-bearing ISO (`'2026-04-30T12:00:00+02:00'`) → silently
 *     UTC-rebased to `'2026-04-30T10:00:00Z'`. The original offset is NOT
 *     preserved on round-trip. Pair with `timestamptz` columns (the only
 *     SQL type whose contract is "store UTC instant"). Do **not** use this
 *     adapter for `timestamp without time zone` columns where wall-clock
 *     fidelity matters — you will lose the offset on read and silently
 *     rebase on write.
 *   - Naive ISO (`'2026-04-30T12:00:00'` or SQLite-style
 *     `'2026-04-30 12:00:00'`, no `Z`, no offset) → parsed by `new Date(...)`
 *     in the JS runtime's **local** zone. This means the same DB row hydrates
 *     differently across machines (CI host on UTC vs. dev laptop in
 *     Europe/Zurich). Do **not** store naive timestamps in columns reaching
 *     this adapter; configure your DB / driver to emit Z-suffixed strings or
 *     `Date` instances, or pre-process via `DateTime.fromSQL`.
 *
 * **Stacking caveat with `@column.dateTime({ autoCreate, autoUpdate })`:**
 * the auto-timestamp decorator (story 32.8) writes `new Date()` (a JS `Date`)
 * to the entity property when `autoCreate` / `autoUpdate` is set. If you
 * ALSO tag the same property with `@Column(dateTimeAtlasAdapter)`, `prepare`
 * will receive a `Date` and throw the "expected a DateTime instance"
 * `TypeError` at INSERT / UPDATE time. **Only the `autoCreate` / `autoUpdate`
 * flags conflict** — plain `@column.dateTime()` (no flags) does not write
 * anything and is safe to stack. Mitigations when you need auto-timestamps:
 *   - **Adapter only**: drop `@column.dateTime({ autoCreate, autoUpdate })`
 *     and assign manually (e.g., in a model hook:
 *     `entity.createdAt = DateTime.now()`).
 *   - **`@column.dateTime({ ... })` only**: drop the adapter and manually
 *     wrap reads with `new DateTime(row.createdAt)` at the call site.
 * The adapter does NOT silently coerce `Date` → `DateTime` because that
 * would mask the inconsistency between the two mechanisms.
 *
 * The shape `{ prepare, consume }` is **passable directly** to `@Column(...)`:
 * `@Column(dateTimeAtlasAdapter)` is identical to
 * `@Column({ prepare: dateTimeAtlasAdapter.prepare, consume: dateTimeAtlasAdapter.consume })`.
 *
 * The exported object is `Object.freeze`d, which blocks the most common
 * direct-assignment tampering of the adapter's own slots. `Object.freeze`
 * is shallow: prototype-level mutation of `DateTime` itself, or wholesale
 * replacement via `structuredClone(adapter)` followed by re-binding, are
 * out of scope for the freeze defense.
 *
 * **Cross-realm safety:** `consume` and `prepare` test the input via a
 * structural duck-typed check (`toISO` + `equals` methods present), not a
 * plain `instanceof DateTime`. This protects against pnpm-hoisting quirks
 * where a consumer's `DateTime` import resolves to a duplicate copy of the
 * class — the adapter still recognizes it as a `DateTime` and round-trips
 * cleanly.
 */
export const dateTimeAtlasAdapter = Object.freeze({
	consume(raw: unknown): DateTime | null {
		if (raw === null || raw === undefined) return null;
		if (isDateTimeLike(raw)) return raw;
		if (raw instanceof Date) return DateTime.fromJSDate(raw);
		if (typeof raw === "string") return new DateTime(raw);
		if (typeof raw === "number") return DateTime.fromMillis(raw);
		if (typeof raw === "bigint") return DateTime.fromMillis(Number(raw));
		throw new TypeError(
			`dateTimeAtlasAdapter.consume: expected string | Date | DateTime | number | bigint | null, got ${typeof raw}`,
		);
	},
	prepare(value: unknown): string | null {
		if (value === null || value === undefined) return null;
		if (!isDateTimeLike(value)) {
			throw new TypeError(
				`dateTimeAtlasAdapter.prepare: expected a DateTime instance, got ${typeof value === "object" ? Object.prototype.toString.call(value) : typeof value}. ` +
					"Wrap the value with `new DateTime(...)` before assigning to a column tagged with this adapter.",
			);
		}
		return value.toISO();
	},
});
