# NAVI - Accountability Sheet

**Kompetisi:** Tencent Cloud Hackathon Indonesia 2026, Track B - The Office Agent
**Workspace:** `D:/navi/NAVI`
**Tanggal:** 6 November 2026

---

## Identitas Proyek

NAVI adalah office agent yang mengubah instruksi bahasa Indonesia yang ambigu menjadi tindakan aman (email, kalender, tugas) dengan persetujuan manusia yang terautentikasi. Tidak ada tindakan yang dieksekusi tanpa approval eksplisit.

## Arsitektur Trust Boundary (1 halaman)

```
Pengguna (terautentikasi via sesi)
   |
   v
[UI React 5-tab] ──> [Fastify API]
   |                      |
   |      ┌──────────────┴──────────────┐
   |      |                             |
   v      v                             |
[Workspace] ──> Pipeline 4 Agent:       |
   |            A1 Orchestrator          |
   |            A2 Interpreter           |
   |            A3 Conflict Detector     |
   |            A4 Validator             |
   |                                     |
   v                                     v
[Rencana Aksi] ──> [Approval Service] ──> [Execution Gateway]
   |            (RBAC + hash binding)    (10 deny-by-default checks)
   |                                     |
   v                                     v
[Konflik]        [Pratinjau & Approve]   [Mock Tool] ──> [SQLite]
   |                                     |               (audit hash chain)
   v                                     v
[Klarifikasi]    [Audit Trail] <─────────┘
```

## Siapa Bertanggung Jawab atas Apa

| Komponen | File | Tanggung Jawab | Bisa Eksekusi? |
|----------|------|----------------|----------------|
| A1 Orchestrator | `agents/orchestrator.ts` | Tentukan langkah berikutnya | Tidak |
| A2 Interpreter | `agents/interpreter.ts` | Parse teks Indonesia → aksi terstruktur | Tidak |
| A3 Conflict Detector | `agents/conflict-detector.ts` | Deteksi 10 jenis konflik | Tidak |
| A4 Validator | `agents/validator.ts` | Validasi zona waktu, kebijakan, risk | Tidak |
| Approval Service | `gateway/approval-service.ts` | RBAC, hash binding, expiry | Tidak |
| Execution Gateway | `gateway/execution-gateway.ts` | 10 deny-by-default checks + eksekusi | Ya (satu-satunya) |
| Mock Tools | `mock/*.ts` | Tulis ke SQLite, bukan layanan nyata | Hanya via gateway |
| Audit Log | `db/index.ts` | Append-only hash chain SHA-256 | Passive |

## Prinsip Keamanan

1. **Deny-by-default:** gateway menolak kecuali 10 kondisi terpenuhi (approval exists, not consumed, not invalidated, not expired, hash match, version match, state=APPROVED, approver RBAC, same-identity, high-risk manager gate)
2. **Hash binding:** `sha256(canonicalJson({tenant_id, action_id, version, payload}))` — perubahan payload membatalkan approval
3. **No text-as-approval:** teks dari chat, dokumen, atau lampiran tidak pernah menjadi persetujuan
4. **Idempotency:** key unik mencegah eksekusi ganda
5. **Append-only audit:** setiap event terhubung via hash chain, dapat diverifikasi

## Batas yang Diklaim Jujur

- Semua data adalah fixture sintetis (domain `example.invalid`)
- Eksekusi mode `MOCK_ONLY` — tidak ada email/kalender/tugas nyata
- Interpreter adalah rule engine deterministik, bukan LLM
- Kalender libur nasional ditandai `UNVERIFIED` — NAVI tidak menebak
- Blok salat Jumat adalah fixture simulasi, bukan fatwa resmi
