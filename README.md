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
d.plus({ months: 1, days: 2 })      // a Duration works too
d.setZone('Europe/Zurich').toISO()  // 2026-06-05T16:30:00.000+02:00 (same instant)
d.toFormat('dd/MM/yyyy HH:mm')      // 05/06/2026 14:30   (yyyy/dd/LLL tokens)
d.format('DD/MM/YYYY HH:mm')        // 05/06/2026 14:30   (YYYY/DD tokens)
d.toSQL()                           // 2026-06-05 14:30:00.000 Z
d.set({ hour: 9 }).toISO()          // 2026-06-05T09:00:00.000Z
d.startOf('month').toISO()          // 2026-06-01T00:00:00.000Z
d.diff('2026-01-01', 'day').as('day')       // 155.604   (a minus b, a Duration)
d.diff('2026-01-01', ['months', 'days'])    // { months: 5, days: 4.604… }
d > DateTime.from('2026-01-01')             // true — valueOf is the epoch ms
```

`at()` is the same thing, shorter: `at('2026-06-05')`.

Built from whatever you have:
`from` · `now` · `local` · `utc` · `fromISO` · `fromMillis` · `fromSeconds` ·
`fromUnix` · `fromJSDate` · `fromObject` · `fromRFC2822` · `fromSQL` ·
`fromHTTP`. `fromISO`, `fromObject` and `fromSQL` take `{ zone }`: a time
without an offset is then a wall clock in that zone (UTC otherwise — never the
host's zone).

Read out as `toISO` · `toISODate` · `toISOTime` · `toSQL` · `toSQLDate` ·
`toSQLTime` · `toZonedISO` · `toDate` · `toMillis` · `toSeconds` · `toFormat` ·
`format` · `toLocaleString` · `toRelative` ("1 day ago") · `toRelativeCalendar`
("yesterday"), compared with `equals` · `isBefore` ·
`isAfter` · `isSameDay` · `hasSame` · `isWithin` (or `<`, `>`), and moved with
`plus` · `minus` · `set` · `startOf` · `endOf` · `setZone` (`keepLocalTime`) ·
`setLocale` · `toUTC`.

Strings are read as ISO 8601 only (`YYYY-MM-DD`, with an optional time — `T`
or a space — and offset); anything else is refused, as are values outside
years 0000-9999. `plus`/`minus` refuse a non-finite amount and carry a fraction
as elapsed time: `plus(1.5, 'day')` is one calendar day and twelve hours.

### A date that does not exist is refused

```ts
DateTime.from('2026-02-30')
// Invalid date '2026-02-30': February 2026 has 28 days, so there is no day 30.
```

So is a zone the tz database does not know — at every entry that takes one,
`DateTime.now(zone)`, `new DateTime(input, zone)` and `setZone(zone)` alike:

```ts
DateTime.now('Mars/Olympus')
// Unknown IANA timezone: 'Mars/Olympus'. Check https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
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

`plus` · `minus` · `negate` · `normalize` · `rescale` · `shiftTo` ·
`shiftToAll` · `mapUnits` · `as` · `get`, out as `toISO` · `toMillis` ·
`toFormat` · `toHuman` · `toObject`. Every value must be a finite number (a
numeric string is coerced) and every unit known — `{ hours: NaN }` and
`{ fortnights: 1 }` are refused. A year converts as 365 days, a month as 30.

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

`Interval.after(start, duration)` and `splitBy` step on the calendar in the
start's zone (January 31st plus a month ends on February 28th);
`Interval.before` and `Interval.fromISO('start/end' | 'start/P1M' | 'P1D/end')`
build the other ways.

Set operations: `overlaps` · `engulfs` · `intersection` · `union` (the span
covering both, gap included) · `Interval.merge` · `Interval.xor` ·
`difference` · `count` · `abutsStart` · `abutsEnd` · `splitBy` · `splitAt`.

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
ends on `count` or `until`. What the rule leaves out comes from the start, as
RFC 5545 says: `FREQ=MONTHLY` repeats on the start's day of the month.

```ts
// On a zone's wall clock: a 09:00 meeting stays at 09:00 across DST.
expandRRule('2026-03-23T08:00:00Z', 'FREQ=WEEKLY;COUNT=2', { tzid: 'Europe/Paris' })
// 2026-03-23T08:00:00.000Z, 2026-03-30T07:00:00.000Z

// The iCalendar form, DTSTART read from the text.
expandRRule('DTSTART;TZID=Europe/Paris:20260323T090000\nRRULE:FREQ=WEEKLY;COUNT=2')
```

A rule from user input or an imported .ics is safe to expand: the text is
capped at 8 KB, BY* lists are sets, at most 10 000 occurrences come back, and
iteration ends at year 9999, so an unsatisfiable rule answers `[]` in
milliseconds. Unknown properties and malformed parts are refused.

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
  @Column(dateTimeAtlasAdapter) declare placedAt: DateTime
}
```

## Entry points

- `@c9up/chronos` — `DateTime`, `Duration`, `Interval`, recurrence, ranges, the `Chronos` facade
- `@c9up/chronos/atlas` — the Atlas column adapter

## License

MIT
