/**
 * Proleptic Gregorian calendar arithmetic, implemented with plain integer math.
 * Nothing in here touches the native `Date` object.
 *
 * Years are astronomical: year 0 exists (1 BC) and year -1 is 2 BC.
 * Months are 1-12 and days are 1-31. Weekdays are 0 (Sunday) through 6 (Saturday).
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Integer division that rounds toward negative infinity. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Modulo that always returns a value in [0, b). */
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function isLeapYear(year: number): boolean {
  return mod(year, 4) === 0 && (mod(year, 100) !== 0 || mod(year, 400) === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new RangeError(`Month out of range: ${month}`);
  }
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

export function isValidDate(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/**
 * Number of days since 1970-01-01 for a civil date.
 * Based on Howard Hinnant's `days_from_civil` algorithm.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = floorDiv(y, 400);
  const yearOfEra = y - era * 400; // [0, 399]
  const shiftedMonth = month > 2 ? month - 3 : month + 9; // March = 0
  const dayOfYear = floorDiv(153 * shiftedMonth + 2, 5) + day - 1; // [0, 365]
  const dayOfEra = yearOfEra * 365 + floorDiv(yearOfEra, 4) - floorDiv(yearOfEra, 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Inverse of {@link daysFromCivil}. */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = floorDiv(z, 146097);
  const dayOfEra = z - era * 146097; // [0, 146096]
  const yearOfEra = floorDiv(
    dayOfEra - floorDiv(dayOfEra, 1460) + floorDiv(dayOfEra, 36524) - floorDiv(dayOfEra, 146096),
    365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + floorDiv(yearOfEra, 4) - floorDiv(yearOfEra, 100));
  const shiftedMonth = floorDiv(5 * dayOfYear + 2, 153);
  const day = dayOfYear - floorDiv(153 * shiftedMonth + 2, 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(year: number, month: number, day: number): number {
  // 1970-01-01 was a Thursday (4).
  return mod(daysFromCivil(year, month, day) + 4, 7);
}

/** 1-based ordinal day within the year (1 January = 1). */
export function dayOfYear(year: number, month: number, day: number): number {
  return daysFromCivil(year, month, day) - daysFromCivil(year, 1, 1) + 1;
}

/** ISO-8601 weekday: 1 = Monday ... 7 = Sunday. */
function isoWeekday(year: number, month: number, day: number): number {
  const dow = dayOfWeek(year, month, day);
  return dow === 0 ? 7 : dow;
}

/** An ISO year has 53 weeks when it starts on a Thursday, or is a leap year starting on a Wednesday. */
export function isoWeeksInYear(year: number): number {
  const jan1 = isoWeekday(year, 1, 1);
  return jan1 === 4 || (jan1 === 3 && isLeapYear(year)) ? 53 : 52;
}

/** Converts an ISO week date (e.g. 2026-W41-7) to a civil date. Returns null if out of range. */
export function fromIsoWeekDate(
  isoYear: number,
  week: number,
  weekday: number,
): { year: number; month: number; day: number } | null {
  if (week < 1 || week > isoWeeksInYear(isoYear) || weekday < 1 || weekday > 7) {
    return null;
  }
  // 4 January is always in week 1, so the Monday of week 1 is easy to find from it.
  const jan4 = daysFromCivil(isoYear, 1, 4);
  const mondayOfWeek1 = jan4 - (isoWeekday(isoYear, 1, 4) - 1);
  return civilFromDays(mondayOfWeek1 + (week - 1) * 7 + (weekday - 1));
}

/** Converts a 1-based ordinal day of the year to a civil date. Returns null if out of range. */
export function fromOrdinalDate(
  year: number,
  ordinal: number,
): { year: number; month: number; day: number } | null {
  if (ordinal < 1 || ordinal > daysInYear(year)) {
    return null;
  }
  return civilFromDays(daysFromCivil(year, 1, 1) + ordinal - 1);
}
