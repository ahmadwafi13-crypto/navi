# NAVI - Paket data awal untuk WorkBuddy

**NAVI** adalah codename untuk Tencent Cloud Hackathon Indonesia 2026 Track B: The Office Agent. Paket ini berisi data uji sintetis, prompt, acceptance criteria, dan PRD. Tidak ada data organisasi nyata.

## Cara mulai
1. Ekstrak ZIP ke folder proyek NAVI yang baru, misalnya `C:/apps/navi` atau folder pilihan Anda.
2. Buka folder tersebut sebagai WORKSPACE ROOT di WorkBuddy. Jangan arahkan ke folder induk yang berisi banyak proyek.
3. Buka `PROMPT_UTAMA_WORKBUDDY.md`, salin seluruh isinya sebagai pesan pertama ke WorkBuddy.
4. Pastikan WorkBuddy membaca PRD, fixture, dan melakukan inspeksi kemampuan nyata sebelum mengklaim agent berjalan.
5. Setelah pembangunan awal, uji T14/T15 (tanpa approval/perubahan payload) terlebih dahulu.

## Yang sudah ada
- `prd/NAVI_PRD_v1_1.pdf` dan `.docx`: PRD versi sebelumnya, spesifikasi desain (bukan kode aplikasi yang sudah berjalan).
- `data/`: data organisasi, orang, aturan, percakapan konflik, skenario sukses, lampiran yang mengandung prompt injection, kalender simulasi.
- `docs/`: kontrak workflow, kriteria penerimaan, checklist submission.
- `tests/`: 20 test case dengan status NOT_RUN.

## Batas keamanan
- Semua nama fiktif, alamat email hanya `example.invalid`.
- Hanya mock tools; dilarang mengirim atau menyimpan tindakan ke aplikasi nyata.
- National holiday mock belum terverifikasi; jangan menyatakan dataset ini kalender nasional resmi.
- Label 4 agent sebagai TARGET DESIGN, bukan status agent yang sudah berjalan.
