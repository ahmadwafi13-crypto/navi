/**
 * NAVI Agent 4/4 - VALIDATOR
 *
 * Contract (docs/WORKFLOW_CONTRACT.md):
 *   Input : ActionPlan + policy rules + original input
 *   Output: ValidationReport (pass/hold, reason codes, citations, risk)
 *
 * The Validator checks operational rules (WIB/WITA/WIT, business hours,
 * Friday prayer block, holidays), verifies that the plan still matches the
 * original instruction, and flags anything that is not verifiable instead of
 * guessing (AC06: unverified national holiday => mark UNVERIFIED, never guess).
 */

import type { ActionCandidate, ActionPayload, ValidationReport } from '../core/types.js';
import type { Fixtures } from '../core/fixtures.js';
import {
  convertWallClock,
  getZonedParts,
  isoDate,
  localMinutes,
  parseTimeLabel,
  DAY_NAME_EN,
  TZ_LABEL,
  type WallClock,
} from '../core/timezone.js';

export interface ValidatorInput {
  candidates: ActionCandidate[];
  fx: Fixtures;
  referenceNow: Date;
  sourceText: string;
}

function minutesOf(label: string): number {
  const parsed = parseTimeLabel(label);
  if (!parsed) return 0;
  return parsed.hour * 60 + parsed.minute;
}

