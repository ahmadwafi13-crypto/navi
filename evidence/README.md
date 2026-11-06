# NAVI - Evidence Index

**Proyek:** NAVI - Conflict-Aware Office Agent
**Kompetisi:** Tencent Cloud Hackathon Indonesia 2026, Track B
**Tanggal:** 6 November 2026

---

## Artefak Visual

| File | Deskripsi |
|------|-----------|
| `cover/navi-cover-16x9.png` | Cover presentasi 1920x1080 |
| `video/navi-demo.mp4` | Video demo 5m13s, 1280x800, H.264, dengan caption narasi Indonesia |
| `video/navi-demo.webm` | Sumber video (kualitas lebih tinggi, 33MB) |

## Screenshot UI (11)

| File | Isi |
|------|-----|
| `screenshots/01-login.png` | Halaman login dengan pemilih identitas |
| `screenshots/02-workspace-empty.png` | Workspace setelah login |
| `screenshots/03-workspace-conflict-loaded.png` | Skenario konflik dimuat ke textarea |
| `screenshots/04-conflict-results.png` | Hasil deteksi konflik, 4 konflik terbuka |
| `screenshots/05-action-plan.png` | Tab Rencana Aksi, 3 kartu aksi |
| `screenshots/06-conflicts.png` | Tab Konflik & Klarifikasi |
| `screenshots/07-happy-path-results.png` | Jalur sukses, validasi pass |
| `screenshots/08-preview-approval.png` | Pratinjau persis + hash payload |
| `screenshots/09-approved.png` | Aksi disetujui |
| `screenshots/10-executed.png` | Aksi dieksekusi, receipt mock |
| `screenshots/11-audit-trail.png` | Jejak audit, hash chain utuh |

## Log dan Hasil Uji

| File | Isi |
|------|-----|
| `logs/00-environment.txt` | Versi runtime, konfigurasi |
| `logs/01-file-inventory.txt` | Daftar file yang berhasil dan gagal dibaca |
| `logs/02-typecheck.txt` | TypeScript typecheck (0 error) |
| `logs/03-frontend-build.txt` | Build Vite (clean) |
| `logs/04-test-suite.txt` | Ringkasan test suite |
| `logs/05-determinism.txt` | 3x determinisme |
| `logs/07-demo-http.txt` | Demo HTTP live end-to-end |
| `logs/08-mock-persistence.txt` | Mock tool menulis ke DB nyata |
| `logs/09-no-real-side-effect.txt` | Bukti tidak ada efek samping nyata |
| `logs/10-workbuddy-skills.txt` | Bukti pemuatan skill WorkBuddy |
| `logs/demo-curl-evidence.txt` | Evidence via curl |
| `logs/test-results.jsonl` | TC01-TC20 dengan expected/actual/status |

## Dokumen Submission

| File | Isi |
|------|-----|
| `deliverables/accountability-sheet.md` | Accountability sheet 1 halaman |
| `deliverables/demo-script.md` | Skrip demo langkah-demi-langkah |
| `deliverables/project-description.md` | Blurb 10 kata + deskripsi + dampak |
| `deliverables/architecture-overview.md` | Diagram arsitektur + roadmap cloud |
| `deliverables/gstack/pre-launch-review-navi-2026-11-06.md` | Laporan audit pra-rilis |
| `WORKBUDDY_EVIDENCE.md` | Bukti penggunaan WorkBuddy |

## Script Reproduksi

| Script | Fungsi |
|--------|--------|
| `scripts/take-screenshots.mjs` | Ambil 11 screenshot UI |
| `scripts/record-demo.mjs` | Rekam video demo dengan caption |
| `scripts/make-cover.mjs` | Render cover 16:9 |
| `scripts/evidence.sh` | Regenerasi paket bukti |

## Cara Menjalankan

```bash
cd D:/navi/NAVI
npm install
npm run build
PORT=8787 NAVI_REFERENCE_NOW=2026-11-06T10:00:00+07:00 npx tsx apps/api/src/index.ts
# -> http://127.0.0.1:8787

# Test suite
cd apps/api && npx tsx scripts/run-tests.ts

# Regenerasi bukti visual (butuh playwright)
npx playwright install chromium
node scripts/take-screenshots.mjs
node scripts/record-demo.mjs
node scripts/make-cover.mjs
```
