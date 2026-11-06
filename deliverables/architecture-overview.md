# NAVI - Architecture Overview & Cloud Roadmap

---

## Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────┐
│                    Pengguna Terautentikasi                │
│                  (browser - React 5-tab UI)              │
└──────────────┬──────────────────────────┬───────────────┘
               │ HTTPS                    │
               v                          v
┌──────────────────────┐   ┌─────────────────────────────┐
│   Fastify API :8787   │   │   React Static (dist/)      │
│                      │   │   Workspace → Rencana →      │
│  /v1/auth/session    │   │   Konflik → Pratinjau →      │
│  /v1/runs            │   │   Audit                      │
│  /v1/actions/*       │   └─────────────────────────────┘
│  /internal/execute   │
│  /v1/runs/*/audit    │
└──────────┬───────────┘
           │
           v
┌──────────────────────────────────────────────────────────┐
│                   Pipeline 4 Agent                        │
│                                                          │
│  A1 Orchestrator ──> A2 Interpreter ──> A4 Validator     │
│         │                    │                           │
│         │              A3 Conflict Detector              │
│         │                    │                           │
│         v                    v                           │
│    [next step]      [conflicts + actions]                │
└──────────┬──────────────────────────────┬───────────────┘
           │                              │
           v                              v
┌─────────────────────┐     ┌────────────────────────────┐
│  Approval Service   │     │   Execution Gateway         │
│  - RBAC check       │     │   10 deny-by-default:       │
│  - Hash computation │────>|   1. approval exists        │
│  - High-risk gate   │     │   2. not consumed           │
│  - Expiry           │     │   3. not invalidated        │
│                     │     │   4. not expired            │
└─────────────────────┘     │   5. hash match             │
                            │   6. version match          │
                            │   7. state = APPROVED       │
                            │   8. approver RBAC          │
                            │   9. same identity          │
                            │  10. high-risk manager      │
                            └──────────┬─────────────────┘
                                       │ (all 10 pass)
                                       v
                            ┌────────────────────────────┐
                            │   Mock Tools (MOCK_ONLY)   │
                            │   mock.email               │
                            │   mock.calendar            │
                            │   mock.task                │
                            └──────────┬─────────────────┘
                                       │
                                       v
                            ┌────────────────────────────┐
                            │   SQLite (node:sqlite)     │
                            │   - actions table          │
                            │   - approvals table        │
                            │   - executions table       │
                            │   - audit_events (hash     │
                            │     chain SHA-256)         │
                            └────────────────────────────┘
```

## Trust Boundary

| Layer | Kepercayaan | Akses Eksekusi |
|-------|-------------|----------------|
| Input pengguna (textarea) | TRUSTED | Tidak |
| Lampiran/file | UNTRUSTED | Tidak |
| Fixture data | SIMULASI | Tidak |
| 4 Agent (A1-A4) | Propose only | Tidak |
| Approval Service | RBAC + hash | Tidak |
| Execution Gateway | Gateway only | Ya (satu-satunya) |
| Mock Tools | MOCK_ONLY | Hanya via gateway |

## Roadmap Integrasi Cloud (Gratis)

### Fase 1: Sumber Dokumen (Google Drive)
- **Tujuan:** Notulensi dari Google Drive, bukan JSON fixture
- **Cara:** Google Drive API (gratis, 15GB storage)
- **Implementasi:** Ganti `data/04_meeting_context.json` dengan fetch dari Drive berdasarkan document_id
- **Storage:** Dokumen `.md`/`.docx` disimpan di Drive, metadata di SQLite

### Fase 2: Autentikasi (OAuth)
- **Tujuan:** Login dengan akun nyata, bukan dropdown
- **Cara:** Google OAuth 2.0 / Microsoft Entra ID (gratis)
- **Implementasi:** Ganti `/v1/auth/session` dengan redirect OAuth → callback → session
- **RBAC:** Role dari directory API (Google Workspace Admin SDK)

### Fase 3: Eksekusi Nyata
- **Email:** Gmail API (gratis, 1 billion quota/day) atau Microsoft Graph
- **Kalender:** Google Calendar API (gratis) atau Microsoft Graph Calendar
- **Task:** Google Tasks API atau Microsoft To Do
- **Safety:** Gateway tetap sama — 10 deny-by-default checks tidak berubah

### Fase 4: Hosting
- **Frontend:** Vercel free tier (React static build)
- **Backend:** Render free tier atau Railway (Node.js)
- **Database:** SQLite tetap (file-based) atau Cloudflare D1 (free tier)
- **Storage:** Cloudflare R2 (free tier 10GB)

### Fase 5: Validasi Eksternal
- **Kalender libur:** API pemerintah Indonesia (data.go.id) atau scraping manual terverifikasi
- **Ketersediaan peserta:** Google Calendar Free/Busy API
- **Zona waktu:** IANA timezone database (sudah terintegrasi)

## Pohon File

```
NAVI/
├─ apps/
│  ├─ api/src/
│  │  ├─ core/         pipeline, hash, fixtures, timezone, session, types
│  │  ├─ agents/       orchestrator, interpreter, conflict-detector, validator
│  │  ├─ gateway/      approval-service, execution-gateway
│  │  ├─ mock/         mock email/calendar/task connectors
│  │  ├─ db/           SQLite schema + audit hash chain
│  │  └─ index.ts      Fastify routes + auth + static serve
│  └─ web/src/
│     ├─ App.tsx       5 views + login + app shell
│     ├─ lib/          api client, types
│     └─ styles.css    design system (responsive, a11y)
├─ .workbuddy-ai/skills/   4 WorkBuddy Skills
├─ data/                   fixture sintetis
├─ docs/                   kontrak, kriteria, checklist
├─ tests/                  20 test cases
├─ evidence/               log + hasil uji
├─ deliverables/           accountability, demo, deskripsi, arsitektur
└─ prd/                    PRD v1.1
```
