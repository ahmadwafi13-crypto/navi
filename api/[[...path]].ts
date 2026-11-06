/**
 * Vercel Serverless Function — NAVI API
 *
 * Entry point untuk semua API requests di Vercel.
 * Frontend di-serve sebagai static files oleh Vercel CDN.
 * API routes /v1/* dan /internal/* di-rewrite ke file ini.
 *
 * Database: in-memory (MemDatabase), data di-reset per cold start.
 */

// @ts-expect-error - Vercel provides these types at runtime
import type { VercelRequest, VercelResponse } from '@vercel/node';

process.env.NAVI_DB_MODE = 'memory';
process.env.VERCEL = '1';

let cachedApp: any = null;

async function getApp() {
  if (cachedApp) return cachedApp;

  const path = await import('node:path');
  const cwd = process.cwd();
  process.env.NAVI_WORKSPACE_ROOT = cwd;

  // Try the esbuild-bundled version first (created by scripts/build-vercel.mjs)
  // Falls back to tsx for local development
  let serverModule: any;
  try {
    serverModule = await import(path.resolve(cwd, '.vercel-output/api-server.mjs'));
  } catch {
    // Fallback: use tsx to load the TypeScript source directly
    const { execSync } = await import('node:child_process');
    // This path is for local dev only; Vercel uses the bundled version
    serverModule = await import(path.resolve(cwd, 'apps/api/src/index.ts'));
  }

  const result = await serverModule.buildServer({
    dbPath: ':memory:',
    referenceNow: new Date(
      process.env.NAVI_REFERENCE_NOW ?? '2026-11-06T10:00:00+07:00',
    ),
  });

  await result.app.ready();
  cachedApp = result.app;
  return cachedApp;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = await getApp();

    // Reconstruct the original URL from Vercel's catch-all routing
    let url = req.url || '/';

    // For catch-all [[...path]], Vercel puts segments in req.query.path
    if (req.query && req.query.path) {
      const segments = Array.isArray(req.query.path)
        ? req.query.path
        : [String(req.query.path)];
      // Build path, preserving query string
      const pathStr = '/' + segments.filter(Boolean).join('/');
      // Preserve query string if present
      const qs = req.url?.split('?')[1];
      url = qs ? `${pathStr}?${qs}` : pathStr;
    }

    // Build payload
    let payload: string | undefined;
    if (req.body !== undefined && req.body !== null) {
      payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const result = await app.inject({
      method: req.method || 'GET',
      url,
      headers: req.headers as Record<string, string>,
      payload,
    });

    // Copy headers (skip hop-by-hop)
    const skip = ['content-encoding', 'transfer-encoding', 'connection', 'content-length'];
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        if (!skip.includes(key.toLowerCase())) {
          res.setHeader(key, value as string);
        }
      }
    }

    res.status(result.statusCode).send(result.body);
  } catch (error) {
    console.error('[NAVI Vercel] Error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
