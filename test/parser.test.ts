import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_INPUT_LENGTH,
  SUPPORTED_FORMATS,
  civilFromDays,
  parseDate,
  parseDateOrThrow,
  toEpochMilliseconds,
  toISOString,
  type DateFormat,
  type ParsedDate,
} from '../src/index.ts';

type Expected = Partial<ParsedDate>;

function expectParse(input: string, expected: Expected, options?: Parameters<typeof parseDate>[1]): void {
  const result = parseDate(input, options);
  assert.ok(result, `expected ${JSON.stringify(input)} to parse`);
  const picked = Object.fromEntries(Object.keys(expected).map((key) => [key, result[key as keyof ParsedDate]]));
  assert.deepEqual(picked, expected, `while parsing ${JSON.stringify(input)}`);
}

function expectReject(input: string, options?: Parameters<typeof parseDate>[1]): void {
  assert.equal(parseDate(input, options), null, `expected ${JSON.stringify(input)} to be rejected`);
}

const midnight = { hour: 0, minute: 0, second: 0, millisecond: 0, offsetMinutes: null };

describe('ISO 8601 extended format', () => {
  it('parses a calendar date with defaults for the time', () => {
    expectParse('2024-01-15', { year: 2024, month: 1, day: 15, ...midnight, format: 'iso-extended' });
  });

  it('parses date-times with every level of precision', () => {
    expectParse('2024-01-15T10:30', { hour: 10, minute: 30, second: 0, offsetMinutes: null });
    expectParse('2024-01-15T10:30:45', { hour: 10, minute: 30, second: 45, millisecond: 0 });
    expectParse('2024-01-15T10:30:45.123', { millisecond: 123 });
    expectParse('2024-01-15T10:30:45,5', { millisecond: 500 });
    expectParse('2024-01-15T10:30:45.12', { millisecond: 120 });
    expectParse('2024-01-15T10:30:45.123456789', { millisecond: 123 }); // truncated, not rounded
    expectParse('2024-01-15T10:30:45.999999', { millisecond: 999 });
  });

  it('accepts a space or lowercase t as the separator', () => {
    expectParse('2024-01-15 10:30:00', { hour: 10, minute: 30 });
    expectParse('2024-01-15t10:30:00z', { hour: 10, offsetMinutes: 0 });
  });

  it('parses zone designators', () => {
    expectParse('2024-01-15T10:30:00Z', { offsetMinutes: 0 });
    expectParse('2024-01-15T10:30:00+05:30', { offsetMinutes: 330 });
    expectParse('2024-01-15T10:30:00+0530', { offsetMinutes: 330 });
    expectParse('2024-01-15T10:30:00-08', { offsetMinutes: -480 });
    expectParse('2024-01-15T10:30:00-00:00', { offsetMinutes: 0 });
    expectParse('2024-01-15 10:30:00 +0200', { offsetMinutes: 120 }); // git log style
    expectParse('2024-01-15 10:30:00 UTC', { offsetMinutes: 0 });
  });

  it('parses expanded (six digit, signed) years', () => {
    expectParse('+012024-01-15', { year: 12024, month: 1, day: 15 });
    expectParse('-000001-03-01', { year: -1, month: 3, day: 1 });
    expectParse('+000000-02-29', { year: 0, month: 2, day: 29 }); // year 0 is a leap year
    expectReject('-000000-01-01'); // forbidden by ISO 8601
  });

  it('rejects malformed ISO strings', () => {
    expectReject('2024-1-15');
    expectReject('2024-01-5');
    expectReject('2024-01-15T1:30');
    expectReject('2024-01-15T10');
    expectReject('2024-01-15T10:30:');
    expectReject('2024-01-15T10:30:00.');
    expectReject('2024-01-15T10:30:00+5');
    expectReject('2024-01-15T10:30:00Q');
    expectReject('2024-01-15T');
    expectReject('12024-01-15');
  });
});

