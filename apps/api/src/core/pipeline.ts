/**
 * NAVI pipeline: Orchestrator -> Interpreter -> Conflict Detector -> Validator.
 *
 * The pipeline produces a run with actions, conflicts and validation reports.
 * It NEVER executes anything and NEVER approves anything. Execution only
 * happens through POST /internal/execute after a human approval exists.
 */

import type { Db } from '../db/index.js';
import { appendAuditEvent, nowIso } from '../db/index.js';
import { computePayloadHash } from '../core/hash.js';
import { newActionId, newConflictId, newRunId } from '../core/ids.js';
import { findUser, type Fixtures } from '../core/fixtures.js';
import type {
  ActionCandidate,
  ActionPayload,
  ActionState,
  Conflict,
  StoredAction,
  ValidationReport,
} from '../core/types.js';
import { SUPPORTED_ACTION_TYPES } from '../core/types.js';
import { interpret } from '../agents/interpreter.js';
import { detectConflicts, scanUntrustedText } from '../agents/conflict-detector.js';
import { buildPayload, validate } from '../agents/validator.js';
import { decideNextStep, type RunStep } from '../agents/orchestrator.js';

export interface RunRequest {
  db: Db;
  fx: Fixtures;
  userId: string;
  sessionId: string;
  text: string;
  attachments?: Array<{ name: string; content: string }>;
  /** Fixed reference instant so results are deterministic. */
  referenceNow: Date;
}

export interface RunResult {
  run_id: string;
  step: RunStep;
  actions: StoredAction[];
  conflicts: Conflict[];
  validation: ValidationReport;
  orchestrator_notes: string[];
}

function recipientEmails(fx: Fixtures, ids: string[]): string[] {
  return ids
    .map((id) => findUser(fx, id)?.email)
    .filter((e): e is string => Boolean(e));
}

