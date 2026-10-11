import {
  dayOfWeek,
  daysFromCivil,
  fromIsoWeekDate,
  fromOrdinalDate,
  isValidDate,
} from './calendar.ts';

/** The formats the parser understands, in the order they are tried. */
export type DateFormat =
  | 'iso-extended'
  | 'iso-basic'
  | 'iso-ordinal'
  | 'iso-week'
  | 'numeric-ymd'
  | 'numeric'
  | 'month-name-first'
  | 'day-first-month-name'
  | 'ctime';

export interface ParsedDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /**
   * Offset from UTC in minutes (e.g. -300 for EST), or `null` when the input
   * carried no time zone information.
   */
  offsetMinutes: number | null;
  /** Which format matched the input. */
  format: DateFormat;
}

export interface ParseOptions {
  /**
   * Treat ambiguous slash/dash numeric dates (`01/02/2024`) as day-first (DMY)
   * instead of month-first (MDY). Dotted dates (`01.02.2024`) are always day-first.
   * @default false
   */
  dayFirst?: boolean;
  /**
   * Two-digit years below this value land in the 2000s, the rest in the 1900s.
   * @default 50
   */
  twoDigitYearPivot?: number;
  /** Restrict parsing to a subset of formats. Defaults to all of them. */
  formats?: readonly DateFormat[];
}

/** Inputs longer than this are rejected outright to keep regex work bounded. */
export const MAX_INPUT_LENGTH = 256;

// ---------------------------------------------------------------------------
// Regex building blocks
// ---------------------------------------------------------------------------

const MONTH_NAME =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const WEEKDAY_NAME =
  'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';

/** Time zone designators: offsets, `Z`, `UTC`/`GMT`(+offset), and the RFC 2822 US zones. */
const TIME_ZONE = '(?:utc|gmt)[+-]\\d{1,2}(?::?\\d{2})?|[+-]\\d{2}(?::?\\d{2})?|z|utc|gmt|ut|[ecmp][sd]t';

/** Optional leading weekday, e.g. `Monday, ` or `Tue `. */
const LEADING_WEEKDAY = `(?:(?<weekday>${WEEKDAY_NAME})\\.?(?:\\s*,\\s*|\\s+))?`;

/** Separator between a date and a time: whitespace or a comma, plus an optional `at`. */
const DATE_TIME_SEPARATOR = '(?:\\s*,\\s*|\\s+)(?:at\\s+)?';

/**
 * A human-friendly time: `3pm`, `3:45 p.m.`, `15:45`, `15:45:30.250 +02:00`.
 * The lookahead requires a bare hour to be followed by a meridiem, so `2024 3` is not a time.
 */
const HUMAN_TIME =
  '(?<hour>\\d{1,2})(?=:|\\s*[ap]\\.?\\s?m\\b)' +
  '(?::(?<minute>\\d{2})(?::(?<second>\\d{2})(?:[.,](?<fraction>\\d{1,9}))?)?)?' +
  '(?:\\s*(?<meridiem>[ap])\\.?\\s?m\\.?)?' +
  `(?:\\s*(?<tz>${TIME_ZONE}))?`;

/** An ISO-8601 extended time: `T10:30`, ` 10:30:00.123Z`, `T10:30:00+05:30`. */
const ISO_TIME =
  '(?<hour>\\d{2}):(?<minute>\\d{2})(?::(?<second>\\d{2})(?:[.,](?<fraction>\\d{1,9}))?)?' +
  `(?:\\s?(?<tz>${TIME_ZONE}))?`;

const OPTIONAL_HUMAN_TIME = `(?:${DATE_TIME_SEPARATOR}${HUMAN_TIME})?`;
const OPTIONAL_ISO_TIME = `(?:[t\\s]${ISO_TIME})?`;

function anchored(source: string): RegExp {
  return new RegExp(`^${source}$`, 'i');
}

