import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Gate on the browser engine: the `pnpm build:wasm` output (the wasm-bindgen
// `--target web` JS glue + the binary) MUST load, compute, and be in the
// package. CI builds it in its own job, runs this on it, and hands it to the
// publish job as an artefact; prepublishOnly only checks it, so a publish never
// builds the binary it ships. Without it the browser loader (src/native.ts)
// throws CHRONOS_ENGINE_REQUIRED at runtime — exactly the "stub-only tarball"
// failure this gate exists to prevent. Only the hand-written
// `chronos_engine_wasm.d.ts` typecheck stub is committed; the .js/.wasm are built.

const TAG = '[chronos:wasm]'
const here = dirname(fileURLToPath(import.meta.url))
const wasmDir = join(here, '..', 'wasm')

const required = ['chronos_engine_wasm.js', 'chronos_engine_wasm_bg.wasm']
for (const name of required) {
  const p = join(wasmDir, name)
  if (!existsSync(p)) {
    throw new Error(
      `${TAG} missing build artifact: wasm/${name} — run \`pnpm build:wasm\` before publishing`,
    )
  }
  if (statSync(p).size === 0) {
    throw new Error(`${TAG} empty build artifact: wasm/${name}`)
  }
}

const wasm = await import(pathToFileURL(join(wasmDir, 'chronos_engine_wasm.js')).href)
// Hand the binary over as BYTES. Called with no argument, the `--target web`
// glue defaults to `new URL('..._bg.wasm', import.meta.url)` and fetches it,
// and Node's fetch refuses a `file:` URL. Bytes go straight to
// WebAssembly.instantiate.
await wasm.default({
  module_or_path: readFileSync(join(wasmDir, 'chronos_engine_wasm_bg.wasm')),
})

// Every function src/native.ts adapts for the browser.
for (const fn of ['add', 'diff', 'start_of', 'end_of', 'format',
  'validate_timezone', 'to_zone', 'add_in_zone', 'start_of_in_zone',
  'end_of_in_zone', 'diff_in_zone', 'zone_offset', 'from_local',
  'parse_rfc2822', 'parse_sql', 'parse_http', 'rrule_expand',
  'calendar_parts']) {
  if (typeof wasm[fn] !== 'function') {
    throw new Error(`${TAG} invalid exports: missing ${fn}()`)
  }
}

function expectEqual(what, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a !== b) throw new Error(`${TAG} ${what} smoke test failed: got ${a}, want ${b}`)
}

// Exercised rather than merely exported: a browser build that carries the
// functions but computes something else, or lost its zone data, is the failure
// this gate exists to catch.
expectEqual(
  'add (month clamps to the last day)',
  wasm.add('2026-01-31T10:00:00.000Z', 1n, 'month'),
  '2026-02-28T10:00:00.000Z',
)
expectEqual(
  'to_zone (embedded zone data)',
  wasm.to_zone('2026-07-01T12:00:00.000Z', 'Europe/Paris').offsetMinutes,
  120,
)
expectEqual(
  'from_local (DST-aware wall clock)',
  wasm.from_local('2026-01-15T09:00:00', 'Europe/Paris'),
  '2026-01-15T08:00:00.000Z',
)
expectEqual(
  'rrule_expand',
  wasm.rrule_expand('2026-01-15T10:00:00Z', 'FREQ=DAILY;COUNT=2', 10, undefined),
  ['2026-01-15T10:00:00.000Z', '2026-01-16T10:00:00.000Z'],
)
// Hostile input comes back as an error, never a trap: the browser build has no
// catch_unwind, so a panic in the engine kills the module instead.
{
  let thrown
  try {
    wasm.rrule_expand('2026-01-15T10:00:00Z', 'ABCDEFGé=1', 1, undefined)
  } catch (e) {
    thrown = e
  }
  if (typeof thrown !== 'string' || !thrown.includes('Unknown RRULE property')) {
    throw new Error(`${TAG} hostile RRULE smoke test failed: got ${String(thrown)}`)
  }
}

// Present on disk is NOT the same question as present in the package, and it is
// the weaker one. npm honours a .gitignore nested inside a published directory
// even when `files` lists that directory — so every check above can pass while
// the tarball ships nothing. That is exactly how 0.1.13 went out, when the build
// tool wrote a `.gitignore` of `*` into wasm/: green gate, empty wasm/.
//
// So ask the packer. `--ignore-scripts` keeps this from re-entering
// prepublishOnly, which is what invoked us.
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: join(here, '..'),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
)[0]

const shipped = new Set(packed.files.map((f) => f.path))
for (const name of required) {
  if (!shipped.has(`wasm/${name}`)) {
    throw new Error(
      `${TAG} wasm/${name} is on disk but NOT in the tarball — something is excluding it ` +
        `(a .gitignore or .npmignore nested in wasm/ will do this even though "wasm" is in package.json files). ` +
        `Remove it and pack again.`,
    )
  }
}

console.log(`${TAG} browser engine loads, computes, and is in the tarball (${shipped.size} files)`)
