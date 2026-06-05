/**
 * Cross-package smoke test — Story 36.14.
 *
 * Wires the REAL `dateTimeAtlasAdapter` from `@c9up/chronos/atlas` into a
 * REAL `BaseRepository` from `@c9up/atlas` via the Adonis-style
 * `@Column({ prepare, consume })` decorator pattern, and drives an
 * end-to-end INSERT → SELECT → UPDATE → SELECT round-trip plus a NULL
 * round-trip. No global registry, no boot-time wiring — the adapter is
 * baked into the entity class definition itself.
 *
 * Mirrors the layout of `packages/atom/tests/integration/atom-atlas-smoke.test.ts`
 * (Story 35.10) — `@c9up/atlas` is a workspace devDep added strictly for
 * this smoke test, never imported from chronos's `src/`.
 *
 * Note: `@c9up/atlas` brings `reflect-metadata` in via its own dependency
 * tree — chronos itself does NOT depend on it. Importing it explicitly here
 * would fail to resolve from chronos's `node_modules`.
 */
import {
	BaseEntity,
	BaseRepository,
	Column,
	column,
	Entity,
	PrimaryKey,
	setAtlasDialect,
} from "@c9up/atlas";
import { beforeEach, describe, expect, it } from "vitest";
import { dateTimeAtlasAdapter } from "../../src/atlas.js";
import { DateTime } from "../../src/DateTime.js";

interface PrepareStmt {
	run(...p: unknown[]): { changes?: number; lastInsertRowid?: number };
	get?(...p: unknown[]): Record<string, unknown> | undefined;
	all?(...p: unknown[]): Record<string, unknown>[];
}
interface PrepareMockShape {
	prepare(sql: string): PrepareStmt;
}

function wrapPrepareMock(mock: PrepareMockShape) {
	return {
		execute(sql: string, params: unknown[] = []) {
			const r = mock.prepare(sql).run(...params);
			return Promise.resolve({ rowsAffected: r.changes ?? 0 });
		},
		query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
			const stmt = mock.prepare(sql);
			if (stmt.all) return Promise.resolve(stmt.all(...params) as T[]);
			if (stmt.get) {
				const row = stmt.get(...params);
				return Promise.resolve(row === undefined ? [] : ([row] as T[]));
			}
			return Promise.resolve([] as T[]);
		},
	};
}

@Entity("events")
class Event extends BaseEntity {
	@PrimaryKey() id!: number;
	@Column(dateTimeAtlasAdapter) createdAt!: DateTime | null;
	@Column() label!: string;
}

/**
 * Stacking-caveat fixture — the property carries BOTH `@column.dateTime({
 * autoUpdate: true })` AND `@Column(dateTimeAtlasAdapter)`. The auto-timestamp
 * decorator writes `new Date()` at UPDATE time; the adapter's `prepare` then
 * receives a `Date` and throws. Documented in `dateTimeAtlasAdapter`'s JSDoc.
 */
@Entity("logs")
class StackedLog extends BaseEntity {
	@PrimaryKey() id!: number;
	@column.dateTime({ autoUpdate: true })
	@Column(dateTimeAtlasAdapter)
	updatedAt!: DateTime | null;
	@Column() message!: string;
}

/**
 * Recording-mock options.
 * - `transformReadValue`: simulate driver-specific row hydration. The
 *   default is identity (the bound value comes back verbatim, like
 *   better-sqlite3 with TEXT columns). Pass a transform to model
 *   `node-postgres`-style behavior where `timestamp` / `timestamptz`
 *   columns return JS `Date` instances instead of ISO strings.
 */
interface MockOpts {
	transformReadValue?: (col: string, value: unknown) => unknown;
}

