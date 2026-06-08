# @c9up/chronos

> Advanced date/time and recurrence engine for the Ream ecosystem (TypeScript + Rust N-API).

Part of **[Ream](https://github.com/C9up/ream)** — a Rust-powered, AdonisJS-compatible Node.js framework. Independent, publishable package.

## Installation

```bash
pnpm add @c9up/chronos
```

## Usage

```ts
import { at } from '@c9up/chronos'

const d = at('2026-06-05')   // parse / construct a Chronos instant
```

## Entry points

- `@c9up/chronos` — main API
- `@c9up/chronos/atlas` — Atlas integration adapter

## License

MIT
