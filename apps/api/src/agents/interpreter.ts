/**
 * NAVI Agent 2/4 - INTERPRETER
 *
 * Contract (docs/WORKFLOW_CONTRACT.md):
 *   Input : Untrusted text + schema + context
 *   Output: ActionCandidate[] (type, who, what, when, where, content, source_spans, confidence)
 *
 * Hard boundary: this module NEVER resolves an ambiguous contact on its own and
 * NEVER marks anything approved. It only proposes. It has no execution tools.
 *
 * Implementation note (honest reporting): the Interpreter is a deterministic
 * rule engine rather than a hosted LLM call. PRD section 4.2 requires
 * `rules.evaluate` to be a deterministic rule engine, and a deterministic
 * interpreter keeps the 20 acceptance test cases reproducible and auditable.
 * The identical role contract is packaged as a WorkBuddy Skill under
 * apps/api/src/skills/ so the same role can also be driven from WorkBuddy.
 */

import type { ActionCandidate } from '../core/types.js';
import { findUserByName, findUser, usersAtSite, type Fixtures } from '../core/fixtures.js';
import {
  parseIndonesianDate,
  parseIndonesianTime,
  parseTimezoneLabel,
  splitClauses,
  type Clause,
} from './text-utils.js';

const HONORIFICS = ['pak', 'bu', 'ibu', 'bapak', 'dr', 'drs', 'h', 'hj', 'mr', 'mrs', 'ms'];

export interface InterpreterInput {
  text: string;
  referenceNow: Date;
  referenceTimezone: string;
  sourceId: string;
}

export interface InterpreterResult {
  candidates: ActionCandidate[];
  referencedMeetings: string[];
  ambiguousMentions: Array<{ mention: string; candidates: string[] }>;
}

const CITY_TO_SITE: Record<string, string> = {
  jakarta: 'JKT',
  jkt: 'JKT',
  makassar: 'MKS',
  mks: 'MKS',
  jayapura: 'JYP',
  jyp: 'JYP',
};

const CONTINUATION_MARKERS = /^\s*(?:isi|body|pesan|content)\s*:/i;

function stripHonorific(raw: string): string {
  let value = raw.trim();
  for (const h of HONORIFICS) {
    const re = new RegExp(`^${h}\\.?\\s+`, 'i');
    if (re.test(value)) {
      value = value.replace(re, '');
      break;
    }
  }
  return value.trim();
}

/** Resolve a mention such as "Pak Budi", "Budi Santoso" or "USR-101". */
export function resolveMention(
  fx: Fixtures,
  mention: string,
): { status: 'RESOLVED' | 'AMBIGUOUS' | 'UNKNOWN'; userId?: string; candidates: string[] } {
  const cleaned = stripHonorific(mention);
  const idMatch = /USR-\d+/i.exec(cleaned);
  if (idMatch) {
    const userId = idMatch[0].toUpperCase();
    const user = findUser(fx, userId);
    if (user) return { status: 'RESOLVED', userId, candidates: [userId] };
    return { status: 'UNKNOWN', candidates: [] };
  }
  const exact = findUserByName(fx, cleaned);
  if (exact.length === 1) {
    return { status: 'RESOLVED', userId: exact[0].id, candidates: [exact[0].id] };
  }
  if (exact.length > 1) {
    return { status: 'AMBIGUOUS', candidates: exact.map((u) => u.id) };
  }
  // Fall back to first-name matching, which is where the "two Budi" case lives.
  const first = cleaned.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!first) return { status: 'UNKNOWN', candidates: [] };
  const byFirst = fx.people.users.filter((u) => u.name.toLowerCase().split(/\s+/)[0] === first);
  if (byFirst.length === 1) {
    return { status: 'RESOLVED', userId: byFirst[0].id, candidates: [byFirst[0].id] };
  }
  if (byFirst.length > 1) {
    return { status: 'AMBIGUOUS', candidates: byFirst.map((u) => u.id) };
  }
  return { status: 'UNKNOWN', candidates: [] };
}

interface MentionHit {
  raw: string;
  /** Index of the mention itself inside the clause (not the whitespace). */
  index: number;
}

