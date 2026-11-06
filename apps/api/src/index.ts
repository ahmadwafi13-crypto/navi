/**
 * NAVI API server.
 *
 * Route map (PRD 6.3):
 *   POST   /v1/auth/session              - create an authenticated session
 *   DELETE /v1/auth/session              - destroy it
 *   GET    /v1/me                        - current identity + capabilities
 *   POST   /v1/runs                      - run the agent pipeline
 *   GET    /v1/runs/:id                  - run state, actions, conflicts
 *   POST   /v1/runs/:id/clarifications   - answer a clarification
 *   GET    /v1/actions/:id/preview       - exact payload to be approved
 *   POST   /v1/actions/:id/decision      - approve / reject (human only)
 *   POST   /internal/execute             - gateway, deny-by-default
 *   GET    /v1/runs/:id/audit            - redacted audit trail
 *   GET    /v1/audit/verify              - hash chain integrity check
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { openDatabase, appendAuditEvent, nowIso, verifyAuditChain, type Db } from './db/index.js';
import { loadFixtures, findUser, findWorkspaceRoot, type Fixtures } from './core/fixtures.js';
import { createSession, destroySession, resolveSession, type AuthContext } from './core/session.js';
import { loadRun, runPipeline } from './core/pipeline.js';
import { computePayloadHash } from './core/hash.js';
import { DenyReason, NaviError } from './core/errors.js';
import { createApproval, invalidateApprovalsOnChange } from './gateway/approval-service.js';
import { executeApprovedAction } from './gateway/execution-gateway.js';
import { recomputeSchedule } from './agents/validator.js';
import { newConflictId } from './core/ids.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const ROOT = findWorkspaceRoot();
const FX = loadFixtures(ROOT);
const DB_PATH = process.env.NAVI_DB ?? resolve(ROOT, 'data/navi-runtime.sqlite');

/**
 * The reference "now" for the demo. Fixed so results are deterministic and
 * reproducible (PRD 13.2 asks for a fixed system clock during a demo).
 */
const REFERENCE_NOW = new Date(
  process.env.NAVI_REFERENCE_NOW ?? '2026-11-06T10:00:00+07:00',
);

export interface ServerOptions {
  dbPath?: string;
  referenceNow?: Date;
}

