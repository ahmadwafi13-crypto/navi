/**
 * NAVI Agent 1/4 - ORCHESTRATOR
 *
 * Contract (docs/WORKFLOW_CONTRACT.md):
 *   Input : RunInput
 *   Output: RunState, next_step
 *
 * Boundary: the Orchestrator has NO execution tools. It cannot approve on
 * behalf of a human and it cannot reach email/calendar/task systems. It only
 * decides what happens next: interpret -> detect -> validate -> clarify or
 * preview.
 */

import type { AgentOutput, Conflict, RunInput } from '../core/types.js';

export const ORCHESTRATOR_SCHEMA_VERSION = '1.0.0';

export type RunStep =
  | 'RECEIVED'
  | 'INTERPRETED'
  | 'CONFLICTS_DETECTED'
  | 'VALIDATED'
  | 'AWAITING_CLARIFICATION'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED';

export interface RunState {
  run_id: string;
  step: RunStep;
  next_step: RunStep;
  requires_human_approval: boolean;
  action_count: number;
  blocking_conflicts: number;
  warnings: string[];
}

export interface OrchestratorDecision {
  next_step: RunStep;
  requires_human_approval: boolean;
  notes: string[];
}

/**
 * Decide the next step given the current pipeline results.
 * Pure function - no I/O, no side effects, no execution capability.
 */
export function decideNextStep(input: {
  actionCount: number;
  conflicts: Conflict[];
  validationPassed: boolean;
  hasBlockingClarification: boolean;
}): OrchestratorDecision {
  const notes: string[] = [];

  if (input.actionCount === 0) {
    notes.push(
      'Tidak ada aksi yang dapat dikenali dari instruksi. Nada WhatsApp untuk lalu lanjut atau clarify manual.',
    );
    return { next_step: 'AWAITING_CLARIFICATION', requires_human_approval: false, notes };
  }

  const blocking = input.conflicts.filter(
    (c) => c.severity === 'BLOCKING' && c.requires_clarification,
  );

  if (blocking.length > 0) {
    notes.push(
      `${blocking.length} konflik blocking membutuhkan klarifikasi sebelum preview siap.`,
    );
    return { next_step: 'AWAITING_CLARIFICATION', requires_human_approval: false, notes };
  }

  if (!input.validationPassed) {
    notes.push('Validasi gagal. Aksi ditahan, tidak ada yang dapat disetujui.');
    return { next_step: 'AWAITING_CLARIFICATION', requires_human_approval: false, notes };
  }

  notes.push(
    'Rencana siap. Menunggu persetujuan manusia per aksi. Tidak ada eksekusi otomatis.',
  );
  return { next_step: 'AWAITING_APPROVAL', requires_human_approval: true, notes };
}

export function buildRunState(
  runInput: RunInput,
  decision: OrchestratorDecision,
  conflicts: Conflict[],
): AgentOutput<RunState> {
  const started = Date.now();
  const blocking = conflicts.filter((c) => c.severity === 'BLOCKING');
  return {
    agent_id: 'A1-Orchestrator',
    run_id: runInput.run_id,
    schema_version: ORCHESTRATOR_SCHEMA_VERSION,
    data: {
      run_id: runInput.run_id,
      step: 'RECEIVED',
      next_step: decision.next_step,
      requires_human_approval: decision.requires_human_approval,
      action_count: 0,
      blocking_conflicts: blocking.length,
      warnings: decision.notes,
    },
    warnings: decision.notes,
    source_spans: [],
    elapsed_ms: Date.now() - started,
  };
}