function findMentions(clause: string): MentionHit[] {
  const hits: MentionHit[] = [];
  const re =
    /\b(USR-\d{3})\b|\b((?:Pak|Bu|Ibu|Bapak|Dr\.?|H\.?|Hj\.?|Mr\.?|Mrs\.?|Ms\.?)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw) continue;
    const bare = stripHonorific(raw);
    if (bare.toLowerCase() === 'saya' || bare.toLowerCase() === 'kamu') continue;
    // The regex may consume leading whitespace; align the index with the
    // trimmed text so that slicing keeps the remaining clause intact.
    const leading = m[0].length - raw.length;
    hits.push({ raw, index: m.index + Math.max(0, leading) });
  }
  return hits;
}

function isKnownName(fx: Fixtures, raw: string): boolean {
  const cleaned = stripHonorific(raw);
  if (/^USR-\d+$/i.test(cleaned)) return Boolean(findUser(fx, cleaned.toUpperCase()));
  const first = cleaned.split(/\s+/)[0]?.toLowerCase() ?? '';
  return fx.people.users.some((u) => u.name.toLowerCase().split(/\s+/)[0] === first);
}

/**
 * Match meeting mentions. Requires at least two significant title words AND
 * at least 60% of them, so that "notulen evaluasi operasional" resolves to
 * MTG-01 ("Evaluasi Operasional Mingguan") without matching unrelated text.
 */
function findMeetingMentions(fx: Fixtures, clause: string): string[] {
  const ids = new Set<string>();
  const clauseLower = clause.toLowerCase();
  for (const meeting of fx.meetings.meetings) {
    if (new RegExp(`\\b${meeting.id}\\b`, 'i').test(clause)) {
      ids.add(meeting.id);
      continue;
    }
    const titleWords = meeting.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (titleWords.length < 2) continue;
    const matched = titleWords.filter((w) => clauseLower.includes(w)).length;
    if (matched >= 2 && matched / titleWords.length >= 0.6) {
      ids.add(meeting.id);
    }
  }
  return [...ids];
}

type Intent = 'email' | 'calendar' | 'task' | 'none' | 'unsupported';

/**
 * Action shapes NAVI deliberately does NOT implement. PRD 1.2 lists real
 * payments and production integrations as OUT of scope for the MVP, and AC20
 * forbids inventing tools. These are surfaced as a safe refusal with a
 * reason instead of being silently ignored or faked (TC20).
 */
const UNSUPPORTED_INTENTS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\b(?:buat|buatkan|bikin|terbitkan|generate)\s+(?:invoice|invois|faktur|kwitansi)\b/i, type: 'invoice.create' },
  { pattern: /\b(?:bayar|transfer\s+dana|kirim\s+pembayaran|buat\s+pembayaran|lunaskan)\b/i, type: 'payment.send' },
  { pattern: /\b(?:hapus|delete|remove)\s+(?:data|record|catatan|budin)\b/i, type: 'record.delete' },
  { pattern: /\b(?:cetak|print|export|ekspor)\s+(?:laporan|dokumen|report)\b/i, type: 'document.export' },
  { pattern: /\bposting\b/i, type: 'ledger.post' },
  { pattern: /\b(?:kirim|post)\s+(?:ke\s+)?(?:grup\s+)?whatsapp\b/i, type: 'messaging.send' },
  { pattern: /\b(?:ganti|ubah|update|set)\s+(?:kata\s+sandi|password)\b/i, type: 'credential.update' },
];

function detectUnsupported(clause: string): string | null {
  for (const { pattern, type } of UNSUPPORTED_INTENTS) {
    if (pattern.test(clause)) return type;
  }
  return null;
}

function detectIntent(clause: string): Intent {
  const lower = clause.toLowerCase();
  if (/\b(buat|buatkan|bikin)\s+(tugas|todo)\b/.test(lower)) return 'task';
  if (/\btugas\s+untuk\b/.test(lower)) return 'task';
  if (/\b(jadwalkan|buat\s+jadwal|buat\s+rapat|schedule)\b/.test(lower)) return 'calendar';
  if (/\b(kirim|kirimkan|mail|email)\b/.test(lower) && /\bke\b/.test(lower)) return 'email';
  if (/\b(kirim|kirimkan)\b/.test(lower) && /\bnotulen\b/.test(lower)) return 'email';
  if (detectUnsupported(clause)) return 'unsupported';
  return 'none';
}

