import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServer } from '../src/index.js';
import { findWorkspaceRoot } from '../src/core/fixtures.js';
import { splitClauses } from '../src/agents/text-utils.js';

const ROOT = findWorkspaceRoot();
const DB = resolve(ROOT, 'tmp/navi-probe3.sqlite');
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

  console.log('\n=== PROBE 13: splitClauses breaks on the dot inside an email address ===');
  const t = 'Kirim notulen MTG-02 ke Budi Santoso (USR-101) dan klien.luar@mitra-contoh.com dengan subjek Uji. Isi: Halo.';
  for (const c of splitClauses(t)) console.log('  clause:', JSON.stringify(c.text));

  console.log('\n=== PROBE 14: single internal + single external recipient -> HIGH risk? ===');
  const r = await run(t);
  console.log('validation.pass =', r.validation.pass);
  console.log('validation.errors =', r.validation.errors);
  console.log('validation.reason_codes =', r.validation.reason_codes);
  console.log('validation.risk_level =', r.validation.risk_level);
  const email = r.actions.find((a: any) => a.type === 'email.create');
  console.log('action.risk_level =', email.risk_level, '| state =', email.state);
  console.log('payload.recipient_ids =', JSON.stringify(email.payload.recipient_ids));
  console.log('payload.recipient_emails =', JSON.stringify(email.payload.recipient_emails));
  console.log('conflicts =', r.conflicts.map((c: any) => c.type).join(', '));

  console.log('\n=== PROBE 15: TC19-style bulk (6 internal + external) - what makes it HIGH? ===');
  const many = ['Budi Santoso (USR-101)','Sari Lestari (USR-103)','Rahmat Hidayat (USR-104)','Ayu Wati (USR-105)','Dina Utami (USR-200)','Maya Putri (USR-001)','klien.luar@mitra-contoh.com'].join(', ');
  const r2 = await run(`Kirim notulen MTG-02 ke ${many} dengan subjek Massal. Isi: Halo.`);
  console.log('reason_codes =', r2.validation.reason_codes, '| risk =', r2.validation.risk_level);
  console.log('=> HIGH came from HIGH_RISK_BULK (>5), NOT from external recipient detection');
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
