import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServer } from '../src/index.js';
import { findWorkspaceRoot } from '../src/core/fixtures.js';

const ROOT = findWorkspaceRoot();
const DB = resolve(ROOT, 'tmp/navi-probe2.sqlite');
for (const s of ['', '-wal', '-shm']) rmSync(`${DB}${s}`, { force: true });
const REFERENCE_NOW = new Date('2026-11-06T10:00:00+07:00');

async function main(): Promise<void> {
  const { app } = await buildServer({ dbPath: DB, referenceNow: REFERENCE_NOW });
  const login = async (u: string) =>
    (await app.inject({ method: 'POST', url: '/v1/auth/session', payload: { user_id: u } })).json().api_key as string;
  const maya = await login('USR-001');
  const H = { authorization: `Bearer ${maya}` };
  const run = async (text: string) =>
    (await app.inject({ method: 'POST', url: '/v1/runs', headers: H, payload: { text } })).json();

  console.log('\n=== PROBE 9: AMBIGUOUS_CONTACT clarification rewrites EVERY action in the run ===');
  const TEXT =
    'Tolong kirim notulen evaluasi operasional ke Pak Budi. Jadwalkan evaluasi lanjutan Jumat depan jam setengah dua belas dengan tim Makassar, dan buat tugas untuk Sari menyelesaikan laporan minggu depan.';
  const r = await run(TEXT);
  for (const a of r.actions) {
    console.log(` BEFORE ${a.type.padEnd(16)} recipient_ids=${JSON.stringify(a.payload.recipient_ids)} state=${a.state}`);
  }
  const amb = r.conflicts.find((c: any) => c.type === 'AMBIGUOUS_CONTACT');
  const cl = await app.inject({
    method: 'POST', url: `/v1/runs/${r.run_id}/clarifications`, headers: H,
    payload: { conflict_id: amb.conflict_id, option_id: 'USR-101' },
  });
  for (const a of cl.json().actions) {
    console.log(` AFTER  ${a.type.padEnd(16)} recipient_ids=${JSON.stringify(a.payload.recipient_ids)} state=${a.state} subject=${JSON.stringify(a.payload.subject_or_title)}`);
  }

  console.log('\n=== PROBE 10: validator errors are dropped when an unrelated clarification is answered ===');
  const TEXT2 =
    'Kirim notulen MTG-02 ke Sari Lestari (USR-103) dan klien.luar@mitra-contoh.com dengan subjek Ekst. Isi: Halo. Jadwalkan rapat Evaluasi Lanjutan Jumat 13 November 2026 jam 13.30 dengan tim Jakarta.';
  const r2 = await run(TEXT2);
  console.log('validation.pass =', r2.validation.pass);
  console.log('validation.errors =', r2.validation.errors);
  const email2 = r2.actions.find((a: any) => a.type === 'email.create');
  const cal2 = r2.actions.find((a: any) => a.type === 'calendar.create');
  console.log('email.state =', email2.state, '| cal.state =', cal2.state);
  // Find any resolvable conflict and answer it.
  const resolvable = r2.conflicts.find((c: any) => c.options && c.options.length > 0);
  console.log('resolvable conflict:', resolvable?.type);
  if (resolvable) {
    const cl2 = await app.inject({
      method: 'POST', url: `/v1/runs/${r2.run_id}/clarifications`, headers: H,
      payload: { conflict_id: resolvable.conflict_id, option_id: resolvable.options[0].id },
    });
    console.log('clarification status =', cl2.statusCode);
    for (const a of cl2.json().actions) {
      console.log(` AFTER ${a.type.padEnd(16)} state=${a.state}`);
    }
    const appr = await app.inject({ method: 'POST', url: `/v1/actions/${email2.action_id}/decision`, headers: H, payload: { decision: 'APPROVE' } });
    console.log('APPROVE external-recipient email ->', appr.statusCode, JSON.stringify(appr.json()).slice(0, 140));
    if (appr.statusCode === 200) {
      const ex = await app.inject({ method: 'POST', url: '/internal/execute', headers: H, payload: { action_id: email2.action_id, idempotency_key: 'probe10' } });
      console.log('EXECUTE external-recipient email ->', ex.statusCode, JSON.stringify(ex.json().receipt?.details?.recipient_emails));
    }
  }

  console.log('\n=== PROBE 11: preview hides the external recipient entirely ===');
  const prev = await app.inject({ method: 'GET', url: `/v1/actions/${email2.action_id}/preview`, headers: H });
  console.log('preview payload =', JSON.stringify(prev.json().payload, null, 1));

  console.log('\n=== PROBE 12: high-risk manager approval is unreachable (no user has both caps) ===');
  const r12 = await run('Kirim notulen MTG-02 ke ' + ['Budi Santoso (USR-101)','Sari Lestari (USR-103)','Rahmat Hidayat (USR-104)','Ayu Wati (USR-105)','Dina Utami (USR-200)','Maya Putri (USR-001)'].join(', ') + ' dengan subjek Massal. Isi: Halo.');
  const a12 = r12.actions.find((a: any) => a.type === 'email.create');
  console.log('risk_level =', a12.risk_level, '| state =', a12.state, '| run.step =', r12.step);
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