export function runPipeline(req: RunRequest): RunResult {
  const { db, fx } = req;
  const runId = newRunId();
  const createdAt = nowIso();
  const attachments = req.attachments ?? [];

  db.prepare(
    `INSERT INTO runs
      (run_id, tenant_id, user_id, session_id, locale, timezone, reference_now,
       source_text, source_hash, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    runId,
    fx.org.org_id,
    req.userId,
    req.sessionId,
    'id-ID',
    fx.org.default_timezone,
    req.referenceNow.toISOString(),
    req.text,
    computePayloadHash({
      tenant_id: fx.org.org_id,
      action_id: 'run',
      version: 1,
      payload: req.text,
    }),
    'OPEN',
    createdAt,
  );

  appendAuditEvent(db, {
    tenant_id: fx.org.org_id,
    run_id: runId,
    actor: req.userId,
    event_type: 'INPUT_RECEIVED',
    metadata: {
      source_count: 1 + attachments.length,
      attachment_names: attachments.map((a) => a.name),
      text_length: req.text.length,
      trust: 'user_input_trusted_channel; attachments_untrusted',
    },
    event_id: `EVT-IN-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000,
    )}`,
  });

  // ---- Untrusted content is scanned, never obeyed ------------------------
  // The user's own message is scanned too: an authority claim typed in chat
  // must be surfaced as a conflict, never applied as RBAC (TC06).
  const untrustedText = attachments.map((a) => a.content).join('\n');
  const scanAttachments = scanUntrustedText(untrustedText);
  const scanUserText = scanUntrustedText(req.text);
  const claimedIdentities = [...scanAttachments.claimedIdentities, ...scanUserText.claimedIdentities];
  const documentApprovals = [
    ...scanAttachments.documentApprovals,
    ...scanUserText.documentApprovals,
  ];
  for (const attachment of attachments) {
    appendAuditEvent(db, {
      tenant_id: fx.org.org_id,
      run_id: runId,
      actor: 'system',
      event_type: 'INPUT_RECEIVED',
      metadata: { attachment: attachment.name, trust_level: 'untrusted_content' },
      event_id: `EVT-ATT-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  }

  // ---- Agent 2: Interpreter ---------------------------------------------
  const interpretation = interpret(fx, {
    text: req.text,
    referenceNow: req.referenceNow,
    referenceTimezone: fx.org.default_timezone,
    sourceId: 'MSG-001',
  });

  // ---- Agent 4: Validator (runs before conflict detection so that
  //      rule-derived fields such as participant local times are available)
  const validation = validate({
    candidates: interpretation.candidates,
    fx,
    referenceNow: req.referenceNow,
    sourceText: req.text,
  });

  // ---- Agent 3: Conflict Detector ---------------------------------------
  const conflicts = detectConflicts({
    candidates: interpretation.candidates,
    fx,
    sourceText: req.text,
    attachments,
    claimedIdentities,
    documentApprovals,
  });

  if (conflicts.some((c) => c.type === 'PROMPT_INJECTION')) {
    appendAuditEvent(db, {
      tenant_id: fx.org.org_id,
      run_id: runId,
      actor: 'system',
      event_type: 'PROMPT_INJECTION_DETECTED',
      metadata: {
        note: 'Instruksi pada lampiran diperlakukan sebagai data, bukan perintah. Tidak ada yang dieksekusi.',
      },
      event_id: `EVT-INJ-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  }

  // ---- Persist actions ---------------------------------------------------
  const storedActions: StoredAction[] = [];
  for (const candidate of interpretation.candidates) {
    // Unsupported action shapes are NOT persisted as executable actions: NAVI
    // must not invent a tool for them. They surface as a refusal conflict.
    if (!SUPPORTED_ACTION_TYPES.includes(candidate.type as never)) continue;
    const actionId = newActionId();
    const payload = buildPayload(candidate);
    payload.recipient_emails = recipientEmails(fx, payload.recipient_ids);

    // Attach the referenced minutes document when the action sends one.
    const referenced = (candidate.payload.referenced_meetings as string[] | undefined) ?? [];
    for (const meetingId of referenced) {
      const meeting = fx.meetings.meetings.find((m) => m.id === meetingId);
      if (!meeting) continue;
      payload.meeting_ref = meeting.id;
      payload.document_status = meeting.minutes_status;
      const attachmentName = `${meeting.document_id}.md`;
      payload.attachments = [
        {
          document_id: meeting.document_id,
          filename: attachmentName,
          mime_type: 'text/markdown',
          bytes: Buffer.byteLength(meeting.notes.join('\n'), 'utf8'),
          content_sha256: computePayloadHash({
            tenant_id: fx.org.org_id,
            action_id: meeting.document_id,
            version: 1,
            payload: meeting.notes,
          }),
          mock_uri: `mock://documents/${meeting.document_id}`,
        },
      ];
      if (!payload.subject_or_title) {
        payload.subject_or_title = `Notulen ${meeting.id} - ${meeting.title}`;
      }
      if (!payload.full_body_or_description) {
        payload.full_body_or_description = `Terlampir notulen ${meeting.id} (${meeting.title}).`;
      }
    }

    const version = 1;
    const payloadHash = computePayloadHash({
      tenant_id: fx.org.org_id,
      action_id: actionId,
      version,
      payload,
    });

    const blockingForCandidate = conflicts.filter(
      (c) => c.severity === 'BLOCKING' && c.requires_clarification,
    );
    const state: StoredAction['state'] =
      blockingForCandidate.length > 0 || !validation.pass ? 'NEEDS_CLARIFICATION' : 'AWAITING_APPROVAL';

    // Risk level comes from the Validator, which is the only component that
    // applies the high-risk policy rules.
    const riskLevel = validation.risk_level ?? 'LOW';

    const row: StoredAction = {
      action_id: actionId,
      run_id: runId,
      tenant_id: fx.org.org_id,
      type: candidate.type as StoredAction['type'],
      state,
      version,
      payload,
      payload_hash: payloadHash,
      risk_level: riskLevel,
      source_spans: candidate.source_spans,
      created_at: createdAt,
      updated_at: createdAt,
      last_error: null,
    };

    db.prepare(
      `INSERT INTO actions
        (action_id, run_id, tenant_id, type, state, version, payload, payload_hash,
         risk_level, provenance, created_at, updated_at, last_error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      actionId,
      runId,
      fx.org.org_id,
      row.type,
      row.state,
      row.version,
      JSON.stringify(row.payload),
      row.payload_hash,
      row.risk_level,
      JSON.stringify(row.source_spans),
      row.created_at,
      row.updated_at,
      null,
    );

    storedActions.push(row);
  }

  // ---- Persist conflicts -------------------------------------------------
  const storedConflicts: Conflict[] = [];
  for (const conflict of conflicts) {
    const conflictId = newConflictId();
    const stored: Conflict = { ...conflict, conflict_id: conflictId };
    db.prepare(
      `INSERT INTO conflicts
        (conflict_id, run_id, action_id, type, severity, evidence, question, options,
         requires_clarification, status, resolution, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      conflictId,
      runId,
      conflict.action_ids[0] ?? null,
      stored.type,
      stored.severity,
      stored.evidence,
      stored.question,
      JSON.stringify(stored.options),
      stored.requires_clarification ? 1 : 0,
      stored.status,
      stored.resolution,
      createdAt,
    );
    storedConflicts.push(stored);
  }

  // ---- Agent 1: Orchestrator decides the next step ----------------------
  const decision = decideNextStep({
    actionCount: storedActions.length,
    conflicts: storedConflicts,
    validationPassed: validation.pass,
    hasBlockingClarification: storedConflicts.some(
      (c) => c.severity === 'BLOCKING' && c.requires_clarification,
    ),
  });

  appendAuditEvent(db, {
    tenant_id: fx.org.org_id,
    run_id: runId,
    actor: 'system',
    event_type: 'ACTIONS_PARSED',
    metadata: {
      action_count: storedActions.length,
      action_ids: storedActions.map((a) => a.action_id),
      agents_executed: ['A1-Orchestrator', 'A2-Interpreter', 'A3-ConflictDetector', 'A4-Validator'],
    },
    event_id: `EVT-PARSE-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000,
    )}`,
  });

  if (storedConflicts.length > 0) {
    appendAuditEvent(db, {
      tenant_id: fx.org.org_id,
      run_id: runId,
      actor: 'system',
      event_type: 'CONFLICT_FOUND',
      metadata: {
        conflicts: storedConflicts.map((c) => ({
          id: c.conflict_id,
          type: c.type,
          severity: c.severity,
          requires_clarification: c.requires_clarification,
        })),
      },
      event_id: `EVT-CONF-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  }

  appendAuditEvent(db, {
    tenant_id: fx.org.org_id,
    run_id: runId,
    actor: 'system',
    event_type: 'VALIDATED',
    metadata: {
      pass: validation.pass,
      risk_level: validation.risk_level,
      reason_codes: validation.reason_codes,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    event_id: `EVT-VAL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000,
    )}`,
  });

  if (decision.next_step === 'AWAITING_CLARIFICATION') {
    appendAuditEvent(db, {
      tenant_id: fx.org.org_id,
      run_id: runId,
      actor: 'system',
      event_type: 'CLARIFICATION_REQUESTED',
      metadata: {
        questions: storedConflicts
          .filter((c) => c.requires_clarification)
          .map((c) => ({ id: c.conflict_id, type: c.type, question: c.question })),
      },
      event_id: `EVT-CLAR-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  }

  db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run(decision.next_step, runId);

  return {
    run_id: runId,
    step: decision.next_step,
    actions: storedActions,
    conflicts: storedConflicts,
    validation,
    orchestrator_notes: decision.notes,
  };
}

