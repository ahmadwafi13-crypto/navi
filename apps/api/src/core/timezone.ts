/**
 * Timezone engine for NAVI.
 *
 * Indonesia has three zones (PRD AC05):
 *   WIB  Asia/Jakarta   UTC+7
 *   WITA Asia/Makassar UTC+8
 *   WIT  Asia/Jayapura UTC+9
 *
 * Implemented with the built-in Intl API so there is no runtime dependency and
 * no dependency on the host machine timezone.
 */

export const SITE_TZ: Record<string, string> = {
  JKT: 'Asia/Jakarta',
  MKS: 'Asia/Makassar',
  JYP: 'Asia/Jayapura',
};

export const TZ_LABEL: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
};

export const TZ_BY_LABEL: Record<string, string> = {
  WIB: 'Asia/Jakarta',
  WITA: 'Asia/Makassar',
  WIT: 'Asia/Jayapura',
};

export const INDONESIAN_DAYS = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
] as const;

/**
 * The organization fixture (data/01_organization.json) lists workdays in
 * English, while the UI and the rest of NAVI use Indonesian. This map keeps
 * the two comparable without altering the fixture.
 */
export const DAY_NAME_EN: Record<string, string> = {
  Minggu: 'Sunday',
  Senin: 'Monday',
  Selasa: 'Tuesday',
  Rabu: 'Wednesday',
  Kamis: 'Thursday',
  Jumat: 'Friday',
  Sabtu: 'Saturday',
};

export const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  maret: 3,
  mei: 5,
  agustus: 8,
  agu: 8,
  september: 9,
  okt: 10,
  oktober: 10,
  november: 11,
  nopember: 11,
  desember: 12,
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/** Offset of `timeZone` from UTC in minutes at the given instant. */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Convert a wall clock time expressed in `timeZone` into an absolute instant.
 * Two-pass offset resolution keeps DST/edge cases stable.
 */
export function zonedWallClockToUtc(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(naive), timeZone);
  const candidate = new Date(naive - firstOffset * 60000);
  const secondOffset = getTimeZoneOffsetMinutes(candidate, timeZone);
  return new Date(naive - secondOffset * 60000);
}

/** ISO-8601 string with the explicit local offset of `timeZone`. */
export function toIsoWithOffset(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const offsetMinutes = getTimeZoneOffsetMinutes(date, timeZone);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(
    p.hour,
  ).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00${sign}${hh}:${mm}`;
}

/** "13:30 WITA" style label used across the UI (PRD 7.5). */
export function formatLocal(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${
    TZ_LABEL[timeZone] ?? timeZone
  }`;
}

export function formatLocalLong(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const day = INDONESIAN_DAYS[p.weekday];
  return `${day}, ${p.day} ${monthName(p.month)} ${p.year} ${String(p.hour).padStart(
    2,
    '0',
  )}:${String(p.minute).padStart(2, '0')} ${TZ_LABEL[timeZone] ?? timeZone}`;
}

export function monthName(month: number): string {
  const names = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return names[month - 1] ?? String(month);
}

export function isoDate(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Local minutes since midnight, used for business hour / prayer block checks. */
export function localMinutes(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function parseTimeLabel(label: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(label.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Convert a wall clock time in one zone to the same wall clock time in another
 * zone. This is what the Validator uses to answer "13.30 WIB = 14.30 WITA"
 * (TC08) and "09.00 WIB = 11.00 WIT" (TC09).
 */
export function convertWallClock(
  wall: WallClock,
  fromTz: string,
  toTz: string,
): { wall: WallClock; utc: Date } {
  const utc = zonedWallClockToUtc(wall, fromTz);
  const p = getZonedParts(utc, toTz);
  return {
    wall: { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute },
    utc,
  };
}
