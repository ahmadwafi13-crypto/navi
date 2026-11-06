# NAVI - Bukti Penggunaan WorkBuddy

**Proyek**: NAVI - Conflict-Aware Office Agent
**Kompetisi**: Tencent Cloud Hackathon Indonesia 2026, Track B - The Office Agent
**Workspace root**: `D:/navi/NAVI`
**Waktu acuan demo**: Jumat, 6 November 2026, 10.00 WIB

Dokumen ini mencatat **bukti nyata** penggunaan WorkBuddy selama membangun NAVI. Setiap
klaim di bawah disertai perintah atau output yang dapat diverifikasi ulang.

---

## 1. Inspeksi lingkungan WorkBuddy (LANGKAH 0)

| Yang diperiksa | Perintah | Hasil nyata |
|----------------|----------|-------------|
| Working directory | `pwd` | `/d/navi/NAVI` (Windows: `D:\navi\NAVI`) |
| Runtime Node | `node --version` | `v22.22.2` |
| Runtime Python | `python --version` | `3.13.14` |
| npm | `npm --version` | `10.9.7` |
| Git | `git --version` | `2.55.0.windows.3` |
| Skill user-level | `ls ~/.workbuddy-ai/skills/` | 30+ skill terpasang (admapix, frontend-dev, fullstack-dev, ...) |
| Skill builtin | daftar `<available_skills>` | `workbuddy-pdf`, `workbuddy-docx`, `cloud-service`, `mini-program-development`, `library`, `workbuddy-local-office-edit`, `expert-manager`, dan lainnya |
| MCP connector aktif | status sesi | `gmail: connected`, `google-drive: connected` |
| Agent/team runtime | `TeamCreate` + `Agent` | Berhasil - tim `gstack-navi-prelaunch` dibuat dengan 3 anggota spesialis |
| CLI WorkBuddy | `which workbuddy codebuddy` | **Tidak ada** - tidak ada CLI WorkBuddy di PATH |
| Managed Agents API | endpoint | **Tidak diuji keasliannya** - tidak ada kredensial, tidak diklaim |

### 1.1 `PANDUAN_HACKATHON.pdf` - TIDAK TERSEDIA (dinyatakan terbuka)

Instruksi meminta file ini sebagai acuan tertinggi. Hasil pemeriksaan:

```
$ find . -type f
./data/01_organization.json ... ./tests/20_test_cases.jsonl
# PANDUAN_HACKATHON.pdf tidak ada di workspace

# Dicoba juga dari Google Drive (connector connected, ID dari PRD Lampiran B):
google-drive read_file file_id=1mGFTmLzSkbxHx-7UBmsiB-GMDNBfzSWm
-> UPSTREAM_REJECTED: 文件不存在、不可见、在回收站内，或本应用未被授权访问

$ google-drive search_files query="PANDUAN HACKATHON"
-> {"items":[]}
```

**Kesimpulan jujur**: panduan hackathon asli **tidak dapat diakses** lewat workspace maupun
Google Drive yang terhubung. File `prd/NAVI_PRD_v1_1.pdf` (v1.0, 25 halaman) menjadi acuan
spesifikasi yang tersedia, termasuk bagian yang mengutip ketentuan kompetisi
(H-B01..H-B07, tabel "KONTROL PALING KRITIS", batas pengumpulan 7 November 2026 23.59 WIB).
Link resmi ada di PRD Lampiran B butir 1 dan perlu dibuka manual oleh peserta.

---

## 2. Empat peran agent sebagai Skill WorkBuddy sungguhan

Empat peran logis NAVI (PRD bagian 4, `docs/WORKFLOW_CONTRACT.md`) dikemas sebagai **Skill
WorkBuddy yang bisa dipanggil**, bukan sekadar fungsi biasa di backend.

### 2.1 Skill yang dibuat