/** Load a run with its actions and conflicts for the UI. */
export function loadRun(db: Db, runId: string): {
  run: Record<string, unknown>;
  actions: StoredAction[];
  conflicts: Conflict[];
} | null {
  const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as
    | Record<string, unknown>
    | undefined;
  if (!run) return null;

  const actionRows = db
    .prepare('SELECT * FROM actions WHERE run_id = ? ORDER BY created_at ASC, action_id ASC')
    .all(runId) as Array<Record<string, unknown>>;
  const actions: StoredAction[] = actionRows.map((row) => ({
    action_id: String(row.action_id),
    run_id: String(row.run_id),
    tenant_id: String(row.tenant_id),
    type: String(row.type) as StoredAction['type'],
    state: String(row.state) as StoredAction['state'],
    version: Number(row.version),
    payload: JSON.parse(String(row.payload)) as ActionPayload,
    payload_hash: String(row.payload_hash),
    risk_level: String(row.risk_level) as StoredAction['risk_level'],
    source_spans: JSON.parse(String(row.provenance)),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_error: (row.last_error as string | null) ?? null,
  }));

  const conflictRows = db
    .prepare('SELECT * FROM conflicts WHERE run_id = ? ORDER BY created_at ASC')
    .all(runId) as Array<Record<string, unknown>>;
  const conflicts: Conflict[] = conflictRows.map((row) => ({
    conflict_id: String(row.conflict_id),
    type: String(row.type),
    severity: String(row.severity) as Conflict['severity'],
    action_ids: row.action_id ? [String(row.action_id)] : [],
    evidence: String(row.evidence),
    question: (row.question as string | null) ?? null,
    options: JSON.parse(String(row.options)),
    requires_clarification: Number(row.requires_clarification) === 1,
    status: String(row.status) as Conflict['status'],
    resolution: (row.resolution as string | null) ?? null,
  }));

  return { run, actions, conflicts };
}
