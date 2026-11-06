/**
 * Approval service.
 *
 * An approval can only be created by an authenticated session acting on an
 * exact, hashed payload. There is no code path that lets model output, a
 * document, or a chat message create one (AC12, TC16).
 */

import type { Db } from '../db/index.js';
import { appendAuditEvent, nowIso } from '../db/index.js';
import { computePayloadHash } from '../core/hash.js';
import { DenyReason, NaviError } from '../core/errors.js';
import { newApprovalId } from '../core/ids.js';
import { findUser, type Fixtures } from '../core/fixtures.js';
import type { ActionPayload } from '../core/types.js';

export interface ApprovalRequest {
  db: Db;
  fx: Fixtures;
  actionId: string;
  /** Identity of the human session making the decision. */
  approverId: string;
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
  /** Set for high-risk actions: id of the manager approval record. */
  managerApprovalId?: string | null;
  ttlMinutes?: number;
}

export interface ApprovalOutcome {
  approval_id: string;
  action_id: string;
  approver_id: string;
  decision: string;
  version: number;
  payload_hash: string;
  issued_at: string;
  expires_at: string;
  risk_level: string;
}

export function createApproval(req: ApprovalRequest): ApprovalOutcome {
  const { db, fx } = req;

  const row = db.prepare('SELECT * FROM actions WHERE action_id = ?').get(req.actionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new NaviError(404, DenyReason.NOT_FOUND, `Aksi ${req.actionId} tidak ditemukan.`);
  }

  const state = String(row.state);
  const version = Number(row.version);
  const payload = JSON.parse(String(row.payload)) as ActionPayload;
  const riskLevel = String(row.risk_level);
  const tenantId = String(row.tenant_id);

  if (tenantId !== fx.org.org_id) {
    throw new NaviError(403, DenyReason.CROSS_TENANT, 'Tenant tidak cocok.');
  }

  const approver = findUser(fx, req.approverId);
  if (!approver) {
    throw new NaviError(
      403,
      DenyReason.UNAUTHORIZED_APPROVER,
      `Approver ${req.approverId} tidak dikenali.`,
    );
  }

  if (req.decision === 'REJECT') {
    const approvalId = newApprovalId();
    const issuedAt = nowIso();
    const expiresAt = new Date(Date.now() + (req.ttlMinutes ?? 15) * 60000).toISOString();
    const payloadHash = computePayloadHash({
      tenant_id: tenantId,
      action_id: req.actionId,
      version,
      payload,
    });
    db.prepare(
      `INSERT INTO approvals
        (approval_id, run_id, action_id, tenant_id, approver_id, version, payload_hash,
         decision, issued_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      approvalId,
      String(row.run_id),
      req.actionId,
      tenantId,
      approver.id,
      version,
      payloadHash,
      'REJECTED',
      issuedAt,
      expiresAt,
    );
    db.prepare(`UPDATE actions SET state = 'REJECTED', updated_at = ? WHERE action_id = ?`).run(
      issuedAt,
      req.actionId,
    );
    appendAuditEvent(db, {
      tenant_id: tenantId,
      run_id: String(row.run_id),
      action_id: req.actionId,
      actor: approver.id,
      event_type: 'REJECTED',
      state_before: state,
      state_after: 'REJECTED',
      metadata: { approval_id: approvalId, reason: req.reason ?? null },
      event_id: `EVT-REJ-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
    return {
      approval_id: approvalId,
      action_id: req.actionId,
      approver_id: approver.id,
      decision: 'REJECTED',
      version,
      payload_hash: payloadHash,
      issued_at: issuedAt,
      expires_at: expiresAt,
      risk_level: riskLevel,
    };
  }

  // ---- Capability check: approver must be allowed for this action type
  const capability = String(row.type);
  if (!(approver.can_approve ?? []).includes(capability)) {
    throw new NaviError(
      403,
      DenyReason.UNAUTHORIZED_APPROVER,
      `${approver.name} (${approver.role}) tidak berwenang menyetujui ${capability}.`,
      { approver_id: approver.id, required_capability: capability },
    );
  }

  // ---- High risk needs manager approval on top of the operator approval
  if (riskLevel === 'HIGH' && !req.managerApprovalId) {
    throw new NaviError(
      403,
      DenyReason.HIGH_RISK_CONFIRMATION_MISSING,
      'Aksi berisiko tinggi memerlukan konfirmasi manajer tambahan.',
      { risk_level: riskLevel },
    );
  }

  // ---- The action must actually be approvable
  if (state !== 'AWAITING_APPROVAL' && state !== 'APPROVED') {
    throw new NaviError(
      409,
      DenyReason.INVALID_STATE,
      `Aksi ${req.actionId} berstatus ${state} sehingga tidak dapat disetujui.`,
      { current_state: state },
    );
  }

  const approvalId = newApprovalId();
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + (req.ttlMinutes ?? 15) * 60000).toISOString();
  const payloadHash = computePayloadHash({
    tenant_id: tenantId,
    action_id: req.actionId,
    version,
    payload,
  });

  db.prepare(
    `INSERT INTO approvals
      (approval_id, run_id, action_id, tenant_id, approver_id, version, payload_hash,
       decision, issued_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    approvalId,
    String(row.run_id),
    req.actionId,
    tenantId,
    approver.id,
    version,
    payloadHash,
    'APPROVED',
    issuedAt,
    expiresAt,
  );

  db.prepare(`UPDATE actions SET state = 'APPROVED', updated_at = ? WHERE action_id = ?`).run(
    issuedAt,
    req.actionId,
  );

  appendAuditEvent(db, {
    tenant_id: tenantId,
    run_id: String(row.run_id),
    action_id: req.actionId,
    actor: approver.id,
    event_type: 'APPROVED',
    state_before: state,
    state_after: 'APPROVED',
    metadata: {
      approval_id: approvalId,
      version,
      payload_hash: payloadHash,
      expires_at: expiresAt,
      risk_level: riskLevel,
      manager_approval_id: req.managerApprovalId ?? null,
    },
    event_id: `EVT-APR-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000,
    )}`,
  });

  return {
    approval_id: approvalId,
    action_id: req.actionId,
    approver_id: approver.id,
    decision: 'APPROVED',
    version,
    payload_hash: payloadHash,
    issued_at: issuedAt,
    expires_at: expiresAt,
    risk_level: riskLevel,
  };
}

/**
 * Invalidate an approval when the payload changes (AC11 / TC15).
 * Called whenever an action payload is revised after approval.
 */
export function invalidateApprovalsOnChange(
  db: Db,
  actionId: string,
  newHash: string,
  reason: string,
): number {
  const rows = db
    .prepare(
      `SELECT approval_id, payload_hash FROM approvals
       WHERE action_id = ? AND decision = 'APPROVED' AND invalidated_at IS NULL`,
    )
    .all(actionId) as Array<{ approval_id: string; payload_hash: string }>;
  let invalidated = 0;
  const ts = nowIso();
  for (const row of rows) {
    if (row.payload_hash === newHash) continue;
    db.prepare(
      `UPDATE approvals SET invalidated_at = ?, invalidate_reason = ? WHERE approval_id = ?`,
    ).run(ts, reason, row.approval_id);
    invalidated += 1;
  }
  if (invalidated > 0) {
    db.prepare(
      `UPDATE actions SET state = 'APPROVAL_INVALIDATED', updated_at = ? WHERE action_id = ?`,
    ).run(ts, actionId);
    appendAuditEvent(db, {
      tenant_id: 'demo-navi-001',
      run_id: null,
      action_id: actionId,
      actor: 'system',
      event_type: 'APPROVAL_INVALIDATED',
      state_before: 'APPROVED',
      state_after: 'APPROVAL_INVALIDATED',
      metadata: { reason, invalidated_count: invalidated },
      event_id: `EVT-INVAL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });
  }
  return invalidated;
}