export function validate(input: ValidatorInput): ValidationReport {
  const { candidates, fx, referenceNow } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const reasonCodes: string[] = [];
  const citations: string[] = [];

  const workStart = minutesOf(fx.org.work_hours_local.start);
  const workEnd = minutesOf(fx.org.work_hours_local.end);
  const prayerStart = minutesOf(fx.policies.friday_prayer_demo_block_local.start);
  const prayerEnd = minutesOf(fx.policies.friday_prayer_demo_block_local.end);

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

  for (const candidate of candidates) {
    const type = candidate.type;

    if (type === 'calendar.create') {
      const startDate = candidate.payload.start_date as string | null;
      const startTime = candidate.payload.start_time as string | null;
      const timezone = (candidate.payload.timezone as string) ?? fx.org.default_timezone;
      if (!startDate || !startTime) {
        errors.push(`Kalender "${candidate.what}": tanggal atau waktu belum lengkap.`);
        reasonCodes.push('MISSING_SCHEDULE');
        continue;
      }

      const time = parseTimeLabel(startTime);
      if (!time) {
        errors.push(`Kalender "${candidate.what}": format waktu tidak valid (${startTime}).`);
        reasonCodes.push('INVALID_TIME_FORMAT');
        continue;
      }

      const [y, m, d] = startDate.split('-').map(Number);
      const wall: WallClock = { year: y, month: m, day: d, hour: time.hour, minute: time.minute };
      const utc = convertWallClock(wall, 'Asia/Jakarta', timezone).utc;
      const local = getZonedParts(utc, timezone);

      // -- Business hours in the originating zone
      const startMin = local.hour * 60 + local.minute;
      const endMin = startMin + 60;
      if (startMin < workStart || endMin > workEnd) {
        errors.push(
          `Kalender "${candidate.what}": ${String(local.hour).padStart(2, '0')}:${String(
            local.minute,
          ).padStart(2, '0')} ${TZ_LABEL[timezone]} di luar jam kerja ${fx.org.work_hours_local.start}-${fx.org.work_hours_local.end}.`,
        );
        reasonCodes.push('OUTSIDE_BUSINESS_HOURS');
      }

      // -- Day of week + weekend check
      const dayName = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][local.weekday];
      const dayNameEn = DAY_NAME_EN[dayName];
      if (dayNameEn && !fx.org.workdays.includes(dayNameEn)) {
        errors.push(`Kalender "${candidate.what}": ${dayName} bukan hari kerja organisasi.`);
        reasonCodes.push('NON_WORKDAY');
      }

      // -- Friday prayer block (mock fixture), evaluated in each local zone
      const zones = new Set<string>([timezone]);
      const participantSites = (candidate.payload.participant_ids as string[] | undefined) ?? [];
      for (const pid of participantSites) {
        const user = fx.people.users.find((u) => u.id === pid);
        if (!user) continue;
        const site = fx.org.sites.find((s) => s.id === user.site);
        if (site) zones.add(site.tz);
      }
      if (local.weekday === 5) {
        for (const zone of zones) {
          const zoned = getZonedParts(utc, zone);
          const zMin = zoned.hour * 60 + zoned.minute;
          if (zMin < prayerEnd && zMin + 60 > prayerStart) {
            errors.push(
              `Kalender "${candidate.what}": ${String(zoned.hour).padStart(2, '0')}:${String(
                zoned.minute,
              ).padStart(2, '0')} ${TZ_LABEL[zone]} bertabrakan dengan blok salat Jumat simulasi ${fx.policies.friday_prayer_demo_block_local.start}-${fx.policies.friday_prayer_demo_block_local.end} (zona ${zone}).`,
            );
            reasonCodes.push('FRIDAY_PRAYER_BLOCK');
            citations.push('data/03_policies.json#friday_prayer_demo_block_local');
          }
        }
      }

      // -- Organization day off (mock fixture)
      const orgDayOff = fx.policies.holiday_calendar.organization_days_off.find(
        (h) => h.date === startDate,
      );
      if (orgDayOff) {
        errors.push(
          `Kalender "${candidate.what}": ${startDate} adalah "${orgDayOff.label}" (libur internal fiktif).`,
        );
        reasonCodes.push('ORG_HOLIDAY');
        citations.push('data/03_policies.json#holiday_calendar');
      }

      // -- National holiday status: MUST be marked, never guessed (AC06)
      if (fx.policies.holiday_calendar.national_holidays_for_range === null) {
        warnings.push(
          `Status hari libur nasional untuk ${startDate} belum terverifikasi (kalender nasional = MOCK_FIXTURE_ONLY). NAVI tidak menebak.`,
        );
        reasonCodes.push('NATIONAL_HOLIDAY_UNVERIFIED');
        citations.push('data/03_policies.json#holiday_calendar');
      }

      // -- Participant availability is not connected (mock calendar note)
      warnings.push(
        'Kalender ketersediaan peserta belum terhubung; NAVI tidak menyatakan peserta "tersedia".',
      );
      reasonCodes.push('AVAILABILITY_UNVERIFIED');
      citations.push('data/07_mock_calendar.md');

      // -- Cross-zone rendering for participants (AC05)
      const participantLocalTimes = [];
      for (const pid of participantSites) {
        const user = fx.people.users.find((u) => u.id === pid);
        if (!user) continue;
        const site = fx.org.sites.find((s) => s.id === user.site);
        if (!site) continue;
        const conv = convertWallClock(wall, 'Asia/Jakarta', site.tz);
        const endMinutes = conv.wall.minute + 60;
        participantLocalTimes.push({
          site_id: site.id,
          timezone: site.tz,
          label: TZ_LABEL[site.tz],
          start_local: `${String(conv.wall.hour).padStart(2, '0')}:${String(conv.wall.minute).padStart(2, '0')}`,
          end_local: `${String((conv.wall.hour + Math.floor(endMinutes / 60)) % 24).padStart(2, '0')}:${String(
            endMinutes % 60,
          ).padStart(2, '0')}`,
        });
      }
      candidate.payload.participant_local_times = participantLocalTimes;
      candidate.payload.start_at = utc.toISOString();
      candidate.payload.end_at = new Date(utc.getTime() + 3600000).toISOString();
    }

    if (type === 'task.create') {
      const dueDate = candidate.payload.due_date as string | null;
      const dueTime = candidate.payload.due_time as string | null;
      if (!dueDate) {
        errors.push(`Tugas "${candidate.what}": tenggat belum ditentukan.`);
        reasonCodes.push('MISSING_DEADLINE');
      } else {
        const [y, m, d] = dueDate.split('-').map(Number);
        const parsedTime = dueTime ? parseTimeLabel(dueTime) : null;
        const t = parsedTime ?? { hour: 17, minute: 0 };
        const wall: WallClock = { year: y, month: m, day: d, hour: t.hour, minute: t.minute };        const utc = convertWallClock(wall, 'Asia/Jakarta', fx.org.default_timezone).utc;
        const local = getZonedParts(utc, fx.org.default_timezone);
        const startMin = local.hour * 60 + local.minute;
        if (startMin < workStart || startMin > workEnd) {
          warnings.push(
            `Tugas "${candidate.what}": tenggat ${String(local.hour).padStart(2, '0')}:${String(
              local.minute,
            ).padStart(2, '0')} di luar jam kerja.`,
          );
          reasonCodes.push('DEADLINE_OUTSIDE_BUSINESS_HOURS');
        }
        candidate.payload.due_at = utc.toISOString();
        candidate.payload.due_timezone = fx.org.default_timezone;
      }
    }

    if (type === 'email.create') {
      const recipients = (candidate.payload.recipient_ids as string[]) ?? [];
      const external = (candidate.payload.external_recipient_emails as string[]) ?? [];
      const totalRecipients = (candidate.payload.recipient_count as number) ?? recipients.length;

      if (recipients.length === 0 && external.length === 0) {
        errors.push('Email: penerima belum dapat dipastikan.');
        reasonCodes.push('MISSING_RECIPIENT');
      }
      for (const rid of recipients) {
        const user = fx.people.users.find((u) => u.id === rid);
        if (!user) {
          errors.push(`Email: penerima ${rid} tidak dikenal.`);
          reasonCodes.push('UNKNOWN_RECIPIENT');
        } else if (!user.email.endsWith('.invalid')) {
          errors.push(`Email: domain penerima ${user.email} di luar domain simulasi.`);
          reasonCodes.push('EXTERNAL_RECIPIENT');
        }
      }
      // Recipients outside the organization are high risk even for a single one.
      if (external.length > 0) {
        errors.push(
          `Email: ${external.length} penerima di luar organisasi (${external.join(', ')}).`,
        );
        reasonCodes.push('EXTERNAL_RECIPIENT');
        riskLevel = 'HIGH';
      }
      if (totalRecipients > 5) {
        riskLevel = 'HIGH';
        reasonCodes.push('HIGH_RISK_BULK');
      }
    }

    // -- Verify the candidate still traces back to the original instruction
    const clause = candidate.payload.source_clause as string | undefined;
    if (clause) {
      const key = clause.split(/\s+/).slice(0, 6).join(' ').toLowerCase();
      if (key.length > 8 && !input.sourceText.toLowerCase().includes(key)) {
        errors.push(`Aksi "${candidate.what}" tidak dapat ditelusuri ke instruksi asli.`);
        reasonCodes.push('PROVENANCE_MISMATCH');
      }
    }
  }

  const pass = errors.length === 0;
  return {
    pass,
    errors,
    warnings,
    needs_approval: pass,
    risk_level: riskLevel,
    reason_codes: [...new Set(reasonCodes)],
    citations: [...new Set(citations)],
  };
}

