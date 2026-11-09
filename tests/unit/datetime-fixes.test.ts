import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "../../src/index.js";

/** Run with the host in a non-UTC zone, the way a dev laptop or a container may be. */
function withHostZone(zone: string): void {
	let previous: string | undefined;
	beforeEach(() => {
		previous = process.env.TZ;
		process.env.TZ = zone;
	});
	afterEach(() => {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	});
}

describe("toLocaleString formats in the value's own zone", () => {
	withHostZone("Europe/Paris");

	it("formats a UTC value in UTC, not in the host zone", () => {
		const dt = DateTime.from("2026-06-01T00:00:00Z");
		expect(dt.toLocaleString("en-GB", { timeStyle: "short" })).toBe("00:00");
	});

	it("formats a zoned value in its zone", () => {
		const dt = new DateTime("2026-06-01T00:00:00Z", "America/New_York");
		expect(dt.toLocaleString("en-GB", { timeStyle: "short" })).toBe("20:00");
	});
});

describe("format keeps non-ASCII literal text", () => {
	const instant = "2026-06-01T00:00:00Z";
	// Reykjavik sits on +00:00 all year, so the zoned path must print exactly
	// what the UTC path prints.
	const utc = DateTime.from(instant);
	const zoned = new DateTime(instant, "Atlantic/Reykjavik");

	it.each([
		["YYYY年MM月DD日", "2026年06月01日"],
		["[é] HH", "é 00"],
		["DD/MM/YYYY [à] HH:mm", "01/06/2026 à 00:00"],
		["HH:mm – DD·MM°", "00:00 – 01·06°"],
		["[100%] YYYY", "100% 2026"],
	])("%s", (pattern, expected) => {
		expect(utc.format(pattern)).toBe(expected);
		expect(zoned.format(pattern)).toBe(expected);
	});
});
