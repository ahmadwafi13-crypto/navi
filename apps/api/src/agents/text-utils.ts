/**
 * Indonesian-language parsing helpers used by the Interpreter agent.
 *
 * Deterministic on purpose: the same input must always produce the same plan
 * so that the 20 acceptance test cases are reproducible.
 */

import {
  INDONESIAN_DAYS,
  INDONESIAN_MONTHS,
  convertWallClock,
  getZonedParts,
  type WallClock,
} from '../core/timezone.js';

const WORD_NUMBERS: Record<string, number> = {
  nol: 0,
  satu: 1,
  se: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  duabelas: 12,
  dua_belas: 12,
  tigabelas: 13,
  tiga_belas: 13,
  empatbelas: 14,
  empat_belas: 14,
  limabelas: 15,
  lima_belas: 15,
  enambelas: 16,
  enam_belas: 16,
  tujuhbelas: 17,
  tujuh_belas: 17,
  delapanbelas: 18,
  delapan_belas: 18,
  sembilanbelas: 19,
  sembilan_belas: 19,
  dua_puluh: 20,
  duapuluh: 20,
  dua_puluh_satu: 21,
  dua_puluh_dua: 22,
  dua_puluh_tiga: 23,
  dua_puluh_empat: 24,
};

function wordNumber(word: string): number | null {
  const w = word.toLowerCase().trim();
  if (WORD_NUMBERS[w] !== undefined) return WORD_NUMBERS[w];
  if (w === 'sebelas') return 11;
  const belas = /^(.+)\s+belas$/.exec(w);
  if (belas) {
    const base = WORD_NUMBERS[belas[1]];
    if (base !== undefined) return base + 10;
  }
  const puluh = /^(.+)\s*puluh(?:\s+(.+))?$/.exec(w);
  if (puluh) {
    const base = WORD_NUMBERS[puluh[1]];
    if (base !== undefined) {
      const ones = puluh[2] ? WORD_NUMBERS[puluh[2]] ?? 0 : 0;
      return base * 10 + ones;
    }
  }
  return null;
}

/** Parse an Indonesian time expression into hour/minute (24h). */
export function parseIndonesianTime(text: string): { hour: number; minute: number } | null {
  const lower = text.toLowerCase();

  // "jam 11.30", "pukul 16.00", "11:30"
  const numeric = /(?:jam|pukul)?\s*(\d{1,2})[:.](\d{2})/.exec(lower);
  if (numeric) {
    const hour = Number(numeric[1]);
    const minute = Number(numeric[2]);
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }

  // "jam setengah dua belas" -> 11:30 ; "jam setengah satu" -> 00:30
  const setengah = /(?:jam|pukul)?\s*setengah\s+([a-z]+(?:\s+[a-z]+)?)/.exec(lower);
  if (setengah) {
    // Try the two-word form first ("dua belas" = 12), then the single word.
    const twoWords = wordNumber(setengah[1]);
    const oneWord = wordNumber(setengah[1].split(/\s+/)[0]);
    const n = twoWords ?? oneWord;
    if (n !== null) {
      if (n === 12) return { hour: 11, minute: 30 };
      if (n === 1) return { hour: 0, minute: 30 };
      if (n > 1 && n <= 11) return { hour: n, minute: 30 };
    }
  }

  // "jam dua belas" / "jam sembilan"
  const jam = /(?:jam|pukul)\s+([a-z\s]+?)(?:\s+(pagi|siang|sore|malam)|\s|$|,|\.)/.exec(lower);
  if (jam) {
    const n = wordNumber(jam[1].trim());
    if (n !== null) {
      const period = jam[2];
      let hour = n;
      if (period === 'pagi' && hour === 12) hour = 0;
      if (period === 'siang' && hour < 12) hour = n === 12 ? 12 : n;
      if (period === 'sore' && hour < 12) hour = n + 12;
      if (period === 'malam' && hour < 12) hour = n + 12;
      return { hour: hour % 24, minute: 0 };
    }
  }

  // bare "11" after jam
  const bare = /(?:jam|pukul)\s+(\d{1,2})(?!\d)/.exec(lower);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour <= 23) return { hour, minute: 0 };
  }

  return null;
}

export interface ParsedDate {
  /** ISO date in the reference timezone, or null when not resolvable. */
  iso: string | null;
  /** True when the phrase is understood but deliberately not resolved. */
  ambiguous: boolean;
  reason?: string;
  options?: Array<{ id: string; label: string; value: { iso: string } }>;
}

/**
 * Resolve an Indonesian date phrase against a fixed reference instant.
 *
 * "Jumat depan" resolves deterministically. "minggu depan" is intentionally
 * left ambiguous: NAVI must not guess a deadline (TC07).
 */
