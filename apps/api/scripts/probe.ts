/** Throwaway probe to empirically confirm suspected bugs. Not part of the suite. */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServer } from '../src/index.js';
import { findWorkspaceRoot } from '../src/core/fixtures.js';

const ROOT = findWorkspaceRoot();
const DB = resolve(ROOT, 'tmp/navi-probe.sqlite');
for (const s of ['', '-wal', '-shm']) rmSync(`${DB}${s}`, { force: true });

const REFERENCE_NOW = new Date('2026-11-06T10:00:00+07:00');

async function main(): Promise<void> {
  const { app } = await buildServer({ dbPath: DB, referenceNow: REFERENCE_NOW });
  const login = async (u: string) =>
    (await app.inject({ method: 'POST', url: '/v1/auth/session', payload: { user_id: u } })).json()
      .api_key as string;
  const maya = await login('USR-001');
  const H = { authorization: `Bearer ${maya}` };
  const run = async (text: string) =>
    (await app.inject({ method: 'POST', url: '/v1/runs', headers: H, payload: { text } })).json();

  console.log('\n=== PROBE 1: clarification clears a validator error (OUTSIDE_BUSINESS_HOURS) ===');
  // Friday 13 Nov 2026 08.00 WIB -> outside business hours (09:00-17:00)
  const r1 = await run('Jadwalkan rapat Evaluasi Lanjutan Jumat 13 November 2026 jam 08.00 dengan tim Jakarta.');
  const cal1 = r1.actions.find((a: any) => a.type === 'calendar.create');
  console.log('validation.pass =', r1.validation.pass, '| errors =', r1.validation.errors);
  console.log('action.state =', cal1.state);
  // Answer a clarification that has nothing to do with the business-hours error.
  const uncertain = r1.conflicts.find((c: any) => c.type === 'UNCERTAIN_TIME');
  console.log('UNCERTAIN_TIME conflict present?', Boolean(uncertain));
  if (uncertain) {
    const res = await app.inject({
      method: 'POST', url: `/v1/runs/${r1.run_id}/clarifications`, headers: H,
      payload: { conflict_id: uncertain.conflict_id, option_id: uncertain.options[0]?.id },
    });
    console.log('clarification status =', res.statusCode);
    const after = res.json().actions.find((a: any) => a.action_id === cal1.action_id);
    console.log('action.state AFTER clarification =', after.state);
    const appr = await app.inject({
      method: 'POST', url: `/v1/actions/${cal1.action_id}/decision`, headers: H,
      payload: { decision: 'APPROVE' },
    });
    console.log('APPROVE status =', appr.statusCode, JSON.stringify(appr.json()).slice(0, 200));
  }

  console.log('\n=== PROBE 2: clarification does not refresh recipient_emails ===');
  const r2 = await run('Tolong kirim notulen evaluasi operasional ke Pak Budi. Jadwalkan rapat Kamis 12 November 2026 jam 10.00 dengan tim Jakarta.');
  const email2 = r2.actions.find((a: any) => a.type === 'email.create');
  console.log('BEFORE payload.recipient_ids =', JSON.stringify(email2.payload.recipient_ids));
  console.log('BEFORE payload.recipient_emails =', JSON.stringify(email2.payload.recipient_emails));
  const amb = r2.conflicts.find((c: any) => c.type === 'AMBIGUOUS_CONTACT');
  const cl = await app.inject({
    method: 'POST', url: `/v1/runs/${r2.run_id}/clarifications`, headers: H,
    payload: { conflict_id: amb.conflict_id, option_id: 'USR-101' },
  });
  const after2 = cl.json().actions.find((a: any) => a.action_id === email2.action_id);
  console.log('AFTER payload.recipient_ids   =', JSON.stringify(after2.payload.recipient_ids));
  console.log('AFTER payload.recipient_emails =', JSON.stringify(after2.payload.recipient_emails), '<-- STALE?');
  const prev = await app.inject({ method: 'GET', url: `/v1/actions/${email2.action_id}/preview`, headers: H });
  console.log('PREVIEW recipient_emails =', JSON.stringify(prev.json().payload.recipient_emails));
  await app.inject({ method: 'POST', url: `/v1/actions/${email2.action_id}/decision`, headers: H, payload: { decision: 'APPROVE' } });
  const ex = await app.inject({ method: 'POST', url: '/internal/execute', headers: H, payload: { action_id: email2.action_id, idempotency_key: 'probe2' } });
  console.log('EXEC status =', ex.statusCode, 'receipt.recipient_emails =', JSON.stringify(ex.json().receipt?.details?.recipient_emails));

  console.log('\n=== PROBE 3: REJECT after SUCCEEDED flips state (illegal transition) ===');
  const rej = await app.inject({ method: 'POST', url: `/v1/actions/${email2.action_id}/decision`, headers: H, payload: { decision: 'REJECT' } });
  console.log('REJECT status =', rej.statusCode);
  const { openDatabase } = await import('../src/db/index.js');
  const db = openDatabase(DB);
  const row = db.prepare('SELECT state FROM actions WHERE action_id = ?').get(email2.action_id) as any;
  console.log('action.state after rejecting an already-EXECUTED action =', row.state);

  console.log('\n=== PROBE 4: REJECT by a user with no approval capability ===');
  const sari = await login('USR-103');
  const r4 = await run('Kirim notulen MTG-02 ke Budi Santoso (USR-101) dengan subjek Uji. Isi: Halo Budi.');
  const a4 = r4.actions.find((a: any) => a.type === 'email.create');
  const rej4 = await app.inject({ method: 'POST', url: `/v1/actions/${a4.action_id}/decision`, headers: { authorization: `Bearer ${sari}` }, payload: { decision: 'REJECT' } });
  console.log('Sari (staf, no can_approve) REJECT status =', rej4.statusCode, JSON.stringify(rej4.json()).slice(0, 160));

  console.log('\n=== PROBE 5: EXECUTION_BLOCKED event emitted for a successful execution ===');
  const r5 = await run('Kirim notulen MTG-02 ke Budi Santoso (USR-101) dengan subjek Uji5. Isi: Halo Budi.');
  const a5 = r5.actions.find((a: any) => a.type === 'email.create');
  await app.inject({ method: 'POST', url: `/v1/actions/${a5.action_id}/decision`, headers: H, payload: { decision: 'APPROVE' } });
  await app.inject({ method: 'POST', url: '/internal/execute', headers: H, payload: { action_id: a5.action_id, idempotency_key: 'probe5' } });
  const aud = await app.inject({ method: 'GET', url: `/v1/runs/${r5.run_id}/audit`, headers: H });
  for (const e of aud.json().events.filter((e: any) => ['EXECUTION_BLOCKED', 'MOCK_EXECUTED'].includes(e.event_type))) {
    console.log(' event:', e.event_type, '| state', e.state_before, '->', e.state_after, '|', JSON.stringify(e.metadata).slice(0, 120));
  }

  console.log('\n=== PROBE 6: stated origin timezone ignored (10.00 WITA) ===');
  const r6 = await run('Jadwalkan rapat Evaluasi Lanjutan Kamis 12 November 2026 jam 10.00 WITA dengan tim Makassar.');
  const cal6 = r6.actions.find((a: any) => a.type === 'calendar.create');
  console.log('start_date =', cal6.payload.start_date, 'start_time =', cal6.payload.start_time, 'tz =', cal6.payload.timezone);
  console.log('start_at (UTC instant) =', cal6.payload.start_at, '<- should be 02:00Z for 10.00 WITA');
  console.log('participant_local_times =', JSON.stringify(cal6.payload.participant_local_times));

  console.log('\n=== PROBE 7: clarification accepts an arbitrary unknown user_id ===');
  const r7 = await run('Tolong kirim notulen evaluasi operasional ke Pak Budi.');
  const amb7 = r7.conflicts.find((c: any) => c.type === 'AMBIGUOUS_CONTACT');
  const cl7 = await app.inject({
    method: 'POST', url: `/v1/runs/${r7.run_id}/clarifications`, headers: H,
    payload: { conflict_id: amb7.conflict_id, value: { user_id: 'USR-999' } },
  });
  console.log('status =', cl7.statusCode);
  const a7 = cl7.json().actions?.find((a: any) => a.type === 'email.create');
  console.log('recipient_ids =', JSON.stringify(a7?.payload?.recipient_ids), '(USR-999 is not a real user)');

  console.log('\n=== PROBE 8: manager_approval_id not bound to the action ===');
  const r8 = await run('Kirim notulen MTG-02 ke Budi Santoso (USR-101) dengan subjek Uji8. Isi: Halo Budi.');
  const a8 = r8.actions.find((a: any) => a.type === 'email.create');
  db.prepare('UPDATE actions SET risk_level = ? WHERE action_id = ?').run('HIGH', a8.action_id);
  const dina = await login('USR-200');
  const dinaH = { authorization: `Bearer ${dina}` };
  // Dina has can_approve_high_risk but no can_approve -> can she create an approval?
  const dinaAppr = await app.inject({ method: 'POST', url: `/v1/actions/${a8.action_id}/decision`, headers: dinaH, payload: { decision: 'APPROVE' } });
  console.log('Dina approves (has only can_approve_high_risk):', dinaAppr.statusCode, JSON.stringify(dinaAppr.json()).slice(0, 200));
  db.close();
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
