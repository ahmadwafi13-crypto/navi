# Deploy NAVI ke Vercel

## Prasyarat

- Akun Vercel (daftar gratis di https://vercel.com)
- Vercel CLI: `npm i -g vercel`
- Node.js 22+

## Cara Deploy

### 1. Login ke Vercel CLI

```bash
vercel login
```

### 2. Deploy dari root project

```bash
cd D:\navi\NAVI
vercel
```

Pada prompt pertama:
- **Set up and deploy?** → Y
- **Which scope?** → pilih akun Anda
- **Link to existing project?** → N
- **Project name?** → navi (atau nama lain)
- **In which directory?** → . (root)
- **Override settings?** → N (vercel.json sudah dikonfigurasi)

### 3. Deploy ke production

```bash
vercel --prod
```

Vercel akan:
1. Menjalankan `node scripts/build-vercel.mjs` yang:
   - Bundle API dengan esbuild → `.vercel-output/api-server.mjs`
   - Build frontend dengan Vite → `apps/web/dist/`
   - Copy `data/` fixtures
2. Deploy frontend sebagai static CDN
3. Deploy `api/[[...path]].ts` sebagai serverless function
4. Apply routing dari `vercel.json`

### 4. Akses aplikasi

Setelah deploy, Anda dapatkan URL seperti:
```
https://navi-xxxxx.vercel.app
```

Buka di browser → aplikasi NAVI siap digunakan.

## Arsitektur Vercel

```
Browser → Vercel CDN (static frontend)
       ↘ /v1/* dan /internal/* → Serverless Function (Fastify + MemDatabase)
```

| Komponen | Lokasi | Catatan |
|----------|--------|---------|
| Frontend (React) | Static CDN dari `apps/web/dist/` | Vite build output |
| API (Fastify) | Serverless Function `api/[[...path]].ts` | 30s max duration, 1024MB |
| Database | In-memory (MemDatabase) | Di-reset per cold start |
| Fixtures | `.vercel-output/data/*.json` | Read-only di serverless runtime |

## Limitasi (Demo Mode)

1. **Database ephemeral**: Data hilang saat serverless function cold start (~15 menit idle). Cukup untuk demo hackathon.
2. **Session tidak persist**: Jika cold start terjadi di tengah sesi, user perlu login ulang.
3. **Single instance**: Tidak ada shared state antar serverless instances.

## Untuk Production

Ganti MemDatabase dengan:
- **Turso** (libSQL serverless SQLite, gratis tier 500 DB) — https://turso.tech
- **PlanetScale** (MySQL serverless) — https://planetscale.com
- **Neon** (PostgreSQL serverless) — https://neon.tech

## Troubleshooting

### Build gagal
```bash
# Hapus cache dan rebuild
rm -rf .vercel-output apps/web/dist
node scripts/build-vercel.mjs
```

### API 404
Pastikan `vercel.json` rewrites sudah benar:
```json
"rewrites": [
  { "source": "/v1/:path*", "destination": "/api/v1/:path*" },
  { "source": "/internal/:path*", "destination": "/api/internal/:path*" }
]
```

### Login gagal (401)
Serverless function cold start menghapus in-memory database. Refresh halaman dan login ulang.

## Test Lokal (sebelum deploy)

```bash
# Build dan test bundled API
node scripts/build-vercel.mjs
node scripts/test-vercel-e2e.mjs

# Atau test dengan Vercel dev server
vercel dev
```
