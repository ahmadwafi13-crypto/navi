/**
 * NAVI core domain types.
 *
 * Mirrors PRD v1.0 section 6.2 (data model) and docs/WORKFLOW_CONTRACT.md
 * (agent contracts + state machine). Nothing in this file may be imported by an
 * agent that is allowed to hold execution credentials.
 */

export const TENANT_ID = 'demo-navi-001';
export const LOCALE = 'id-ID';

export type ActionType = 'email.create' | 'calendar.create' | 'task.create';

export const SUPPORTED_ACTION_TYPES: ActionType[] = [
  'email.create',
  'calendar.create',
  'task.create',
];

/** State machine from docs/WORKFLOW_CONTRACT.md */
export type ActionState =
  | 'DRAFT'
  | 'NEEDS_CLARIFICATION'
  | 'VALIDATED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'APPROVAL_INVALIDATED'
  | 'EXECUTING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REJECTED'
  | 'EXPIRED';

export type ConflictSeverity = 'BLOCKING' | 'WARNING';

/** Contract of every logical agent role (PRD 4.1). */
export interface AgentOutput<T> {
  agent_id: string;
  run_id: string;
  schema_version: string;
  data: T;
  warnings: string[];
  source_spans: string[];
  elapsed_ms: number;
}

/** Contract of every logical agent role (PRD 4.1). */
export interface RunInput {
  run_id: string;
  tenant_id: string;
  user_id: string;
  session_id: string;
  source_refs: string[];
  locale: string;
  timezone: string;
}

/** A single extracted action candidate, before validation. */
export interface ActionCandidate {
  type: ActionType | string;
  who: string[] | null;
  what: string | null;
  when: string | null;
  where: string | null;
  content: string | null;
  source_spans: string[];
  confidence: number;
  /** Filled by the Interpreter, normalised into an exact payload later. */
  payload: Record<string, unknown>;
}

export interface Conflict {
  conflict_id: string;
  type: string;
  severity: ConflictSeverity;
  action_ids: string[];
  evidence: string;
  question: string | null;
  options: ClarificationOption[];
  requires_clarification: boolean;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  resolution: string | null;
}

export interface ClarificationOption {
  id: string;
  label: string;
  value: unknown;
}

export interface ValidationReport {
  pass: boolean;
  errors: string[];
  warnings: string[];
  needs_approval: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  reason_codes: string[];
  citations: string[];
}

/** Exact payload that gets hashed, previewed, approved and executed. */
export interface ActionPayload {
  action_type: ActionType;
  recipient_ids: string[];
  recipient_emails: string[];
  subject_or_title: string | null;
  full_body_or_description: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  attachments: PayloadAttachment[];
  location: string | null;
  // Type specific extras (still part of the hashed canonical payload).
  meeting_ref?: string | null;
  document_status?: string | null;
  due_at?: string | null;
  due_timezone?: string | null;
  organizer_id?: string | null;
  participant_sites?: string[];
  participant_local_times?: ParticipantLocalTime[];
  /** Resolved local schedule fields, kept so a clarification can re-derive. */
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

export interface PayloadAttachment {
  document_id: string;
  filename: string;
  mime_type: string;
  bytes: number;
  content_sha256: string;
  mock_uri: string;
}

export interface ParticipantLocalTime {
  site_id: string;
  timezone: string;
  label: string;
  start_local: string;
  end_local: string;
}

export interface StoredAction {
  action_id: string;
  run_id: string;
  tenant_id: string;
  type: ActionType;
  state: ActionState;
  version: number;
  payload: ActionPayload;
  payload_hash: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  source_spans: string[];
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

export type AuditEventType =
  | 'INPUT_RECEIVED'
  | 'ACTIONS_PARSED'
  | 'CONFLICT_FOUND'
  | 'VALIDATED'
  | 'CLARIFICATION_REQUESTED'
  | 'CLARIFICATION_PROVIDED'
  | 'PLAN_PREVIEWED'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPROVAL_INVALIDATED'
  | 'EXECUTION_BLOCKED'
  | 'MOCK_EXECUTED'
  | 'EXECUTION_FAILED'
  | 'PROMPT_INJECTION_DETECTED'
  | 'AGENT_TRACE';

export interface AuditEvent {
  event_id: string;
  seq: number;
  tenant_id: string;
  run_id: string | null;
  action_id: string | null;
  actor: string;
  event_type: AuditEventType;
  state_before: string | null;
  state_after: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  prev_hash: string;
  hash: string;
}
