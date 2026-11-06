# Hackathon checklist (sesuai panduan, dilengkapi sebelum submit)

[x] Judul NAVI (codename hackathon)
[x] Blurb <=10 kata — `deliverables/project-description.md` (10 kata)
[x] Deskripsi proyek & dampak terukur — `deliverables/project-description.md`
[x] Accountability Sheet 1 halaman — `deliverables/accountability-sheet.md`
[x] Hasil test resmi dan internal lengkap screenshot, termasuk gagal — log di `evidence/logs/`, 11 screenshot UI di `evidence/screenshots/`
[x] Diagram arsitektur dan trust boundaries — `deliverables/architecture-overview.md` + `deliverables/accountability-sheet.md`
[x] Demo 5-8 menit — `deliverables/demo-script.md` (skrip) + `evidence/video/navi-demo.mp4` (5m13s, 1280x800, H.264, dengan caption narasi Indonesia)
[x] Penjelasan kontribusi WorkBuddy yang benar-benar terjadi — `WORKBUDDY_EVIDENCE.md`
[~] Repo publik ATAU ekspor WorkBuddy workflow + bukti penggunaannya — skill terpasang di `~/.workbuddy-ai/skills/navi-*` dan `.workbuddy-ai/skills/`; bukti penggunaan di `WORKBUDDY_EVIDENCE.md`; repo publik belum dibuat (per instruksi: tidak push tanpa instruksi eksplisit)
[x] Opsional cover 16:9 — `evidence/cover/navi-cover-16x9.png` (1920x1080)
[x] Bonus tautan live jika stabil — `http://127.0.0.1:8787` (lokal)

## Item yang masih perlu tindakan manual

1. **Repo publik** (opsional) — jika diperlukan, push ke GitHub dengan `.gitignore` yang mengecualikan `node_modules/`, `data/navi-runtime.sqlite`, `.workbuddy-ai/`
2. **Voice-over opsional untuk video** — video sudah punya caption narasi; rekam suara naratif bila diinginkan presentasi lisan

## Bukti yang Dihasilkan

| Artefak | Lokasi | Detail |
|---------|--------|--------|
| Screenshot UI (11) | `evidence/screenshots/` | Login, workspace, konflik, action plan, pratinjau, approve, execute, audit |
| Video demo | `evidence/video/navi-demo.mp4` | 313 detik, 1280x800, H.264, subtitle narasi |
| Cover 16:9 | `evidence/cover/navi-cover-16x9.png` | 1920x1080 PNG |
| Log test | `evidence/logs/` | 12 file termasuk test-results.jsonl (TC01-TC20) |
| Dokumen submission | `deliverables/` | accountability-sheet, demo-script, project-description, architecture-overview |

## Batas

Jangan gunakan KIVO/TARA di submission. Jangan publikasikan secrets/token atau data organisasi asli. Pemeriksaan registrasi tim dan batas pengumpulan merupakan proses terpisah.
