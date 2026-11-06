# NAVI - Panduan Submit Hackathon

**Kompetisi:** Tencent Cloud Hackathon Indonesia 2026, Track B - The Office Agent
**Batasan waktu pengumpulan:** 7 November 2026, 23.59 WIB
**Tim:** *isi nama tim dan ID registrasi*

---

## 1. Apa yang Dikumpulkan

Satu file ZIP berisi seluruh proyek NAVI:

```
navi-submission.zip
```

File ini sudah dibuat dan tersedia di:
```
D:/navi/NAVI/navi-submission.zip
```

---

## 2. Isi Paket Submission

```
navi-submission/
├── SUBMISSION_GUIDE.md          ← panduan ini (baca pertama)
├── README_START_HERE.md         ← cara mulai cepat
├── PROMPT_UTAMA_WORKBUDDY.md    ← prompt asli
├── WORKBUDDY_EVIDENCE.md        ← bukti penggunaan WorkBuddy
├── package.json                 ← npm workspaces config
├── .gitignore
│
├── apps/
│   ├── api/                     ← backend Fastify + 4 agent + gateway
│   │   ├── src/
│   │   │   ├── agents/          ← orchestrator, interpreter, conflict-detector, validator
│   │   │   ├── gateway/         ← approval-service, execution-gateway (trust boundary)
│   │   │   ├── core/            ← pipeline, hash, fixtures, timezone, session, types
│   │   │   ├── mock/            ← mock email/calendar/task tools
│   │   │   ├── db/              ← SQLite schema + audit hash chain
│   │   │   └── index.ts         ← Fastify routes + auth + static serve
│   │   ├── scripts/             ← run-tests.ts, smoke.ts, probe*.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                     ← frontend React + Vite
│       ├── src/
│       │   ├── App.tsx          ← 5 views + login
│       │   ├── lib/             ← api client, types
│       │   ├── styles.css       ← design system (responsive, a11y)
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       └── tsconfig.json
│
├── data/                        ← fixture sintetis (bukan data asli)
│   ├── 01_organization.json
│   ├── 02_people.json           ← 7 karyawan fiktif
│   ├── 03_policies.json         ← MOCK_ONLY, aturan approval, blok salat
│   ├── 04_meeting_context.json  ← 2 notulen rapat (DRAFT & APPROVED)
│   ├── 05_main_request.txt      ← skenario konflik
│   ├── 06_untrusted_attached_notes.txt  ← uji prompt injection
│   ├── 07_mock_calendar.md      ← kalender simulasi
│   └── 08_happy_path_request.txt ← skenario sukses
│
├── docs/
│   ├── ACCEPTANCE_CRITERIA.md   ← AC01-AC20
│   ├── WORKFLOW_CONTRACT.md     ← state machine, trust boundary
│   └── SUBMISSION_CHECKLIST.md  ← checklist final
│
├── tests/
│   └── 20_test_cases.jsonl      ← TC01-TC20 + hasil aktual
│
├── deliverables/
│   ├── SUBMISSION_GUIDE.md      ← panduan ini
│   ├── project-description.md   ← blurb 10 kata + deskripsi + dampak
│   ├── accountability-sheet.md  ← 1 halaman trust boundary
│   ├── demo-script.md           ← skrip demo 5-8 menit
│   ├── architecture-overview.md ← diagram arsitektur + roadmap cloud
│   └── gstack/
│       └── pre-launch-review-navi-2026-11-06.md  ← laporan audit pra-rilis
│
├── evidence/
│   ├── README.md                ← index evidence
│   ├── cover/
│   │   └── navi-cover-16x9.png  ← cover 1920x1080
│   ├── video/
│   │   └── navi-demo.mp4        ← video demo 5m13s, H.264, caption Indonesia
│   ├── screenshots/             ← 11 screenshot UI
│   │   ├── 01-login.png
│   │   ├── 02-workspace-empty.png
│   │   ├── 03-workspace-conflict-loaded.png
│   │   ├── 04-conflict-results.png
│   │   ├── 05-action-plan.png
│   │   ├── 06-conflicts.png
│   │   ├── 07-happy-path-results.png
│   │   ├── 08-preview-approval.png
│   │   ├── 09-approved.png
│   │   ├── 10-executed.png
│   │   └── 11-audit-trail.png
│   └── logs/                    ← 12 file log bukti
│       ├── 00-environment.txt
│       ├── 01-file-inventory.txt
│       ├── 02-typecheck.txt
│       ├── 03-frontend-build.txt
│       ├── 04-test-suite.txt
│       ├── 05-determinism.txt
│       ├── 07-demo-http.txt
│       ├── 08-mock-persistence.txt
│       ├── 09-no-real-side-effect.txt
│       ├── 10-workbuddy-skills.txt
│       ├── demo-curl-evidence.txt
│       └── test-results.jsonl
│
├── scripts/
│   ├── take-screenshots.mjs     ← reproduksi screenshot
│   ├── record-demo.mjs          ← reproduksi video demo
│   ├── make-cover.mjs           ← reproduksi cover
│   └── evidence.sh              ← regenerasi paket bukti
│
├── prd/                         ← PRD v1.1 (PDF + DOCX)
│   ├── NAVI_PRD_v1_1.pdf
│   └── NAVI_PRD_v1_1.docx
│
└── .workbuddy-ai/skills/        ← 4 Skill WorkBuddy (level proyek)
    ├── navi-orchestrator/SKILL.md
    ├── navi-interpreter/SKILL.md
    ├── navi-conflict-detector/SKILL.md
    └── navi-validator/SKILL.md
```

