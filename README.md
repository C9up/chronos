# @c9up/chronos

Dates, durations, intervals and recurrence rules for Node.js — a small immutable API over a Rust N-API core.

Part of **[Ream](https://github.com/C9up/ream)**, and usable on its own: chronos depends on nothing else in the ecosystem.

## Installation

```bash
pnpm add @c9up/chronos
```

The Rust binary is required — there is no JavaScript fallback.

## DateTime

Immutable. Every method that would change an instant returns a new one, and the
zone travels with it.

```ts
import { DateTime, at } from '@c9up/chronos'

const d = DateTime.from('2026-06-05T14:30:00Z')

d.plus(1, 'month').toISO()          // 2026-07-05T14:30:00.000Z
d.setZone('Europe/Zurich')
 .toZonedISO()                      // 2026-06-05T16:30:00+02:00
d.format('DD/MM/YYYY HH:mm')        // 05/06/2026 14:30
d.startOf('month').toISO()          // 2026-06-01T00:00:00.000Z
d.diff('2026-01-01', 'day')         // -155  (other minus this)
```

`at()` is the same thing, shorter: `at('2026-06-05')`.

Built from whatever you have:
`from` · `now` · `fromMillis` · `fromSeconds` · `fromUnix` · `fromJSDate` ·
`fromObject` · `fromRFC2822` · `fromSQL` · `fromHTTP`.

Read out as `toISO` · `toZonedISO` · `toDate` · `toMillis` · `toSeconds` ·
`format` · `toLocaleString` · `toRelative`, compared with `equals` · `isBefore` ·
`isAfter` · `isSameDay` · `hasSame` · `isWithin`, and moved with `plus` ·
`minus` · `startOf` · `endOf` · `setZone` · `toUTC`.

### A date that does not exist is refused

```ts
DateTime.from('2026-02-30')
// Invalid date '2026-02-30': February 2026 has 28 days, so there is no day 30.
```

`new Date('2026-02-30')` answers March 2nd. Those overflow semantics are right
for arithmetic and wrong for reading input, where the same slide turns a typo
into a fact. Only the *written* date is checked, so an offset that legitimately
moves the UTC day still works:

```ts
DateTime.from('2026-08-10T23:00:00-05:00').toISO()  // 2026-08-11T04:00:00.000Z
```

Arithmetic still slides, because there the slide is the point — and it clamps
to the month rather than overflowing past it:

```ts
DateTime.from('2026-01-31').plus(1, 'month').toISO()  // 2026-02-28T00:00:00.000Z
```

### Calendar parts

```ts
DateTime.from('2026-06-05').calendar
// { year: 2026, month: 6, day: 5, weekday: 5, weekNumber: 23, weekYear: 2026,
//   ordinal: 156, quarter: 2, daysInMonth: 30, daysInYear: 365,
//   isLeapYear: false, ... }
```

Each is also a getter: `d.quarter`, `d.weekNumber`, `d.daysInMonth`, and so on.

## Duration

```ts
import { Duration } from '@c9up/chronos'

Duration.fromObject({ hours: 2, minutes: 30 }).toHuman()  // 2 hours, 30 minutes
Duration.fromISO('PT90M').as('hours')                     // 1.5
Duration.fromObject({ minutes: 90 }).normalize().toObject()
// { years: 0, months: 0, weeks: 0, days: 0, hours: 1, minutes: 30, ... }
```

`plus` · `minus` · `negate` · `normalize` · `shiftTo` · `as` · `get`, out as
`toISO` · `toFormat` · `toHuman` · `toObject`.

## Interval

A half-open span, `start` included and `end` excluded.

```ts
import { Interval, DateTime } from '@c9up/chronos'

const june = Interval.fromDateTimes(
  DateTime.from('2026-06-01'),
  DateTime.from('2026-07-01'),
)

june.length('days')                 // 30
june.contains(DateTime.from('2026-06-15'))   // true
june.splitBy({ amount: 1, unit: 'week' })    // 5 intervals
```

Set operations: `overlaps` · `engulfs` · `intersection` · `union` ·
`abutsStart` · `abutsEnd` · `splitBy` · `splitAt`.

Units are accepted singular or plural, and an unknown one is refused rather
than quietly measured in milliseconds.

## Recurrence (RFC 5545)

```ts
import { expandRRule, toRRuleString } from '@c9up/chronos'

expandRRule('2026-06-01T09:00:00Z', { freq: 'WEEKLY', byDay: ['MO', 'WE'], count: 4 })
// 2026-06-01T09:00:00.000Z, 2026-06-03T09:00:00.000Z,
// 2026-06-08T09:00:00.000Z, 2026-06-10T09:00:00.000Z

toRRuleString({ freq: 'MONTHLY', byMonthDay: [1, 15] })
// FREQ=MONTHLY;BYMONTHDAY=1,15
```

A rule takes `freq` · `interval` · `wkst` · `byDay` · `byMonthDay` · `byMonth` ·
`byWeekNo` · `byYearDay` · `bySetPos` · `byHour` · `byMinute` · `bySecond`, and
ends on `count` or `until`.

## Ranges

For the cases where a plain `{ start, end }` pair is enough:

```ts
import { inRange, containsRange, overlapsRange, analyzeRange } from '@c9up/chronos'
```

`analyzeRange` names the relation between two ranges rather than reducing it to
a boolean.

## With Atlas

`@c9up/chronos/atlas` carries the adapter that hydrates a column into a
`DateTime` and prepares one for the database.

```ts
import { Column } from '@c9up/atlas'
import { dateTimeAtlasAdapter } from '@c9up/chronos/atlas'

class Order {
  @Column({ adapter: dateTimeAtlasAdapter }) declare placedAt: DateTime
}
```

## Entry points

- `@c9up/chronos` — `DateTime`, `Duration`, `Interval`, recurrence, ranges, the `Chronos` facade
- `@c9up/chronos/atlas` — the Atlas column adapter

## License

MIT