describe('ISO 8601 basic, ordinal and week formats', () => {
  it('parses basic format', () => {
    expectParse('20240115', { year: 2024, month: 1, day: 15, format: 'iso-basic' });
    expectParse('20240115T1030', { hour: 10, minute: 30, second: 0 });
    expectParse('20240115T103045Z', { hour: 10, minute: 30, second: 45, offsetMinutes: 0 });
    expectParse('20240115T103045.5-0500', { millisecond: 500, offsetMinutes: -300 });
    expectReject('2024011');
    expectReject('202401150');
    expectReject('20240230');
  });

  it('parses ordinal dates', () => {
    expectParse('2024-001', { year: 2024, month: 1, day: 1, format: 'iso-ordinal' });
    expectParse('2024-060', { month: 2, day: 29 });
    expectParse('2023-060', { month: 3, day: 1 });
    expectParse('2024-366T12:00Z', { month: 12, day: 31, hour: 12, offsetMinutes: 0 });
    expectReject('2023-366');
    expectReject('2024-000');
    expectReject('2024-367');
  });

  it('parses week dates', () => {
    expectParse('2026-W41-7', { year: 2026, month: 10, day: 11, format: 'iso-week' });
    expectParse('2026W417', { year: 2026, month: 10, day: 11 });
    expectParse('2026-W41', { year: 2026, month: 10, day: 5 }); // defaults to Monday
    expectParse('2009-W01-1', { year: 2008, month: 12, day: 29 });
    expectParse('2020-W53-5T08:00', { year: 2021, month: 1, day: 1, hour: 8 });
    expectReject('2024-W53');
    expectReject('2024-W00');
    expectReject('2024-W01-8');
    expectReject('2024-W011'); // mixed basic/extended separators
    expectReject('2024W01-1');
  });
});

describe('numeric formats', () => {
  it('parses year-first numeric dates', () => {
    expectParse('2024/01/15', { year: 2024, month: 1, day: 15, format: 'numeric-ymd' });
    expectParse('2024/1/5', { month: 1, day: 5 });
    expectParse('2024.12.25', { month: 12, day: 25 });
    expectReject('2024/01.15');
  });

  it('treats slash and dash dates as month-first by default', () => {
    expectParse('01/15/2024', { year: 2024, month: 1, day: 15, format: 'numeric' });
    expectParse('1/5/2024', { month: 1, day: 5 });
    expectParse('12-25-2024', { month: 12, day: 25 });
    expectReject('15/01/2024');
  });

  it('honours the dayFirst option', () => {
    expectParse('15/01/2024', { month: 1, day: 15 }, { dayFirst: true });
    expectParse('01/02/2024', { month: 2, day: 1 }, { dayFirst: true });
    expectParse('01/02/2024', { month: 1, day: 2 }, { dayFirst: false });
  });

  it('always treats dotted dates as day-first', () => {
    expectParse('15.01.2024', { month: 1, day: 15 });
    expectParse('01.02.2024', { month: 2, day: 1 });
    expectReject('01.15.2024');
  });

  it('requires a consistent separator', () => {
    expectReject('01/15-2024');
    expectReject('01-15/2024');
    expectReject('01.15/2024');
  });

  it('expands two-digit years using the pivot', () => {
    expectParse('1/5/24', { year: 2024 });
    expectParse('1/5/49', { year: 2049 });
    expectParse('1/5/50', { year: 1950 });
    expectParse('1/5/99', { year: 1999 });
    expectParse('1/5/00', { year: 2000 });
    expectParse('1/5/69', { year: 2069 }, { twoDigitYearPivot: 70 });
    expectParse('1/5/70', { year: 1970 }, { twoDigitYearPivot: 70 });
  });

  it('rejects other year lengths', () => {
    expectReject('1/5/2');
    expectReject('1/5/202');
    expectReject('1/5/20245');
    expectReject('123/5/2024');
  });

  it('accepts an attached time', () => {
    expectParse('01/15/2024 14:30', { hour: 14, minute: 30 });
    expectParse('01/15/2024, 2:30 PM', { hour: 14, minute: 30 });
    expectParse('15.01.2024 08:00:05', { day: 15, hour: 8, second: 5 });
    expectParse('2024/01/15 9am', { hour: 9 });
  });
});

