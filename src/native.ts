/**
 * Universal engine loader — auto-detects Node (NAPI) vs Browser (WASM).
 *
 * **No fallback.** If neither NAPI nor WASM loads, `nativeChronos()` throws
 * immediately. Chronos operations (timezone, DST, RFC 5545) are too complex
 * for a pure-TS fallback.
 */

/**
 * The engine's surface, as the Rust declares it.
 *
 * Derived from `./native/generated.js` — written by `pnpm build:napi-types`
 * from napi-derive's own `type-def` output — rather than restated here, where
 * nothing would notice a `pub fn` gaining a parameter or changing its return.
 *
 * The WASM build is held to the same shape below, so the two engines cannot
 * quietly diverge either: the browser glue has to export what the Rust does.
 */
export type NativeChronos = typeof import("./native/generated.js");

let native: NativeChronos | undefined;
let loadError: unknown;

const isNode =
	typeof globalThis.process !== "undefined" &&
	typeof globalThis.process.versions?.node === "string";

if (isNode) {
	try {
		const { createRequire } = await import("node:module");
		const { dirname, join } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const { arch, platform } = await import("node:process");

		const nodeRequire = createRequire(import.meta.url);
		const currentDir = dirname(fileURLToPath(import.meta.url));

		const platformMap: Record<string, string> = {
			"linux-x64": "linux-x64-gnu",
			"linux-arm64": "linux-arm64-gnu",
			"darwin-x64": "darwin-x64",
			"darwin-arm64": "darwin-arm64",
			"win32-x64": "win32-x64-msvc",
		};

		const suffix = platformMap[`${platform}-${arch}`];
		if (suffix) {
			native = nodeRequire(join(currentDir, `../index.${suffix}.node`));
		}
	} catch (e) {
		loadError = e;
	}
} else {
	try {
		// wasm-bindgen preserves Rust snake_case names (start_of, end_of, etc.)
		// while NAPI-RS auto-converts to camelCase. We adapt the WASM module
		// shape (which uses bigint for large integers) to the NativeChronos
		// interface (number-based), so consumers don't deal with the difference.
		const wasm = await import("../wasm/chronos_engine_wasm.js");
		await wasm.default();
		native = {
			add: (iso, amount, unit) => wasm.add(iso, BigInt(amount), unit),
			diff: (a, b, unit) => Number(wasm.diff(a, b, unit)),
			startOf: (iso, unit) => wasm.start_of(iso, unit),
			endOf: (iso, unit) => wasm.end_of(iso, unit),
			format: (iso, pattern) => wasm.format(iso, pattern),
			validateTimezone: (zone) => wasm.validate_timezone(zone),
			toZone: (iso, zone) => wasm.to_zone(iso, zone),
			addInZone: (iso, amount, unit, zone) =>
				wasm.add_in_zone(iso, BigInt(amount), unit, zone),
			startOfInZone: (iso, unit, zone) =>
				wasm.start_of_in_zone(iso, unit, zone),
			endOfInZone: (iso, unit, zone) => wasm.end_of_in_zone(iso, unit, zone),
			diffInZone: (a, b, unit, zone) =>
				Number(wasm.diff_in_zone(a, b, unit, zone)),
			zoneOffset: (iso, zone) => wasm.zone_offset(iso, zone),
			fromLocal: (naive, zone) => wasm.from_local(naive, zone),
			parseRfc2822: (input) => wasm.parse_rfc2822(input),
			parseSql: (input) => wasm.parse_sql(input),
			parseHttp: (input) => wasm.parse_http(input),
			rruleExpand: (start, rrule, limit) =>
				wasm.rrule_expand(start, rrule, limit),
			calendarParts: (iso) => wasm.calendar_parts(iso),
		};
	} catch (e) {
		loadError = e;
	}
}

export function nativeChronos(): NativeChronos {
	if (!native) {
		throw new Error(
			`[CHRONOS_ENGINE_REQUIRED] The Chronos engine is required but not loaded.\n` +
				`  Environment: ${isNode ? "Node" : "Browser"}\n` +
				`  Reason: ${loadError ?? "binary not found"}\n` +
				`  Fix (Node): cd packages/chronos && pnpm build:napi\n` +
				`  Fix (Browser): cd packages/chronos && pnpm build:wasm`,
		);
	}
	return native;
}
