/**
 * Mock connectors for email / calendar / task.
 *
 * These are the ONLY components in NAVI that write side effects, and they
 * write to the local SQLite state - never to a real mail server, a real
 * calendar, or a real task tracker (AC20, PRD 4.2 "mock.email/calendar/task").
 *
 * AC13: "Tool mock menulis hasil nyata ke state database, bukan respons success
 * palsu." Every mock tool inserts a real row and returns a receipt referencing
 * that row.
 */

import type { Db } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ActionPayload } from '../core/types.js';

export interface ToolReceipt {
  receipt_id: string;
  tool: 'mock.email' | 'mock.calendar' | 'mock.task';
  provider: 'NAVI_MOCK';
  simulated: true;
  created_at: string;
  details: Record<string, unknown>;
}

export interface MockEmailInput {
  run_id: string;
  action_id: string;
  payload: ActionPayload;
  recipientEmails: string[];
}

export interface MockCalendarInput {
  run_id: string;
  action_id: string;
  payload: ActionPayload;
  participantIds: string[];
}

export interface MockTaskInput {
  run_id: string;
  action_id: string;
  payload: ActionPayload;
  assigneeId: string;
}

function receipt(tool: ToolReceipt['tool'], details: Record<string, unknown>): ToolReceipt {
  return {
    receipt_id: `RCPT-${tool.replace('.', '-').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    tool,
    provider: 'NAVI_MOCK',
    simulated: true,
    created_at: nowIso(),
    details,
  };
}

export function mockEmail(db: Db, input: MockEmailInput): ToolReceipt {
  const id = `MOCK-MAIL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
    Math.random() * 1000,
  )}`;
  db.prepare(
    `INSERT INTO mock_email_messages
      (id, run_id, action_id, recipient_ids, recipient_emails, subject, body, attachments, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.run_id,
    input.action_id,
    JSON.stringify(input.payload.recipient_ids),
    JSON.stringify(input.recipientEmails),
    input.payload.subject_or_title ?? '',
    input.payload.full_body_or_description ?? '',
    JSON.stringify(input.payload.attachments),
    nowIso(),
  );
  return receipt('mock.email', {
    mock_message_id: id,
    subject: input.payload.subject_or_title,
    recipient_emails: input.recipientEmails,
    attachment_count: input.payload.attachments.length,
    note: 'Simulasi. Tidak ada email sungguhan yang dikirim.',
  });
}

export function mockCalendar(db: Db, input: MockCalendarInput): ToolReceipt {
  const id = `MOCK-CAL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
    Math.random() * 1000,
  )}`;
  db.prepare(
    `INSERT INTO mock_calendar_events
      (id, run_id, action_id, title, start_at, end_at, timezone, location, participant_ids, description, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.run_id,
    input.action_id,
    input.payload.subject_or_title ?? '',
    input.payload.start_at ?? '',
    input.payload.end_at ?? '',
    input.payload.timezone ?? 'Asia/Jakarta',
    input.payload.location,
    JSON.stringify(input.participantIds),
    input.payload.full_body_or_description,
    nowIso(),
  );
  return receipt('mock.calendar', {
    mock_event_id: id,
    title: input.payload.subject_or_title,
    start_at: input.payload.start_at,
    end_at: input.payload.end_at,
    timezone: input.payload.timezone,
    participant_count: input.participantIds.length,
    note: 'Simulasi. Tidak ada kalender sungguhan yang diubah.',
  });
}

export function mockTask(db: Db, input: MockTaskInput): ToolReceipt {
  const id = `MOCK-TASK-${Date.now().toString(36).toUpperCase()}-${Math.floor(
    Math.random() * 1000,
  )}`;
  db.prepare(
    `INSERT INTO mock_tasks
      (id, run_id, action_id, assignee_id, title, description, due_at, due_timezone, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.run_id,
    input.action_id,
    input.assigneeId,
    input.payload.subject_or_title ?? '',
    input.payload.full_body_or_description ?? null,
    input.payload.due_at ?? null,
    input.payload.due_timezone ?? null,
    nowIso(),
  );
  return receipt('mock.task', {
    mock_task_id: id,
    title: input.payload.subject_or_title,
    assignee_id: input.assigneeId,
    due_at: input.payload.due_at,
    note: 'Simulasi. Tidak ada sistem tugas sungguhan yang diubah.',
  });
}

/**
 * Deliberate failure injector used by TC17 ("Mock calendar gagal satu kali").
 * Enabled only when NAVI_FAIL_TOOL matches the tool name, so the happy path
 * never fails by accident.
 */
export function shouldFail(tool: string): boolean {
  const configured = process.env.NAVI_FAIL_TOOL;
  return Boolean(configured && configured === tool);
}
