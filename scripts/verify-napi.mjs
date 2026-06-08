import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { arch, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const suffixMap = {
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'win32-x64': 'win32-x64-msvc',
}

const suffix = suffixMap[`${platform}-${arch}`]
if (!suffix) {
  throw new Error(`[chronos:napi] unsupported platform/arch: ${platform}-${arch}`)
}

const binary = join(root, `index.${suffix}.node`)
if (!existsSync(binary)) {
  throw new Error(`[chronos:napi] binary missing: ${binary}`)
}

const require2 = createRequire(import.meta.url)
const binding = require2(binary)

for (const fn of ['add', 'diff', 'startOf', 'endOf', 'format', 'rruleExpand']) {
  if (typeof binding[fn] !== 'function') {
    throw new Error(`[chronos:napi] invalid exports: missing ${fn}()`)
  }
}

if (binding.add('2026-01-15T10:00:00Z', 1, 'month') !== '2026-02-15T10:00:00Z') {
  throw new Error('[chronos:napi] add smoke test failed')
}

const recurring = binding.rruleExpand('2026-01-15T15:00:00Z', 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3', 10)
if (!Array.isArray(recurring) || recurring.length !== 3) {
  throw new Error('[chronos:napi] rrule smoke test failed')
}

console.log('[chronos:napi] smoke test passed')