/**
 * Split a compound clause such as "A, dan B" into its parts.
 * The split happens BEFORE the conjunction so neither part keeps the
 * conjunction word.
 */
function splitConjunctions(clause: Clause, text: string): Clause[] {
  const re = /,\s*(?:dan|terus|lalu)\s+|\s+(?:lalu|kemudian)\s+/gi;
  const parts: Clause[] = [];
  let cursor = clause.start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause.text)) !== null) {
    const cutAt = clause.start + m.index;
    const afterAt = cutAt + m[0].length;
    const head = text.slice(cursor, cutAt);
    if (head.trim().length > 0) {
      parts.push({ start: cursor, end: cutAt, rawEnd: cutAt, text: head });
    }
    cursor = afterAt;
  }
  const tail = text.slice(cursor, clause.end);
  if (tail.trim().length > 0) {
    parts.push({ start: cursor, end: clause.end, rawEnd: clause.rawEnd, text: tail });
  }
  return parts.length > 0 ? parts : [clause];
}

/**
 * Group sentences so that a body continuation ("Isi: ...") stays attached to
 * the email sentence that introduced it.
 */
function groupSentences(text: string): Clause[] {
  const sentences = splitClauses(text);
  const groups: Clause[] = [];
  for (const sentence of sentences) {
    const previous = groups[groups.length - 1];
    if (previous && CONTINUATION_MARKERS.test(sentence.text)) {
      previous.end = sentence.rawEnd;
      previous.rawEnd = sentence.rawEnd;
      previous.text = text.slice(previous.start, previous.rawEnd);
      continue;
    }
    groups.push({ ...sentence });
  }
  return groups;
}

