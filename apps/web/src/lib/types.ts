export type ActionType = 'email.create' | 'calendar.create' | 'task.create';

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

export interface ActionPayload {
  action_type: ActionType;
  recipient_ids: string[];
  recipient_emails: string[];
  subject_or_title: string | null;
  full_body_or_description: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  attachments: Array<{
    document_id: string;
    filename: string;
    mime_type: string;
    bytes: number;
    content_sha256: string;
    mock_uri: string;
  }>;
  location: string | null;
  due_at?: string | null;
  due_timezone?: string | null;
  meeting_ref?: string | null;
  document_status?: string | null;
  participant_local_times?: Array<{
    site_id: string;
    timezone: string;
    label: string;
    start_local: string;
    end_local: string;
  }>;
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

export interface Action {
  action_id: string;
  run_id: string;
  type: ActionType;
  state: ActionState;
  version: number;
  payload: ActionPayload;
  payload_hash: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  source_spans: string[];
  updated_at: string;
  last_error: string | null;
}

export interface ClarificationOption {
  id: string;
  label: string;
  value: Record<string, unknown>;
}

export interface Conflict {
  conflict_id: string;
  type: string;
  severity: 'BLOCKING' | 'WARNING';
  action_ids: string[];
  evidence: string;
  question: string | null;
  options: ClarificationOption[];
  requires_clarification: boolean;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  resolution: string | null;
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

export interface RunResult {
  run_id: string;
  step: string;
  orchestrator_notes: string[];
  validation: ValidationReport;
  actions: Action[];
  conflicts: Conflict[];
}

export interface AuditEvent {
  seq: number;
  event_type: string;
  actor: string;
  action_id: string | null;
  state_before: string | null;
  state_after: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  hash: string;
  prev_hash: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  role: string;
  site: string;
  email: string;
  can_approve: string[];
  can_approve_high_risk: boolean;
}

export interface Fixtures {
  organization: {
    org_id: string;
    name: string;
    default_timezone: string;
    sites: Array<{ id: string; city: string; tz: string }>;
    work_hours_local: { start: string; end: string };
  };
  users: CurrentUser[];
  meetings: Array<{
    id: string;
    title: string;
    date: string;
    minutes_status: string;
    document_id: string;
    notes: string[];
  }>;
  policies: {
    execution_mode: string;
    holiday_calendar: { status: string; national_holidays_for_range: unknown };
    friday_prayer_demo_block_local: { start: string; end: string; notice: string };
    approval_requirements: {
      exact_preview_fields: string[];
      identity_source: string;
      payload_binding: string;
      reject_if: string[];
      high_risk: string[];
    };
    privacy: string;
  };
  reference_now: string;
}
