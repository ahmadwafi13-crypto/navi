/**
 * NAVI Agent 3/4 - CONFLICT DETECTOR
 *
 * Contract (docs/WORKFLOW_CONTRACT.md):
 *   Input : ActionCandidates + authorized contacts + provenance
 *   Output: Conflict[] (type, severity, affected_action, question, options)
 *
 * The detector never picks a person and never silently fixes a schedule.
 * Every finding carries evidence and, when a decision is needed, a targeted
 * question (PRD FR-04: "Klarifikasi minimal").
 */

import type { ActionCandidate, Conflict } from '../core/types.js';
import type { Fixtures } from '../core/fixtures.js';
import { findUser } from '../core/fixtures.js';

export type ConflictType =
  | 'AMBIGUOUS_CONTACT'
  | 'DOCUMENT_NOT_FINAL'
  | 'INSTRUCTION_CONTRADICTION'
  | 'UNCERTAIN_TIME'
  | 'UNVERIFIED_AUTHORITY'
  | 'UNSUPPORTED_ACTION'
  | 'PROMPT_INJECTION'
  | 'APPROVAL_IN_DOCUMENT'
  | 'HIGH_RISK_RECIPIENT'
  | 'IDENTITY_CLAIM_IN_TEXT';

export interface ConflictInput {
  candidates: ActionCandidate[];
  fx: Fixtures;
  sourceText: string;
  attachments: Array<{ name: string; content: string }>;
  /** Identities injected in plain text, e.g. "saya direktur". */
  claimedIdentities: string[];
  /** Untrusted text that contains approval-like language. */
  documentApprovals: string[];
}

const APPROVAL_PHRASES = [
  /\bsaya\s+setuju\b/i,
  /\bsaya\s+menyetujui\b/i,
  /\bdisetujui\s+oleh\b/i,
  /\bsudah\s+disetujui\b/i,
  /\bapprove(d)?\b/i,
  /\bpersetujuan\s+ini\s+sah\b/i,
];

const INJECTION_PHRASES = [
  /abaikan\s+(?:kebijakan|approval|persetujuan|aturan)/i,
  /jangan\s+tampilkan\s+preview/i,
  /langsung\s+kirim\s+semua/i,
  /tulis\s+audit\s+bahwa\s+sudah\s+disetujui/i,
  /ignore\s+(?:policy|approval|all)\s+instructions/i,
  /do\s+not\s+require\s+approval/i,
];

const AUTHORITY_PHRASES = [
  /\bsaya\s+(?:adalah\s+)?direktur\b/i,
  /\bsaya\s+(?:adalah\s+)?ceo\b/i,
  /\bsaya\s+(?:adalah\s+)?admin(?:istrator)?\b/i,
  /\bsebagai\s+(?:direktur|ceo|admin)\b/i,
  /\bauthorized\s+as\s+admin\b/i,
];

