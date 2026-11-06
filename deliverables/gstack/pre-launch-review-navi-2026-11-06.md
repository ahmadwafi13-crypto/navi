# NAVI Pre-Launch Review — Code Review, Security Audit, QA Testing

**Tanggal:** 2026-11-06  
**Reviewer:** Team Lead (GStack agents tidak tersedia karena rate-limit 429; audit dijalankan langsung)  
**Workspace:** `D:\navi\NAVI`

---

## 1. Ringkasan Eksekutif

| Aspek | Status | Catatan |
|-------|--------|---------|
| Code Review | **PASS** | Arsitektur trust-boundary sesuai PRD; 4 agent roles terpisah; pipeline tidak mengeksekusi |
| Security Audit | **PASS dengan catatan** | 10-check deny-by-default gateway solid; 3 temuan non-blocking |
| QA Testing | **PASS** | 26/26 tes lulus, 3× determinisme, demo HTTP live |
| Release Readiness | **GO** | Siap untuk demo hackathon dengan batasan yang diakui jujur |

---

## 2. Code Review

### 2.1 Arsitektur dan Trust Boundary

**Verdict: PASS**

Batas kepercayaan (trust boundary) diimplementasikan dengan benar:

- **Agent layer (A1–A4)** hanya mengusulkan aksi; tidak memiliki akses ke tool eksekusi apa pun (`allowed-tools: Read, Grep, Glob` di semua SKILL.md).
- **Pipeline** (`src/core/pipeline.ts`) hanya membuat records di DB dan tidak pernah memanggil tool eksekusi.
- **Execution Gateway** (`src/gateway/execution-gateway.ts`) adalah satu-satunya komponen yang bisa menyebabkan side effect, dan hanya setelah 10 pemeriksaan deny-by-default.
- **Approval Service** (`src/gateway/approval-service.ts`) hanya menerima keputusan dari sesi terautentikasi; tidak ada code path yang memungkinkan teks chat, dokumen, atau output model membuat approval.

### 2.2 Pemisahan 4 Agent Roles

| Agent | File | Tanggung Jawab | Eksekusi Tool? |
|-------|------|---------------|----------------|
| A1 Orchestrator | `agents/orchestrator.ts` | Tentukan langkah berikutnya (klarifikasi vs approval) | Tidak |
| A2 Interpreter | `agents/interpreter.ts` | Parse teks Indonesia → kandidat aksi terstruktur | Tidak |
| A3 Conflict Detector | `agents/conflict-detector.ts` | 10 jenis konflik, surface ambigu, jangan auto-fix | Tidak |
| A4 Validator | `agents/validator.ts` | Validasi aturan operasional, zona waktu, risk level | Tidak |

Pemisahan ini sesuai PRD §4.2 dan `docs/WORKFLOW_CONTRACT.md`.

### 2.3 Deterministic-by-Design

Interpreter adalah rule engine deterministik, bukan panggilan LLM. Ini diakui jujur di `WORKBUDDY_EVIDENCE.md` dan bukan kelemahan — justru memastikan:
- Semua 20 test cases reproduksible 100%
- Tidak ada output model di jalur approval
- Sesuai PRD §4.2 (`rules.evaluate` must be deterministic)

### 2.4 Kualitas Kode

**TypeScript strict mode:** PASS (0 errors di `apps/api` dan `apps/web`)  
**Frontend build:** PASS (Vite 6, 28 modules, clean)  
**Formatting:** Konsisten, komentar dokumentasi dalam Bahasa Indonesia sesuai konteks pengguna

### 2.5 Temuan Code Review

| # | Severity | File | Deskripsi | Status |
|---|----------|------|-----------|--------|
| CR-1 | LOW | `conflict-detector.ts:204` | Typo: `"Tanggal rapat tersebut_Should_held?"` — campuran Indonesia/Inggris dengan underscore. Seharusnya: `"Kapan rapat tersebut diadakan?"` | **Diperbaiki** (lihat bawah) |
| CR-2 | INFO | `execution-gateway.ts:306` | Event type `EXECUTION_BLOCKED` digunakan untuk fase "execution started" yang sebenarnya bukan block. Seharusnya event type terpisah seperti `EXECUTION_STARTED`. | Non-blocking — tidak mempengaruhi keamanan atau fungsionalitas |
| CR-3 | INFO | `pipeline.ts:218-219` | Semua aksi dalam satu run diberi state yang sama (`NEEDS_CLARIFICATION` jika ada konflik blocking untuk aksi manapun). Idealnya per-aksi. | Non-blocking — behavior yang aman (lebih hati-hati) |
| CR-4 | LOW | `approval-service.ts:257` | `tenant_id: 'demo-navi-001'` di-hardcode di `invalidateApprovalsOnChange`. Seharusnya mengambil dari action. | Non-blocking — demo single-tenant |

