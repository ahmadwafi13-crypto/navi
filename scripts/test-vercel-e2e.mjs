/**
 * Full E2E test for Vercel-bundled NAVI API.
 * Tests the complete flow: login → run → clarify → preview → approve → execute → audit
 */

import { buildServer } from '../.vercel-output/api-server.mjs';
import { createHash } from 'node:crypto';

async function main() {
  const { app, db } = await buildServer({ dbPath: ':memory:' });

  let pass = 0, fail = 0;
  function check(label, cond) {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}`); }
  }

  // 1. Login
  console.log('\n=== 1. Login ===');
  let res = await app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ user_id: 'USR-001' }),
  });
  check('Login 200', res.statusCode === 200);
  const session = JSON.parse(res.body);
  const apiKey = session.api_key;
  const authHeader = { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' };
  console.log(`  User: ${session.user.name} (${session.user.id})`);

  // 2. Run pipeline with ambiguous contact
  console.log('\n=== 2. Run Pipeline (Ambiguous) ===');
  res = await app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers: authHeader,
    payload: JSON.stringify({ text: 'Kirim email ke Budi besok jam 9 pagi tentang laporan keuangan' }),
  });
  check('Run 200', res.statusCode === 200);
  const run = JSON.parse(res.body);
  check('Step AWAITING_CLARIFICATION', run.step === 'AWAITING_CLARIFICATION');
  check('Has blocking conflict', run.conflicts.some(c => c.severity === 'BLOCKING'));
  const conflict = run.conflicts.find(c => c.severity === 'BLOCKING');
  console.log(`  Conflict: ${conflict?.type} - ${conflict?.question}`);
  console.log(`  Actions: ${run.actions.length}`);

  // 3. Resolve clarification
  console.log('\n=== 3. Resolve Clarification ===');
  const option = conflict.options[0];
  res = await app.inject({
    method: 'POST',
    url: `/v1/runs/${run.run_id}/clarifications`,
    headers: authHeader,
    payload: JSON.stringify({ conflict_id: conflict.conflict_id, option_id: option.id }),
  });
  check('Clarify 200', res.statusCode === 200);
  const clarified = JSON.parse(res.body);
  check('Step AWAITING_APPROVAL', clarified.step === 'AWAITING_APPROVAL');
  check('Actions exist', clarified.actions.length > 0);

  // 4. Preview action
  console.log('\n=== 4. Preview Action ===');
  const action = clarified.actions[0];
  res = await app.inject({
    method: 'GET',
    url: `/v1/actions/${action.action_id}/preview`,
    headers: authHeader,
  });
  check('Preview 200', res.statusCode === 200);
  const preview = JSON.parse(res.body);
  check('State AWAITING_APPROVAL', preview.state === 'AWAITING_APPROVAL');
  console.log(`  Type: ${preview.type}, Risk: ${preview.risk_level}`);
  console.log(`  Payload hash: ${preview.payload_hash.substring(0, 16)}...`);

  // 5. Approve action
  console.log('\n=== 5. Approve Action ===');
  res = await app.inject({
    method: 'POST',
    url: `/v1/actions/${action.action_id}/decision`,
    headers: authHeader,
    payload: JSON.stringify({ decision: 'APPROVE' }),
  });
  check('Approve 200', res.statusCode === 200);
  const approval = JSON.parse(res.body);
  check('Approval APPROVED', approval.decision === 'APPROVED');
  console.log(`  Approval ID: ${approval.approval_id}`);

  // 6. Execute via gateway
  console.log('\n=== 6. Execute via Gateway ===');
  const idempotencyKey = createHash('sha256').update(`${action.action_id}-${Date.now()}`).digest('hex');
  res = await app.inject({
    method: 'POST',
    url: '/internal/execute',
    headers: authHeader,
    payload: JSON.stringify({ action_id: action.action_id, idempotency_key: idempotencyKey }),
  });
  check('Execute 200', res.statusCode === 200);
  const execution = JSON.parse(res.body);
  check('Status SUCCEEDED', execution.status === 'SUCCEEDED');
  console.log(`  Execution ID: ${execution.execution_id}`);
  console.log(`  Receipt: ${execution.receipt}`);

  // 7. Audit trail
  console.log('\n=== 7. Audit Trail ===');
  res = await app.inject({
    method: 'GET',
    url: `/v1/runs/${run.run_id}/audit`,
    headers: authHeader,
  });
  check('Audit 200', res.statusCode === 200);
  const audit = JSON.parse(res.body);
  check('Has events', audit.events.length > 0);
  console.log(`  Events: ${audit.events.length}`);
  audit.events.forEach(e => {
    console.log(`    [${e.seq}] ${e.event_type} by ${e.actor}`);
  });

  // 8. Verify audit chain
  console.log('\n=== 8. Verify Audit Chain ===');
  res = await app.inject({
    method: 'GET',
    url: '/v1/audit/verify',
    headers: authHeader,
  });
  check('Verify 200', res.statusCode === 200);
  const verify = JSON.parse(res.body);
  check('Chain OK', verify.ok === true);
  check('No break', verify.brokenAt === null);

  // 9. Deny-by-default: execute without approval (different action)
  console.log('\n=== 9. Deny-by-default (no approval) ===');
  res = await app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers: authHeader,
    payload: JSON.stringify({ text: 'Buat task untuk Sari tentang revisi dokumen besok' }),
  });
  const run2 = JSON.parse(res.body);
  if (run2.actions.length > 0) {
    const action2 = run2.actions[0];
    res = await app.inject({
      method: 'POST',
      url: '/internal/execute',
      headers: authHeader,
      payload: JSON.stringify({ action_id: action2.action_id, idempotency_key: 'test-no-approval' }),
    });
    check('Execute blocked', res.statusCode !== 200 || JSON.parse(res.body).status === 'BLOCKED');
    const execResult = JSON.parse(res.body);
    console.log(`  Status: ${execResult.status}, Reason: ${execResult.reason || 'N/A'}`);
  } else {
    console.log('  (No actions in run2, skipping deny test)');
  }

  // Summary
  console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