const PATTERNS: Record<DateFormat, RegExp> = {
  // 2024-01-15, 2024-01-15T10:30:00.000Z, +002024-01-15
  'iso-extended': anchored(`(?<year>\\d{4}|[+-]\\d{6})-(?<month>\\d{2})-(?<day>\\d{2})${OPTIONAL_ISO_TIME}`),

  // 20240115, 20240115T103000Z
  'iso-basic': anchored(
    '(?<year>\\d{4})(?<month>\\d{2})(?<day>\\d{2})' +
      '(?:t(?<hour>\\d{2})(?<minute>\\d{2})(?:(?<second>\\d{2})(?:[.,](?<fraction>\\d{1,9}))?)?' +
      '(?<tz>z|[+-]\\d{2}(?:\\d{2})?)?)?',
  ),

  // 2024-015 (15 January)
  'iso-ordinal': anchored(`(?<year>\\d{4})-(?<ordinal>\\d{3})${OPTIONAL_ISO_TIME}`),

  // 2024-W03, 2024-W03-1, 2024W031
  'iso-week': anchored(`(?<year>\\d{4})(?<sep>-?)w(?<week>\\d{2})(?:\\k<sep>(?<isoWeekday>[1-7]))?${OPTIONAL_ISO_TIME}`),

  // 2024/01/15, 2024.1.15
  'numeric-ymd': anchored(
    `(?<year>\\d{4})(?<sep>[/.])(?<month>\\d{1,2})\\k<sep>(?<day>\\d{1,2})${OPTIONAL_HUMAN_TIME}`,
  ),

  // 01/15/2024, 1-15-24, 15.01.2024 (the separator must be used consistently)
  numeric: anchored(
    `(?<first>\\d{1,2})(?<sep>[/.-])(?<middle>\\d{1,2})\\k<sep>(?<year>\\d{4}|\\d{2})${OPTIONAL_HUMAN_TIME}`,
  ),

  // January 15, 2024 · Mon, Jan. 15th 2024 at 3:30 PM · Jan-15-2024
  'month-name-first': anchored(
    `${LEADING_WEEKDAY}(?<monthName>${MONTH_NAME})\\.?(?:\\s+|-)(?<day>\\d{1,2})(?<suffix>st|nd|rd|th)?` +
      `(?:\\s*,\\s*|\\s+|-)(?<year>\\d{4}|'?\\d{2})${OPTIONAL_HUMAN_TIME}`,
  ),

  // 15 January 2024 · Tue, 15 Nov 1994 08:12:31 GMT · 15th of March, 2024 · 15-Jan-2024
  'day-first-month-name': anchored(
    `${LEADING_WEEKDAY}(?<day>\\d{1,2})(?<suffix>st|nd|rd|th)?(?:\\s+(?:of\\s+)?|-)(?<monthName>${MONTH_NAME})\\.?` +
      `(?:\\s*,\\s*|\\s+|-)(?<year>\\d{4}|'?\\d{2})${OPTIONAL_HUMAN_TIME}`,
  ),

  // Sun Nov  6 08:49:37 1994 · Sun Nov 6 08:49:37 UTC 1994 (C's asctime and Unix `date`)
  ctime: anchored(
    `(?<weekday>${WEEKDAY_NAME})\\s+(?<monthName>${MONTH_NAME})\\s+(?<day>\\d{1,2})\\s+` +
      `(?<hour>\\d{1,2}):(?<minute>\\d{2}):(?<second>\\d{2})(?:\\s+(?<tz>${TIME_ZONE}))?\\s+(?<year>\\d{4})`,
  ),
};

export const SUPPORTED_FORMATS = Object.keys(PATTERNS) as readonly DateFormat[];

// ---------------------------------------------------------------------------
// Group interpretation
// ---------------------------------------------------------------------------

type Groups = Record<string, string | undefined>;

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** RFC 2822 obsolete North American zones, in minutes from UTC. */
const NAMED_ZONES: Record<string, number> = {
  z: 0, ut: 0, utc: 0, gmt: 0,
  est: -300, edt: -240,
  cst: -360, cdt: -300,
  mst: -420, mdt: -360,
  pst: -480, pdt: -420,
};

const OFFSET_PATTERN = /^(?:utc|gmt)?(?<sign>[+-])(?<hours>\d{1,2})(?::?(?<minutes>\d{2}))?$/i;

function toInt(value: string): number {
  return Number.parseInt(value, 10);
}

function lookupName(table: Record<string, number>, name: string): number | undefined {
  return table[name.slice(0, 3).toLowerCase()];
}

/** Returns the offset in minutes, or undefined if the designator is out of range. */
function parseTimeZone(tz: string): number | undefined {
  const named = NAMED_ZONES[tz.toLowerCase()];
  if (named !== undefined) {
    return named;
  }
  const match = OFFSET_PATTERN.exec(tz);
  if (!match?.groups) {
    return undefined;
  }
  const hours = toInt(match.groups.hours!);
  const minutes = match.groups.minutes ? toInt(match.groups.minutes) : 0;
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  const total = hours * 60 + minutes;
  return match.groups.sign === '-' && total !== 0 ? -total : total;
}

