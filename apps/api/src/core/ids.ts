import { randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

export function newRunId(): string {
  return newId('RUN');
}

export function newActionId(): string {
  return newId('ACT');
}

export function newApprovalId(): string {
  return newId('APR');
}

export function newExecutionId(): string {
  return newId('EXE');
}

export function newConflictId(): string {
  return newId('CFL');
}

export function newSessionId(): string {
  return newId('SES');
}
