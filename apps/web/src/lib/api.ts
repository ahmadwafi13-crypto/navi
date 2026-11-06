import type {
  Action,
  ActionState,
  ActionType,
  AuditEvent,
  Conflict,
  CurrentUser,
  Fixtures,
  RunResult,
  ValidationReport,
} from './types';

const API_BASE = '';

let apiKey: string | null = sessionStorage.getItem('navi.apiKey');

export function setApiKey(key: string | null): void {
  apiKey = key;
  if (key) sessionStorage.setItem('navi.apiKey', key);
  else sessionStorage.removeItem('navi.apiKey');
}

export function getApiKey(): string | null {
  return apiKey;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: 'INVALID_RESPONSE', message: text };
  }
  if (!response.ok) {
    const err = body as { error?: string; message?: string; details?: Record<string, unknown> };
    throw new ApiError(
      response.status,
      err?.error ?? 'UNKNOWN',
      err?.message ?? `Permintaan gagal (${response.status}).`,
      err?.details ?? {},
    );
  }
  return body as T;
}

export const api = {
  login: (userId: string) =>
    request<{ session_id: string; user: CurrentUser; api_key: string }>('/v1/auth/session', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  me: () =>
    request<{ user: CurrentUser; reference_now: string; execution_mode: string }>('/v1/me'),

  fixtures: () => request<Fixtures>('/v1/fixtures'),

  createRun: (text: string, attachments: Array<{ name: string; content: string }>) =>
    request<RunResult>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ text, attachments }),
    }),

  getRun: (runId: string) =>
    request<{ run: Record<string, unknown>; actions: Action[]; conflicts: Conflict[] }>(
      `/v1/runs/${runId}`,
    ),

  clarify: (runId: string, conflictId: string, optionId: string) =>
    request<{ run_id: string; step: string; actions: Action[]; conflicts: Conflict[] }>(
      `/v1/runs/${runId}/clarifications`,
      {
        method: 'POST',
        body: JSON.stringify({ conflict_id: conflictId, option_id: optionId }),
      },
    ),

  preview: (actionId: string) =>
    request<{
      action_id: string;
      type: ActionType;
      state: ActionState;
      version: number;
      risk_level: string;
      payload_hash: string;
      exact_preview_fields: string[];
      payload: Action['payload'];
      approval: Record<string, unknown> | null;
      provenance: string[];
    }>(`/v1/actions/${actionId}/preview`),

  decide: (actionId: string, decision: 'APPROVE' | 'REJECT', reason?: string) =>
    request<{ approval_id: string; decision: string; payload_hash: string; expires_at: string }>(
      `/v1/actions/${actionId}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, reason }) },
    ),

  execute: (actionId: string, idempotencyKey: string) =>
    request<{
      execution_id: string;
      status: string;
      receipt: Record<string, unknown> | null;
      provider_error: string | null;
      idempotent_replay: boolean;
    }>('/internal/execute', {
      method: 'POST',
      body: JSON.stringify({ action_id: actionId, idempotency_key: idempotencyKey }),
    }),

  audit: (runId: string) =>
    request<{ run_id: string; events: AuditEvent[] }>(`/v1/runs/${runId}/audit`),

  verifyAudit: () => request<{ ok: boolean; brokenAt: number | null }>('/v1/audit/verify'),
};

export const STATE_LABEL: Record<ActionState, { text: string; tone: string }> = {
  DRAFT: { text: 'DRAFT', tone: 'pill-neutral' },
  NEEDS_CLARIFICATION: { text: 'NEEDS_CLARIFICATION', tone: 'pill-amber' },
  VALIDATED: { text: 'READY_TO_APPROVE', tone: 'pill-teal' },
  AWAITING_APPROVAL: { text: 'READY_TO_APPROVE', tone: 'pill-teal' },
  APPROVED: { text: 'APPROVED', tone: 'pill-blue' },
  APPROVAL_INVALIDATED: { text: 'APPROVAL_INVALIDATED', tone: 'pill-red' },
  EXECUTING: { text: 'EXECUTING', tone: 'pill-blue' },
  SUCCEEDED: { text: 'EXECUTED', tone: 'pill-green' },
  FAILED: { text: 'FAILED', tone: 'pill-red' },
  REJECTED: { text: 'REJECTED', tone: 'pill-red' },
  EXPIRED: { text: 'EXPIRED', tone: 'pill-amber' },
};

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  'email.create': 'Email',
  'calendar.create': 'Kalender',
  'task.create': 'Tugas',
};

export const CONFLICT_LABEL: Record<string, string> = {
  AMBIGUOUS_CONTACT: 'Penerima ambigu',
  DOCUMENT_NOT_FINAL: 'Dokumen belum final',
  INSTRUCTION_CONTRADICTION: 'Instruksi bertentangan',
  UNCERTAIN_TIME: 'Waktu tidak pasti',
  UNVERIFIED_AUTHORITY: 'Kewenangan tidak terverifikasi',
  IDENTITY_CLAIM_IN_TEXT: 'Klaim identitas dalam teks',
  UNSUPPORTED_ACTION: 'Aksi tidak didukung',
  PROMPT_INJECTION: 'Prompt injection terdeteksi',
  APPROVAL_IN_DOCUMENT: 'Persetujuan palsu dalam dokumen',
  HIGH_RISK_RECIPIENT: 'Penerima berisiko tinggi',
};

export function formatLocalTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone ?? 'Asia/Jakarta',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