function syncSqliteMock(opts: MockOpts = {}) {
	type Row = Record<string, unknown>;
	const tables = new Map<string, Map<unknown, Row>>();
	const captured: { sql: string; params: unknown[] }[] = [];
	const transform = opts.transformReadValue ?? ((_c, v) => v);

	const tableOf = (sql: string): string | null => {
		const m = sql.match(/(?:INTO|FROM|UPDATE)\s+"(\w+)"/i);
		return m ? m[1] : null;
	};
	const whereCol = (sql: string): string | null => {
		const m = sql.match(/WHERE\s+"(\w+)"/i);
		return m ? m[1] : null;
	};
	const hydrateRow = (row: Row): Row => {
		const out: Row = {};
		for (const [k, v] of Object.entries(row)) out[k] = transform(k, v);
		return out;
	};

	return {
		captured,
		tables,
		prepare(sql: string) {
			return {
				run: (...params: unknown[]) => {
					captured.push({ sql, params });
					const table = tableOf(sql);
					if (!table) {
						// Atlas always emits a table reference for run-targets (INSERT /
						// UPDATE / DELETE). A null match here means the regex drifted
						// out of sync with atlas's SQL emission — fail loud instead of
						// silently no-op'ing.
						throw new Error(
							`syncSqliteMock: could not extract table from SQL: ${sql}`,
						);
					}
					if (!tables.has(table)) tables.set(table, new Map());
					const t = tables.get(table) as Map<unknown, Row>;

					if (/^\s*INSERT/i.test(sql)) {
						const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
						if (!colMatch) {
							throw new Error(
								`syncSqliteMock: INSERT without parsed column list: ${sql}`,
							);
						}
						const cols = colMatch[1]
							.split(",")
							.map((c) => c.trim().replace(/"/g, ""));
						const row: Row = {};
						cols.forEach((c, i) => {
							row[c] = params[i];
						});
						const id = row.id;
						t.set(id, row);
						return {
							changes: 1,
							lastInsertRowid: typeof id === "number" ? id : 1,
						};
					}
					if (/^\s*UPDATE/i.test(sql)) {
						const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
						if (!setMatch) {
							throw new Error(
								`syncSqliteMock: UPDATE without parsed SET clause: ${sql}`,
							);
						}
						const setCols = setMatch[1].split(",").map((s) =>
							s
								.trim()
								.split(/\s*=\s*/)[0]
								.replace(/"/g, ""),
						);
						const whereVal = params[params.length - 1];
						const row = t.get(whereVal);
						if (!row) {
							// A miss here means the WHERE binding didn't resolve — likely
							// a stale id in the test, NOT an expected no-op. Surface it.
							throw new Error(
								`syncSqliteMock: UPDATE matched no row in '${table}' for WHERE value ${String(whereVal)}`,
							);
						}
						setCols.forEach((c, i) => {
							row[c] = params[i];
						});
						return { changes: 1, lastInsertRowid: 0 };
					}
					return { changes: 0, lastInsertRowid: 0 };
				},
				get: (...params: unknown[]) => {
					captured.push({ sql, params });
					const table = tableOf(sql);
					if (!table) return undefined;
					const t = tables.get(table);
					if (!t) return undefined;
					const wcol = whereCol(sql);
					if (!wcol) return [...t.values()].map(hydrateRow)[0];
					for (const row of t.values()) {
						if (row[wcol] === params[0]) return hydrateRow(row);
					}
					return undefined;
				},
				all: (...params: unknown[]) => {
					captured.push({ sql, params });
					const table = tableOf(sql);
					if (!table) return [];
					if (!tables.has(table)) tables.set(table, new Map());
					const t = tables.get(table) as Map<unknown, Row>;
					// sqlite/postgres call `.all()` for `INSERT ... RETURNING`. Mirror
					// the side-effect of `.run()` and surface the freshly-written row
					// so the repository hydrates auto-id / default columns.
					if (/^\s*INSERT/i.test(sql)) {
						const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
						if (!colMatch) return [];
						const cols = colMatch[1]
							.split(",")
							.map((c) => c.trim().replace(/"/g, ""));
						const row: Row = {};
						cols.forEach((c, i) => {
							row[c] = params[i];
						});
						const id = row.id ?? t.size + 1;
						t.set(id, row);
						return [hydrateRow(row)];
					}
					const wcol = whereCol(sql);
					if (!wcol) return [...t.values()].map(hydrateRow);
					return [...t.values()]
						.filter((r) => r[wcol] === params[0])
						.map(hydrateRow);
				},
			};
		},
	};
}

describe("Chronos + Atlas smoke (DateTime column via @Column(prepare/consume))", () => {
	let db: ReturnType<typeof syncSqliteMock>;

	beforeEach(() => {
		setAtlasDialect("sqlite");
		db = syncSqliteMock();
	});

	it("binds the ISO 8601 string on INSERT and re-SELECTs as a DateTime instance", async () => {
		const repo = new BaseRepository(Event, wrapPrepareMock(db));
		const original = new DateTime("2026-04-30T12:00:00Z");
		await repo.create({ id: 1, createdAt: original, label: "hello" });

		const insert = db.captured.find((c) => /^\s*INSERT/i.test(c.sql));
		expect(insert?.params).toContain("2026-04-30T12:00:00Z");
		// Adapter must lower DateTime to string — not leak the instance to the bind.
		for (const p of insert?.params ?? []) {
			expect(p).not.toBeInstanceOf(DateTime);
			expect(p).not.toBeInstanceOf(Date);
		}

		const found = await repo.find(1);
		expect(found).not.toBeNull();
		expect(found?.createdAt).toBeInstanceOf(DateTime);
		expect(found?.createdAt?.toISO()).toBe("2026-04-30T12:00:00Z");
		// Round-trip equality via the chronos primitive.
		expect(found?.createdAt?.equals(original)).toBe(true);
		// Untagged column passes through unchanged.
		expect(found?.label).toBe("hello");
	});

	it("null createdAt round-trips via the consume callback", async () => {
		const repo = new BaseRepository(Event, wrapPrepareMock(db));
		await repo.create({ id: 2, createdAt: null, label: "empty" });

		const found = await repo.find(2);
		expect(found?.createdAt).toBeNull();
		expect(found?.label).toBe("empty");
	});

	it("UPDATE binds the new ISO string and re-SELECT lands as DateTime", async () => {
		const repo = new BaseRepository(Event, wrapPrepareMock(db));
		const initial = new DateTime("2026-04-30T12:00:00Z");
		await repo.create({ id: 3, createdAt: initial, label: "starting" });

		const entity = await repo.find(3);
		if (!entity) throw new Error("precondition: row must exist");
		expect(entity.createdAt?.equals(initial)).toBe(true);

		const updated = new DateTime("2027-01-01T00:00:00Z");
		entity.createdAt = updated;
		await repo.save(entity);

		const update = db.captured.find((c) => /^\s*UPDATE/i.test(c.sql));
		expect(update?.params).toContain("2027-01-01T00:00:00Z");
		for (const p of update?.params ?? []) {
			expect(p).not.toBeInstanceOf(DateTime);
		}

		const stored = db.tables.get("events")?.get(3);
		expect(stored?.created_at).toBe("2027-01-01T00:00:00Z");

		const refreshed = await repo.find(3);
		expect(refreshed?.createdAt).toBeInstanceOf(DateTime);
		expect(refreshed?.createdAt?.equals(updated)).toBe(true);
		// Negative assertion against the prior value — proves we didn't read a cache.
		expect(refreshed?.createdAt?.equals(initial)).toBe(false);
	});

	it("Adonis-style: @Column(dateTimeAtlasAdapter) is structurally accepted", () => {
		// Compile-time: the direct pass above on the Event class did not error.
		// Runtime: the adapter shape is { prepare, consume } and TypeScript's
		// structural compatibility carries the contract across packages.
		expect(typeof dateTimeAtlasAdapter.prepare).toBe("function");
		expect(typeof dateTimeAtlasAdapter.consume).toBe("function");
	});

	it("postgres-style driver returning Date: consume hydrates correctly via the Date branch", async () => {
		// Simulate node-postgres: `timestamptz` columns come back as JS `Date`
		// instances, not ISO strings. The `prepare` lower path still emits ISO
		// (so the captured INSERT bind is a string), but the SELECT row's
		// `created_at` is now a `Date` and `consume` must take its Date branch.
		const pgLikeDb = syncSqliteMock({
			transformReadValue: (col, value) =>
				col === "created_at" && typeof value === "string"
					? new Date(value)
					: value,
		});
		const repo = new BaseRepository(Event, wrapPrepareMock(pgLikeDb));
		const original = new DateTime("2026-04-30T12:00:00Z");
		await repo.create({ id: 100, createdAt: original, label: "pg-style" });

		// The bind on the wire is the ISO string — adapter.prepare did its job.
		const insert = pgLikeDb.captured.find((c) => /^\s*INSERT/i.test(c.sql));
		expect(insert?.params).toContain("2026-04-30T12:00:00Z");

		// The driver round-trips it as a Date — consume must lift it back to DateTime.
		const found = await repo.find(100);
		expect(found?.createdAt).toBeInstanceOf(DateTime);
		expect(found?.createdAt?.equals(original)).toBe(true);
	});

	it("cross-realm DateTime: a duck-typed (toISO + equals) value is accepted", () => {
		// Simulate pnpm-hoisting duplication where a consumer's `DateTime`
		// import resolved to a separate copy of the class — `instanceof DateTime`
		// would be false, but the structural duck-typing fallback keeps the
		// adapter functional.
		const fakeFromOtherRealm = {
			toISO: () => "2026-04-30T12:00:00Z",
			equals: (_other: unknown) => true,
		};
		// consume must return the same object identity (idempotent path).
		expect(dateTimeAtlasAdapter.consume(fakeFromOtherRealm)).toBe(
			fakeFromOtherRealm,
		);
		// prepare must call .toISO() and return the string, NOT throw.
		expect(dateTimeAtlasAdapter.prepare(fakeFromOtherRealm)).toBe(
			"2026-04-30T12:00:00Z",
		);
	});

	it("stacking @column.dateTime({ autoUpdate }) + adapter throws TypeError on UPDATE", async () => {
		// AC behavioral contract — see `dateTimeAtlasAdapter` JSDoc "Stacking
		// caveat" section. The auto-timestamp decorator (story 32.8) writes
		// `new Date()` to `updatedAt` before #applyPrepare runs; prepare then
		// receives a JS Date and throws the wrap-with-DateTime hint.
		const repo = new BaseRepository(StackedLog, wrapPrepareMock(db));
		// INSERT with an explicit DateTime so the row exists. autoCreate is NOT
		// set — autoUpdate fires only on UPDATE — so this insert succeeds.
		await repo.create({
			id: 1,
			updatedAt: new DateTime("2026-04-30T12:00:00Z"),
			message: "init",
		});

		const entity = await repo.find(1);
		if (!entity) throw new Error("precondition: row must exist");
		// Trigger an UPDATE — change a different column so something is dirty;
		// #applyAutoTimestamps then writes `new Date()` into `updatedAt`,
		// #applyPrepare runs, and dateTimeAtlasAdapter.prepare rejects the Date.
		entity.message = "mutated";

		let caught: unknown = null;
		try {
			await repo.save(entity);
		} catch (err) {
			caught = err;
		}
		// Atlas wraps adapter throws with the column key (deferred-work
		// 35-10-2-A4); the original TypeError survives on `cause` and the
		// outer message carries the @Column.prepare prefix + property name.
		expect(caught).toBeInstanceOf(Error);
		if (!(caught instanceof Error))
			throw new Error("unreachable: assertion above");
		expect(caught.cause).toBeInstanceOf(TypeError);
		expect(caught.message).toMatch(/^@Column\.prepare threw on 'updatedAt'/);
		const inner = caught.cause;
		if (!(inner instanceof Error))
			throw new Error("unreachable: assertion above");
		expect(inner.message).toMatch(/expected a DateTime instance/);
		expect(inner.message).toMatch(/\[object Date\]/);
		expect(inner.message).toMatch(
			/Wrap the value with `new DateTime\(\.\.\.\)`/,
		);
	});
});
