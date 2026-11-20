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
`fromHTTP` · `fromFormat`. `fromISO`, `fromObject`, `fromSQL` and
`fromFormat` take `{ zone }`: a time without an offset is then a wall clock in
that zone (UTC otherwise — never the host's zone).

`fromFormat` reads the tokens `toFormat` writes, names in `{ locale }` (en-US
by default); units the format leaves out come from now for the larger ones and
start at their minimum for the smaller ones:

```ts
DateTime.fromFormat('10/08/2026 09:30', 'dd/MM/yyyy HH:mm', { zone: 'Europe/Paris' })
DateTime.fromFormat('10 août 2026', 'd MMMM yyyy', { locale: 'fr' })
DateTime.fromFormat('14:30', 'HH:mm')   // today at 14:30 UTC
```

Text that does not match the format, or names a date that does not exist,
throws.

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

### Exceptions: EXDATE and RDATE

A series without some of its occurrences, or with a few more, as RFC 5545
§3.8.5 sets it: the rule's occurrences and the RDATEs, without the EXDATEs.
COUNT and UNTIL bound the rule alone — an EXDATE does not give its place back.

```ts
// A Monday slot, not on the 28th, once on Wednesday the 30th instead.
expandRRule(
  'DTSTART;TZID=Europe/Zurich:20261214T090000\n' +
    'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\n' +
    'EXDATE;TZID=Europe/Zurich:20261228T090000\n' +
    'RDATE;TZID=Europe/Zurich:20261230T140000',
)

// The same, as options: instants or DateTimes.
expandRRule(start, { freq: 'WEEKLY', count: 3 }, { exdates: ['2026-12-21T09:00:00+01:00'], rdates: [extra] })
```

A floating value is read on its line's TZID, else on the rule's zone; a `Z`
value is the instant it names. Date-times only: `VALUE=DATE` would name days
of a series of times, which RFC 5545 forbids, and an RDATE `PERIOD` is not an
occurrence — both are refused rather than guessed at.

A rule from user input or an imported .ics is safe to expand: the rule is
capped at 8 KB and the whole text, exceptions included, at 256 KB; EXDATE and
RDATE name at most 10 000 date-times; BY* lists are sets, at most 10 000
occurrences come back, and iteration ends at year 9999, so an unsatisfiable
rule answers `[]` in milliseconds. Unknown properties and malformed parts are
refused.

## Public holidays and Easter

```ts
import { easterDate, holidays, isHoliday } from '@c9up/chronos'

easterDate(2026)                                   // '2026-04-05'
holidays(2026, { country: 'FR' })                  // [{ date: '2026-01-01', key: 'new_year' }, …]
holidays(2026, { country: 'CH', region: 'VD' })    // federal days + Vaud's
isHoliday('2026-09-21', { country: 'CH', region: 'VD' })   // true: Federal Fast Monday
isHoliday(DateTime.now().setZone('Europe/Zurich'), { country: 'CH', region: 'GE' })
```

Computed by the engine, in Node and in the browser alike. `country` is `FR`
(its eleven national days) or `CH`: without a `region` its three federal days
(1 January, 1 August, 25 December), with one a canton's two-letter code
(`SWISS_CANTONS`) adding that canton's days: Easter Monday, Ascension and Whit
Monday everywhere, then its own, fixed (Saint Berchtold, Saint Stephen,
Assumption, All Saints, …) or moving (Good Friday, Corpus Christi, Federal Fast
Monday in Vaud and Neuchâtel, the Geneva Fast, the Näfelser Fahrt in Glarus).

- Each holiday has a stable `key` (`easter_monday`, `federal_fast_monday`, …)
  for the application to translate; chronos names none in any language.
- Two holidays on one day are both listed (Ascension on 1 May, 2008).
- Neuchâtel's 2 January and 26 December count only when 1 January / 25
  December is a Sunday. The Näfelser Fahrt is the first Thursday of April, one
  week later when that Thursday falls in Holy Week.
- A `DateTime` is read on its own wall clock; a string must be `YYYY-MM-DD`.
- An unknown country or canton is refused (`E_CHRONOS_UNKNOWN_COUNTRY`,
  `E_CHRONOS_UNKNOWN_REGION`) rather than answered with no holiday; the Easter
  date is computed for 1583-9999 (`E_CHRONOS_INVALID_YEAR`).
- The cantonal table is today's calendar applied to every year: it does not
  know when a holiday was instituted.

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
