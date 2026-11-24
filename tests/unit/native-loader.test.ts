/**
 * Where the Node engine comes from: the local build of a checkout first, the
 * platform package an install picked second, and a refusal naming that package
 * when neither loads.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

/** A stand-in engine: the loader hands over whatever `require` returns. */
const engine = { add: () => "2026-02-15T10:00:00.000Z" };

/** The host the loader is told it runs on, so the suite asserts on every platform. */
const HOST = { platform: "linux", arch: "x64", suffix: "linux-x64-gnu" };

/** The platform package this host installs. */
const PLATFORM_PACKAGE = `@c9up/chronos-${HOST.suffix}`;

/** What `require` throws for a module that is not there. */
function notFound(id: string): Error {
	return Object.assign(new Error(`Cannot find module '${id}'`), {
		code: "MODULE_NOT_FOUND",
	});
}

/** Load chronos's loader with `require` running `load` for every module it asks for. */
async function withRequire(
	load: (id: string) => unknown,
	host: { platform: string; arch: string } = HOST,
) {
	vi.resetModules();
	vi.doMock("node:process", async (importOriginal) => ({
		...(await importOriginal<typeof import("node:process")>()),
		platform: host.platform,
		arch: host.arch,
	}));
	vi.doMock("node:module", async (importOriginal) => ({
		...(await importOriginal<typeof import("node:module")>()),
		createRequire: () => load,
	}));
	const native = await import("../../src/native.js");
	const errors = await import("../../src/errors.js");
	return { native, errors };
}

/** What `nativeChronos()` throws, or `undefined` when it returns. */
function refusalOf(native: typeof import("../../src/native.js")): unknown {
	try {
		native.nativeChronos();
		return undefined;
	} catch (error) {
		return error;
	}
}

afterEach(() => {
	vi.doUnmock("node:process");
	vi.doUnmock("node:module");
	vi.resetModules();
});

describe("chronos > the Node engine comes from the local build or the platform package", () => {
	it("loads the platform package when no local binary is built", async () => {
		const asked: string[] = [];
		const { native } = await withRequire((id) => {
			asked.push(id);
			if (id === PLATFORM_PACKAGE) return engine;
			throw notFound(id);
		});

		expect(
			native.nativeChronos().add("2026-01-15T10:00:00.000Z", 1, "month"),
		).toBe("2026-02-15T10:00:00.000Z");
		expect(asked).toHaveLength(2);
		expect(asked[0]).toMatch(/[\\/]index\.linux-x64-gnu\.node$/);
		expect(asked[1]).toBe(PLATFORM_PACKAGE);
	});

	it("prefers the local build, and never asks for the package then", async () => {
		const asked: string[] = [];
		const { native } = await withRequire((id) => {
			asked.push(id);
			return engine;
		});

		expect(refusalOf(native)).toBeUndefined();
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatch(/index\.linux-x64-gnu\.node$/);
	});

	it("names the platform package to install when neither is there", async () => {
		const { native, errors } = await withRequire((id) => {
			throw notFound(id);
		});

		const refusal = refusalOf(native);

		expect(refusal).toBeInstanceOf(errors.E_CHRONOS_ENGINE_REQUIRED);
		expect(String(refusal)).toContain("Environment: Node");
		expect(String(refusal)).toContain(
			`Fix: install ${PLATFORM_PACKAGE} at the exact version of @c9up/chronos`,
		);
		expect(String(refusal)).toContain("pnpm build:napi");
		expect(String(refusal)).toContain("Alpine/musl");
		// The load error travels as the cause, not in the message.
		expect(refusal).toMatchObject({
			cause: {
				code: "MODULE_NOT_FOUND",
				message: expect.stringContaining(PLATFORM_PACKAGE),
			},
		});
		expect(String(refusal)).not.toContain("Cannot find module");
	});

	it("reports a local build that fails to load, instead of falling back to the package", async () => {
		const asked: string[] = [];
		const { native } = await withRequire((id) => {
			asked.push(id);
			throw new Error("invalid ELF header");
		});

		const refusal = refusalOf(native);

		expect(asked).toHaveLength(1);
		expect(String(refusal)).toContain(
			"Fix: index.linux-x64-gnu.node failed to load. Rebuild it: cd packages/chronos && pnpm build:napi",
		);
		expect(String(refusal)).not.toContain("invalid ELF header");
		expect(refusal).toMatchObject({ cause: { message: "invalid ELF header" } });
	});

	it("leaves the musl hint out off Linux", async () => {
		const { native } = await withRequire(
			(id) => {
				throw notFound(id);
			},
			{ platform: "darwin", arch: "arm64" },
		);

		const refusal = String(refusalOf(native));

		expect(refusal).toContain("install @c9up/chronos-darwin-arm64");
		expect(refusal).not.toContain("musl");
	});

	it("lists the supported targets on a host no binary is built for", async () => {
		const asked: string[] = [];
		const { native } = await withRequire(
			(id) => {
				asked.push(id);
				return engine;
			},
			{ platform: "linux", arch: "riscv64" },
		);

		const refusal = refusalOf(native);

		expect(asked).toHaveLength(0);
		expect(String(refusal)).toContain(
			"Fix: no prebuilt binary for linux-riscv64; chronos ships one for linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64.",
		);
		expect(refusal).not.toHaveProperty("cause", expect.anything());
	});
});