function parseYear(raw: string, pivot: number): number {
  const digits = raw.replace(/^'/, '');
  if (digits.length === 2) {
    const yy = toInt(digits);
    return yy < pivot ? 2000 + yy : 1900 + yy;
  }
  return toInt(digits); // handles 4-digit and signed 6-digit years
}

function expectedOrdinalSuffix(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return 'th';
  }
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function extractDate(format: DateFormat, g: Groups, options: Required<Omit<ParseOptions, 'formats'>>): CivilDate | null {
  const year = parseYear(g.year!, options.twoDigitYearPivot);

  switch (format) {
    case 'iso-extended':
      // ISO 8601 forbids "-000000" as a representation of year zero.
      if (g.year === '-000000') {
        return null;
      }
      return { year, month: toInt(g.month!), day: toInt(g.day!) };
    case 'iso-basic':
    case 'numeric-ymd':
      return { year, month: toInt(g.month!), day: toInt(g.day!) };
    case 'iso-ordinal':
      return fromOrdinalDate(year, toInt(g.ordinal!));
    case 'iso-week':
      return fromIsoWeekDate(year, toInt(g.week!), g.isoWeekday ? toInt(g.isoWeekday) : 1);
    case 'numeric': {
      const first = toInt(g.first!);
      const middle = toInt(g.middle!);
      const dayFirst = g.sep === '.' || options.dayFirst;
      return dayFirst ? { year, month: middle, day: first } : { year, month: first, day: middle };
    }
    case 'month-name-first':
    case 'day-first-month-name':
    case 'ctime': {
      const day = toInt(g.day!);
      if (g.suffix && g.suffix.toLowerCase() !== expectedOrdinalSuffix(day)) {
        return null; // "1th", "2st", ...
      }
      return { year, month: lookupName(MONTH_INDEX, g.monthName!)!, day };
    }
  }
}

interface TimeOfDay {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number | null;
}

function extractTime(g: Groups): TimeOfDay | null {
  if (g.hour === undefined) {
    return { hour: 0, minute: 0, second: 0, millisecond: 0, offsetMinutes: null };
  }

  let hour = toInt(g.hour);
  const minute = g.minute ? toInt(g.minute) : 0;
  const second = g.second ? toInt(g.second) : 0;
  // Fractions keep millisecond precision; extra digits are truncated, not rounded.
  const millisecond = g.fraction ? toInt(g.fraction.padEnd(3, '0').slice(0, 3)) : 0;

  if (g.meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    const isPm = g.meridiem.toLowerCase() === 'p';
    hour = (hour % 12) + (isPm ? 12 : 0);
  }

  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  let offsetMinutes: number | null = null;
  if (g.tz) {
    const offset = parseTimeZone(g.tz);
    if (offset === undefined) {
      return null;
    }
    offsetMinutes = offset;
  }

  return { hour, minute, second, millisecond, offsetMinutes };
}

function interpret(format: DateFormat, g: Groups, options: Required<Omit<ParseOptions, 'formats'>>): ParsedDate | null {
  const date = extractDate(format, g, options);
  if (!date || !isValidDate(date.year, date.month, date.day)) {
    return null;
  }

  // A weekday name, when given, has to agree with the date.
  if (g.weekday !== undefined && lookupName(WEEKDAY_INDEX, g.weekday) !== dayOfWeek(date.year, date.month, date.day)) {
    return null;
  }

  const time = extractTime(g);
  if (!time) {
    return null;
  }

  return { ...date, ...time, format };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a date (and optional time) string.
 *
 * Returns `null` for anything that is not a recognised, real calendar date:
 * unknown formats, 31 April, 29 February in a common year, 25:00, a weekday
 * that does not match the date, and so on.
 */
export function parseDate(input: string, options: ParseOptions = {}): ParsedDate | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
    return null;
  }
  const text = input.trim();
  if (text === '') {
    return null;
  }

  const resolved = {
    dayFirst: options.dayFirst ?? false,
    twoDigitYearPivot: options.twoDigitYearPivot ?? 50,
  };
  const formats = options.formats ?? SUPPORTED_FORMATS;

  for (const format of SUPPORTED_FORMATS) {
    if (!formats.includes(format)) {
      continue;
    }
    const match = PATTERNS[format].exec(text);
    const result = match?.groups ? interpret(format, match.groups, resolved) : null;
    if (result) {
      return result;
    }
  }
  return null;
}

/** Like {@link parseDate}, but throws a `SyntaxError` instead of returning `null`. */
export function parseDateOrThrow(input: string, options?: ParseOptions): ParsedDate {
  const result = parseDate(input, options);
  if (!result) {
    throw new SyntaxError(`Unable to parse date: ${JSON.stringify(input)}`);
  }
  return result;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function formatYear(year: number): string {
  if (year >= 0 && year <= 9999) {
    return pad(year, 4);
  }
  return (year < 0 ? '-' : '+') + pad(Math.abs(year), 6);
}

function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'Z';
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

/**
 * Formats a parsed date as ISO 8601. The offset is preserved as written; a
 * date without zone information is rendered without a designator.
 */
export function toISOString(date: ParsedDate): string {
  const datePart = `${formatYear(date.year)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
  const timePart = `${pad(date.hour, 2)}:${pad(date.minute, 2)}:${pad(date.second, 2)}.${pad(date.millisecond, 3)}`;
  const zone = date.offsetMinutes === null ? '' : formatOffset(date.offsetMinutes);
  return `${datePart}T${timePart}${zone}`;
}

/**
 * Milliseconds since the Unix epoch. Dates without zone information are
 * interpreted as UTC.
 */
export function toEpochMilliseconds(date: ParsedDate): number {
  const days = daysFromCivil(date.year, date.month, date.day);
  const offset = date.offsetMinutes ?? 0;
  const minutes = days * 1440 + date.hour * 60 + date.minute - offset;
  return (minutes * 60 + date.second) * 1000 + date.millisecond;
}
