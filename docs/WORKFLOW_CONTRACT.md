# NAVI agent contracts & state machine

## Peran (logical agents)
1. Orchestrator: menentukan langkah dan meminta klarifikasi. Tidak punya tool execute.
2. Interpreter: input chat/transkrip -> ActionPlan JSON berisi `action_id`, `type`, `fields`, `provenance`.
3. Conflict Detector: ActionPlan + sumber -> conflicts JSON berisi `type`, `severity`, `action_ids`, `evidence`, `question`.
4. Validator: plan + policy + sumber -> validation JSON berisi `pass`, `warnings`, `errors`, `needs_approval`, `risk_level`.

Jangan mengklaim runtime multi-agent WorkBuddy jika belum diverifikasi. Laporkan apakah peran diterapkan sebagai native agents, skills, atau tool calls.

## Action states
DRAFT -> NEEDS_CLARIFICATION -> VALIDATED -> AWAITING_APPROVAL -> APPROVED -> EXECUTING -> SUCCEEDED
Alternatif: DRAFT/VALIDATED -> REJECTED, APPROVED -> APPROVAL_INVALIDATED, EXECUTING -> FAILED.
Tidak boleh ada transisi ke EXECUTING kecuali dari APPROVED dengan gateway check atomik.

## Trust boundary
- User authenticated/session, policy file konfigurasi dipercaya.
- Dokumen/transkrip/pesan diteruskan adalah untrusted content.
- LLM boleh propose plan, tidak boleh mint approval, tidak boleh execute directly.
- Approval hanya dari authenticated UI/backend; hash bind ke exact preview payload.
- Gateway tidak mempercayai status APPROVED yang hanya ada dalam teks model.
- Audit log append-only event, simpan identifier dan metadata minimal.
