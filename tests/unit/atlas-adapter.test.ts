/**
 * Unit tests for `dateTimeAtlasAdapter` exposed at `@c9up/chronos/atlas`.
 *
 * Verifies the adapter's contract in isolation — no atlas dependency.
 * Mirrors Adonis Lucid's `@column.prepare` / `@column.consume` shape and
 * the structure of `@c9up/atom/atlas`'s test suite (story 35.10).
 *
 * @implements Story 36.14
 */
import { describe, expect, it } from "vitest";
import { dateTimeAtlasAdapter } from "../../src/atlas.js";
import { DateTime } from "../../src/DateTime.js";

/** Narrow away null/undefined without a `!` non-null assertion (which lies to the compiler). */
function defined<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("expected a defined value");
	return value;
}

describe("dateTimeAtlasAdapter", () => {
	describe("consume (DB → model)", () => {
		it("lifts an ISO 8601 string into a DateTime instance", () => {
			// Chronos canonicalizes `.000Z` → `Z` (utils.ts:normalizeIso) — input
			// with `.000Z` round-trips to the compact form. This is the project-
			// wide ISO contract, not adapter behavior.
			const dt = dateTimeAtlasAdapter.consume("2026-04-30T12:00:00.000Z");
			expect(dt).toBeInstanceOf(DateTime);
			expect(dt?.toISO()).toBe("2026-04-30T12:00:00Z");
		});

		it("lifts a JS Date into a DateTime instance", () => {
			const date = new Date("2026-04-30T12:00:00.000Z");
			const dt = dateTimeAtlasAdapter.consume(date);
			expect(dt).toBeInstanceOf(DateTime);
			expect(dt?.toISO()).toBe("2026-04-30T12:00:00Z");
		});

		it("lifts a number as epoch milliseconds", () => {
			// 1714478400000 ms = 2024-04-30T12:00:00Z
			const dt = dateTimeAtlasAdapter.consume(1714478400000);
			expect(dt).toBeInstanceOf(DateTime);
			expect(dt?.toISO()).toBe("2024-04-30T12:00:00Z");
		});

		it("lifts a bigint as epoch milliseconds (matches the number branch)", () => {
			const dt = dateTimeAtlasAdapter.consume(1714478400000n);
			expect(dt).toBeInstanceOf(DateTime);
			expect(dt?.toISO()).toBe("2024-04-30T12:00:00Z");
		});

		it("returns null for null input", () => {
			expect(dateTimeAtlasAdapter.consume(null)).toBeNull();
		});

		it("returns null for undefined input", () => {
			expect(dateTimeAtlasAdapter.consume(undefined)).toBeNull();
		});

		it("preserves an existing DateTime instance verbatim (idempotent)", () => {
			const original = new DateTime("2026-04-30T12:00:00.000Z");
			const out = dateTimeAtlasAdapter.consume(original);
			// Identity, not just equality — re-consume must not allocate.
			expect(out).toBe(original);
		});

		it("throws TypeError on boolean / object / array inputs (the offending type appears in the message)", () => {
			expect(() => dateTimeAtlasAdapter.consume(true)).toThrow(TypeError);
			expect(() => dateTimeAtlasAdapter.consume(true)).toThrow(/boolean/);
			expect(() => dateTimeAtlasAdapter.consume({})).toThrow(TypeError);
			expect(() => dateTimeAtlasAdapter.consume([])).toThrow(TypeError);
		});
	});

	describe("prepare (model → DB)", () => {
		it("emits the ISO 8601 string of a DateTime", () => {
			const dt = new DateTime("2026-04-30T12:00:00.000Z");
			// Same canonicalization caveat as the consume tests.
			expect(dateTimeAtlasAdapter.prepare(dt)).toBe("2026-04-30T12:00:00Z");
		});

		it("returns null for null / undefined input (symmetric with consume)", () => {
			expect(dateTimeAtlasAdapter.prepare(null)).toBeNull();
			expect(dateTimeAtlasAdapter.prepare(undefined)).toBeNull();
		});

		it("throws TypeError when called with a JS Date — message embeds [object Date] AND the wrap hint", () => {
			expect(() => dateTimeAtlasAdapter.prepare(new Date())).toThrow(TypeError);
			// The offending runtime type must be embedded — see AC line 138.
			expect(() => dateTimeAtlasAdapter.prepare(new Date())).toThrow(
				/\[object Date\]/,
			);
			expect(() => dateTimeAtlasAdapter.prepare(new Date())).toThrow(
				/Wrap the value with `new DateTime\(\.\.\.\)`/,
			);
		});

		it("throws TypeError when called with an ISO string", () => {
			expect(() =>
				dateTimeAtlasAdapter.prepare("2026-04-30T12:00:00.000Z"),
			).toThrow(TypeError);
		});

		it("throws TypeError when called with a number / object", () => {
			expect(() => dateTimeAtlasAdapter.prepare(42)).toThrow(TypeError);
			expect(() => dateTimeAtlasAdapter.prepare({})).toThrow(TypeError);
		});
	});

	describe("round-trip identity (consume → prepare) — canonical chronos form", () => {
		// Each row: [label, input, expected canonical output]. Chronos's
		// `normalizeIso` strips `.000Z` → `Z`; subsecond precision (e.g. `.123Z`)
		// is preserved verbatim. The adapter is faithful to that contract.
		const cases: Array<[string, string, string]> = [
			["UTC midday", "2026-04-30T12:00:00.000Z", "2026-04-30T12:00:00Z"],
			[
				"fractional milliseconds preserved",
				"2026-04-30T12:00:00.123Z",
				"2026-04-30T12:00:00.123Z",
			],
			["leap day Feb 29", "2024-02-29T00:00:00.000Z", "2024-02-29T00:00:00Z"],
			["epoch boundary", "1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00Z"],
			// Year > 9999 — JS Date supports up to year 275760 with the extended
			// `±YYYYYY` ISO form. Per AC line 264 ("year > 9999").
			[
				"far future (year 10000)",
				"+010000-01-01T00:00:00.000Z",
				"+010000-01-01T00:00:00Z",
			],
		];
		for (const [label, input, expected] of cases) {
			it(`${label}: ${input} → ${expected}`, () => {
				const consumed = dateTimeAtlasAdapter.consume(input);
				expect(consumed).not.toBeNull();
				if (!consumed)
					throw new Error("precondition: consumed must not be null");
				expect(dateTimeAtlasAdapter.prepare(consumed)).toBe(expected);
				// Re-feeding the canonical form is a fixed point.
				const consumed2 = dateTimeAtlasAdapter.consume(expected);
				expect(dateTimeAtlasAdapter.prepare(defined(consumed2))).toBe(expected);
			});
		}
	});

	describe("immutability", () => {
		it("Object.isFrozen(dateTimeAtlasAdapter) is true", () => {
			expect(Object.isFrozen(dateTimeAtlasAdapter)).toBe(true);
		});

		it("attempts to monkey-patch consume / prepare are no-ops under strict mode", () => {
			// In ESM (modules are always strict), assigning to a frozen property throws.
			// Either branch is acceptable — what matters is that the singleton's
			// behavior remains unchanged.
			const originalConsume = dateTimeAtlasAdapter.consume;
			const tamper = () => {
				(
					dateTimeAtlasAdapter as { consume: (raw: unknown) => unknown }
				).consume = () => "tampered";
			};
			expect(tamper).toThrow(TypeError);
			// Behavior is unchanged regardless of whether the assignment threw —
			// identity check beats a function-call check (a hostile tamperer could
			// replace the function with one that mimics the test's input).
			expect(dateTimeAtlasAdapter.consume).toBe(originalConsume);
			expect(
				dateTimeAtlasAdapter.consume("2026-04-30T12:00:00.000Z"),
			).toBeInstanceOf(DateTime);
		});
	});

	describe("import surface", () => {
		it("dateTimeAtlasAdapter is NOT re-exported from the main @c9up/chronos index", async () => {
			const main = await import("../../src/index.js");
			expect("dateTimeAtlasAdapter" in main).toBe(false);
		});

		it("the adapter is shaped { prepare, consume } and passable directly to @Column(...)", () => {
			expect(typeof dateTimeAtlasAdapter.prepare).toBe("function");
			expect(typeof dateTimeAtlasAdapter.consume).toBe("function");
			// `prepare` and `consume` must be present. Other internal keys are
			// allowed in the future — assert containment, not exact equality, to
			// avoid breaking the test on benign internal additions.
			expect(Object.keys(dateTimeAtlasAdapter)).toEqual(
				expect.arrayContaining(["consume", "prepare"]),
			);
		});
	});
});