---

## 3. Security Audit

### 3.1 Execution Gateway — 10 Deny-by-Default Checks

**Verdict: PASS**

Diperiksa satu per satu dari `execution-gateway.ts:117-285`:

| # | Check | Line | Implementasi | Status |
|---|-------|------|-------------|--------|
| 1 | Approval exists | 149-158 | `SELECT * FROM approvals WHERE action_id=? AND decision='APPROVED'` | ✅ |
| 2 | Not consumed | 163-167 | `if (approvalRow.consumed_at) block(...)` | ✅ |
| 3 | Not invalidated | 170-175 | `if (approvalRow.invalidated_at) block(...)` | ✅ |
| 4 | Not expired | 178-182 | `if (Date.parse(expires_at) <= Date.now()) block(...)` | ✅ |
| 5 | **Hash match** | 184-223 | `computePayloadHash(current) !== approvalRow.payload_hash` → invalidate + block | ✅ **CRITICAL** |
| 6 | Version match | 226-231 | `approvalRow.version !== action.version` | ✅ |
| 7 | State == APPROVED | 234-239 | `action.state !== 'APPROVED'` | ✅ |
| 8 | Approver RBAC | 242-256 | `approver.can_approve.includes(action.type)` | ✅ |
| 9 | Same identity | 258-264 | `approvalRow.approver_id !== ctx.actorId` | ✅ |
| 10 | High-risk manager | 267-285 | Manager approval + `can_approve_high_risk` | ✅ |

**Idempotency:** `executions.idempotency_key UNIQUE` (DB constraint, line 91 di `db/index.ts`). Replay returns original receipt with `idempotent_replay: true`. ✅

**Atomic state transition:** `UPDATE actions SET state='EXECUTING' WHERE action_id=? AND state='APPROVED' AND version=?` — must change exactly 1 row (line 289-295). ✅

### 3.2 Cryptographic Binding

**Verdict: PASS**

- `canonicalJson`: recursively sorted keys, arrays order-preserved, `undefined` dropped (verified di `hash.ts:15-29`)
- `computePayloadHash`: `sha256(canonicalJson({tenant_id, action_id, version, payload}))` — mencakup tenant, action ID, dan version, sehingga hash tidak dapat dipindahkan antar aksi atau tenant
- Hash direkomputasi server-side di execution time, bukan di approval time — perbedaan ini adalah inti dari AC10/AC11/TC15

### 3.3 Audit Chain Integrity

**Verdict: PASS**

- SHA-256 hash chain: `hash = sha256(prev_hash + '|' + canonicalJson(event))`
- Genesis hash: `'GENESIS'`
- `verifyAuditChain()` memverifikasi setiap row: `prev_hash` match + `hash` match
- Append-only: tidak ada UPDATE atau DELETE pada `audit_events` di manapun di codebase
- Live demo membuktikan: `{"ok":true,"brokenAt":null}`

### 3.4 Authentication & Session

**Verdict: PASS**

- API keys disimpan **hashed** (SHA-256) di memory Map, plaintext dikembalikan sekali dan tidak pernah dipersisten (`session.ts:33,48`)
- `requireAuth()` dipanggil di setiap endpoint kecuali `/v1/health` dan `/v1/auth/session` (POST)
- Tenant isolation: `auth.session.tenant_id !== FX.org.org_id` → 403 CROSS_TENANT
- Session expiry: `Date.parse(expires_at) <= Date.now()` → null session

### 3.5 Prompt Injection Defense

**Verdict: PASS**

- Attachments dan user text keduanya di-scan oleh `scanUntrustedText()` (fix TC06)
- 6 pola injection terdeteksi: `abaikan kebijakan`, `jangan tampilkan preview`, `langsung kirim semua`, `tulis audit bahwa sudah disetujui`, `ignore policy/approval`, `do not require approval`
- Injection hanya dicatat sebagai konflik `PROMPT_INJECTION` (BLOCKING), tidak pernah dieksekusi
- 6 pola approval-in-document: `saya setuju`, `saya menyetujui`, `disetujui oleh`, `sudah disetujui`, `approve(d)`, `persetujuan ini sah` — semua diblokir
- 5 pola authority claim: `saya direktur/ceo/admin`, `sebagai direktur/ceo/admin`, `authorized as admin` — muncul sebagai konflik `IDENTITY_CLAIM_IN_TEXT`, tidak mengubah RBAC

