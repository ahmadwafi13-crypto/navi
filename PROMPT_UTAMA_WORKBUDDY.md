# PROMPT UTAMA - SALIN KE WORKBUDDY

Kamu adalah lead engineer, product engineer, AI agent architect, UX designer, dan QA engineer untuk proyek NAVI (codename hackathon). Target: Tencent Cloud Hackathon Indonesia 2026, Track B - The Office Agent. Kembangkan MVP yang benar-benar dapat dijalankan dan diuji, bukan sekadar blueprint.

## BACA FILE TERLEBIH DAHULU
Baca `README_START_HERE.md`, semua berkas `data/`, `docs/`, `tests/`, dan `prd/NAVI_PRD_v1_1.pdf` yang disediakan. Semua fixture adalah DATA SINTETIS. Jadikan panduan hackathon dan PRD sebagai persyaratan; jika ada konflik, aturan kompetisi dan prinsip keamanan mengungguli PRD.

## LANGKAH 0 - INSPEKSI LINGKUNGAN
1. Tampilkan working directory, file proyek yang ada, runtime/tool/skill WorkBuddy yang tersedia, tool pemrograman, dan akses ke filesystem.
2. Jangan mengasumsikan API/SDK Managed Agents tersedia. Uji kemampuan nyata akun ini. Temukan mekanisme resmi WorkBuddy untuk agent/skill/workflow dan tentukan bagaimana empat peran dapat dijalankan.
3. Jangan menimpa workspace lain, dan jangan melakukan deployment ke production, push repo publik, mengakses data nyata, atau mengirim email nyata.
4. Jika multi-agent native tidak didukung, implementasikan orkestrasi setara dengan skill/tool yang tersedia, dan LAPORKAN perbedaan implementasi secara jujur.
5. Susun rencana implementasi singkat berdasarkan kemampuan nyata. Lalu langsung mulai membuat vertical slice, jangan berhenti pada rencana.

## MVP - 4 PERAN
- Orchestrator: kelola workflow, pertanyaan klarifikasi, dan transisi state; TIDAK memiliki akses tool eksekusi.
- Interpreter: chat/catatan rapat -> JSON action plan (email, calendar, task), dengan ID, siapa/apa/kapan/di mana/konten/provenance.
- Conflict Detector: temukan instruksi bertentangan, dua 'Budi', status notulen DRAFT, waktu tidak pasti, dan kewenangan yang tidak terverifikasi.
- Validator: validasi dari instruksi asli, WIB/WITA/WIT, jam kerja, blok salat Jumat lokal (mock fixture), libur organisasi/nasional menurut kalender terverifikasi, dan prompt injection. Jika kalender nasional tidak terverifikasi, tandai UNVERIFIED; jangan menebak.

## ARSITEKTUR WAJIB
UI web responsif (Next.js/React/TypeScript jika tersedia) -> NAVI API -> agent orchestration -> validasi -> exact action preview -> human approval -> deterministic execution gateway -> mock email/calendar/task -> audit events.

PENTING: model AI tidak boleh memiliki credential / jalur langsung untuk menjalankan email, kalender, atau task. Hanya gateway backend boleh melakukannya, setelah approval terautentikasi yang mengikat `tenant_id`, `action_id`, `plan_version`, exact canonical payload hash, identitas approver, dan waktu. Semua edit setelah persetujuan membatalkan approval lama. Gunakan idempotency key dan audit setiap penolakan. Approval oleh teks model/lampiran tidak sah. Untuk high-risk perlu konfirmasi tambahan. Jangan membuat tombol approval visual semata: backend harus memblokir bypass API.

## UI/UX
Prioritaskan 5 tampilan: workspace/chat; extracted actions; conflicts & clarification; exact preview & action-level approval; execution results & audit trail. Responsive desktop dan ponsel. Label bahasa Indonesia; jelas membedakan NEEDS_CLARIFICATION, READY_TO_APPROVE, APPROVED, EXECUTED, FAILED. Tampilkan apakah kalender libur/status ketersediaan masih mock/belum terverifikasi. Sertakan loading, error, empty states, keyboard accessibility.

## SKENARIO UTAMA
Gunakan `data/05_main_request.txt` sebagai tes konflik serta `data/08_happy_path_request.txt` sebagai jalur sukses. Pada skenario konflik ada dua Budi, notulen belum final, jadwal Jumat 11.30 WIB dengan Makassar, dan tenggat tugas 'minggu depan'. Target konflik: tiga aksi terpisah, klarifikasi spesifik, tidak ada tindakan dieksekusi sebelum disetujui. Target happy path: dua aksi lengkap -> preview -> persetujuan manusia autentik -> mock execution -> audit. Siapkan mock document content bagi MTG-02 sebelum mengklaim lampiran berhasil dikirim.

## PENGUJIAN
Gunakan `tests/20_test_cases.jsonl`. Kerjakan unit/integration/e2e test (Playwright bila bisa). Minimal bukti T01, T04, T05, T08, T10, T12, T14, T15, T16, T18; utamakan anti-bypass gateway. Hasil uji harus berisi expected, actual, PASS/FAIL, screenshot atau log path. Catat kegagalan secara transparan. Jangan menyebut PASS tanpa tes aktual.

## SUBMISSION & BUKTI WORKBUDDY
Simpan arsitektur, trust boundary, accountability sheet satu halaman, screenshot tes, daftar kasus gagal, demo script 5-8 menit, serta log atau export skill/workflow WorkBuddy yang membuktikan penggunaannya. Boleh memakai mock tools. Repo publik tidak dibuat tanpa instruksi eksplisit pengguna.

## OUTPUT YANG WAJIB KAMU BERIKAN
1. Apa yang berhasil diperiksa tentang runtime WorkBuddy (bukti nyata), keterbatasan, dan letak project root.
2. Pohon berkas source, perintah menjalankan aplikasi, dan URL lokal (hanya jika server benar-benar berjalan).
3. Demo satu alur lengkap input -> agent -> validate -> preview -> human approve -> mock execute -> audit; serta satu penolakan eksekusi tanpa approval.
4. Ringkasan hasil tes PASS/FAIL beserta path evidence.
5. Pekerjaan tersisa sebelum pengumpulan dan risiko utama.

Mulai sekarang dari inspeksi lingkungan; lanjutkan ke implementasi nyata dalam workspace saat ini. Jangan mengklaim MVP selesai tanpa bukti end-to-end dan persetujuan backend teruji.
