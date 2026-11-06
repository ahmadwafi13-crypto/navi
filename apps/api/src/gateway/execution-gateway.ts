/**
 * NAVI EXECUTION GATEWAY
 *
 * This is the single component in NAVI that is allowed to cause a side effect.
 * It is deny-by-default (PRD FR-09) and re-validates EVERYTHING immediately
 * before executing, not at approval time:
 *
 *   1. approval exists for the action
 *   2. approval decision === APPROVED and not consumed
 *   3. approval not expired
 *   4. approval.payload_hash === freshly recomputed hash of the CURRENT payload
 *   5. approval.version === action.version (no stale plan)
 *   6. action.state === APPROVED
 *   7. approver is an authenticated session actor with the right capability
 *   8. high-risk actions additionally carry a manager approval
 *   9. tenant isolation
 *  10. idempotency key has not been used before
 *
 * Any failure => zero side effect + EXECUTION_BLOCKED audit event.
 */

import type { Db } from '../db/index.js';
import { appendAuditEvent, nowIso } from '../db/index.js';
import { computePayloadHash } from '../core/hash.js';
import { DenyReason, NaviError } from '../core/errors.js';
import { newExecutionId } from '../core/ids.js';
import { findUser, type Fixtures } from '../core/fixtures.js';
import type { ActionPayload, ActionState, StoredAction } from '../core/types.js';
import { mockCalendar, mockEmail, mockTask, shouldFail } from '../mock/tools.js';

export interface ApprovalRow {
  approval_id: string;
  run_id: string;
  action_id: string;
  tenant_id: string;
  approver_id: string;
  version: number;
  payload_hash: string;
  decision: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  invalidated_at: string | null;
  invalidate_reason: string | null;
}

export interface ExecutionContext {
  db: Db;
  fx: Fixtures;
  actionId: string;
  idempotencyKey: string;
  /** Identity of the human whose authenticated session triggered execution. */
  actorId: string;
  actorSessionId: string;
  /** Manager approval id for high risk actions. */
  managerApprovalId?: string | null;
}

export interface ExecutionResult {
  execution_id: string;
  action_id: string;
  status: 'SUCCEEDED' | 'FAILED';
  receipt: Record<string, unknown> | null;
  provider_error: string | null;
  idempotent_replay: boolean;
}