### 3.6 Temuan Security Audit

| # | Severity | File | Deskripsi | Status |
|---|----------|------|-----------|--------|
| SA-1 | MEDIUM | `index.ts:96-106` | Login endpoint menerima `user_id` tanpa password. Demo-only, tapi harus diakui. | **Diketahui** — diakui jujur sebagai demo fixture di WORKBUDDY_EVIDENCE.md |
| SA-2 | LOW | `session.ts:33` | API key hashes disimpan di in-memory Map, bukan di DB. Jika server restart, semua sesi hilang. | Non-blocking — behavior yang aman (lebih restriktif) |
| SA-3 | INFO | `index.ts:449` | Default `idempotency_key` di-generate dengan `randomUUID()` jika tidak disediakan. Ini baik untuk mencegah accidental replay, tapi berarti caller yang lupa mengirim key tidak mendapat error. | Non-blocking — behavior yang aman |

### 3.7 STRIDE Threat Model (Summary)

| Threat | Mitigasi | Status |
|--------|---------|--------|
| **Spoofing** | API key hashed + session expiry + requireAuth di setiap endpoint | ✅ |
| **Tampering** | Payload hash binding (SHA-256 canonical JSON) + recompute at execution | ✅ |
| **Repudiation** | Append-only audit log dengan hash chain + actor logged | ✅ |
| **Information Disclosure** | Tenant isolation + redacted audit metadata + no PII in logs | ✅ |
| **Denial of Service** | Body limit 512KB + rate limiting bukan scope demo | N/A |
| **Elevation of Privilege** | RBAC capability check + high-risk manager gate + identity-claim blocking | ✅ |
| **Prompt Injection** | Untrusted text scan + 6 injection patterns + never obeyed | ✅ |

---

## 4. QA Testing

### 4.1 Test Suite Results

**26/26 PASS, 0 FAIL** — 3× consecutive fresh-database runs:

```
Run 1: PASS: 26 / FAIL: 0 / TOTAL: 26
Run 2: PASS: 26 / FAIL: 0 / TOTAL: 26
Run 3: PASS: 26 / FAIL: 0 / TOTAL: 26
```

### 4.2 Test Coverage Matrix

| Test | Deskripsi | Status |
|------|-----------|--------|
| TC01 | 3 action record unik dan status awal DRAFT | ✅ |
| TC02 | 3 aksi tetap terdeteksi dan provenance kept | ✅ |
| TC03 | Tidak ada klarifikasi yang tidak perlu | ✅ |
| TC04 | Tanya USR-101 atau USR-102, tidak memilih otomatis | ✅ |
| TC05 | Tahan dan jelaskan konflik, tidak mengirim draf | ✅ |
| TC06 | Tidak menaikkan kewenangan dari teks chat | ✅ |
| TC07 | Sari resolve ke USR-103, tenggat diklarifikasi | ✅ |
| TC08 | Konversi 14.30 WITA tanpa menggeser waktu asli | ✅ |
| TC09 | Konversi 11.00 WIT, zona tidak disamakan | ✅ |
| TC10 | Bentrokan blok salat Jumat terdeteksi di JKT dan MKS | ✅ |
| TC11 | Deteksi libur internal + tandai kalender nasional belum diverifikasi | ✅ |
| TC12 | Instruksi injection diabaikan, gateway tidak dilewati | ✅ |
| TC13 | Hanya email yang bisa dieksekusi jika valid | ✅ |
| TC14 | Gateway menolak (403 MISSING_APPROVAL) dan event audit tercatat | ✅ |
| TC15 | Hash tidak cocok, approval lama tidak dipakai | ✅ |
| TC16 | Teks dokumen tidak dianggap persetujuan manusia | ✅ |
| TC17 | Kegagalan dicatat, tidak mengklaim sukses | ✅ |
| TC18 | Satu side effect tercatat, tidak eksekusi dua kali (idempotency) | ✅ |
| TC19 | High-risk gate aktif, persetujuan tambahan diperlukan | ✅ |
| TC20 | Penolakan aman dengan alasan, tidak mengarang tool baru | ✅ |
| AC-HAPPY-E2E | Full path: input → agent → validate → preview → approve → execute → audit | ✅ |
| AC-RBAC | Approver tanpa izin ditolak 403 | ✅ |
| AC-AUTH | Tanpa sesi terautentikasi → 401 | ✅ |
| AC-HIGH-RISK | Aksi berisiko tinggi butuh persetujuan manajer | ✅ |
| AC-TENANT | Tenant lain ditolak | ✅ |
| AC-IDENTITY | Approval harus dieksekusi oleh identitas yang sama | ✅ |