describe('month-name formats', () => {
  it('parses month-first names', () => {
    expectParse('January 15, 2024', { year: 2024, month: 1, day: 15, format: 'month-name-first' });
    expectParse('Jan 15 2024', { month: 1, day: 15 });
    expectParse('Jan. 15, 2024', { month: 1, day: 15 });
    expectParse('Jan-15-2024', { month: 1, day: 15 });
    expectParse('sept 1, 2024', { month: 9, day: 1 });
    expectParse('DECEMBER 31, 1999', { year: 1999, month: 12, day: 31 });
    expectParse("Jan 5 '24", { year: 2024, day: 5 });
    expectParse('Jan 5, 99', { year: 1999 });
  });

  it('parses day-first names', () => {
    expectParse('15 January 2024', { year: 2024, month: 1, day: 15, format: 'day-first-month-name' });
    expectParse('15 Jan 2024', { month: 1, day: 15 });
    expectParse('15-Jan-2024', { month: 1, day: 15 });
    expectParse('15 Jan, 2024', { month: 1, day: 15 });
    expectParse('15th of March, 2024', { month: 3, day: 15 });
    expectParse('1st of May 2024', { month: 5, day: 1 });
  });

  it('recognises every month name and abbreviation', () => {
    const names = [
      ['January', 'Jan'], ['February', 'Feb'], ['March', 'Mar'], ['April', 'Apr'],
      ['May', 'May'], ['June', 'Jun'], ['July', 'Jul'], ['August', 'Aug'],
      ['September', 'Sep'], ['October', 'Oct'], ['November', 'Nov'], ['December', 'Dec'],
    ] as const;
    names.forEach(([full, short], index) => {
      expectParse(`${full} 1, 2024`, { month: index + 1 });
      expectParse(`1 ${short} 2024`, { month: index + 1 });
    });
  });

  it('rejects unknown or mangled month names', () => {
    expectReject('Janu 15, 2024');
    expectReject('Januaryy 15, 2024');
    expectReject('Foo 15, 2024');
    expectReject('Mayday 15, 2024');
    expectReject('15 Octo 2024');
  });

  it('validates ordinal suffixes', () => {
    for (const [day, suffix] of [[1, 'st'], [2, 'nd'], [3, 'rd'], [4, 'th'], [11, 'th'], [12, 'th'], [13, 'th'], [21, 'st'], [22, 'nd'], [23, 'rd'], [31, 'st']] as const) {
      expectParse(`March ${day}${suffix}, 2024`, { day });
    }
    expectReject('March 1th, 2024');
    expectReject('March 2st, 2024');
    expectReject('March 11st, 2024');
    expectReject('March 12nd, 2024');
    expectReject('March 13rd, 2024');
    expectReject('22th March 2024');
  });

  it('checks that a leading weekday matches the date', () => {
    expectParse('Monday, January 15, 2024', { day: 15 });
    expectParse('Mon, Jan 15, 2024', { day: 15 });
    expectParse('Mon. Jan 15 2024', { day: 15 });
    expectParse('Thurs, Jan 18, 2024', { day: 18 });
    expectParse('Tues 16 Jan 2024', { day: 16 });
    expectReject('Tuesday, January 15, 2024');
    expectReject('Sun, 15 Jan 2024');
  });

  it('accepts attached times in many styles', () => {
    expectParse('January 15, 2024 3:45 PM', { hour: 15, minute: 45 });
    expectParse('January 15, 2024 at 3:45pm', { hour: 15, minute: 45 });
    expectParse('January 15, 2024, 3pm', { hour: 15, minute: 0 });
    expectParse('January 15, 2024 3 p.m.', { hour: 15 });
    expectParse('January 15, 2024 12:00 AM', { hour: 0 });
    expectParse('January 15, 2024 12:00 PM', { hour: 12 });
    expectParse('January 15, 2024 12:30 am', { hour: 0, minute: 30 });
    expectParse('January 15, 2024 11:59:59.999 PM', { hour: 23, minute: 59, second: 59, millisecond: 999 });
    expectParse('15 January 2024 23:15:00 EST', { hour: 23, minute: 15, offsetMinutes: -300 });
  });

  it('rejects a bare hour without a meridiem', () => {
    expectReject('January 15, 2024 3');
    expectReject('January 15, 2024 at 15');
  });
});