export async function buildServer(options: ServerOptions = {}) {
  const db: Db = openDatabase(options.dbPath ?? DB_PATH);
  const referenceNow = options.referenceNow ?? REFERENCE_NOW;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 512 });

  // ---- Auth helper ------------------------------------------------------
  function requireAuth(request: { headers: Record<string, unknown> }): AuthContext {
    const header = request.headers.authorization;
    const raw = typeof header === 'string' ? header : '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : (request.headers['x-navi-key'] as string | undefined);
    const auth = resolveSession(db, token);
    if (!auth) {
      throw new NaviError(
        401,
        DenyReason.UNAUTHENTICATED,
        'Sesi terautentikasi diperlukan. Persetujuan hanya dapat dibuat oleh pengguna terautentikasi.',
      );
    }
    if (auth.session.tenant_id !== FX.org.org_id) {
      throw new NaviError(403, DenyReason.CROSS_TENANT, 'Tenant tidak cocok.');
    }
    return auth;
  }

  // ---- Error handler ----------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NaviError) {
      reply.status(error.statusCode).send({
        error: error.reasonCode,
        message: error.message,
        details: error.details,
      });
      return;
    }
    const err = error as Error;
    request.log?.error?.(err);
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
  });

  // =======================================================================
  // AUTH
  // =======================================================================
  app.post('/v1/auth/session', async (request, reply) => {
    const body = (request.body ?? {}) as { user_id?: string };
    const userId = String(body.user_id ?? '');
    const user = findUser(FX, userId);
    if (!user) {
      reply.status(401).send({
        error: DenyReason.UNAUTHENTICATED,
        message: `Pengguna ${userId || '(kosong)'} tidak dikenal pada fixture.`,
      });
      return;
    }
    const auth = createSession(db, FX.org.org_id, user.id);
    reply.send({
      session_id: auth.session.session_id,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        site: user.site,
        email: user.email,
        can_approve: user.can_approve ?? [],
        can_approve_high_risk: user.can_approve_high_risk ?? false,
      },
      api_key: auth.apiKey,
      expires_at: auth.session.expires_at,
      notice: 'Kunci API sesi demo. Semua keputusan humans hanya sah melalui sesi ini.',
    });
  });

  app.delete('/v1/auth/session', async (request, reply) => {
    const auth = requireAuth(request);
    destroySession(db, auth.session.session_id);
    reply.send({ ok: true });
  });

  app.get('/v1/me', async (request, reply) => {
    const auth = requireAuth(request);
    const user = findUser(FX, auth.session.user_id);
    reply.send({
      user: {
        id: user?.id,
        name: user?.name,
        role: user?.role,
        site: user?.site,
        email: user?.email,
        can_approve: user?.can_approve ?? [],
        can_approve_high_risk: user?.can_approve_high_risk ?? false,
      },
      tenant_id: FX.org.org_id,
      session_id: auth.session.session_id,
      reference_now: referenceNow.toISOString(),
      execution_mode: FX.policies.execution_mode,
      holiday_calendar_status: FX.policies.holiday_calendar.status,
    });
  });

  // =======================================================================
  // RUNS
  // =======================================================================
  app.post('/v1/runs', async (request, reply) => {
    const auth = requireAuth(request);
    const body = (request.body ?? {}) as {
      text?: string;
      attachments?: Array<{ name?: string; content?: string }>;
    };
    const text = String(body.text ?? '').trim();
    if (!text) {
      reply.status(400).send({ error: 'INVALID_INPUT', message: 'Pesan tidak boleh kosong.' });
      return;
    }
    const attachments = (body.attachments ?? []).map((a, i) => ({
      name: String(a.name ?? `lampiran-${i + 1}`),
      content: String(a.content ?? ''),
    }));

    const result = runPipeline({
      db,
      fx: FX,
      userId: auth.session.user_id,
      sessionId: auth.session.session_id,
      text,
      attachments,
      referenceNow,
    });

    reply.send({
      run_id: result.run_id,
      step: result.step,
      orchestrator_notes: result.orchestrator_notes,
      validation: result.validation,
      actions: result.actions,
      conflicts: result.conflicts,
      notice:
        'Rencana hanya. Belum ada tindakan yang dieksekusi. Setiap aksi memerlukan persetujuan manusia.',
    });
  });

  app.get('/v1/runs/:id', async (request, reply) => {
    requireAuth(request);
    const { id } = request.params as { id: string };
    const loaded = loadRun(db, id);
    if (!loaded) {
      reply.status(404).send({ error: DenyReason.NOT_FOUND, message: `Run ${id} tidak ditemukan.` });
      return;
    }
    reply.send({
      run: {
        run_id: loaded.run.run_id,
        status: loaded.run.status,
        reference_now: loaded.run.reference_now,
        created_at: loaded.run.created_at,
        source_text: loaded.run.source_text,
      },
      actions: loaded.actions,
      conflicts: loaded.conflicts,
    });
  });

  /**
   * Clarification answers.
   * Applying an answer produces a NEW plan version, which invalidates any
   * approval issued against the previous version (AC11).
   */
  app.post('/v1/runs/:id/clarifications', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      conflict_id?: string;
      option_id?: string;
      value?: Record<string, unknown>;
    };
    const loaded = loadRun(db, id);
    if (!loaded) {
      reply.status(404).send({ error: DenyReason.NOT_FOUND, message: `Run ${id} tidak ditemukan.` });
      return;
    }
    const conflict = loaded.conflicts.find((c) => c.conflict_id === body.conflict_id);
    if (!conflict) {
      reply.status(404).send({ error: DenyReason.NOT_FOUND, message: 'Konflik tidak ditemukan.' });
      return;
    }
    const option =
      conflict.options.find((o) => o.id === body.option_id) ??
      (body.value ? { id: 'custom', label: 'Jawaban manual', value: body.value } : null);
    if (!option) {
      reply.status(400).send({ error: 'INVALID_INPUT', message: 'Opsi klarifikasi tidak valid.' });
      return;
    }

    const value = option.value as Record<string, unknown>;
    const now = nowIso();

    // Apply the answer to the affected action(s).
    for (const action of loaded.actions) {
      let changed = false;
      const payload = { ...action.payload };

      if (conflict.type === 'AMBIGUOUS_CONTACT') {
        const userId = String(value.user_id ?? '');
        if (userId) {
          payload.recipient_ids = [userId];
          changed = true;
        }
      } else if (conflict.type === 'UNCERTAIN_TIME') {
        if (typeof value.iso === 'string') {
          if (action.type === 'calendar.create') {
            payload.start_date = value.iso;
            changed = true;
          } else if (action.type === 'task.create') {
            payload.due_date = value.iso;
            changed = true;
          }
        }
      } else if (conflict.type === 'DOCUMENT_NOT_FINAL') {
        if (value.decision === 'send_anyway') {
          changed = true; // explicit override, still needs approval
        }
      }

      if (!changed) continue;

      // Derived schedule fields must be recomputed so the preview stays exact.
      recomputeSchedule(payload, FX);

      const version = action.version + 1;
      const payloadHash = computePayloadHash({
        tenant_id: action.tenant_id,
        action_id: action.action_id,
        version,
        payload,
      });
      db.prepare(
        `UPDATE actions SET payload = ?, payload_hash = ?, version = ?, state = ?, updated_at = ?
         WHERE action_id = ?`,
      ).run(
        JSON.stringify(payload),
        payloadHash,
        version,
        'AWAITING_APPROVAL',
        now,
        action.action_id,
      );

      // Any approval bound to the old payload is now dead (AC11 / TC15).
      invalidateApprovalsOnChange(
        db,
        action.action_id,
        payloadHash,
        `PLAN_REVISED_V${version}`,
      );

      appendAuditEvent(db, {
        tenant_id: action.tenant_id,
        run_id: action.run_id,
        action_id: action.action_id,
        actor: auth.session.user_id,
        event_type: 'CLARIFICATION_PROVIDED',
        state_before: action.state,
        state_after: 'AWAITING_APPROVAL',
        metadata: {
          conflict_id: conflict.conflict_id,
          option_id: option.id,
          new_version: version,
          new_payload_hash: payloadHash,
        },
        event_id: `EVT-CLP-${Date.now().toString(36).toUpperCase()}-${Math.floor(
          Math.random() * 1000,
        )}`,
      });
    }

    db.prepare(
      `UPDATE conflicts SET status = 'RESOLVED', resolution = ? WHERE conflict_id = ?`,
    ).run(JSON.stringify(option.value), conflict.conflict_id);

    appendAuditEvent(db, {
      tenant_id: FX.org.org_id,
      run_id: id,
      actor: auth.session.user_id,
      event_type: 'CLARIFICATION_PROVIDED',
      metadata: { conflict_id: conflict.conflict_id, option_id: option.id },
      event_id: `EVT-CLR-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });

    // Re-evaluate remaining conflicts for this run.
    const refreshed = loadRun(db, id);
    const stillBlocking = (refreshed?.conflicts ?? []).filter(
      (c) => c.status === 'OPEN' && c.severity === 'BLOCKING' && c.requires_clarification,
    );
    const nextStep = stillBlocking.length > 0 ? 'AWAITING_CLARIFICATION' : 'AWAITING_APPROVAL';
    db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run(nextStep, id);

    reply.send({
      run_id: id,
      step: nextStep,
      actions: refreshed?.actions ?? [],
      conflicts: refreshed?.conflicts ?? [],
    });
  });

  // =======================================================================
  // ACTION PREVIEW + DECISION
  // =======================================================================
  app.get('/v1/actions/:id/preview', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = db.prepare('SELECT * FROM actions WHERE action_id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      reply.status(404).send({ error: DenyReason.NOT_FOUND, message: `Aksi ${id} tidak ditemukan.` });
      return;
    }
    const payload = JSON.parse(String(row.payload));
    const approval = db
      .prepare(
        `SELECT approval_id, approver_id, version, payload_hash, decision, issued_at, expires_at
         FROM approvals WHERE action_id = ? ORDER BY issued_at DESC LIMIT 1`,
      )
      .get(id);

    appendAuditEvent(db, {
      tenant_id: String(row.tenant_id),
      run_id: String(row.run_id),
      action_id: id,
      actor: auth.session.user_id,
      event_type: 'PLAN_PREVIEWED',
      metadata: { version: Number(row.version), payload_hash: String(row.payload_hash) },
      event_id: `EVT-PRV-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1000,
      )}`,
    });

    reply.send({
      action_id: id,
      type: String(row.type),
      state: String(row.state),
      version: Number(row.version),
      risk_level: String(row.risk_level),
      payload_hash: String(row.payload_hash),
      // The exact fields that will be executed (data/03_policies.json).
      exact_preview_fields: FX.policies.approval_requirements.exact_preview_fields,
      payload,
      approval: approval ?? null,
      provenance: JSON.parse(String(row.provenance)),
      notice: 'Isi di bawah ini persis yang akan dieksekusi setelah persetujuan.',
    });
  });

  app.post('/v1/actions/:id/decision', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      decision?: string;
      reason?: string;
      manager_approval_id?: string;
    };
    const decision = String(body.decision ?? '').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      reply.status(400).send({ error: 'INVALID_INPUT', message: 'decision harus APPROVE atau REJECT.' });
      return;
    }
    const outcome = createApproval({
      db,
      fx: FX,
      actionId: id,
      approverId: auth.session.user_id,
      decision: decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
      reason: body.reason,
      managerApprovalId: body.manager_approval_id ?? null,
    });
    reply.send({
      ...outcome,
      notice:
        decision === 'APPROVE'
          ? 'Disetujui. Eksekusi belum terjadi - harus dipanggil melalui gateway dengan idempotency key.'
          : 'Aksi ditolak.',
    });
  });

  // =======================================================================
  // EXECUTION GATEWAY (the only path to a side effect)
  // =======================================================================
  app.post('/internal/execute', async (request, reply) => {
    const auth = requireAuth(request);
    const body = (request.body ?? {}) as {
      action_id?: string;
      idempotency_key?: string;
      manager_approval_id?: string;
    };
    const actionId = String(body.action_id ?? '');
    const idempotencyKey = String(body.idempotency_key ?? randomUUID());
    if (!actionId) {
      reply.status(400).send({ error: 'INVALID_INPUT', message: 'action_id wajib diisi.' });
      return;
    }

    const result = executeApprovedAction({
      db,
      fx: FX,
      actionId,
      idempotencyKey,
      actorId: auth.session.user_id,
      actorSessionId: auth.session.session_id,
      managerApprovalId: body.manager_approval_id ?? null,
    });

    reply.send({
      execution_id: result.execution_id,
      action_id: result.action_id,
      status: result.status,
      receipt: result.receipt,
      provider_error: result.provider_error,
      idempotent_replay: result.idempotent_replay,
      notice: 'Simulasi. Tidak ada email/undangan/task sungguhan yang dikirim.',
    });
  });

  // =======================================================================
  // AUDIT
  // =======================================================================
  app.get('/v1/runs/:id/audit', async (request, reply) => {
    requireAuth(request);
    const { id } = request.params as { id: string };
    const rows = db
      .prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY seq ASC')
      .all(id) as Array<Record<string, unknown>>;
    reply.send({
      run_id: id,
      events: rows.map((row) => ({
        seq: Number(row.seq),
        event_type: row.event_type,
        actor: row.actor,
        action_id: row.action_id,
        state_before: row.state_before,
        state_after: row.state_after,
        metadata: JSON.parse(String(row.metadata)),
        created_at: row.created_at,
        hash: String(row.hash).slice(0, 16),
        prev_hash: String(row.prev_hash).slice(0, 16),
      })),
      note: 'Log append-only dengan hash chain. Metadata sudah direduksi, tidak ada token atau PII lengkap.',
    });
  });

  app.get('/v1/audit/verify', async (request, reply) => {
    requireAuth(request);
    const result = verifyAuditChain(db);
    reply.send(result);
  });

  // =======================================================================
  // FIXTURES + HEALTH
  // =======================================================================
  app.get('/v1/fixtures', async (request, reply) => {
    requireAuth(request);
    reply.send({
      organization: FX.org,
      users: FX.people.users,
      meetings: FX.meetings.meetings,
      policies: {
        execution_mode: FX.policies.execution_mode,
        holiday_calendar: FX.policies.holiday_calendar,
        friday_prayer_demo_block_local: FX.policies.friday_prayer_demo_block_local,
        approval_requirements: FX.policies.approval_requirements,
        privacy: FX.policies.privacy,
      },
      reference_now: referenceNow.toISOString(),
    });
  });

  app.get('/v1/health', async (_request, reply) => {
    reply.send({
      ok: true,
      service: 'navi-api',
      version: '0.1.0',
      execution_mode: FX.policies.execution_mode,
      workspace_root: ROOT,
    });
  });

  // ---- Static frontend ----------------------------------------------------
  const webDist = resolve(ROOT, 'apps/web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/v1') || request.url.startsWith('/internal')) {
        reply.status(404).send({ error: 'NOT_FOUND', message: 'Endpoint tidak dikenal.' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return { app, db, referenceNow };
}

async function main(): Promise<void> {
  const { app } = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  // eslint-disable-next-line no-console
  console.log(`NAVI API siap di http://${HOST}:${PORT} (workspace root: ${ROOT})`);
}

const isMain = process.argv[1] && process.argv[1].includes('index');
if (isMain) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