/** Build the exact payload for an action, ready to be hashed and previewed. */
export function buildPayload(candidate: ActionCandidate): ActionPayload {
  const type = candidate.type as ActionPayload['action_type'];
  const recipientIds = (candidate.payload.recipient_ids as string[]) ?? [];
  const participantIds = (candidate.payload.participant_ids as string[]) ?? [];
  const ids = recipientIds.length ? recipientIds : participantIds;
  const actionType = candidate.type as ActionPayload['action_type'];
  // For email the body must come from the instruction (or be null). Falling back
  // to the raw clause would put the user's own words into the email body.
  const descriptionFallback =
    actionType === 'email.create' ? null : ((candidate.payload.source_clause as string) ?? null);
  return {
    action_type: actionType,
    recipient_ids: ids,
    recipient_emails: [],
    subject_or_title: (candidate.payload.subject_or_title as string) ?? null,
    full_body_or_description:
      (candidate.payload.full_body_or_description as string) ?? descriptionFallback,
    start_at: (candidate.payload.start_at as string) ?? null,
    end_at: (candidate.payload.end_at as string) ?? null,
    timezone: (candidate.payload.timezone as string) ?? null,
    attachments: [],
    location: (candidate.payload.location as string) ?? null,
    due_at: (candidate.payload.due_at as string) ?? null,
    due_timezone: (candidate.payload.due_timezone as string) ?? null,
    start_date: (candidate.payload.start_date as string) ?? null,
    start_time: (candidate.payload.start_time as string) ?? null,
    due_date: (candidate.payload.due_date as string) ?? null,
    due_time: (candidate.payload.due_time as string) ?? null,
    organizer_id: (candidate.payload.organizer_id as string) ?? null,
    participant_sites: (candidate.payload.participant_sites as string[]) ?? [],
    participant_local_times: (candidate.payload.participant_local_times as never[]) ?? [],
  };
}