describe('RFC 2822 and ctime', () => {
  it('parses RFC 2822 dates', () => {
    expectParse('Tue, 15 Nov 1994 08:12:31 GMT', {
      year: 1994, month: 11, day: 15, hour: 8, minute: 12, second: 31, offsetMinutes: 0,
    });
    expectParse('Fri, 21 Nov 1997 09:55:06 -0600', { offsetMinutes: -360 });
    expectParse('Thu, 13 Feb 1969 23:32:54 -0330', { offsetMinutes: -210 });
    expectParse('21 Nov 97 09:55:06 GMT', { year: 1997 });
  });

  it('understands the obsolete RFC 2822 US zones', () => {
    const zones = { EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
    for (const [zone, offsetMinutes] of Object.entries(zones)) {
      expectParse(`1 Jul 2024 12:00 ${zone}`, { offsetMinutes });
    }
  });

  it('parses ctime / Unix date output', () => {
    expectParse('Sun Nov  6 08:49:37 1994', {
      year: 1994, month: 11, day: 6, hour: 8, minute: 49, second: 37, offsetMinutes: null, format: 'ctime',
    });
    expectParse('Sun Nov 6 08:49:37 UTC 1994', { offsetMinutes: 0, format: 'ctime' });
    expectParse('Sun Oct 11 20:33:00 PDT 2026', { day: 11, offsetMinutes: -420 });
    expectReject('Mon Nov  6 08:49:37 1994'); // wrong weekday
    expectReject('Sun Nov  6 25:49:37 1994');
  });
});

describe('time zone designators', () => {
  it('parses GMT/UTC prefixed offsets', () => {
    expectParse('Jan 1 2024 10:00 UTC+5', { offsetMinutes: 300 });
    expectParse('Jan 1 2024 10:00 GMT-3:30', { offsetMinutes: -210 });
    expectParse('Jan 1 2024 10:00 utc+0545', { offsetMinutes: 345 });
    expectParse('Jan 1 2024 10:00 UT', { offsetMinutes: 0 });
  });

  it('rejects out-of-range offsets', () => {
    expectReject('2024-01-15T10:30:00+24:00');
    expectReject('2024-01-15T10:30:00+05:60');
    expectReject('Jan 1 2024 10:00 UTC+25');
  });

  it('rejects unknown zone abbreviations', () => {
    expectReject('Jan 1 2024 10:00 XYZ');
    expectReject('Jan 1 2024 10:00 BST');
  });
});

describe('calendar validation', () => {
  it('rejects days that do not exist', () => {
    expectReject('2023-02-29');
    expectReject('1900-02-29');
    expectReject('2024-02-30');
    expectReject('2024-04-31');
    expectReject('2024-06-31');
    expectReject('2024-09-31');
    expectReject('2024-11-31');
    expectReject('2024-00-10');
    expectReject('2024-13-01');
    expectReject('2024-01-00');
    expectReject('2024-01-32');
    expectReject('February 29, 2023');
    expectReject('31 April 2024');
    expectReject('31.04.2024');
  });

  it('accepts leap days that do exist', () => {
    expectParse('2024-02-29', { month: 2, day: 29 });
    expectParse('2000-02-29', { month: 2, day: 29 });
    expectParse('Feb 29, 2024', { month: 2, day: 29 });
    expectParse('29.02.2024', { month: 2, day: 29 });
  });

  it('accepts the last day of every month', () => {
    const lastDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lastDays.forEach((day, i) => {
      const month = String(i + 1).padStart(2, '0');
      expectParse(`2024-${month}-${day}`, { month: i + 1, day });
      expectReject(`2024-${month}-${day + 1}`);
    });
  });

  it('rejects impossible times', () => {
    expectReject('2024-01-15T24:00');
    expectReject('2024-01-15T23:60');
    expectReject('2024-01-15T23:59:60');
    expectReject('January 15, 2024 13:00 PM');
    expectReject('January 15, 2024 0:00 AM');
    expectReject('January 15, 2024 25:00');
  });

  it('accepts boundary times', () => {
    expectParse('2024-01-15T00:00:00', { hour: 0, minute: 0, second: 0 });
    expectParse('2024-01-15T23:59:59.999', { hour: 23, minute: 59, second: 59, millisecond: 999 });
  });
});

describe('general input handling', () => {
  it('trims surrounding whitespace', () => {
    expectParse('   2024-01-15\n', { year: 2024 });
    expectParse('\tJanuary 15, 2024  ', { day: 15 });
  });

  it('rejects garbage, empty and non-string input', () => {
    for (const input of ['', '   ', 'not a date', 'today', '2024', '15', 'January', 'January 2024', '2024-01-15 and more', 'x2024-01-15', '2024-01-15x', '１２/１５/２０２４']) {
      expectReject(input);
    }
    assert.equal(parseDate(undefined as unknown as string), null);
    assert.equal(parseDate(20240115 as unknown as string), null);
  });

  it('rejects overly long input without hanging', () => {
    expectReject(`2024-01-15${' '.repeat(MAX_INPUT_LENGTH)}`);
    const started = process.hrtime.bigint();
    for (const filler of [' ', ',', '1', 'a']) {
      parseDate(`Monday${filler.repeat(MAX_INPUT_LENGTH - 10)}`);
      parseDate(`1/1/2024${filler.repeat(MAX_INPUT_LENGTH - 10)}`);
      parseDate(`January 1, 2024 1${filler.repeat(MAX_INPUT_LENGTH - 20)}`);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 250, `adversarial inputs took ${elapsedMs}ms`);
  });

  it('can be restricted to particular formats', () => {
    expectParse('2024-01-15', { year: 2024 }, { formats: ['iso-extended'] });
    expectReject('January 15, 2024', { formats: ['iso-extended'] });
    expectReject('2024-01-15', { formats: ['month-name-first', 'numeric'] });
    expectReject('2024-01-15', { formats: [] });
  });

  it('exposes the list of supported formats', () => {
    const expected: DateFormat[] = [
      'iso-extended', 'iso-basic', 'iso-ordinal', 'iso-week', 'numeric-ymd',
      'numeric', 'month-name-first', 'day-first-month-name', 'ctime',
    ];
    assert.deepEqual([...SUPPORTED_FORMATS].sort(), expected.sort());
  });

  it('returns a fresh object every time', () => {
    const a = parseDate('2024-01-15');
    const b = parseDate('2024-01-15');
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });
});

describe('parseDateOrThrow', () => {
  it('returns the parsed date', () => {
    assert.equal(parseDateOrThrow('2024-01-15').day, 15);
  });

  it('throws a SyntaxError that names the input', () => {
    assert.throws(() => parseDateOrThrow('nope'), { name: 'SyntaxError', message: /"nope"/ });
  });
});

describe('toISOString', () => {
  it('formats with and without an offset', () => {
    assert.equal(toISOString(parseDateOrThrow('January 5, 2024 3:04:05 PM')), '2024-01-05T15:04:05.000');
    assert.equal(toISOString(parseDateOrThrow('2024-01-05T15:04:05.7Z')), '2024-01-05T15:04:05.700Z');
    assert.equal(toISOString(parseDateOrThrow('2024-01-05T15:04:05+05:30')), '2024-01-05T15:04:05.000+05:30');
    assert.equal(toISOString(parseDateOrThrow('2024-01-05T15:04:05-0930')), '2024-01-05T15:04:05.000-09:30');
  });

  it('uses expanded years outside 0000-9999', () => {
    assert.equal(toISOString(parseDateOrThrow('+012024-01-15')), '+012024-01-15T00:00:00.000');
    assert.equal(toISOString(parseDateOrThrow('-000044-03-15')), '-000044-03-15T00:00:00.000');
    assert.equal(toISOString(parseDateOrThrow('+000000-01-01')), '0000-01-01T00:00:00.000');
  });

  it('matches Date#toISOString for UTC inputs', () => {
    for (const input of ['1970-01-01T00:00:00Z', '2024-02-29T23:59:59.999Z', '1601-01-01T00:00:00Z', '9999-12-31T23:59:59.999Z']) {
      assert.equal(toISOString(parseDateOrThrow(input)), new Date(input).toISOString());
    }
  });
});

describe('toEpochMilliseconds', () => {
  it('handles known instants', () => {
    assert.equal(toEpochMilliseconds(parseDateOrThrow('1970-01-01T00:00:00Z')), 0);
    assert.equal(toEpochMilliseconds(parseDateOrThrow('1970-01-01T01:00:00+01:00')), 0);
    assert.equal(toEpochMilliseconds(parseDateOrThrow('1969-12-31T23:59:59.999Z')), -1);
    assert.equal(toEpochMilliseconds(parseDateOrThrow('2001-09-09T01:46:40Z')), 1_000_000_000_000);
  });

  it('treats inputs without a zone as UTC', () => {
    assert.equal(toEpochMilliseconds(parseDateOrThrow('2024-01-15')), Date.UTC(2024, 0, 15));
  });

  it('agrees with Date.parse for the same instant written in different formats', () => {
    const instant = Date.parse('1994-11-15T08:12:31Z');
    for (const input of [
      '1994-11-15T08:12:31Z',
      '19941115T081231Z',
      '1994-11-15T03:12:31-05:00',
      'Tue, 15 Nov 1994 08:12:31 GMT',
      'Tue, 15 Nov 1994 03:12:31 EST',
      'Tue Nov 15 08:12:31 UTC 1994',
      'November 15th, 1994 at 1:12:31 AM PDT',
      '11/15/1994 8:12:31 AM Z',
      '1994-319T08:12:31Z',
      '1994-W46-2T08:12:31Z',
    ]) {
      assert.equal(toEpochMilliseconds(parseDateOrThrow(input)), instant, input);
    }
  });

  it('matches Date.parse across a large random sample of ISO strings', () => {
    let seed = 0x5eed;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pad = (value: number, width: number): string => String(value).padStart(width, '0');

    for (let i = 0; i < 5000; i++) {
      const { year, month, day } = civilFromDays(random(2_900_000) - 719_000); // ~0032 to ~7900
      const offsetSign = random(2) ? '+' : '-';
      const offset = random(3) === 0 ? 'Z' : `${offsetSign}${pad(random(15), 2)}:${pad(random(4) * 15, 2)}`;
      const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(random(24), 2)}:${pad(random(60), 2)}:${pad(random(60), 2)}.${pad(random(1000), 3)}${offset}`;

      const parsed = parseDateOrThrow(iso);
      assert.equal(toEpochMilliseconds(parsed), Date.parse(iso), iso);
      // Round trip: formatting then re-parsing yields an identical result.
      assert.deepEqual(parseDate(toISOString(parsed)), parsed, iso);
    }
  });
});
