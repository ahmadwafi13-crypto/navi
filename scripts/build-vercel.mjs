/**
 * Build script for Vercel deployment.
 *
 * 1. Bundles the API into a single JS file using esbuild
 *    (avoids node:sqlite import issues in Vercel build env)
 * 2. Builds the frontend with Vite
 * 3. Copies data/ fixtures to the output
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

async function main() {
  console.log('[build:vercel] Step 1: Bundle API with esbuild...');

  // Bundle the API server, marking node:sqlite as external
  // We'll provide a shim that falls back to MemDatabase
  await build({
    entryPoints: [resolve(ROOT, 'apps/api/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: resolve(ROOT, '.vercel-output/api-server.mjs'),
    sourcemap: false,
    // Mark node:sqlite as empty — we use the memory-db adapter instead
    alias: {
      'node:sqlite': resolve(ROOT, 'apps/api/src/db/memory-db-shim.ts'),
    },
    // Keep these external (available in Node.js runtime)
    external: ['fastify', '@fastify/static', '@fastify/cookie', 'zod'],
    logLevel: 'info',
  });

  console.log('[build:vercel] Step 2: Build frontend with Vite...');

  // Run vite build
  const { execSync } = await import('node:child_process');
  execSync('npm run build --workspace apps/web', {
    stdio: 'inherit',
    cwd: ROOT,
  });

  console.log('[build:vercel] Step 3: Copy data fixtures...');
  const dataSrc = resolve(ROOT, 'data');
  const dataDest = resolve(ROOT, '.vercel-output/data');
  if (existsSync(dataSrc)) {
    cpSync(dataSrc, dataDest, { recursive: true });
    console.log(`[build:vercel] Copied data/ to ${dataDest}`);
  }

  console.log('[build:vercel] Done!');
}

main().catch((err) => {
  console.error('[build:vercel] FAILED:', err);
  process.exit(1);
});
