import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const BASE = 'http://127.0.0.1:8787';
const OUT = resolve('evidence/screenshots');
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // ===== 1. Login page =====
  console.log('1. Login page...');
  await page.goto(BASE);
  await page.waitForSelector('#user-select');
  await page.screenshot({ path: join(OUT, '01-login.png'), fullPage: true });

  // ===== 2. Login as Maya (USR-001) =====
  console.log('2. Logging in as Maya...');
  await page.selectOption('#user-select', 'USR-001');
  await page.click('button.btn-primary');
  await page.waitForSelector('.nav-rail, .pane-inner, nav', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, '02-workspace-empty.png'), fullPage: true });

  // ===== 3. Load conflict scenario =====
  console.log('3. Loading conflict scenario...');
  // Find and click "Muat skenario konflik"
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await btn.textContent();
    if (text && text.includes('skenario konflik')) {
      await btn.click();
      break;
    }
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, '03-workspace-conflict-loaded.png'), fullPage: true });

  // ===== 4. Process instruction =====
  console.log('4. Processing instruction...');
  const processBtn = await page.$('button.btn-primary');
  if (processBtn) {
    const text = await processBtn.textContent();
    if (text && text.includes('Proses')) {
      await processBtn.click();
    }
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, '04-conflict-results.png'), fullPage: true });

  // ===== 5. Action Plan tab =====
  console.log('5. Action plan tab...');
  // Try to find and click "Rencana Aksi" tab
  const navItems = await page.$$('button, [role="tab"], .nav-item, [data-tab]');
  for (const item of navItems) {
    const text = await item.textContent();
    if (text && text.includes('Rencana Aksi')) {
      await item.click();
      break;
    }
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, '05-action-plan.png'), fullPage: true });

  // ===== 6. Conflicts tab =====
  console.log('6. Conflicts tab...');
  for (const item of navItems) {
    const text = await item.textContent();
    if (text && text.includes('Konflik')) {
      await item.click();
      break;
    }
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, '06-conflicts.png'), fullPage: true });

  // ===== 7. Load happy path =====
  console.log('7. Loading happy path...');
  // Go back to workspace
  for (const item of navItems) {
    const text = await item.textContent();
    if (text && text.includes('Workspace')) {
      await item.click();
      break;
    }
  }
  await page.waitForTimeout(500);
  const allButtons = await page.$$('button');
  for (const btn of allButtons) {
    const text = await btn.textContent();
    if (text && text.includes('jalur sukses')) {
      await btn.click();
      break;
    }
  }
  await page.waitForTimeout(500);

  // Process
  const procBtn2 = await page.$('button.btn-primary');
  if (procBtn2) {
    const text = await procBtn2.textContent();
    if (text && text.includes('Proses')) {
      await procBtn2.click();
    }
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, '07-happy-path-results.png'), fullPage: true });

  // ===== 8. Preview & Approval =====
  console.log('8. Preview & approval...');
  const navItems2 = await page.$$('button, [role="tab"], .nav-item, [data-tab]');
  for (const item of navItems2) {
    const text = await item.textContent();
    if (text && text.includes('Pratinjau')) {
      await item.click();
      break;
    }
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, '08-preview-approval.png'), fullPage: true });

  // ===== 9. Approve the email action =====
  console.log('9. Approving action...');
  const approveBtn = await page.$('button.btn-primary');
  if (approveBtn) {
    const text = await approveBtn.textContent();
    if (text && text.includes('Setujui')) {
      await approveBtn.click();
      await page.waitForTimeout(1500);
    }
  }
  await page.screenshot({ path: join(OUT, '09-approved.png'), fullPage: true });

  // ===== 10. Execute =====
  console.log('10. Executing...');
  const allBtns = await page.$$('button');
  for (const btn of allBtns) {
    const text = await btn.textContent();
    if (text && text.includes('Jalankan')) {
      await btn.click();
      break;
    }
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, '10-executed.png'), fullPage: true });

  // ===== 11. Audit trail =====
  console.log('11. Audit trail...');
  const navItems3 = await page.$$('button, [role="tab"], .nav-item, [data-tab]');
  for (const item of navItems3) {
    const text = await item.textContent();
    if (text && text.includes('Hasil')) {
      await item.click();
      break;
    }
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, '11-audit-trail.png'), fullPage: true });

  console.log('All screenshots done!');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
