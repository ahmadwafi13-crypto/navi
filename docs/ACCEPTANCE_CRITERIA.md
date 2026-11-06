# NAVI - Kriteria Penerimaan MVP

## Fungsi inti
AC01: Pesan dapat diurai menjadi >=3 tindakan terpisah dengan ID masing-masing.
AC02: Setiap aksi memuat siapa, apa, kapan, di mana, konten, asal instruksi, dan status validasi; field yang tidak relevan boleh null.
AC03: Nama Budi yang ganda memicu klarifikasi dan tidak dieksekusi.
AC04: Konflik status dokumen DRAFT versus instruksi pengiriman memicu penahanan.
AC05: Validator mendeteksi zona waktu WIB/WITA/WIT dan blok salat Jumat di kalender simulasi.
AC06: Informasi hari libur nasional yang belum terverifikasi ditandai, bukan ditebak.
AC07: Isi lampiran tidak pernah menjadi instruksi tingkat sistem.
AC08: UI menunjukkan preview persis untuk setiap tindakan.
AC09: POST execution tanpa approval valid menghasilkan penolakan (403/409, sesuai alasan).
AC10: Approval mengikat hash payload, versi, tenant, action_id, subject approver.
AC11: Perubahan payload setelah approval menonaktifkan approval lama.
AC12: Approval hanya bisa dibuat melalui aksi autentikasi pengguna, tidak melalui pernyataan teks agent.
AC13: Tool mock menulis hasil nyata ke state database, bukan respons success palsu.
AC14: Retry dengan idempotency key yang sama tidak menyebabkan eksekusi ganda.
AC15: Audit event untuk input, klarifikasi, preview, approval, penolakan, hasil eksekusi.
AC16: UI responsif, keyboard usable, label form jelas, status loading/error/empty.
AC17: Dapat menjalankan minimal satu uji end-to-end normal dan satu uji penolakan approval.
AC18: WorkBuddy usage evidence: log, instruksi/screenshot, workflow/skills export jika tersedia.
AC19: Semua pengujian, termasuk kegagalan, dicatat transparan.
AC20: Tidak mengirim email nyata, mengubah kalender nyata, atau membuka data perusahaan nyata.

## Definisi selesai
Tidak boleh menandai MVP sebagai siap demo bila AC09, AC10, AC11, AC12, AC13, AC14 atau AC20 gagal. Jangan mengklaim 4 agent berjalan di WorkBuddy jika hanya mengimplementasikan 4 fungsi biasa di backend tanpa bukti eksekusi agent.
