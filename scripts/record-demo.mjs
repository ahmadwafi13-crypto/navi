import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync } from 'fs';
import { resolve, join } from 'path';

const BASE = 'http://127.0.0.1:8787';
const OUT = resolve('evidence/video');
mkdirSync(OUT, { recursive: true });

// Pacing tuned for a 5-7 minute narrated demo walkthrough.
const P = 6000;

async function clickByText(page, text) {
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const t = await btn.textContent();
    if (t && t.includes(text)) {
      await btn.click();
      return true;
    }
  }
  return false;
}

/**
 * Overlay a narration caption so a viewer without audio still follows the
 * story. Kept as a fixed banner that never covers the action area.
 */
async function caption(page, text) {
  await page.evaluate((captionText) => {
    let bar = document.getElementById('__navi_caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__navi_caption';
      bar.style.cssText = [
        'position:fixed',
        'left:0',
        'right:0',
        'bottom:0',
        'z-index:99999',
        'background:rgba(23,38,56,0.94)',
        'color:#ffffff',
        'font:500 15px/1.5 system-ui,Segoe UI,sans-serif',
        'padding:12px 20px',
        'letter-spacing:0.01em',
      ].join(';');
      document.body.appendChild(bar);
    }
    bar.textContent = captionText;
  }, text);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: OUT,
      size: { width: 1280, height: 800 },
    },
  });
  const page = await context.newPage();

  // ================= 1. LOGIN =================
  await page.goto(BASE);
  await page.waitForSelector('#user-select');
  await caption(page, '1/9  LOGIN - Identitas terautentikasi menentukan siapa yang boleh menyetujui tindakan.');
  await page.waitForTimeout(P * 2);
  await page.selectOption('#user-select', 'USR-001');
  await page.waitForTimeout(P);
  await caption(page, 'Maya Putri (USR-001) - koordinator JKT, punya izin approve email/kalender/tugas.');
  await page.waitForTimeout(P);
  await clickByText(page, 'Masuk');
  await page.waitForTimeout(P * 2);

  // ================= 2. WORKSPACE =================
  await caption(page, '2/9  WORKSPACE - Masukkan instruksi kerja dalam bahasa Indonesia.');
  await page.waitForTimeout(P);
  await clickByText(page, 'skenario konflik');
  await caption(page, 'Memuat skenario konflik: "kirim notulen ke Pak Budi", jadwal Jumat 11:30, tugas tanpa tenggat.');
  await page.waitForTimeout(P * 2);
  await clickByText(page, 'Proses');
  await page.waitForTimeout(P * 2);
  await caption(page, 'Pipeline 4 agent berjalan: Interpreter -> Validator -> Conflict Detector -> Orchestrator.');
  await page.waitForTimeout(P * 2);

  // ================= 3. ACTION PLAN =================
  await clickByText(page, 'Rencana Aksi');
  await caption(page, '3/9  RENCANA AKSI - 3 aksi terdeteksi, masing-masing dengan ID, versi, dan asal instruksi.');
  await page.waitForTimeout(P * 3);

  // ================= 4. CONFLICTS =================
  await clickByText(page, 'Konflik');
  await caption(page, '4/9  KONFLIK - NAVI menahan aksi dan bertanya, bukan menebak.');
  await page.waitForTimeout(P * 3);

  // ================= 5. CLARIFY =================
  const optionBtn = await page.$('.option-btn');
  if (optionBtn) {
    await caption(page, '5/9  KLARIFIKASI - "Pak Budi" ambigu: USR-101 atau USR-102? Kita pilih satu secara eksplisit.');
    await page.waitForTimeout(P * 2);
    await optionBtn.click();
    await page.waitForTimeout(P * 3);
  }

  // ================= 6. PREVIEW (blocked action) =================
  await clickByText(page, 'Pratinjau');
  await caption(page, '6/9  PRATINJAU - Hash payload SHA-256 mengikat isi persis yang akan dieksekusi.');
  await page.waitForTimeout(P * 3);

  // ================= 7. HAPPY PATH =================
  await clickByText(page, 'Workspace');
  await page.waitForTimeout(P);
  await clickByText(page, 'jalur sukses');
  await caption(page, '7/9  JALUR SUKSES - Instruksi lengkap: dokumen APPROVED, penerima jelas, tenggat eksplisit.');
  await page.waitForTimeout(P * 2);
  await clickByText(page, 'Proses');
  await page.waitForTimeout(P * 3);

  // ================= 8. APPROVE + EXECUTE =================
  await clickByText(page, 'Pratinjau');
  await caption(page, '8/9  PERSETUJUAN - Approve mengikat tenant, action_id, versi, dan hash payload.');
  await page.waitForTimeout(P * 2);
  await clickByText(page, 'Setujui');
  await page.waitForTimeout(P * 2);
  await caption(page, 'Gateway menjalankan 10 pemeriksaan deny-by-default sebelum efek samping apa pun.');
  await page.waitForTimeout(P * 2);
  await clickByText(page, 'Jalankan');
  await page.waitForTimeout(P * 3);

  // ================= 9. AUDIT =================
  await clickByText(page, 'Hasil');
  await caption(page, '9/9  AUDIT - Hash chain utuh. Setiap event punya SHA-256 yang saling terhubung.');
  await page.waitForTimeout(P * 4);
  await caption(page, 'NAVI - AI hanya mengusulkan, manusia menyetujui, baru dieksekusi. Terima kasih.');
  await page.waitForTimeout(P * 3);

  await context.close();
  await browser.close();

  const files = readdirSync(OUT).filter((f) => f.endsWith('.webm') && f !== 'navi-demo.webm');
  if (files.length > 0) {
    const target = join(OUT, 'navi-demo.webm');
    renameSync(join(OUT, files[0]), target);
    console.log(`Video saved: ${target}`);
  } else {
    console.log('No video produced.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