### Yang TIDAK dimasukkan (dikecualikan):

| Folder | Alasan |
|--------|--------|
| `node_modules/` | Dependency — instal ulang via `npm install` |
| `data/navi-runtime.sqlite*` | Database runtime — dibuat otomatis saat server start |
| `.workbuddy-ai/memory/` | Memory internal WorkBuddy, bukan bagian submission |
| `evidence/video/navi-demo.webm` | File sumber 33MB — versi MP4 (2.4MB) sudah cukup |
| `apps/web/dist/` | Build output — rebuild via `npm run build` |

---

## 3. Urutan Submit

### Langkah 1: Upload ZIP (jika platform butuh file)

Upload `navi-submission.zip` ke platform pengumpulan hackathon.

### Langkah 2: Isi Form Submission

Isi form dengan data berikut:

**Judul:**
```
NAVI (codename hackathon)
```

**Blurb (<=10 kata):**
```
Conflict-aware office agent: instruksi ambigu jadi tindakan aman, disetujui manusia.
```

**Deskripsi Proyek & Dampak Terukur:**

Salin dari `deliverables/project-description.md` bagian "Deskripsi Proyek" sampai "Dampak Terukur".

**Link demo (opsional):**
```
http://127.0.0.1:8787
```
Catatan: link lokal hanya berfungsi saat server berjalan di komputer peserta. Untuk demo, jalankan server lalu tunjukkan langsung.

### Langkah 3: Lampirkan Media (jika platform terpisah)

| Media | File | Upload? |
|-------|------|---------|
| Video demo | `evidence/video/navi-demo.mp4` (5m13s, 2.4MB) | Ya |
| Cover 16:9 | `evidence/cover/navi-cover-16x9.png` (1920x1080) | Ya, jika diminta |
| Screenshot | `evidence/screenshots/*.png` (11 file) | Pilih 3-5 yang paling representatif |

### Langkah 4: Verifikasi

Sebelum klik submit, cek:

- [ ] ZIP berisi semua file di atas (tidak ada `node_modules`)
- [ ] Blurb <=10 kata
- [ ] Video demo dapat diputar dan durasi 5-8 menit
- [ ] Cover tidak ada karakter rusak/garbled
- [ ] Tidak ada KIVO/TARA di submission
- [ ] Tidak ada token/secret/data organisasi asli
- [ ] Semua domain email pakai `example.invalid`
- [ ] Batas waktu: 7 November 2026 23.59 WIB

---

## 4. Cara Judge Mengevaluasi Aplikasi

Jika judge ingin menjalankan aplikasi:

```bash
# 1. Ekstrak ZIP
unzip navi-submission.zip
cd navi-submission

# 2. Install dependency
npm install

# 3. Build frontend
npm run build

# 4. Jalankan server
PORT=8787 NAVI_REFERENCE_NOW=2026-11-06T10:00:00+07:00 npx tsx apps/api/src/index.ts

# 5. Buka browser
# http://127.0.0.1:8787

# 6. Jalankan test suite
cd apps/api && npx tsx scripts/run-tests.ts

# 7. Cek typecheck
npx tsc --noEmit
```

**Login demo:** pilih "Maya Putri (USR-001)" dari dropdown.

