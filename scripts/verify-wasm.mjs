import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Publish-time gate: the `wasm-pack build --target web` output (JS glue + the
// binary) MUST be in the package. Without it the browser loader
// (src/native.ts) throws CHRONOS_ENGINE_REQUIRED at runtime — exactly the
// "stub-only tarball" failure this gate exists to prevent. Only the hand-written
// `chronos_engine_wasm.d.ts` typecheck stub is committed; the .js/.wasm are built.

const here = dirname(fileURLToPath(import.meta.url))
const wasmDir = join(here, '..', 'wasm')

const required = ['chronos_engine_wasm.js', 'chronos_engine_wasm_bg.wasm']
for (const name of required) {
  const p = join(wasmDir, name)
  if (!existsSync(p)) {
    throw new Error(
      `[chronos:wasm] missing build artifact: wasm/${name} — run \`pnpm build:wasm\` (wasm-pack) before publishing`,
    )
  }
  if (statSync(p).size === 0) {
    throw new Error(`[chronos:wasm] empty build artifact: wasm/${name}`)
  }
}

// Present on disk is NOT the same question as present in the package, and it is
// the weaker one. `wasm-pack` writes a `.gitignore` of `*` into its out-dir, and
// npm honours a .gitignore nested inside a published directory even when `files`
// lists that directory — so every check above can pass while the tarball ships
// nothing. That is exactly how 0.1.13 went out: green gate, empty wasm/.
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
      `[chronos:wasm] wasm/${name} is on disk but NOT in the tarball — something is excluding it ` +
        `(a .gitignore or .npmignore nested in wasm/ will do this even though "wasm" is in package.json files). ` +
        `Run \`node scripts/clean-wasm-pack-meta.mjs\` after wasm-pack.`,
    )
  }
}

console.log(`[chronos:wasm] browser artifacts present and in the tarball (${shipped.size} files)`)
