import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, join } from 'path';

const OUT = resolve('evidence/cover');
mkdirSync(OUT, { recursive: true });

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1920px;height:1080px;overflow:hidden;
       font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
       background:#172638;color:#fff;position:relative}
  .grid-bg{position:absolute;inset:0;
    background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);
    background-size:64px 64px}
  .glow{position:absolute;width:900px;height:900px;border-radius:50%;
    background:radial-gradient(circle,rgba(17,123,120,.34),transparent 68%);
    top:-320px;right:-240px}
  .glow2{position:absolute;width:700px;height:700px;border-radius:50%;
    background:radial-gradient(circle,rgba(214,122,48,.20),transparent 68%);
    bottom:-280px;left:-180px}
  .wrap{position:relative;z-index:2;padding:88px 110px;height:100%;
    display:flex;flex-direction:column}
  .top{display:flex;align-items:center;gap:22px}
  .mark{width:76px;height:76px;border-radius:18px;background:#117b78;
    display:flex;align-items:center;justify-content:center;
    font-size:40px;font-weight:700;letter-spacing:-1px}
  .brand{font-size:27px;font-weight:600;letter-spacing:.16em}
  .brand span{color:#7fb3b1;font-weight:400;letter-spacing:.04em;font-size:22px}
  .track{margin-left:auto;font-size:20px;color:#9fb3c8;
    border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:11px 26px}
  h1{font-size:104px;font-weight:700;line-height:1.02;margin-top:112px;
     letter-spacing:-2.5px}
  h1 em{font-style:normal;color:#5DCAA5}
  .sub{font-size:35px;color:#c3d3e2;margin-top:30px;max-width:1180px;
       line-height:1.42;font-weight:300}
  .rule{width:132px;height:6px;background:#d67a30;border-radius:3px;margin-top:42px}
  .cards{display:flex;gap:26px;margin-top:auto}
  .card{flex:1;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.11);
    border-radius:16px;padding:32px 34px}
  .card .n{font-size:50px;font-weight:700;color:#5DCAA5;line-height:1}
  .card .n.amber{color:#f0a868}
  .card .t{font-size:21px;color:#c3d3e2;margin-top:14px;line-height:1.4}
  .card .l{font-size:17px;color:#8fa6bd;margin-top:12px}
  .foot{display:flex;align-items:center;gap:20px;margin-top:52px;
        font-size:20px;color:#8fa6bd}
  .pill{border:1px solid rgba(255,255,255,.19);border-radius:999px;
        padding:9px 20px;color:#b7c9da}
  .pill.solid{background:rgba(214,122,48,.17);border-color:rgba(214,122,48,.5);color:#f0b183}
  .foot .sp{flex:1}
</style></head>
<body>
  <div class="grid-bg"></div><div class="glow"></div><div class="glow2"></div>
  <div class="wrap">
    <div class="top">
      <div class="mark">N</div>
      <div class="brand">NAVI <span>· Conflict-Aware Office Agent</span></div>
      <div class="track">Tencent Cloud Hackathon Indonesia 2026 · Track B</div>
    </div>

    <h1>Instruksi ambigu,<br>jadi tindakan <em>aman</em>.</h1>
    <div class="sub">Empat agent mengubah catatan rapat bahasa Indonesia menjadi
      email, kalender, dan tugas — dan tidak ada satu pun yang dieksekusi
      tanpa persetujuan manusia yang terautentikasi.</div>
    <div class="rule"></div>

    <div class="cards">
      <div class="card"><div class="n">20/20</div>
        <div class="t">Test cases &amp; acceptance criteria</div>
        <div class="l">Termasuk anti-bypass gateway</div></div>
      <div class="card"><div class="n">10</div>
        <div class="t">Pemeriksaan deny-by-default di gateway</div>
        <div class="l">Hash-bound, RBAC, idempoten</div></div>
      <div class="card"><div class="n amber">0</div>
        <div class="t">Email, kalender, atau tugas nyata dikirim</div>
        <div class="l">Mode simulasi, audit hash chain</div></div>
    </div>

    <div class="foot">
      <span class="pill solid">MOCK_ONLY</span>
      <span class="pill">Fastify + React</span>
      <span class="pill">Bahasa Indonesia</span>
      <span class="sp"></span>
      <span>AI mengusulkan · Manusia menyetujui · Gateway mengeksekusi</span>
    </div>
  </div>
</body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(html);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'navi-cover-16x9.png') });
  await browser.close();
  console.log('Cover saved: evidence/cover/navi-cover-16x9.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
