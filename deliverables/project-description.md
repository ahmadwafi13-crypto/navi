# NAVI - Deskripsi Proyek & Blurb

---

## Blurb (<=10 kata)

> Conflict-aware office agent: instruksi ambigu jadi tindakan aman, disetujui manusia.

*(10 kata)*

---

## Deskripsi Proyek

NAVI adalah office agent cerdas yang mengubah instruksi kerja sehari-hari dalam bahasa Indonesia — yang sering ambigu, tidak lengkap, atau bertentangan — menjadi rencana aksi terstruktur yang aman untuk dieksekusi. NAVI menangani tiga jenis tindakan: pengiriman email, penjadwalan kalender, dan pembuatan tugas.

### Masalah yang Diselesaikan

Di lingkungan kerja Indonesia, instruksi sering diberikan secara informal: "Tolong kirim notulen ke Pak Budi" atau "Jadwalkan rapat Jumat depan jam setengah dua belas". Instruksi ini mengandung ambiguitas: Budi yang mana? Jam berapa persis? Apakah dokumennya sudah final? Apakah jadwal bentrok? Tanpa klarifikasi, tindakan yang salah bisa terjadi — email salah kirim, rapat bentrok, atau dokumen draft terkirim.

### Solusi NAVI

NAVI menggunakan pipeline 4 agent yang dirancang untuk **tidak pernah mengeksekusi tanpa persetujuan manusia**:

1. **Interpreter** — memahami teks bahasa Indonesia, mendeteksi siapa/apa/kapan/di mana
2. **Conflict Detector** — menemukan ambiguitas (nama ganda, dokumen draft, bentrok jadwal, prompt injection)
3. **Validator** — memeriksa zona waktu WIB/WITA/WIT, jam kerja, blok salat Jumat, hari libur
4. **Orchestrator** — mengelola alur: klarifikasi dulu, baru pratinjau, baru persetujuan

### Trust Boundary

Yang membuat NAVI unik adalah **trust boundary** yang ketat:
- AI hanya boleh **mengusulkan**, tidak boleh mengeksekusi
- Eksekusi hanya melalui **gateway** dengan 10 pengecekan deny-by-default
- Setiap aksi diikat **hash SHA-256** — perubahan isi membatalkan persetujuan
- Persetujuan hanya sah dari **sesi terautentikasi**, bukan dari teks/dokumen
- Semua kejadian tercatat di **audit log** dengan hash chain yang tidak bisa dimanipulasi

### Dampak Terukur

| Metrik | Nilai |
|--------|-------|
| Test cases | 20/20 PASS (TC01-TC20) |
| Acceptance criteria | 20/20 PASS (AC01-AC20) |
| Konflik yang dideteksi | 10 jenis (ambigu kontak, dokumen draft, bentrok jadwal, prompt injection, dll) |
| Anti-bypass gateway | 10 cek deny-by-default, teruji TC14 & TC15 |
| Audit integrity | Hash chain SHA-256, terverifikasi |
| Bahasa yang didukung | Bahasa Indonesia (WIB/WITA/WIT, "jam setengah dua belas", "Jumat depan") |

### Teknologi

- **Backend:** Fastify 5, Node.js 22, TypeScript strict mode, SQLite (node:sqlite)
- **Frontend:** React 18, Vite 6, CSS design system (tanpa framework), responsif desktop & mobile
- **Arsitektur:** Single-server (API serve frontend sebagai static files)
- **Agent:** 4 WorkBuddy Skills (navi-orchestrator, navi-interpreter, navi-conflict-detector, navi-validator)
- **Mode:** MOCK_ONLY — tidak ada email/kalender/tugas nyata yang dikirim

### Roadmap Pengembangan

- Integrasi Google Drive / SharePoint untuk sumber notulensi nyata
- OAuth/SSO untuk autentikasi (Google Workspace, Microsoft Entra)
- Koneksi Gmail / Microsoft Graph untuk pengiriman email sungguhan
- Kalender nasional resmi (data pemerintah) untuk validasi hari libur
- Cloud deployment (free tier: Vercel/Render untuk hosting, Cloudflare R2 untuk storage)
