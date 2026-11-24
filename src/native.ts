/**
 * Universal engine loader — auto-detects Node (NAPI) vs Browser (WASM).
 *
 * **No fallback.** If neither NAPI nor WASM loads, `nativeChronos()` throws
 * immediately. Chronos operations (timezone, DST, RFC 5545) are too complex
 * for a pure-TS fallback.
 */

import type { ErrorClass } from "@c9up/flare";
import {
	E_CHRONOS_ENGINE_REQUIRED,
	E_CHRONOS_INTERNAL,
	E_CHRONOS_INVALID_DATE,
	E_CHRONOS_INVALID_YEAR,
	E_CHRONOS_OUT_OF_RANGE,
	E_CHRONOS_UNKNOWN_COUNTRY,
	E_CHRONOS_UNKNOWN_REGION,
	E_CHRONOS_UNKNOWN_ZONE,
	E_CHRONOS_UNREADABLE_RRULE,
	E_CHRONOS_UNSUPPORTED_UNIT,
} from "./errors.js";

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

/**
 * The npm name the platform packages derive from: `@c9up/chronos-<suffix>`,
 * one per target, each an optional dependency pinned to this version.
 */
const PACKAGE_NAME = "@c9up/chronos";

/** Node's `platform-arch` → the suffix napi-rs builds under. */
const NAPI_TARGETS: Record<string, string> = {
	"linux-x64": "linux-x64-gnu",
	"linux-arm64": "linux-arm64-gnu",
	"darwin-x64": "darwin-x64",
	"darwin-arm64": "darwin-arm64",
	"win32-x64": "win32-x64-msvc",
};

let native: NativeChronos | undefined;
let loadError: unknown;
/** What to do about a missing engine, phrased for whoever has to fix it. */
let unavailableFix = "cd packages/chronos && pnpm build:wasm";

const isNode =
	typeof globalThis.process !== "undefined" &&
	typeof globalThis.process.versions?.node === "string";

/** Whether `cause` is Node's "no such module" (and not a module that failed to load). */
function isModuleNotFound(cause: unknown): boolean {
	return (
		cause instanceof Error && Reflect.get(cause, "code") === "MODULE_NOT_FOUND"
	);
}

/**
 * What to do about a NAPI engine that did not load.
 *
 * An application installs the platform package; a checkout of chronos builds
 * the local binary. The load error itself is not in here: it names paths on
 * the host, so it travels as the refusal's `cause` instead of its message.
 */
function nodeRemedy(
	target: string,
	suffix: string | undefined,
	platformPackage: string | undefined,
): string {
	if (suffix === undefined) {
		return `no prebuilt binary for ${target}; chronos ships one for ${Object.keys(NAPI_TARGETS).join(", ")}.`;
	}
	if (platformPackage === undefined) {
		return `index.${suffix}.node failed to load. Rebuild it: cd packages/chronos && pnpm build:napi`;
	}
	const musl = target.startsWith("linux-")
		? " On Alpine/musl, the gnu binary will not load — build the musl target."
		: "";
	return (
		`install ${platformPackage} at the exact version of ${PACKAGE_NAME}: it is the optional dependency that carries the ${suffix} binary, ` +
		"and an install that omits optional dependencies skips it. " +
		`In a checkout of chronos, build it instead: pnpm build:napi.${musl}`
	);
}

if (isNode) {
	let target = "unknown";
	let suffix: string | undefined;
	let platformPackage: string | undefined;
	try {
		const { createRequire } = await import("node:module");
		const { dirname, join } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const { arch, platform } = await import("node:process");

		const nodeRequire = createRequire(import.meta.url);
		const currentDir = dirname(fileURLToPath(import.meta.url));
		target = `${platform}-${arch}`;
		suffix = NAPI_TARGETS[target];
		if (suffix !== undefined) {
			// The local file first: a checkout builds it there (`build:napi`), so
			// tests run the Rust they just compiled. A published tarball carries
			// no `.node` file, so an install falls through to the platform
			// package its package manager picked for this host. A local file
			// that exists but fails to load is a broken build, reported as is.
			try {
				native = nodeRequire(join(currentDir, `../index.${suffix}.node`));
			} catch (cause) {
				if (!isModuleNotFound(cause)) throw cause;
				platformPackage = `${PACKAGE_NAME}-${suffix}`;
				native = nodeRequire(platformPackage);
			}
		}
	} catch (e) {
		loadError = e;
	}
	unavailableFix = nodeRemedy(target, suffix, platformPackage);
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
			parseSql: (input, zone) => wasm.parse_sql(input, zone),
			parseHttp: (input) => wasm.parse_http(input),
			rruleExpand: (start, rrule, limit, tzid) =>
				wasm.rrule_expand(start, rrule, limit, tzid),
			calendarParts: (iso) => wasm.calendar_parts(iso),
			easterDate: (year) => wasm.easter_date(year),
			holidays: (year, country, region) => wasm.holidays(year, country, region),
			isHoliday: (date, country, region) =>
				wasm.is_holiday(date, country, region),
		};
	} catch (e) {
		loadError = e;
	}
}

