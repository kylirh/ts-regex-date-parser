# ts-regex-date-parser

A date parser written in TypeScript with regular expressions and integer math.
It has no runtime dependencies and never calls `Date`, `Intl` or `Temporal`. A test enforces that.

```ts
import { parseDate, toISOString, toEpochMilliseconds } from 'ts-regex-date-parser';

const date = parseDate('Monday, January 15th, 2024 at 3:45 PM EST');
// { year: 2024, month: 1, day: 15, hour: 15, minute: 45, second: 0,
//   millisecond: 0, offsetMinutes: -300, format: 'month-name-first' }

toISOString(date!);          // '2024-01-15T15:45:00.000-05:00'
toEpochMilliseconds(date!);  // 1705351500000
```

`parseDate` returns `null` for anything it can't parse **or** that isn't a real date.
That includes `2023-02-29`, `31 April`, `25:00`, `March 2st` and `Tuesday, January 15, 2024`
(Jan 15 2024 was a Monday). If you'd rather get an exception, `parseDateOrThrow` throws a `SyntaxError`.

## Supported formats

| Format                  | Examples |
| ----------------------- | -------- |
| `iso-extended`          | `2024-01-15`, `2024-01-15T10:30:45.123+05:30`, `2024-01-15 10:30 UTC`, `+012024-01-15` |
| `iso-basic`             | `20240115`, `20240115T103045Z` |
| `iso-ordinal`           | `2024-060` (29 Feb) |
| `iso-week`              | `2026-W41-7`, `2026W417`, `2026-W41` |
| `numeric-ymd`           | `2024/01/15`, `2024.1.15 9am` |
| `numeric`               | `01/15/2024`, `1-15-24 3:30 PM`, `15.01.2024` |
| `month-name-first`      | `January 15, 2024`, `Jan. 15th '24 at 3pm`, `Jan-15-2024` |
| `day-first-month-name`  | `15 January 2024`, `15th of March, 2024`, `Tue, 15 Nov 1994 08:12:31 GMT` (RFC 2822) |
| `ctime`                 | `Sun Nov  6 08:49:37 1994`, `Sun Oct 11 20:33:00 PDT 2026` |

**Times:** 24-hour or 12-hour (`3pm`, `3:45 p.m.`, `12:00 AM`). Fractional seconds are truncated to milliseconds.

**Zones:** `Z`, `±HH`, `±HHMM`, `±HH:MM`, `UTC`/`GMT`/`UT`, `UTC+5`, `GMT-3:30`, plus the RFC 2822 US zones (`EST`, `EDT`, `CST`, `CDT`, `MST`, `MDT`, `PST`, `PDT`).
Without a zone, `offsetMinutes` is `null`, and `toEpochMilliseconds` treats the value as UTC.

## Options

```ts
parseDate('01/02/2024', { dayFirst: true });         // 1 Feb (dotted dates are always day-first)
parseDate('1/5/69', { twoDigitYearPivot: 70 });      // 2069 (default pivot is 50)
parseDate(input, { formats: ['iso-extended'] });     // only accept these formats
```

## Calendar helpers

These are exported as well, all proleptic Gregorian with astronomical years:
`isLeapYear`, `isValidDate`, `daysInMonth`, `daysInYear`, `dayOfWeek`, `dayOfYear`,
`daysFromCivil`, `civilFromDays`, `isoWeeksInYear`, `fromIsoWeekDate`, `fromOrdinalDate`.

## Development

Requires Node ≥ 22.18, which runs the `.ts` files directly.

```sh
npm install
npm test           # node:test suite
npm run typecheck
npm run build      # emits dist/
```

The tests use the native `Date` only as an independent oracle. They check every day from 1600 to 2400,
and 5,000 random ISO timestamps against `Date.parse`.