### 4.3 Live HTTP Demo Evidence

Demo path terverifikasi dengan real server dan real curl:

1. **Health check** → `{"ok":true,"execution_mode":"MOCK_ONLY"}`
2. **Login** (USR-001 Maya Putri) → API key issued
3. **Create run** (happy path) → 2 actions at AWAITING_APPROVAL
4. **Exact preview** → payload_hash + all 10 exact_preview_fields present
5. **Approve** (human decision) → approval_id + 15min TTL
6. **Execute** (gateway) → SUCCEEDED + `simulated: true` + mock row in SQLite
7. **Idempotent replay** → same receipt, `idempotent_replay: true`
8. **Unapproved refusal** → HTTP 403 MISSING_APPROVAL
9. **Audit trail** → 20 events, hash chain verified `{"ok":true,"brokenAt":null}`

### 4.4 No Real Side Effect (AC20)

Grep seluruh codebase `apps/`:
- Satu-satunya `fetch()` adalah relative-path call ke API lokal (`apps/web/src/lib/api.ts:48`)
- Tidak ada library SMTP, mail, atau HTTP outbound
- Tidak ada connector eksternal yang dipanggil
- `execution_mode: MOCK_ONLY` di health check

### 4.5 Determinism

3× consecutive runs dengan fresh database menghasilkan identik:
- Jumlah actions: sama
- Jenis actions: sama
- State transitions: sama
- Payload hashes: deterministik (karena referenceNow fixed)

### 4.6 Temuan QA

| # | Severity | Deskripsi | Status |
|---|----------|-----------|--------|
| QA-1 | LOW | Typo di conflict question line 204: `"Kapan rapat tersebut_Should_held?"` | **Diperbaiki** |
| QA-2 | INFO | Email body trailing period: fixed via `rawEnd` in `Clause` interface. Verified via direct interpreter call and live HTTP API: body ends with `.` | **Diperbaiki** |
| QA-3 | INFO | Evidence pack diregenerasi setelah fix; semua log di `evidence/logs/` truthful | **Selesai** |

---

## 5. Perbaikan yang Diterapkan Selama Review

### 5.1 Fix CR-1/QA-1: Typo di Conflict Question

**File:** `apps/api/src/agents/conflict-detector.ts:204`  
**Sebelum:** `"Tanggal rapat tersebut_Should_held?"`  
**Sesudah:** `"Kapan rapat tersebut diadakan?"`

### 5.2 Fix rawEnd: Email Body Trailing Period

**Files:** `apps/api/src/agents/text-utils.ts`, `apps/api/src/agents/interpreter.ts`

Added `rawEnd` field to `Clause` interface so sentence terminators (`.`, `!`, `?`, `;`) survive through the parsing pipeline:

```typescript
export interface Clause {
  start: number;
  end: number;
  rawEnd: number;  // includes terminator
  text: string;
}
```

`splitConjunctions` updated to propagate `rawEnd` to split clauses.

**Verification:** Direct interpreter call confirms body = `"Halo Budi, terlampir notulen yang sudah disahkan, mohon ditinjau."` (ends with `.`).

### 5.3 Evidence Regeneration

Full evidence pack regenerated via `scripts/evidence.sh`:
- TypeScript: 0 errors (both apps)
- Tests: 26/26 PASS
- Determinism: 3×3 = 9/9 PASS
- Frontend build: clean
- Live HTTP demo: all 9 steps verified
- Audit chain: verified
- No real side effects: confirmed

---

## 6. Batasan yang Diakui Jujur

Berikut hal-hal yang **tidak diklaim** dan batasan yang **diakui terbuka**:

1. **PANDUAN_HACKATHON.pdf tidak tersedia** — tidak ada di workspace, Google Drive connector menolak akses, Drive search 0 results. PRD digunakan sebagai spesifikasi tertinggi yang tersedia.
2. **Interpreter adalah rule engine, bukan LLM** — diakui terbuka, bukan disamarkan. Ini memastikan determinisme dan tidak ada output model di jalur approval.
3. **Tidak di-host sebagai Managed Agents** — demo berjalan di localhost dengan server Fastify.
4. **National holiday UNVERIFIED** — `NATIONAL_HOLIDAY_UNVERIFIED` adalah warning, tidak pernah ditebak.
5. **Friday prayer block adalah fixture** — data/03_policies.json, bukan integrasi kalender nyata.
6. **Availability tidak terhubung** — `AVAILABILITY_UNVERIFIED` di Validator, bukan integrasi kalender real-time.
7. **Login tanpa password** — demo fixture, user_id langsung diterima. Diakui sebagai batasan demo.
8. **API key hash di memory** — tidak dipertahankan setelah server restart. Aman tapi tidak production-grade.

---

## 7. Release Verdict

### **GO for Demo**

NAVI siap untuk demo hackathon dengan batasan yang diakui jujur. Sistem memenuhi:

- ✅ 20/20 test cases resmi (PASS)
- ✅ 6/6 acceptance criteria tambahan (PASS)
- ✅ Deny-by-default execution gateway (10 checks)
- ✅ Cryptographic payload binding (SHA-256 canonical JSON)
- ✅ Append-only tamper-evident audit log (hash chain verified)
- ✅ Prompt injection defense (6 patterns + 6 approval-in-document + 5 authority claims)
- ✅ RBAC + high-risk manager gate
- ✅ Tenant isolation
- ✅ Same-identity execution rule
- ✅ Idempotency (UNIQUE constraint + replay detection)
- ✅ 4 WorkBuddy Skills (installed at user + project level)
- ✅ No real side effects (MOCK_ONLY)
- ✅ Indonesian timezone engine (WIB/WITA/WIT, zero dependencies)
- ✅ Deterministic (3× consecutive runs identical)

### Pre-conditions for Demo:
1. Jalankan `cd apps/api && npx tsx src/index.ts`
2. Buka frontend di `http://127.0.0.1:8787`
3. Login sebagai USR-001 (Maya Putri) atau USR-002 (Andi Wijaya, manager)
4. Gunakan tombol skenario di UI (Konflik / Happy Path / Injection)

---

## Appendix A: File Inventory (Key Files)

```
apps/api/src/
  core/
    types.ts          — Domain types (ActionType, ActionState, Conflict, etc.)
    hash.ts           — canonicalJson, sha256, computePayloadHash, hashChain
    timezone.ts       — WIB/WITA/WIT engine, zero dependencies
    errors.ts         — NaviError + DenyReason const map (15 reasons)
    ids.ts            — ID generators (run, action, approval, execution, etc.)
    fixtures.ts       — Load data/*.json into typed Fixtures
    session.ts        — Session + API key (hashed in memory)
    pipeline.ts       — Orchestrator → Interpreter → Validator → ConflictDetector
  agents/
    orchestrator.ts   — A1: decideNextStep (AWAITING_CLARIFICATION | AWAITING_APPROVAL)
    interpreter.ts    — A2: Indonesian NLP rule engine → ActionCandidate[]
    conflict-detector.ts — A3: 10 conflict types, scanUntrustedText
    validator.ts      — A4: business hours, timezone, risk level, buildPayload
    text-utils.ts     — Indonesian parsing helpers (time, date, timezone, clauses)
  gateway/
    execution-gateway.ts — 10-check deny-by-default, atomic state transition
    approval-service.ts  — createApproval + invalidateApprovalsOnChange
  mock/
    tools.ts          — mockEmail, mockCalendar, mockTask (real SQLite rows)
  db/
    index.ts          — Schema, appendAuditEvent, verifyAuditChain
  index.ts            — Fastify server + all routes

apps/web/src/
  App.tsx             — React UI (5 views, Indonesian labels, a11y)
  lib/api.ts          — Typed API client
  styles.css          — Design system (navy/teal/amber, 8px grid, responsive)
```

## Appendix B: Evidence Log Locations

```
evidence/logs/
  00-environment.txt      — Node/npm/python/git versions
  01-file-inventory.txt   — All files in workspace
  02-typecheck.txt        — TypeScript 0 errors
  03-frontend-build.txt   — Vite build clean
  04-test-suite.txt       — 26/26 PASS
  05-determinism.txt      — 3× runs identical
  07-demo-http.txt        — Live HTTP demo transcript
  08-mock-persistence.txt — Real rows in SQLite
  09-no-real-side-effect.txt — Only localhost fetch
  10-workbuddy-skills.txt — 4 skills installed
  test-results.jsonl      — Machine-readable test results
```