/** Convenience helper used by the demo script. */
export function describeNow(referenceNow: Date, timezone: string): string {
  const p = getZonedParts(referenceNow, timezone);
  return `${isoDate(referenceNow, timezone)} ${String(p.hour).padStart(2, '0')}:${String(
    p.minute,
  ).padStart(2, '0')} ${TZ_LABEL[timezone]}`;
}

/**
 * Recompute derived schedule fields after a clarification changed the date.
 *
 * start_at / end_at / participant_local_times are DERIVED values. If they are
 * not recomputed, the preview would show a date that disagrees with the
 * timestamp that actually gets executed - which would break the "exact
 * preview" guarantee (AC08).
 */
export function recomputeSchedule(payload: ActionPayload, fx: Fixtures): ActionPayload {
  const timezone = payload.timezone ?? fx.org.default_timezone;
  const startDate = payload.start_date;
  const startTime = payload.start_time;

  if (startDate && startTime) {
    const time = parseTimeLabel(startTime);
    if (time) {
      const [y, m, d] = startDate.split('-').map(Number);
      const wall: WallClock = { year: y, month: m, day: d, hour: time.hour, minute: time.minute };
      const utc = convertWallClock(wall, 'Asia/Jakarta', timezone).utc;
      payload.start_at = utc.toISOString();
      payload.end_at = new Date(utc.getTime() + 3600000).toISOString();

      const participantLocalTimes: ActionPayload['participant_local_times'] = [];
      for (const pid of payload.recipient_ids) {
        const user = fx.people.users.find((u) => u.id === pid);
        if (!user) continue;
        const site = fx.org.sites.find((s) => s.id === user.site);
        if (!site) continue;
        const conv = convertWallClock(wall, 'Asia/Jakarta', site.tz);
        const endMinutes = conv.wall.minute + 60;
        participantLocalTimes.push({
          site_id: site.id,
          timezone: site.tz,
          label: TZ_LABEL[site.tz],
          start_local: `${String(conv.wall.hour).padStart(2, '0')}:${String(conv.wall.minute).padStart(2, '0')}`,
          end_local: `${String((conv.wall.hour + Math.floor(endMinutes / 60)) % 24).padStart(2, '0')}:${String(
            endMinutes % 60,
          ).padStart(2, '0')}`,
        });
      }
      payload.participant_local_times = participantLocalTimes;
    }
  }

  const dueDate = payload.due_date;
  const dueTime = payload.due_time ?? '17:00';
  if (dueDate) {
    const t = parseTimeLabel(dueTime);
    if (t) {
      const [y, m, d] = dueDate.split('-').map(Number);
      const wall: WallClock = { year: y, month: m, day: d, hour: t.hour, minute: t.minute };
      const utc = convertWallClock(wall, 'Asia/Jakarta', fx.org.default_timezone).utc;
      payload.due_at = utc.toISOString();
      payload.due_timezone = fx.org.default_timezone;
    }
  }

  return payload;
}

export { localMinutes };