| Skill | Peran | Lokasi skill | Implementasi runtime |
|-------|-------|--------------|----------------------|
| `navi-orchestrator` | A1 Orchestrator | `~/.workbuddy-ai/skills/navi-orchestrator/SKILL.md` | `apps/api/src/agents/orchestrator.ts` |
| `navi-interpreter` | A2 Interpreter | `~/.workbuddy-ai/skills/navi-interpreter/SKILL.md` | `apps/api/src/agents/interpreter.ts` |
| `navi-conflict-detector` | A3 Conflict Detector | `~/.workbuddy-ai/skills/navi-conflict-detector/SKILL.md` | `apps/api/src/agents/conflict-detector.ts` |
| `navi-validator` | A4 Validator | `~/.workbuddy-ai/skills/navi-validator/SKILL.md` | `apps/api/src/agents/validator.ts` |

Salinan identik juga ada di level proyek di `.workbuddy-ai/skills/` sehingga bisa dipakai
oleh anggota tim lain tanpa instalasi.

### 2.2 Bukti pemuatan nyata

Skill dipanggil lewat mekanisme WorkBuddy, bukan dibaca sebagai teks biasa:

```
> Skill(navi-validator)
Base directory for this skill: C:\Users\Administrator\.workbuddy-ai\skills\navi-validator
# NAVI Agent A4 - Validator
... (isi skill termuat penuh ke konteks sesi)

> Skill(navi-orchestrator)
Base directory for this skill: C:\Users\Administrator\.workbuddy-ai\skills\navi-orchestrator
# NAVI Agent A1 - Orchestrator
... (isi skill termuat penuh ke konteks sesi)
```

`navi-interpreter` dan `navi-conflict-detector` terpasang pada mekanisme yang sama
(direktori skill, frontmatter `name`/`description`/`version`, ter-discover oleh registry).

**Catatan jujur**: registry skill WorkBuddy di-cache saat sesi dimulai. Skill yang baru
dibuat di direktori user-level **tidak langsung ter-discover** di sesi yang sama - saat
skill pertama dicoba, sistem melaporkan `Can not find skill`. Setelah skill disalin ke
`~/.workbuddy-ai/skills/`, pemuatan berhasil pada pemanggilan berikutnya di sesi yang sama.
Ini bukti bahwa mekanisme skill WorkBuddy benar-benar aktif, bukan sekadar file markdown.

### 2.3 Peran agent multi-agen nyata di WorkBuddy

Untuk audit pra-rilis, WorkBuddy menjalankan **tim agen sungguhan** (`TeamCreate` +
`Agent`), bukan simulasi:

```
TeamCreate -> "gstack-navi-prelaunch"
Agent(name="gstack-product-reviewer", subagent_type="gstack-product-reviewer")
Agent(name="gstack-security-officer",  subagent_type="gstack-security-officer")
Agent(name="gstack-qa-lead",            subagent_type="gstack-qa-lead")
```

Ketiganya menjalankan operasi file, bash, dan pencarian sendiri secara paralel. Hasil
audit mereka ada di `deliverables/gstack/pre-launch-review-navi-2026-11-06.md`.

---

## 3. Alur kerja yang dijalankan WorkBuddy

| Aktivitas WorkBuddy | Yang dijalankan | Bukti |
|---------------------|-----------------|-------|
| Pembacaan fixture | 16 file dibaca (README, PROMPT_UTAMA, PRD PDF, 4 data JSON, 3 docs MD, tests JSONL, dsb.) | `evidence/logs/01-file-inventory.txt` |
| Ekstraksi PDF | `pdftotext -layout prd/NAVI_PRD_v1_1.pdf` -> 1190 baris teks | PRD bagian 1-17 terbaca penuh |
| Pemrosesan dokumen | Skill `workbuddy-pdf` / parser lokal untuk PDF & DOCX | Lampiran A/B PRD terbaca |
| Import font/ikon | `pdftotext` + `unzip` untuk DOCX (23 entries) | Struktur PRD terverifikasi |
| Pemakaian skill | `Skill(navi-validator)`, `Skill(navi-orchestrator)` | Terminal output sesi |
| Tim agen | `TeamCreate` + 3 `Agent` paralel | Tim `gstack-navi-prelaunch` |
| ImageGen | **Tidak dipakai** - tidak ada kebutuhan aset visual; UI pakai CSS design system | - |
| VideoGen | **Tidak dipakai** - rekaman demo video adalah pekerjaan manual peserta | - |
| MCP connector | `google-drive` (percobaan baca panduan), `gmail` (terhubung, tidak digunakan - NAVI tidak mengirim email nyata) | - |

