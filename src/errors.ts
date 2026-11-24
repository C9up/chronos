/**
 * Chronos errors, one class per code. A caller matches on `error.code` or on
 * `error instanceof errors.E_CHRONOS_...`.
 */
import { createError } from "@c9up/flare";

/**
 * The engine (the NAPI binary in Node, the WASM build in a browser) did not
 * load. In Node, the message names the platform package to install; the load
 * error is the `cause`.
 */
export const E_CHRONOS_ENGINE_REQUIRED = createError<
	[environment: string, fix: string]
>(
	"The Chronos engine is required but not loaded.\n" +
		"  Environment: %s\n" +
		"  Fix: %s",
	"E_CHRONOS_ENGINE_REQUIRED",
);

/** An argument of the wrong type, or an unknown `rounding`. */
export const E_CHRONOS_INVALID_ARGUMENT = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_ARGUMENT",
);

/** A value or an arithmetic result outside years 0000-9999. */
export const E_CHRONOS_OUT_OF_RANGE = createError<[string]>(
	"%s",
	"E_CHRONOS_OUT_OF_RANGE",
);

/** A format mixes fields that contradict each other. */
export const E_CHRONOS_CONFLICTING_FIELDS = createError<[string]>(
	"%s",
	"E_CHRONOS_CONFLICTING_FIELDS",
);

/** A unit chronos does not know. */
export const E_CHRONOS_UNSUPPORTED_UNIT = createError<[string]>(
	"%s",
	"E_CHRONOS_UNSUPPORTED_UNIT",
);

/** An operation that counts in units got none. */
export const E_CHRONOS_MISSING_UNIT = createError<[string]>(
	"%s",
	"E_CHRONOS_MISSING_UNIT",
);

/** A unit amount that is not a finite number. */
export const E_CHRONOS_INVALID_UNIT_VALUE = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_UNIT_VALUE",
);

/** A duration that cannot be read or used. */
export const E_CHRONOS_INVALID_DURATION = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_DURATION",
);

/** An interval whose start is after its end, or that does not parse. */
export const E_CHRONOS_INVALID_INTERVAL = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_INTERVAL",
);

/** A date range that starts after it ends, or holds an invalid date. */
export const E_CHRONOS_INVALID_RANGE = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_RANGE",
);

/** A locale tag `Intl` does not accept. */
export const E_CHRONOS_INVALID_LOCALE = createError<[string]>(
	"Invalid locale: %s",
	"E_CHRONOS_INVALID_LOCALE",
);

/** A structured rule field that cannot be written into the rule text. */
export const E_CHRONOS_INVALID_RRULE = createError<[string, string]>(
	"toRRuleString: invalid %s %s",
	"E_CHRONOS_INVALID_RRULE",
);

/** Rule text the engine cannot read or expand. */
export const E_CHRONOS_UNREADABLE_RRULE = createError<[string]>(
	"%s",
	"E_CHRONOS_UNREADABLE_RRULE",
);

/** The `expandRRule` limit is not a positive integer. */
export const E_CHRONOS_INVALID_RRULE_LIMIT = createError<[string]>(
	"expandRRule(limit) must be a positive integer (got %s)",
	"E_CHRONOS_INVALID_RRULE_LIMIT",
);

/** The `expandRRule` limit is above the safety cap. */
export const E_CHRONOS_RRULE_LIMIT_EXCEEDED = createError<[number, number]>(
	"expandRRule(limit=%s) exceeds the safety cap of %s. Page through the result set instead of asking for everything at once.",
	"E_CHRONOS_RRULE_LIMIT_EXCEEDED",
);

/** The atlas column adapter got a value it cannot read or store. */
export const E_CHRONOS_INVALID_COLUMN_VALUE = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_COLUMN_VALUE",
);

/** A year outside the Gregorian computus (1583-9999). */
export const E_CHRONOS_INVALID_YEAR = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_YEAR",
);

/** A country with no holiday calendar. */
export const E_CHRONOS_UNKNOWN_COUNTRY = createError<[string]>(
	"%s",
	"E_CHRONOS_UNKNOWN_COUNTRY",
);

/** A region the country does not have. */
export const E_CHRONOS_UNKNOWN_REGION = createError<[string]>(
	"%s",
	"E_CHRONOS_UNKNOWN_REGION",
);

/** A zone the tz database does not know. */
export const E_CHRONOS_UNKNOWN_ZONE = createError<[string]>(
	"%s",
	"E_CHRONOS_UNKNOWN_ZONE",
);

/** A date that does not exist or does not parse. */
export const E_CHRONOS_INVALID_DATE = createError<[string]>(
	"%s",
	"E_CHRONOS_INVALID_DATE",
);

/** The engine answered something chronos does not expect. */
export const E_CHRONOS_INTERNAL = createError<[string]>(
	"%s",
	"E_CHRONOS_INTERNAL",
);