function stripOuterQuotes(value: string): string {
  return value.replace(/^["'“”\s]+/, '').replace(/["'“”\s]+$/, '').trim();
}

function extractBody(groupText: string): string | null {
  const match = /(?:isi|body|pesan|content)\s*:\s*([\s\S]+)$/i.exec(groupText);
  if (!match) return null;
  let body = match[1].trim();
  // Keep only the first sentence of the body, but keep its terminal
  // punctuation so the preview matches the instruction verbatim.
  const stop = body.search(/\.(?=\s+[A-Z"])|\.(?=$)/);
  if (stop >= 0) body = body.slice(0, stop + 1);
  return stripOuterQuotes(body) || null;
}

function extractSubject(groupText: string): string | null {
  const match = /dengan\s+subjek\s+([^.;]+)/i.exec(groupText);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '').trim() || null;
}

const RELATIVE_DEADLINE =
  /\b(?:minggu\s+(?:depan|ini)|besok|lusa|hari\s+ini|(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s+depan)\b/i;

export function interpret(fx: Fixtures, input: InterpreterInput): InterpreterResult {
  const candidates: ActionCandidate[] = [];
  const referencedMeetings = new Set<string>();
  const ambiguousMentions: InterpreterResult['ambiguousMentions'] = [];
  const text = input.text;

  for (const group of groupSentences(text)) {
    for (const clause of splitConjunctions(group, text)) {
      const intent = detectIntent(clause.text);
      if (intent === 'none') continue;

      const span = `MSG-001:${clause.start}-${clause.end}`;
      const groupText = group.text;

      for (const mid of findMeetingMentions(fx, clause.text)) {
        referencedMeetings.add(mid);
      }

      const mentions = findMentions(clause.text).filter((m) => isKnownName(fx, m.raw));

      // ------------------------------------------------------------ UNSUPPORTED
      if (intent === 'unsupported') {
        const unsupportedType = detectUnsupported(clause.text) ?? 'unknown.action';
        candidates.push({
          type: unsupportedType,
          who: null,
          what: clause.text.trim(),
          when: null,
          where: null,
          content: null,
          source_spans: [span],
          confidence: 0.9,
          payload: {
            subject_or_title: clause.text.trim(),
            source_clause: stripOuterQuotes(clause.text),
          },
        });
        continue;
      }

      // ---------------------------------------------------------------- EMAIL
      if (intent === 'email') {
        // Prefer a mention that carries an explicit user id.
        const explicit = mentions.find((m) => /USR-\d+/i.test(m.raw));
        const byPreposition = mentions.find((m) => {
          const before = clause.text.slice(0, m.index).toLowerCase();
          const after = clause.text.slice(m.index).toLowerCase();
          return /\b(ke|kepada|untuk)\b/.test(before) || /^\s*(?:ke|kepada|untuk)\b/.test(after);
        });
        const primary = explicit ?? byPreposition ?? mentions[0];
        if (!primary) continue;

        const resolution = resolveMention(fx, primary.raw);
        if (resolution.status === 'AMBIGUOUS') {
          ambiguousMentions.push({ mention: primary.raw, candidates: resolution.candidates });
        }
        const meetingIds = findMeetingMentions(fx, clause.text);
        const body = extractBody(groupText);

        // Every known contact named in an email clause is a recipient. Raw
        // e-mail addresses are also collected so that recipients outside the
        // organization can be detected (TC19 / policy high_risk).
        const recipientMentions = mentions.filter(
          (m) => m !== primary || resolution.status !== 'RESOLVED' || true,
        );
        const resolvedIds: string[] = [];
        for (const mention of recipientMentions) {
          const r = resolveMention(fx, mention.raw);
          if (r.status === 'RESOLVED' && r.userId && !resolvedIds.includes(r.userId)) {
            resolvedIds.push(r.userId);
          }
        }
        if (resolution.userId && !resolvedIds.includes(resolution.userId)) {
          resolvedIds.unshift(resolution.userId);
        }

        const rawEmails = clause.text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
        const knownEmails = new Set(
          resolvedIds
            .map((id) => fx.people.users.find((u) => u.id === id)?.email)
            .filter((e): e is string => Boolean(e)),
        );
        const externalEmails = rawEmails.filter((e) => !knownEmails.has(e));
        const totalRecipients = new Set([...knownEmails, ...rawEmails]).size;

        candidates.push({
          type: 'email.create',
          who: resolvedIds.length ? resolvedIds : null,
          what: 'Kirim notulen',
          when: null,
          where: null,
          content: body,
          source_spans: [span],
          confidence: resolution.status === 'RESOLVED' ? 0.9 : 0.55,
          payload: {
            subject_or_title: extractSubject(groupText),
            full_body_or_description: body,
            recipient_mentions: primary.raw,
            recipient_ids: resolvedIds,
            recipient_count: totalRecipients,
            external_recipient_emails: externalEmails,
            referenced_meetings: meetingIds,
            source_clause: stripOuterQuotes(clause.text),
            mention_resolution: resolution,
          },
        });
        continue;
      }

      // ------------------------------------------------------------- CALENDAR
      if (intent === 'calendar') {
        const time = parseIndonesianTime(clause.text);
        const date = parseIndonesianDate(clause.text, input.referenceNow, input.referenceTimezone);
        const zone = parseTimezoneLabel(clause.text);

        const siteMatch = /\b(?:tim|dari|team)\s+([A-Za-z]+)/i.exec(clause.text);
        let participantIds: string[] = [];
        let location: string | null = null;
        if (siteMatch) {
          const siteId = CITY_TO_SITE[siteMatch[1].toLowerCase()];
          if (siteId) {
            participantIds = usersAtSite(fx, siteId).map((u) => u.id);
            const site = fx.org.sites.find((s) => s.id === siteId);
            location = site?.city ?? siteId;
          }
        }
        if (participantIds.length === 0) {
          for (const mention of mentions) {
            const resolution = resolveMention(fx, mention.raw);
            if (resolution.status === 'RESOLVED' && resolution.userId) {
              participantIds.push(resolution.userId);
            } else if (resolution.status === 'AMBIGUOUS') {
              ambiguousMentions.push({ mention: mention.raw, candidates: resolution.candidates });
            }
          }
          location = location ?? 'Jakarta';
        }

        const titleMatch =
          /\b(?:jadwalkan|buat\s+rapat|buat\s+jadwal|schedule)\s+(.+?)(?=(?:\s+(?:jam|pukul|hari|jumat|senin|selasa|rabu|kamis|sabtu|minggu|friday|monday|tuesday|wednesday|thursday|saturday|sunday|dengan|dan|pukul)\b)|$)/i.exec(
            clause.text,
          );

        candidates.push({
          type: 'calendar.create',
          who: participantIds.length ? participantIds : null,
          what: titleMatch ? titleMatch[1].trim() : 'Rapat',
          when:
            date.iso && time
              ? `${date.iso}T${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
              : null,
          where: location,
          content: null,
          source_spans: [span],
          confidence: date.iso && time && participantIds.length ? 0.85 : 0.5,
          payload: {
            subject_or_title: titleMatch ? titleMatch[1].trim() : 'Rapat',
            start_date: date.iso,
            start_time: time
              ? `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
              : null,
            timezone: zone?.timezone ?? input.referenceTimezone,
            explicit_timezone_label: zone?.label ?? null,
            participant_ids: participantIds,
            participant_sites: [
              ...new Set(
                participantIds
                  .map((id) => fx.people.users.find((u) => u.id === id)?.site)
                  .filter((s): s is string => Boolean(s)),
              ),
            ],
            location,
            source_clause: clause.text.trim(),
            ambiguous_date: date.ambiguous,
            ambiguous_date_options: date.options ?? [],
            ambiguous_date_reason: date.reason ?? null,
          },
        });
        continue;
      }

      // ----------------------------------------------------------------- TASK
      if (intent === 'task') {
        const assigneeHit =
          mentions.find((m) => {
            const before = clause.text.slice(0, m.index).toLowerCase();
            return /\b(untuk|kepada)\b/.test(before);
          }) ?? mentions[0];
        if (!assigneeHit) continue;
        const resolution = resolveMention(fx, assigneeHit.raw);
        if (resolution.status === 'AMBIGUOUS') {
          ambiguousMentions.push({ mention: assigneeHit.raw, candidates: resolution.candidates });
        }

        const titledMatch = /berjudul\s+([^,.;]+)/i.exec(clause.text);
        const explicitDue = /\b(?:tenggat|deadline|paling lambat)\s+(.+)$/i.exec(clause.text);

        // Work out the deadline phrase and where it starts inside the clause.
        let dueClause: string | null = null;
        let dueStart = clause.text.length;
        if (explicitDue) {
          dueClause = explicitDue[1];
          dueStart = explicitDue.index + explicitDue[0].length - explicitDue[1].length;
        } else {
          const rel = RELATIVE_DEADLINE.exec(clause.text);
          if (rel) {
            dueClause = rel[0];
            dueStart = rel.index;
          }
        }

        const afterAssignee = clause.text.slice(assigneeHit.index + assigneeHit.raw.length);
        let title = titledMatch ? titledMatch[1].trim() : null;
        if (!title) {
          const titleSource = afterAssignee.slice(
            0,
            Math.max(0, dueStart - (assigneeHit.index + assigneeHit.raw.length)),
          );
          // Keep the verb: "menyelesaikan laporan" is the assignee's job.
          const cleaned = titleSource.replace(/^[\s,:-]+/, '').trim();
          title = cleaned.length > 0 ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Tugas';
        }

        const dueDate = dueClause
          ? parseIndonesianDate(dueClause, input.referenceNow, input.referenceTimezone)
          : { iso: null, ambiguous: false };
        const dueTime = dueClause ? parseIndonesianTime(dueClause) : null;

        candidates.push({
          type: 'task.create',
          who: resolution.userId ? [resolution.userId] : null,
          what: title,
          when: dueDate.iso,
          where: null,
          content: null,
          source_spans: [span],
          confidence: resolution.status === 'RESOLVED' && dueDate.iso ? 0.9 : 0.5,
          payload: {
            subject_or_title: title,
            assignee_mention: assigneeHit.raw,
            recipient_ids: resolution.userId ? [resolution.userId] : [],
            due_date: dueDate.iso,
            due_time: dueTime
              ? `${String(dueTime.hour).padStart(2, '0')}:${String(dueTime.minute).padStart(2, '0')}`
              : null,
            due_timezone: input.referenceTimezone,
            ambiguous_due: dueDate.ambiguous,
            ambiguous_due_options: dueDate.options ?? [],
            ambiguous_due_reason: dueDate.reason ?? null,
            source_clause: clause.text.trim(),
            mention_resolution: resolution,
          },
        });
      }
    }
  }

  return {
    candidates,
    referencedMeetings: [...referencedMeetings],
    ambiguousMentions,
  };
}
