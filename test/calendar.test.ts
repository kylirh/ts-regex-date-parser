import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  civilFromDays,
  dayOfWeek,
  dayOfYear,
  daysFromCivil,
  daysInMonth,
  daysInYear,
  fromIsoWeekDate,
  fromOrdinalDate,
  isLeapYear,
  isoWeeksInYear,
  isValidDate,
} from '../src/index.ts';

// The native Date object is used here ONLY as an independent oracle to verify
// the from-scratch implementation. The library itself never touches it.
const MS_PER_DAY = 86_400_000;

describe('isLeapYear', () => {
  it('handles the 4/100/400 rules', () => {
    assert.equal(isLeapYear(2024), true);
    assert.equal(isLeapYear(2023), false);
    assert.equal(isLeapYear(1900), false);
    assert.equal(isLeapYear(2000), true);
    assert.equal(isLeapYear(2100), false);
    assert.equal(isLeapYear(2400), true);
  });

  it('handles year zero and negative (astronomical) years', () => {
    assert.equal(isLeapYear(0), true);
    assert.equal(isLeapYear(-4), true);
    assert.equal(isLeapYear(-1), false);
    assert.equal(isLeapYear(-100), false);
    assert.equal(isLeapYear(-400), true);
  });
});

describe('daysInMonth / daysInYear', () => {
  it('returns the right length for every month', () => {
    assert.deepEqual(
      Array.from({ length: 12 }, (_, i) => daysInMonth(2023, i + 1)),
      [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
    );
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInYear(2024), 366);
    assert.equal(daysInYear(2023), 365);
  });

  it('throws on invalid months', () => {
    assert.throws(() => daysInMonth(2024, 0), RangeError);
    assert.throws(() => daysInMonth(2024, 13), RangeError);
  });
});

describe('isValidDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    assert.equal(isValidDate(2024, 2, 29), true);
    assert.equal(isValidDate(2023, 2, 29), false);
    assert.equal(isValidDate(2024, 4, 31), false);
    assert.equal(isValidDate(2024, 0, 1), false);
    assert.equal(isValidDate(2024, 1, 0), false);
    assert.equal(isValidDate(2024, 1.5, 1), false);
  });
});

describe('daysFromCivil / civilFromDays', () => {
  it('anchors on the Unix epoch', () => {
    assert.equal(daysFromCivil(1970, 1, 1), 0);
    assert.deepEqual(civilFromDays(0), { year: 1970, month: 1, day: 1 });
    assert.equal(daysFromCivil(1969, 12, 31), -1);
    assert.equal(daysFromCivil(2000, 3, 1), 11017);
  });

  it('matches Date.UTC for every day from 1600 to 2400', () => {
    // Walk day by day, which also exercises every month boundary and leap day.
    let expectedDays = Date.UTC(1600, 0, 1) / MS_PER_DAY;
    for (let year = 1600; year <= 2400; year++) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= daysInMonth(year, month); day++) {
          if (daysFromCivil(year, month, day) !== expectedDays) {
            assert.fail(`daysFromCivil(${year}, ${month}, ${day}) !== ${expectedDays}`);
          }
          const civil = civilFromDays(expectedDays);
          if (civil.year !== year || civil.month !== month || civil.day !== day) {
            assert.fail(`civilFromDays(${expectedDays}) returned ${JSON.stringify(civil)}`);
          }
          expectedDays++;
        }
      }
    }
    assert.equal(expectedDays, Date.UTC(2401, 0, 1) / MS_PER_DAY);
  });

  it('round-trips far outside the Date range, including negative years', () => {
    for (let days = -1_000_000_000; days <= 1_000_000_000; days += 7_919_993) {
      const { year, month, day } = civilFromDays(days);
      assert.equal(daysFromCivil(year, month, day), days);
    }
    assert.equal(daysFromCivil(0, 1, 1), -719528);
    assert.deepEqual(civilFromDays(-719529), { year: -1, month: 12, day: 31 });
  });
});