export function parseIndonesianDate(
  text: string,
  reference: Date,
  referenceTz: string,
): ParsedDate {
  const lower = text.toLowerCase();
  const refParts = getZonedParts(reference, referenceTz);

  // Explicit: "selasa 10 november 2026"
  const explicit = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(INDONESIAN_MONTHS).join('|')})\\s+(\\d{4})`,
    'i',
  ).exec(lower);
  if (explicit) {
    const day = Number(explicit[1]);
    const month = INDONESIAN_MONTHS[explicit[2].toLowerCase()];
    const year = Number(explicit[3]);
    if (month && day >= 1 && day <= 31) {
      return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, ambiguous: false };
    }
  }

  // Explicit ISO date
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (isoMatch) {
    return { iso: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, ambiguous: false };
  }

  // Day + month without year: "13 november"
  const dayMonth = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(INDONESIAN_MONTHS).join('|')})`,
    'i',
  ).exec(lower);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = INDONESIAN_MONTHS[dayMonth[2].toLowerCase()];
    const year = refParts.year;
    if (month && day >= 1 && day <= 31) {
      return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, ambiguous: false };
    }
  }

  // "minggu depan" -> deliberately ambiguous deadline range.
  // Checked BEFORE the weekday branch because "Minggu" is both "Sunday" and
  // "week" in Indonesian; for a deadline NAVI must ask rather than guess.
  if (/minggu\s+depan/.test(lower)) {
    const startBase = Date.UTC(refParts.year, refParts.month - 1, refParts.day);
    const mondayOffset = (8 - refParts.weekday) % 7 || 7;
    const start = new Date(startBase + mondayOffset * 86400000);
    const end = new Date(startBase + (mondayOffset + 4) * 86400000);
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`;
    return {
      iso: null,
      ambiguous: true,
      reason: '"minggu depan" mencakup rentang tanggal dan tidak menentukan satu tenggat.',
      options: [
        {
          id: 'end-of-next-week',
          label: `Akhir minggu depan (${fmt(end)}, 17:00 WIB)`,
          value: { iso: fmt(end) },
        },
        {
          id: 'start-of-next-week',
          label: `Awal minggu depan (${fmt(start)}, 17:00 WIB)`,
          value: { iso: fmt(start) },
        },
      ],
    };
  }

  // Weekday + "depan": "jumat depan"
  const weekdayNames = INDONESIAN_DAYS.map((d) => d.toLowerCase());
  const weekdayMatch = new RegExp(`(${weekdayNames.join('|')})(\\s+depan)?`, 'i').exec(lower);
  if (weekdayMatch) {
    const targetName = weekdayMatch[1].toLowerCase();
    const targetIdx = INDONESIAN_DAYS.findIndex((d) => d.toLowerCase() === targetName);
    const isNext = Boolean(weekdayMatch[2]);
    let delta = (targetIdx - refParts.weekday + 7) % 7;
    if (delta === 0 && isNext) delta = 7;
    if (delta === 0) delta = 7; // "hari ini" phrasing still means an upcoming occurrence
    const base = Date.UTC(refParts.year, refParts.month - 1, refParts.day);
    const d = new Date(base + delta * 86400000);
    return {
      iso: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`,
      ambiguous: false,
    };
  }

  return { iso: null, ambiguous: false };
}

export interface ParsedZone {
  timezone: string;
  label: string;
}

/** Detect an explicit timezone label in the text (WIB/WITA/WIT). */
export function parseTimezoneLabel(text: string): ParsedZone | null {
  const lower = text.toLowerCase();
  if (/\bwita\b/.test(lower)) return { timezone: 'Asia/Makassar', label: 'WITA' };
  if (/\bwib\b/.test(lower)) return { timezone: 'Asia/Jakarta', label: 'WIB' };
  if (/\bwit\b/.test(lower)) return { timezone: 'Asia/Jayapura', label: 'WIT' };
  return null;
}

export interface Clause {
  start: number;
  end: number;
  /** End offset including the sentence terminator, so trailing punctuation is preserved. */
  rawEnd: number;
  text: string;
}

/**
 * Split a text into sentence-ish clauses while keeping offsets.
 *
 * A period between two digits is a decimal separator ("jam 13.30"), not a
 * sentence end, so it must not break the clause.
 */
export function splitClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') {
      const raw = text.slice(start, i);
      if (raw.trim().length > 0) clauses.push({ start, end: i, rawEnd: i, text: raw });
      start = i + 1;
      continue;
    }
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== ';') continue;
    // Decimal separator: keep scanning.
    if (ch === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    // Consume a run of terminators ("?!", "...").
    let rawEnd = i + 1;
    while (rawEnd < text.length && '.!?;'.includes(text[rawEnd])) rawEnd += 1;
    const raw = text.slice(start, i);
    if (raw.trim().length > 0) clauses.push({ start, end: i, rawEnd, text: raw });
    start = rawEnd;
  }
  if (start < text.length) {
    const raw = text.slice(start);
    if (raw.trim().length > 0) {
      clauses.push({ start, end: text.length, rawEnd: text.length, text: raw });
    }
  }
  return clauses;
}

/** Convert a local wall clock + date + zone into an absolute instant. */
export function wallClockToUtc(
  isoDate: string,
  hour: number,
  minute: number,
  timezone: string,
): { utc: Date; wall: WallClock } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wall: WallClock = { year: y, month: m, day: d, hour, minute };
  const utc = convertWallClock(wall, 'Asia/Jakarta', timezone).utc;
  return { utc, wall };
}
