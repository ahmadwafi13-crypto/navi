/**
 * Shim for node:sqlite in the Vercel build.
 *
 * When esbuild bundles the API, it replaces `import { DatabaseSync } from 'node:sqlite'`
 * with this module. The shim re-exports MemDatabase as DatabaseSync,
 * so the code runs without the native SQLite module.
 */

export { MemDatabase as DatabaseSync } from './memory-db.js';
export type { MemDatabase as DatabaseSyncType } from './memory-db.js';