/** The codes the engine writes at the start of a message (`E_X: text`). */
const ENGINE_CODES = new Map<string, ErrorClass<[string]>>([
	["E_CHRONOS_INVALID_YEAR", E_CHRONOS_INVALID_YEAR],
	["E_CHRONOS_UNKNOWN_COUNTRY", E_CHRONOS_UNKNOWN_COUNTRY],
	["E_CHRONOS_UNKNOWN_REGION", E_CHRONOS_UNKNOWN_REGION],
	["E_CHRONOS_INVALID_DATE", E_CHRONOS_INVALID_DATE],
]);

/** Which chronos error an engine message without a code stands for. */
function uncodedEngineError(
	method: string,
	message: string,
): ErrorClass<[string]> | undefined {
	if (/^Unknown (?:IANA )?timezone: /.test(message))
		return E_CHRONOS_UNKNOWN_ZONE;
	if (/out of range: years are limited to|is outside 0000-9999/.test(message))
		return E_CHRONOS_OUT_OF_RANGE;
	if (message === "Internal panic in chronos engine") return E_CHRONOS_INTERNAL;
	if (method === "rruleExpand") return E_CHRONOS_UNREADABLE_RRULE;
	if (message.startsWith("Unsupported unit: "))
		return E_CHRONOS_UNSUPPORTED_UNIT;
	if (
		/^Invalid (?:SQL datetime|RFC 2822 date|HTTP date|ISO date-time|naive datetime)[: ]/.test(
			message,
		)
	)
		return E_CHRONOS_INVALID_DATE;
	return undefined;
}

/**
 * The engine refuses with a plain message: an `Error` from NAPI, a string
 * from WASM. Read it back into the chronos error it stands for, with the
 * engine's failure as `cause`; a message chronos does not recognise is
 * rethrown as it came.
 */
function fromEngine(method: string, failure: unknown): unknown {
	const message =
		failure instanceof Error
			? failure.message
			: typeof failure === "string"
				? failure
				: undefined;
	if (message === undefined) return failure;
	const coded = /^(E_CHRONOS_[A-Z_]+): /.exec(message);
	const codedClass = coded ? ENGINE_CODES.get(coded[1] ?? "") : undefined;
	if (coded && codedClass) {
		return new codedClass([message.slice(coded[0].length)], {
			cause: failure,
		});
	}
	const ErrorClass = uncodedEngineError(method, message);
	return ErrorClass ? new ErrorClass([message], { cause: failure }) : failure;
}

/** The engine, with every call's refusal read back into a chronos error. */
function guarded(engine: NativeChronos): NativeChronos {
	const wrappers = new Map<PropertyKey, unknown>();
	return new Proxy(engine, {
		get(target, key) {
			const known = wrappers.get(key);
			if (known !== undefined) return known;
			const value: unknown = Reflect.get(target, key);
			if (typeof value !== "function") return value;
			const method = String(key);
			const wrapper = (...args: unknown[]): unknown => {
				try {
					return Reflect.apply(value, target, args);
				} catch (failure) {
					throw fromEngine(method, failure);
				}
			};
			wrappers.set(key, wrapper);
			return wrapper;
		},
	});
}

let guardedEngine: NativeChronos | undefined;

export function nativeChronos(): NativeChronos {
	if (!native) {
		throw new E_CHRONOS_ENGINE_REQUIRED(
			[isNode ? "Node" : "Browser", unavailableFix],
			loadError === undefined ? undefined : { cause: loadError },
		);
	}
	guardedEngine ??= guarded(native);
	return guardedEngine;
}
