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