export function detectConflicts(input: ConflictInput): Conflict[] {
  const { candidates, fx, sourceText, attachments } = input;
  const conflicts: Conflict[] = [];
  let seq = 0;
  const mk = (
    type: ConflictType,
    severity: 'BLOCKING' | 'WARNING',
    actionIds: string[],
    evidence: string,
    question: string | null,
    options: Conflict['options'],
    requiresClarification: boolean,
  ): void => {
    seq += 1;
    conflicts.push({
      conflict_id: `CFL-${String(seq).padStart(3, '0')}`,
      type,
      severity,
      action_ids: actionIds,
      evidence,
      question,
      options,
      requires_clarification: requiresClarification,
      status: 'OPEN',
      resolution: null,
    });
  };

  // ---- 1. Ambiguous contacts (two Budi) ---------------------------------
  for (const candidate of candidates) {
    const resolution = candidate.payload.mention_resolution as
      | { status: string; candidates: string[] }
      | undefined;
    if (resolution?.status === 'AMBIGUOUS') {
      const names = resolution.candidates
        .map((id) => findUser(fx, id))
        .filter(Boolean)
        .map((u) => `${u!.name} (${u!.id})`);
      mk(
        'AMBIGUOUS_CONTACT',
        'BLOCKING',
        [],
        `Nama "${candidate.payload.recipient_mentions ?? candidate.payload.assignee_mention}" cocok dengan lebih dari satu kontak: ${names.join(', ')}.`,
        'Ada dua kontak bernama Budi. Pilih penerima yang dimaksud sebelum melanjutkan.',
        resolution.candidates.map((id) => {
          const u = findUser(fx, id);
          return {
            id,
            label: `${u?.name ?? id} (${id}) - ${u?.role ?? '-'} - ${u?.site ?? '-'}`,
            value: { user_id: id },
          };
        }),
        true,
      );
    }
  }

  // ---- 2. Document not final (DRAFT minutes) ----------------------------
  for (const meeting of fx.meetings.meetings) {
    if (meeting.minutes_status !== 'DRAFT_NOT_FINAL') continue;
    const mentioned = candidates.some((c) =>
      (c.payload.referenced_meetings as string[] | undefined)?.includes(meeting.id),
    );
    const mentionedInText = new RegExp(
      `${meeting.id}|${meeting.title.split(/\s+/).slice(0, 2).join('\\s+')}`,
      'i',
    ).test(sourceText);
    if (!mentioned && !mentionedInText) continue;
    mk(
      'DOCUMENT_NOT_FINAL',
      'BLOCKING',
      [],
      `Dokumen ${meeting.document_id} milik ${meeting.id} berstatus ${meeting.minutes_status}. Notulen "${meeting.title}" belum final sehingga belum aman dikirim.`,
      `Notulen ${meeting.id} belum final. Apakah menunggu revisi final atau tetap dikirim dengan status saat ini?`,
      [
        {
          id: 'hold',
          label: 'Tahan sampai notulen final (pilihan aman)',
          value: { decision: 'hold' },
        },
        {
          id: 'send-anyway',
          label: 'Tetap kirim (hanya dengan persetujuan eksplisit)',
          value: { decision: 'send_anyway' },
        },
      ],
      true,
    );
  }

  // ---- 3. Contradicting instructions in the same message ----------------
  const hasSend = /\b(kirim|kirimkan)\b/i.test(sourceText);
  const hasNotFinal = /\b(belum\s+final|bukan\s+final|belum\s+disahkan|draft)\b/i.test(sourceText);
  if (hasSend && hasNotFinal) {
    mk(
      'INSTRUCTION_CONTRADICTION',
      'WARNING',
      [],
      'Pesan memuat sekaligus permintaan kirim dan pernyataan bahwa dokumen belum final.',
      'Apakah yang dimaksud adalah menahan pengiriman sampai dokumen final?',
      [
        { id: 'hold', label: 'Ya, tahan pengiriman', value: { decision: 'hold' } },
        { id: 'send', label: 'Tidak, kirim sekarang', value: { decision: 'send' } },
      ],
      true,
    );
  }

  // ---- 4. Uncertain / ambiguous time ------------------------------------
  for (const candidate of candidates) {
    if (candidate.type === 'calendar.create' && candidate.payload.ambiguous_date) {
      mk(
        'UNCERTAIN_TIME',
        'BLOCKING',
        [],
        String(candidate.payload.ambiguous_date_reason ?? 'Waktu tidak pasti.'),
        'Tanggal yang dimaksud belum pasti. Pilih rentang yang tepat:',
        (candidate.payload.ambiguous_date_options as Conflict['options']) ?? [],
        true,
      );
    }
    if (candidate.type === 'task.create' && candidate.payload.ambiguous_due) {
      mk(
        'UNCERTAIN_TIME',
        'BLOCKING',
        [],
        String(candidate.payload.ambiguous_due_reason ?? 'Tenggat tidak pasti.'),
        'Tenggat "minggu depan" mencakup beberapa hari. Pilih satu tanggal:',
        (candidate.payload.ambiguous_due_options as Conflict['options']) ?? [],
        true,
      );
    }
    if (candidate.type === 'calendar.create' && !candidate.payload.start_date) {
      mk(
        'UNCERTAIN_TIME',
        'BLOCKING',
        [],
        'Tanggal rapat tidak dapat ditentukan dari instruksi.',
        'Kapan rapat tersebut diadakan?',
        [],
        true,
      );
    }
  }

  // ---- 5. Authority claims in the message or in untrusted content --------
  // A person typing "saya direktur" in chat never gains RBAC. The claim is
  // surfaced as a conflict so a human confirms, and it never changes the
  // authenticated session's role (PRD 3.2 "User mengaku admin lewat chat").
  for (const claim of input.claimedIdentities) {
    mk(
      'IDENTITY_CLAIM_IN_TEXT',
      'BLOCKING',
      [],
      `Pesan mengklaim "${claim}". Identitas dan kewenangan hanya berasal dari sesi terautentikasi, bukan dari teks.`,
      'Permintaan ini tetap diproses dengan kewenangan akun Anda saat ini. Apakah itu benar?',
      [
        { id: 'proceed-with-session-role', label: 'Ya, lanjutkan dengan kewenangan sesi saya', value: { decision: 'proceed' } },
      ],
      true,
    );
  }

  // ---- 6. Unsupported action types (TC20) --------------------------------
  for (const candidate of candidates) {
    if (!['email.create', 'calendar.create', 'task.create'].includes(candidate.type)) {
      mk(
        'UNSUPPORTED_ACTION',
        'BLOCKING',
        [],
        `Tipe aksi "${candidate.type}" tidak didukung oleh NAVI.`,
        'Tipe aksi ini belum didukung. Pilih salah satu dari email, kalender, atau tugas.',
        [
          { id: 'email.create', label: 'Kirim email', value: { type: 'email.create' } },
          { id: 'calendar.create', label: 'Buat jadwal rapat', value: { type: 'calendar.create' } },
          { id: 'task.create', label: 'Buat tugas', value: { type: 'task.create' } },
        ],
        true,
      );
    }
  }

  // ---- 7. Prompt injection in untrusted attachments ---------------------
  for (const attachment of attachments) {
    for (const phrase of INJECTION_PHRASES) {
      if (phrase.test(attachment.content)) {
        mk(
          'PROMPT_INJECTION',
          'BLOCKING',
          [],
          `Lampiran "${attachment.name}" mengandung pola instruksi terhadap sistem: ${phrase.source}. Lampiran diperlakukan sebagai data dan tidak pernah menjadi instruksi tingkat sistem.`,
          null,
          [],
          false,
        );
        break;
      }
    }
    for (const phrase of APPROVAL_PHRASES) {
      if (phrase.test(attachment.content)) {
        mk(
          'APPROVAL_IN_DOCUMENT',
          'BLOCKING',
          [],
          `Lampiran "${attachment.name}" mengandung kalimat bernada persetujuan (${phrase.source}). Teks dokumen bukan persetujuan manusia yang sah.`,
          null,
          [],
          false,
        );
        break;
      }
    }
  }

  // ---- 8. Approval-like language anywhere in untrusted text -------------
  for (const docApproval of input.documentApprovals) {
    mk(
      'APPROVAL_IN_DOCUMENT',
      'BLOCKING',
      [],
      `Teks tak tepercaya mengandung pernyataan persetujuan: "${docApproval}". Persetujuan hanya sah dari aksi pengguna terautentikasi.`,
      null,
      [],
      false,
    );
  }

  // ---- 9. Authority phrases inside untrusted attachments ----------------
  for (const attachment of attachments) {
    for (const phrase of AUTHORITY_PHRASES) {
      const m = phrase.exec(attachment.content);
      if (m) {
        mk(
          'UNVERIFIED_AUTHORITY',
          'BLOCKING',
          [],
          `Lampiran "${attachment.name}" mengandung klaim kewenangan: "${m[0]}".`,
          null,
          [],
          false,
        );
        break;
      }
    }
  }

  // ---- 10. High risk recipients ------------------------------------------
  for (const candidate of candidates) {
    if (candidate.type !== 'email.create') continue;
    const recipients = (candidate.payload.recipient_ids as string[]) ?? [];
    const external = (candidate.payload.external_recipient_emails as string[]) ?? [];
    const total = (candidate.payload.recipient_count as number) ?? recipients.length;
    if (external.length > 0) {
      mk(
        'HIGH_RISK_RECIPIENT',
        'BLOCKING',
        [],
        `Email memiliki ${external.length} penerima di luar organisasi: ${external.join(', ')}.`,
        'Pengiriman ke penerima eksternal memerlukan persetujuan manajer tambahan.',
        [],
        true,
      );
    } else if (total > 5) {
      mk(
        'HIGH_RISK_RECIPIENT',
        'BLOCKING',
        [],
        `Email memiliki ${total} penerima (>=6).`,
        'Pengiriman massal memerlukan persetujuan manajer tambahan.',
        [],
        true,
      );
    }
  }

  return conflicts;
}

/** Detect identity claims and document-style approvals inside untrusted text. */
export function scanUntrustedText(text: string): {
  claimedIdentities: string[];
  documentApprovals: string[];
} {
  const claimedIdentities: string[] = [];
  for (const phrase of AUTHORITY_PHRASES) {
    const m = phrase.exec(text);
    if (m) claimedIdentities.push(m[0]);
  }
  const documentApprovals: string[] = [];
  for (const phrase of APPROVAL_PHRASES) {
    const m = phrase.exec(text);
    if (m) documentApprovals.push(m[0]);
  }
  return { claimedIdentities, documentApprovals };
}