**Skenario demo cepat:**
1. Klik "Muat skenario konflik" → "Proses instruksi" → lihat 3 konflik
2. Klik "Muat jalur sukses" → "Proses instruksi" → approve → execute → audit

---

## 5. Yang Harus Diperhatikan Judge

### Yang DIKLAIM:

| Klaim | Bukti |
|-------|-------|
| 20/20 test cases PASS | `evidence/logs/test-results.jsonl` |
| 20/20 acceptance criteria PASS | `docs/ACCEPTANCE_CRITERIA.md` + test log |
| 10 deny-by-default gateway checks | `apps/api/src/gateway/execution-gateway.ts` |
| Audit hash chain SHA-256 | `apps/api/src/db/index.ts` + `evidence/logs/07-demo-http.txt` |
| 4 WorkBuddy Skills terpasang | `.workbuddy-ai/skills/` + `WORKBUDDY_EVIDENCE.md` |
| UI 5-tab responsif | `evidence/screenshots/` (11 file) |
| Mock-only execution | `apps/api/src/mock/tools.ts` + `evidence/logs/09-no-real-side-effect.txt` |

### Yang TIDAK DIKLAIM (jujur):

| Batas | Alasan |
|-------|--------|
| Bukan hosted WorkBuddy Managed Agents | Runtime lokal Node/Fastify |
| Interpreter adalah rule engine deterministik, bukan LLM | Sesuai PRD §4.2 |
| Kalender libur nasional UNVERIFIED | Tidak menebak data yang tidak terverifikasi |
| Blok salat Jumat adalah fixture simulasi | Bukan fatwa resmi |
| Tidak ada email/kalender/tugas nyata | Mode MOCK_ONLY |
| `PANDUAN_HACKATHON.pdf` tidak tersedia | Tidak ada di workspace maupun Google Drive |

---

## 6. Bukti WorkBuddy (jalur alternatif repo publik)

Panduan hackathon menyebut: *"repo publik ATAU ekspor WorkBuddy workflow + bukti penggunaannya"*.

NAVI memenuhi jalur **ekspor WorkBuddy**:

1. **4 Skill WorkBuddy** terpasang di `.workbuddy-ai/skills/` (level proyek) dan `~/.workbuddy-ai/skills/` (level user)
2. **Bukti pemuatan skill** nyata: `WORKBUDDY_EVIDENCE.md` §2.2
3. **Tim agen WorkBuddy** dijalankan untuk audit: `deliverables/gstack/pre-launch-review-navi-2026-11-06.md`
4. **MCP connector** Google Drive dan Gmail terhubung dan digunakan (percobaan baca panduan)
5. **Skill builtin** dipakai: `workbuddy-pdf` untuk membaca PRD

Repo publik tidak dibuat sesuai instruksi: *"Repo publik tidak dibuat tanpa instruksi eksplisit pengguna."*

---

## 7. Checklist Final Sebelum Submit

| # | Item | Status |
|---|------|--------|
| 1 | ZIP file siap | [ ] |
| 2 | Blurb <=10 kata | [x] 10 kata |
| 3 | Deskripsi proyek + dampak | [x] di `deliverables/project-description.md` |
| 4 | Accountability sheet 1 halaman | [x] di `deliverables/accountability-sheet.md` |
| 5 | Demo 5-8 menit (video) | [x] `evidence/video/navi-demo.mp4` (5m13s) |
| 6 | Demo script | [x] di `deliverables/demo-script.md` |
| 7 | Screenshot tes | [x] 11 file di `evidence/screenshots/` |
| 8 | Log tes + hasil | [x] 12 file di `evidence/logs/` |
| 9 | Diagram arsitektur + trust boundary | [x] di `deliverables/architecture-overview.md` |
| 10 | Bukti WorkBuddy | [x] `WORKBUDDY_EVIDENCE.md` |
| 11 | Cover 16:9 (opsional) | [x] `evidence/cover/navi-cover-16x9.png` |
| 12 | Tidak ada KIVO/TARA | [x] |
| 13 | Tidak ada secret/data asli | [x] domain `example.invalid` |
| 14 | Batas waktu terpenuhi | [ ] verifikasi sebelum 7 Nov 23.59 WIB |

---

## 8. Informasi Tim

| Field | Isi |
|-------|-----|
| Nama tim | *isi* |
| ID registrasi | *isi* |
| Anggota | *isi* |
| Track | B - The Office Agent |
| Kompetisi | Tencent Cloud Hackathon Indonesia 2026 |

---

*Dokumen ini dibuat: 6 November 2026*