function loadAction(db: Db, actionId: string): StoredAction | undefined {
  const row = db.prepare('SELECT * FROM actions WHERE action_id = ?').get(actionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return {
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
  };
}

function block(
  ctx: ExecutionContext,
  action: StoredAction | undefined,
  reason: string,
  statusCode: number,
  detail: Record<string, unknown>,
): never {
  appendAuditEvent(ctx.db, {
    tenant_id: action?.tenant_id ?? 'unknown',
    run_id: action?.run_id ?? null,
    action_id: action?.action_id ?? ctx.actionId,
    actor: ctx.actorId,
    event_type: 'EXECUTION_BLOCKED',
    state_before: action?.state ?? null,
    state_after: action?.state ?? null,
    metadata: { reason, ...detail, idempotency_key: ctx.idempotencyKey },
    event_id: `EVT-BLOCK-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000,
    )}`,
  });
  throw new NaviError(statusCode, reason, `Eksekusi ditolak oleh gateway: ${reason}`, detail);
}

/**
 * Execute an approved action. Deny-by-default.
 * Throws NaviError with a stable reason_code when any check fails.
 */
export function executeApprovedAction(ctx: ExecutionContext): ExecutionResult {
  const { db } = ctx;

  // ---- Idempotency: a replay returns the original receipt, no new side effect
  const existing = db
    .prepare('SELECT * FROM executions WHERE idempotency_key = ?')
    .get(ctx.idempotencyKey) as Record<string, unknown> | undefined;
  if (existing) {
    return {
      execution_id: String(existing.execution_id),
      action_id: String(existing.action_id),
      status: 'SUCCEEDED',
      receipt: existing.receipt ? JSON.parse(String(existing.receipt)) : null,
      provider_error: null,
      idempotent_replay: true,
    };
  }

  const action = loadAction(db, ctx.actionId);
  if (!action) {
    block(ctx, undefined, DenyReason.NOT_FOUND, 404, { action_id: ctx.actionId });
  }

  // ---- Tenant isolation
  if (action.tenant_id !== ctx.fx.org.org_id) {
    block(ctx, action, DenyReason.CROSS_TENANT, 403, {
      expected_tenant: ctx.fx.org.org_id,
      action_tenant: action.tenant_id,
    });
  }

  // ---- Approval must exist
  const approval = db
    .prepare(
      `SELECT * FROM approvals
       WHERE action_id = ? AND decision = 'APPROVED'
       ORDER BY issued_at DESC LIMIT 1`,
    )
    .get(ctx.actionId) as Record<string, unknown> | undefined;
  if (!approval) {
    block(ctx, action, DenyReason.MISSING_APPROVAL, 403, { action_id: ctx.actionId });
  }

  const approvalRow = approval as unknown as ApprovalRow;

  // ---- Approval must not be consumed
  if (approvalRow.consumed_at) {
    block(ctx, action, DenyReason.INVALID_APPROVAL, 409, {
      consumed_at: approvalRow.consumed_at,
    });
  }

  // ---- Approval must not be invalidated
  if (approvalRow.invalidated_at) {
    block(ctx, action, DenyReason.INVALID_APPROVAL, 409, {
      invalidated_at: approvalRow.invalidated_at,
      reason: approvalRow.invalidate_reason,
    });
  }

  // ---- Approval must not be expired
  if (Date.parse(approvalRow.expires_at) <= Date.now()) {
    block(ctx, action, DenyReason.EXPIRED_APPROVAL, 403, {
      expires_at: approvalRow.expires_at,
    });
  }

  // ---- THE CRITICAL CHECK: payload hash must still match (AC10, AC11, TC15)
  const recomputed = computePayloadHash({
    tenant_id: action.tenant_id,
    action_id: action.action_id,
    version: action.version,
    payload: action.payload,
  });
  if (recomputed !== approvalRow.payload_hash) {
    // The plan changed after approval -> old approval is dead.
    db.prepare(
      `UPDATE approvals SET invalidated_at = ?, invalidate_reason = ? WHERE approval_id = ?`,
    ).run(nowIso(), 'PAYLOAD_HASH_MISMATCH', approvalRow.approval_id);
    db.prepare(
      `UPDATE actions SET state = 'APPROVAL_INVALIDATED', updated_at = ? WHERE action_id = ?`,
    ).run(nowIso(), action.action_id);
    appendAuditEvent(db, {
      tenant_id: action.tenant_id,
      run_id: action.run_id,
      action_id: action.action_id,
      actor: ctx.actorId,
      event_type: 'APPROVAL_INVALIDATED',
      state_before: 'APPROVED',
      state_after: 'APPROVAL_INVALIDATED',
      metadata: {
        reason: 'PAYLOAD_HASH_MISMATCH',
        approved_hash: approvalRow.payload_hash,
        current_hash: recomputed,
        approved_version: approvalRow.version,
        current_version: action.version,
      },
      event_id: `EVT-INVAL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
    block(ctx, action, DenyReason.PAYLOAD_HASH_MISMATCH, 409, {
      approved_hash: approvalRow.payload_hash,
      current_hash: recomputed,
      message: 'Isi payload berubah setelah persetujuan. Persetujuan lama tidak berlaku.',
    });
  }

  // ---- Version must match (AC10, stale_version)
  if (approvalRow.version !== action.version) {
    block(ctx, action, DenyReason.STALE_VERSION, 409, {
      approved_version: approvalRow.version,
      current_version: action.version,
    });
  }

  // ---- State machine guard: only APPROVED may reach EXECUTING
  if (action.state !== 'APPROVED') {
    block(ctx, action, DenyReason.INVALID_STATE, 409, {
      current_state: action.state,
      required_state: 'APPROVED',
    });
  }

  // ---- Approver must be an authorised actor for this action type
  const approver = findUser(ctx.fx, approvalRow.approver_id);
  if (!approver) {
    block(ctx, action, DenyReason.UNAUTHORIZED_APPROVER, 403, {
      approver_id: approvalRow.approver_id,
    });
  }
  const capability = `${action.type}`;
  const allowed = approver.can_approve ?? [];
  if (!allowed.includes(capability)) {
    block(ctx, action, DenyReason.UNAUTHORIZED_APPROVER, 403, {
      approver_id: approver.id,
      role: approver.role,
      required_capability: capability,
    });
  }
  // The approver must be the same identity that owns the session performing the call
  if (approvalRow.approver_id !== ctx.actorId) {
    block(ctx, action, DenyReason.UNAUTHORIZED_APPROVER, 403, {
      message: 'Persetujuan harus dibuat dan dieksekusi oleh identitas terautentikasi yang sama.',
      approval_approver: approvalRow.approver_id,
      session_actor: ctx.actorId,
    });
  }

  // ---- High risk requires an additional manager approval (policy + TC19)
  if (action.risk_level === 'HIGH') {
    const managerApprovalId = ctx.managerApprovalId;
    if (!managerApprovalId) {
      block(ctx, action, DenyReason.HIGH_RISK_CONFIRMATION_MISSING, 403, {
        risk_level: action.risk_level,
      });
    }
    const managerApproval = db
      .prepare(`SELECT * FROM approvals WHERE approval_id = ? AND decision = 'APPROVED'`)
      .get(managerApprovalId) as Record<string, unknown> | undefined;
    const manager = managerApproval
      ? findUser(ctx.fx, String(managerApproval.approver_id))
      : undefined;
    if (!managerApproval || !manager?.can_approve_high_risk) {
      block(ctx, action, DenyReason.HIGH_RISK_REQUIRES_MANAGER, 403, {
        message: 'Aksi berisiko tinggi memerlukan persetujuan manajer tambahan.',
      });
    }
  }

  // ---- Atomic state transition APPROVED -> EXECUTING
  const executionId = newExecutionId();
  const claimed = db
    .prepare(
      `UPDATE actions SET state = 'EXECUTING', updated_at = ?
       WHERE action_id = ? AND state = 'APPROVED' AND version = ?`,
    )
    .run(nowIso(), action.action_id, action.version);
  if (claimed.changes !== 1) {
    block(ctx, action, DenyReason.INVALID_STATE, 409, {
      message: 'Transisi state gagal, kemungkinan eksekusi berjalan bersamaan.',
    });
  }

  appendAuditEvent(db, {
    tenant_id: action.tenant_id,
    run_id: action.run_id,
    action_id: action.action_id,
    actor: ctx.actorId,
    event_type: 'EXECUTION_BLOCKED',
    state_before: 'APPROVED',
    state_after: 'EXECUTING',
    metadata: {
      phase: 'execution_started',
      execution_id: executionId,
      idempotency_key: ctx.idempotencyKey,
    },
    event_id: `EVT-START-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000,
    )}`,
  });

  // ---- Perform the mock side effect
  let receipt: Record<string, unknown> | null = null;
  let providerError: string | null = null;
  let finalState: ActionState = 'SUCCEEDED';

  try {
    const userById = (id: string) => findUser(ctx.fx, id);
    const emails = action.payload.recipient_ids
      .map((id) => userById(id)?.email)
      .filter((e): e is string => Boolean(e));

    if (action.type === 'email.create') {
      if (shouldFail('mock.email')) throw new Error('Simulasi kegagalan mock email (NAVI_FAIL_TOOL).');
      const r = mockEmail(db, {
        run_id: action.run_id,
        action_id: action.action_id,
        payload: action.payload,
        recipientEmails: emails,
      });
      receipt = r as unknown as Record<string, unknown>;
    } else if (action.type === 'calendar.create') {
      if (shouldFail('mock.calendar'))
        throw new Error('Simulasi kegagalan mock calendar (NAVI_FAIL_TOOL).');
      const r = mockCalendar(db, {
        run_id: action.run_id,
        action_id: action.action_id,
        payload: action.payload,
        participantIds: action.payload.recipient_ids,
      });
      receipt = r as unknown as Record<string, unknown>;
    } else if (action.type === 'task.create') {
      if (shouldFail('mock.task')) throw new Error('Simulasi kegagalan mock task (NAVI_FAIL_TOOL).');
      const r = mockTask(db, {
        run_id: action.run_id,
        action_id: action.action_id,
        payload: action.payload,
        assigneeId: action.payload.recipient_ids[0] ?? 'unknown',
      });
      receipt = r as unknown as Record<string, unknown>;
    } else {
      throw new Error(`Tipe aksi tidak didukung oleh gateway: ${action.type}`);
    }
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
    finalState = 'FAILED';
  }

  db.prepare(
    `INSERT INTO executions
      (execution_id, run_id, action_id, idempotency_key, status, receipt, provider_error, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    executionId,
    action.run_id,
    action.action_id,
    ctx.idempotencyKey,
    finalState,
    receipt ? JSON.stringify(receipt) : null,
    providerError,
    nowIso(),
  );

  db.prepare('UPDATE actions SET state = ?, updated_at = ?, last_error = ? WHERE action_id = ?').run(
    finalState,
    nowIso(),
    providerError,
    action.action_id,
  );

  if (finalState === 'SUCCEEDED') {
    db.prepare('UPDATE approvals SET consumed_at = ? WHERE approval_id = ?').run(
      nowIso(),
      approvalRow.approval_id,
    );
    appendAuditEvent(db, {
      tenant_id: action.tenant_id,
      run_id: action.run_id,
      action_id: action.action_id,
      actor: ctx.actorId,
      event_type: 'MOCK_EXECUTED',
      state_before: 'EXECUTING',
      state_after: 'SUCCEEDED',
      metadata: {
        execution_id: executionId,
        idempotency_key: ctx.idempotencyKey,
        receipt,
        simulated: true,
      },
      event_id: `EVT-EXEC-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  } else {
    appendAuditEvent(db, {
      tenant_id: action.tenant_id,
      run_id: action.run_id,
      action_id: action.action_id,
      actor: ctx.actorId,
      event_type: 'EXECUTION_FAILED',
      state_before: 'EXECUTING',
      state_after: 'FAILED',
      metadata: { execution_id: executionId, provider_error: providerError },
      event_id: `EVT-FAIL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  }

  return {
    execution_id: executionId,
    action_id: action.action_id,
    status: finalState,
    receipt,
    provider_error: providerError,
    idempotent_replay: false,
  };
}
