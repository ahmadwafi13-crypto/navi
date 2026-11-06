/**
 * End-to-end smoke check of the NAVI pipeline against the two fixture
 * scenarios. Run with: npx tsx scripts/smoke.ts
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServer } from '../src/index.js';
import { findWorkspaceRoot, loadFixtures } from '../src/core/fixtures.js';

const ROOT = findWorkspaceRoot();
const FX = loadFixtures(ROOT);
const DB = resolve(ROOT, 'tmp/smoke.sqlite');
rmSync(DB, { force: true });
rmSync(`${DB}-wal`, { force: true });
rmSync(`${DB}-shm`, { force: true });

const REFERENCE_NOW = new Date('2026-11-06T10:00:00+07:00');

async function main() {
  const { app } = await buildServer({ dbPath: DB, referenceNow: REFERENCE_NOW });

  const login = async (userId: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      payload: { user_id: userId },
    });
    return res.json();
  };

  const maya = await login('USR-001');
  const headers = { authorization: `Bearer ${maya.api_key}` };

  const conflictText = `IDENTITAS TERAUTENTIKASI: Maya Putri (USR-001), Asia/Jakarta.
WAKTU ACUAN DEMO: Jumat, 6 November 2026 pukul 10.00 WIB.

PERMINTAAN PENGGUNA:
"Tolong kirim notulen evaluasi operasional ke Pak Budi. Jadwalkan evaluasi lanjutan Jumat depan jam setengah dua belas dengan tim Makassar, dan buat tugas untuk Sari menyelesaikan laporan minggu depan. Eh, notulen yang itu katanya belum final, jangan sampai salah kirim."`;

  const happyText = `IDENTITAS TERAUTENTIKASI: Maya Putri (USR-001), Asia/Jakarta.
WAKTU ACUAN DEMO: Jumat, 6 November 2026 pukul 10.00 WIB.

PERMINTAAN:
"Kirim notulen MTG-02 yang sudah disahkan ke Budi Santoso (USR-101) dengan subjek Ringkasan Koordinasi Tugas. Isi: Halo Budi, terlampir notulen yang sudah disahkan, mohon ditinjau. Lalu buat tugas untuk Sari Lestari (USR-103) berjudul Finalisasi checklist operasional, tenggat Selasa 10 November 2026 pukul 16.00 WIB."`;

  console.log('=== CONFLICT SCENARIO ===');
  const conflictRes = await app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers,
    payload: { text: conflictText },
  });
  const conflictRun = conflictRes.json();
  console.log('step:', conflictRun.step);
  console.log('actions:', conflictRun.actions?.length);
  for (const a of conflictRun.actions ?? []) {
    console.log(` - ${a.action_id} ${a.type} state=${a.state}`);
    console.log('   payload:', JSON.stringify(a.payload, null, 2).slice(0, 900));
  }
  console.log('conflicts:');
  for (const c of conflictRun.conflicts ?? []) {
    console.log(` - ${c.type} [${c.severity}] ${c.evidence}`);
    console.log(`   question: ${c.question}`);
    console.log(`   options: ${JSON.stringify(c.options)}`);
  }
  console.log('validation:', JSON.stringify(conflictRun.validation, null, 2));

  console.log('\n=== HAPPY PATH SCENARIO ===');
  const happyRes = await app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers,
    payload: { text: happyText },
  });
  const happyRun = happyRes.json();
  console.log('step:', happyRun.step);
  console.log('actions:', happyRun.actions?.length);
  for (const a of happyRun.actions ?? []) {
    console.log(` - ${a.action_id} ${a.type} state=${a.state} risk=${a.risk_level}`);
    console.log('   payload:', JSON.stringify(a.payload, null, 2).slice(0, 1200));
  }
  console.log('conflicts:');
  for (const c of happyRun.conflicts ?? []) {
    console.log(` - ${c.type} [${c.severity}] ${c.evidence}`);
  }
  console.log('validation:', JSON.stringify(happyRun.validation, null, 2));

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
