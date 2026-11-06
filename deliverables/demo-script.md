# NAVI - Demo Script (5-8 menit)

**URL aplikasi:** `http://127.0.0.1:8787`
**User demo:** Maya Putri (USR-001) - Koordinator, site JKT
**Waktu acuan:** Jumat, 6 November 2026, 10.00 WIB

---

## Persiapan (sebelum rekam)

```bash
cd D:/navi/NAVI
npm run build
PORT=8787 NAVI_REFERENCE_NOW=2026-11-06T10:00:00+07:00 npx tsx apps/api/src/index.ts
```

Buka browser: `http://127.0.0.1:8787`

---

## Bukti Rekaman

| Artefak | Lokasi |
|---------|--------|
| Video demo (5m13s, H.264, 1280x800, caption narasi Indonesia) | `evidence/video/navi-demo.mp4` |
| 11 screenshot UI | `evidence/screenshots/` |
| Cover 16:9 | `evidence/cover/navi-cover-16x9.png` |

Video direkam otomatis oleh `scripts/record-demo.mjs` (Playwright) dengan caption
narasi bahasa Indonesia di bagian bawah setiap adegan, sehingga tetap bisa
dipahami meski tanpa suara.

## Skenario 1: Jalur Konflik (3-4 menit)

### Langkah 1: Login (15 detik)
- Buka aplikasi di browser
- Pilih "Maya Putri (USR-001) - koordinator" dari dropdown
- Klik "Masuk"
- **Highlight:** Login menentukan izin approval dan identitas yang terautentikasi

### Langkah 2: Masukkan Instruksi (30 detik)
- Klik tab "Workspace"
- Klik tombol "Muat skenario konflik"
- Teks muncul: *"Tolong kirim notulen evaluasi operasional ke Pak Budi..."*
- Klik "Proses instruksi"
- **Highlight:** 3 aksi terdeteksi (email, kalender, tugas) — semua status NEEDS_CLARIFICATION

### Langkah 3: Lihat Rencana Aksi (30 detik)
- Tab "Rencana Aksi" otomatis aktif
- Tampilkan 3 kartu aksi: Email (Budi ambigu), Kalender (Jumat 11:30 bentrok), Tugas (tenggat tidak jelas)
- **Highlight:** Setiap aksi punya action_id unik, source_spans ke teks asli, status pill

### Langkah 4: Konflik & Klarifikasi (60 detik)
- Tab "Konflik & Klarifikasi" menampilkan 3 konflik blocking:
  1. **AMBIGUOUS_CONTACT** — "Pak Budi" bisa USR-101 atau USR-102
  2. **DOCUMENT_NOT_FINAL** — MTG-01 berstatus DRAFT_NOT_FINAL
  3. **FRIDAY_PRAYER_BLOCK** — jadwal 11:30 bentrok salat Jumat
- Klik opsi klarifikasi untuk Budi: pilih "Budi Santoso (USR-101)"
- **Highlight:** NAVI tidak menebak — bertanya dulu, baru resolve

### Langkah 5: Pratinjau (45 detik)
- Tab "Pratinjau & Persetujuan"
- Pilih aksi email yang sudah diklarifikasi
- Tampilkan: penerima, subjek, isi lengkap, lampiran (DOC-01.md), hash payload SHA-256
- **Highlight:** Yang Anda lihat di sini = persis yang akan dieksekusi. Hash menjamin tidak ada perubahan diam-diam

---

## Skenario 2: Jalur Sukses (2-3 menit)

### Langkah 6: Muat Jalur Sukses (20 detik)
- Kembali ke tab "Workspace"
- Klik "Muat jalur sukses"
- Teks: *"Kirim notulen MTG-02 yang sudah disahkan ke Budi Santoso (USR-101)..."*
- Klik "Proses instruksi"
- **Highlight:** 2 aksi, 0 konflik, validation pass=true, step=AWAITING_APPROVAL

### Langkah 7: Approve & Eksekusi (60 detik)
- Tab "Pratinjau & Persetujuan"
- Klik "Setujui tindakan ini" pada aksi email
- Klik "Jalankan (gateway)"
- **Highlight:** Gateway melakukan 10 cek, status berubah SUCCEEDED, receipt mock muncul

### Langkah 8: Audit Trail (30 detik)
- Tab otomatis pindah ke "Hasil & Audit"
- Tampilkan jejak audit: INPUT_RECEIVED → ACTIONS_PARSED → VALIDATED → APPROVED → EXECUTION_BLOCKED → MOCK_EXECUTED
- Badge hijau: "Hash chain utuh"
- **Highlight:** Setiap event punya hash SHA-256, saling terhubung, tidak bisa dimanipulasi

---

## Skenario 3: Penolakan Tanpa Approval (30 detik)

- Jalankan: `curl -s -X POST http://127.0.0.1:8787/internal/execute -H "Content-Type: application/json" -d '{"action_id":"ACT-TIDAKADA","idempotency_key":"test"}'`
- Response: `403 MISSING_APPROVAL`
- **Highlight:** Gateway menolak eksekusi tanpa approval valid — tidak bisa dibypass

---

## Pesan Penutup (15 detik)

NAVI memastikan: AI hanya usulkan, manusia setujui, baru dieksekusi. Tidak ada jalan pintas.

**Total durasi: 5-7 menit**