---

## 4. Yang TIDAK diklaim (batas yang jujur)

Hal-hal ini **tidak** diklaim oleh NAVI, dan memang tidak ada buktinya:

1. **Bukan hosted WorkBuddy Managed Agents.** Web runtime NAVI berjalan di Node/Fastify
   lokal. Tidak ada panggilan ke endpoint WorkBuddy Managed Agents karena akses,
   lisensi, dan region belum diverifikasi (PRD 16.7 secara eksplisit mengizinkan
   pendekatan ini).
2. **Bukan LLM dalam jalur approval.** Interpreter adalah rule engine deterministik
   (PRD 4.2 mensyaratkan `rules.evaluate` deterministik). Model bahasa tidak pernah
   berada di jalur yang menghasilkan approval.
3. **Tidak ada email/kalender/task nyata.** Semua tool adalah mock connector yang menulis
   ke SQLite lokal. Semua domain email fixture berakhiran `.invalid`.
4. **Kalender libur nasional belum terverifikasi.** `national_holidays_for_range = null`
   di fixture, sehingga NAVI menandai `UNVERIFIED` dan tidak menebak.
5. **Blok salat Jumat adalah fixture simulasi**, bukan fatwa resmi.
6. **Ketersediaan peserta belum terhubung** - NAVI tidak menyatakan peserta "tersedia".
7. **`PANDUAN_HACKATHON.pdf` belum pernah dibaca** - tidak tersedia di workspace maupun
   Drive yang terhubung.

---

## 5. Perintah menjalankan

```bash
# 1. Install
cd D:/navi/NAVI
npm install

# 2. Build UI
npm run build

# 3. Jalankan API + UI (satu port)
cd apps/api && npx tsx src/index.ts
# -> http://127.0.0.1:8787

# 4. Jalankan test suite
cd apps/api && npx tsx scripts/run-tests.ts

# 5. Regenerasi bukti
bash scripts/evidence.sh
```

Variabel lingkungan:

| Variabel | Default | Fungsi |
|----------|---------|--------|
| `PORT` | `8787` | Port API + UI |
| `NAVI_REFERENCE_NOW` | `2026-11-06T10:00:00+07:00` | Waktu acuan demo (deterministik) |
| `NAVI_DB` | `data/navi-runtime.sqlite` | Lokasi database runtime |
| `NAVI_FAIL_TOOL` | (kosong) | Simulasi kegagalan tool: `mock.email` / `mock.calendar` / `mock.task` |

---

## 6. Pohon berkas

```
NAVI/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ core/         types, hash, timezone, fixtures, pipeline, session, errors, ids
│  │  │  ├─ agents/       orchestrator, interpreter, conflict-detector, validator, text-utils
│  │  │  ├─ gateway/      approval-service, execution-gateway   <-- trust boundary
│  │  │  ├─ mock/         mock email/calendar/task connectors
│  │  │  ├─ db/           SQLite schema + append-only audit hash chain
│  │  │  └─ index.ts      Fastify routes + auth middleware
│  │  └─ scripts/         run-tests.ts, smoke.ts
│  └─ web/                 React + Vite UI, 5 tampilan, responsive
├─ .workbuddy-ai/skills/   4 Skill WorkBuddy (level proyek)
├─ data/                   fixture sintetis + runtime SQLite
├─ docs/                   kontrak workflow, kriteria penerimaan, checklist
├─ evidence/               log, hasil uji, screenshot
├─ packages/               (dicadangkan untuk schemas/domain bersama)
├─ prd/                    PRD v1.1 PDF + DOCX
├─ scripts/evidence.sh     regenerate bukti
├─ tests/20_test_cases.jsonl   20 kasus + hasil aktual
└─ deliverables/gstack/    laporan audit pra-rilis
```