describe('dayOfWeek / dayOfYear', () => {
  it('knows some famous days', () => {
    assert.equal(dayOfWeek(1970, 1, 1), 4); // Thursday
    assert.equal(dayOfWeek(2000, 1, 1), 6); // Saturday
    assert.equal(dayOfWeek(1969, 7, 20), 0); // Sunday, Moon landing
    assert.equal(dayOfWeek(2026, 10, 11), 0); // Sunday
  });

  it('matches Date#getUTCDay across a wide sample', () => {
    for (let days = -200_000; days <= 200_000; days += 37) {
      const { year, month, day } = civilFromDays(days);
      assert.equal(dayOfWeek(year, month, day), new Date(days * MS_PER_DAY).getUTCDay());
    }
  });

  it('computes ordinal days', () => {
    assert.equal(dayOfYear(2024, 1, 1), 1);
    assert.equal(dayOfYear(2024, 3, 1), 61);
    assert.equal(dayOfYear(2023, 3, 1), 60);
    assert.equal(dayOfYear(2024, 12, 31), 366);
  });
});

describe('ISO week dates', () => {
  it('knows which years have 53 weeks', () => {
    assert.equal(isoWeeksInYear(2020), 53); // starts Wednesday, leap year
    assert.equal(isoWeeksInYear(2015), 53); // starts Thursday
    assert.equal(isoWeeksInYear(2026), 53); // starts Thursday
    assert.equal(isoWeeksInYear(2024), 52);
    assert.equal(isoWeeksInYear(2021), 52);
  });

  it('converts week dates, including ones that cross a year boundary', () => {
    assert.deepEqual(fromIsoWeekDate(2026, 41, 7), { year: 2026, month: 10, day: 11 });
    assert.deepEqual(fromIsoWeekDate(2009, 1, 1), { year: 2008, month: 12, day: 29 });
    assert.deepEqual(fromIsoWeekDate(2020, 53, 5), { year: 2021, month: 1, day: 1 });
    assert.deepEqual(fromIsoWeekDate(2004, 53, 7), { year: 2005, month: 1, day: 2 });
  });

  it('rejects out-of-range weeks and weekdays', () => {
    assert.equal(fromIsoWeekDate(2024, 53, 1), null);
    assert.equal(fromIsoWeekDate(2024, 0, 1), null);
    assert.equal(fromIsoWeekDate(2024, 1, 0), null);
    assert.equal(fromIsoWeekDate(2024, 1, 8), null);
  });

  it('agrees with a brute-force ISO week computation for every day of 1990-2040', () => {
    for (let days = daysFromCivil(1990, 1, 1); days <= daysFromCivil(2040, 12, 31); days++) {
      const { year, month, day } = civilFromDays(days);
      // Reference: the ISO week-year is the year of this week's Thursday.
      const isoDow = dayOfWeek(year, month, day) || 7;
      const thursday = civilFromDays(days - isoDow + 4);
      const week = Math.floor((dayOfYear(thursday.year, thursday.month, thursday.day) - 1) / 7) + 1;
      const result = fromIsoWeekDate(thursday.year, week, isoDow);
      if (!result || result.year !== year || result.month !== month || result.day !== day) {
        assert.fail(`${thursday.year}-W${week}-${isoDow} should be ${year}-${month}-${day}`);
      }
    }
  });
});

describe('fromOrdinalDate', () => {
  it('converts ordinal days and rejects out-of-range ones', () => {
    assert.deepEqual(fromOrdinalDate(2024, 60), { year: 2024, month: 2, day: 29 });
    assert.deepEqual(fromOrdinalDate(2023, 60), { year: 2023, month: 3, day: 1 });
    assert.deepEqual(fromOrdinalDate(2024, 366), { year: 2024, month: 12, day: 31 });
    assert.equal(fromOrdinalDate(2023, 366), null);
    assert.equal(fromOrdinalDate(2023, 0), null);
  });
});
