/**
 * In-memory database adapter for Vercel serverless deployment.
 *
 * Implements the same interface as node:sqlite's DatabaseSync:
 *   - prepare(sql) -> Statement { run(...), get(...), all() }
 *   - exec(sql)
 *
 * All data lives in memory for the lifetime of the serverless instance.
 * On cold start the database is empty and fixtures re-seed it.
 *
 * This is sufficient for demo / hackathon purposes. For production,
 * use Turso (libSQL) or a managed PostgreSQL.
 */

type Row = Record<string, unknown>;

interface StoredRow {
  table: string;
  data: Row;
}

class MemStatement {
  private db: MemDatabase;
  private sql: string;

  constructor(db: MemDatabase, sql: string) {
    this.db = db;
    this.sql = sql.trim();
  }

  private parseTable(): string | null {
    // Extract table name from common SQL patterns
    let m = this.sql.match(/FROM\s+(\w+)/i);
    if (m) return m[1];
    m = this.sql.match(/INTO\s+(\w+)/i);
    if (m) return m[1];
    m = this.sql.match(/UPDATE\s+(\w+)/i);
    if (m) return m[1];
    m = this.sql.match(/TABLE\s+(\w+)/i);
    if (m) return m[1];
    m = this.sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (m) return m[1];
    return null;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const table = this.parseTable();
    if (!table) return { changes: 0, lastInsertRowid: 0 };

    // INSERT
    if (/^INSERT/i.test(this.sql)) {
      const placeholders = (this.sql.match(/\?/g) || []).length;
      const columns = this.db.schemas.get(table);
      if (columns) {
        const row: Row = {};
        columns.forEach((col, i) => {
          row[col] = params[i] ?? null;
        });
        this.db.tables.get(table)!.push(row);
        return { changes: 1, lastInsertRowid: this.db.tables.get(table)!.length };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    // UPDATE
    if (/^UPDATE/i.test(this.sql)) {
      const rows = this.db.tables.get(table) || [];
      let changes = 0;
      const setMatch = this.sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/is);
      const whereMatch = this.sql.match(/WHERE\s+(.+)$/is);

      if (setMatch) {
        // Parse each SET clause: either "col = ?" (placeholder) or "col = 'literal'" (inline)
        const setClauses = setMatch[1].split(',').map((s) => s.trim());
        const setBindings: Array<{ col: string; type: 'placeholder' | 'literal'; value?: unknown }> = [];
        let placeholderCount = 0;

        for (const clause of setClauses) {
          const eqIdx = clause.indexOf('=');
          if (eqIdx === -1) continue;
          const col = clause.substring(0, eqIdx).trim();
          const valuePart = clause.substring(eqIdx + 1).trim();

          if (valuePart === '?') {
            setBindings.push({ col, type: 'placeholder' });
            placeholderCount++;
          } else {
            // Literal value — strip quotes
            let val: unknown = valuePart;
            if (typeof val === 'string') {
              if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
                val = val.substring(1, val.length - 1);
              }
              // Handle NULL
              if (val === 'NULL' || val === 'null') val = null;
            }
            setBindings.push({ col, type: 'literal', value: val });
          }
        }

        for (const row of rows) {
          let matches = true;
          if (whereMatch) {
            matches = this.evalWhere(whereMatch[1], row, params, placeholderCount);
          }
          if (matches) {
            let paramIdx = 0;
            for (const binding of setBindings) {
              if (binding.type === 'placeholder') {
                row[binding.col] = params[paramIdx] ?? null;
                paramIdx++;
              } else {
                row[binding.col] = binding.value;
              }
            }
            changes++;
          }
        }
      }
      return { changes, lastInsertRowid: 0 };
    }

    // DELETE
    if (/^DELETE/i.test(this.sql)) {
      const rows = this.db.tables.get(table) || [];
      const whereMatch = this.sql.match(/WHERE\s+(.+)$/is);
      if (!whereMatch) {
        const count = rows.length;
        this.db.tables.set(table, []);
        return { changes: count, lastInsertRowid: 0 };
      }
      const remaining: Row[] = [];
      let changes = 0;
      for (const row of rows) {
        if (this.evalWhere(whereMatch[1], row, params, 0)) {
          changes++;
        } else {
          remaining.push(row);
        }
      }
      this.db.tables.set(table, remaining);
      return { changes, lastInsertRowid: 0 };
    }

    return { changes: 0, lastInsertRowid: 0 };
  }

  get(...params: unknown[]): Row | undefined {
    const table = this.parseTable();
    if (!table) return undefined;
    const rows = this.db.tables.get(table) || [];
    const whereMatch = this.sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/is);
    const orderMatch = this.sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/is);
    const limitMatch = this.sql.match(/LIMIT\s+(\d+)/i);

    let filtered = rows;
    if (whereMatch) {
      filtered = rows.filter((row) => this.evalWhere(whereMatch[1], row, params, 0));
    }
    if (orderMatch) {
      const orderCol = orderMatch[1].trim().split(/\s+/)[0];
      const isDesc = /DESC/i.test(orderMatch[1]);
      filtered.sort((a, b) => {
        const av = a[orderCol] as number | string;
        const bv = b[orderCol] as number | string;
        if (typeof av === 'number' && typeof bv === 'number') {
          return isDesc ? bv - av : av - bv;
        }
        return isDesc
          ? String(bv).localeCompare(String(av))
          : String(av).localeCompare(String(bv));
      });
    }
    const limit = limitMatch ? Number(limitMatch[1]) : 1;
    return filtered.slice(0, limit)[0];
  }

  all(...params: unknown[]): Row[] {
    const table = this.parseTable();
    if (!table) return [];
    const rows = this.db.tables.get(table) || [];
    const whereMatch = this.sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|$)/is);
    const orderMatch = this.sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/is);

    let filtered = rows;
    if (whereMatch) {
      filtered = rows.filter((row) => this.evalWhere(whereMatch[1], row, params, 0));
    }
    if (orderMatch) {
      const orderCol = orderMatch[1].trim().split(/\s+/)[0];
      const isDesc = /DESC/i.test(orderMatch[1]);
      filtered.sort((a, b) => {
        const av = a[orderCol] as number | string;
        const bv = b[orderCol] as number | string;
        if (typeof av === 'number' && typeof bv === 'number') {
          return isDesc ? bv - av : av - bv;
        }
        return isDesc
          ? String(bv).localeCompare(String(av))
          : String(av).localeCompare(String(bv));
      });
    }
    return filtered;
  }

  private evalWhere(
    clause: string,
    row: Row,
    params: unknown[],
    paramOffset: number,
  ): boolean {
    // Simple WHERE col = ? AND col2 = ? patterns
    // Also handles col IS NULL
    const conditions = clause.split(/\s+AND\s+/i);
    let paramIdx = paramOffset;

    for (const cond of conditions) {
      const trimmed = cond.trim();

      // col = ?
      let m = trimmed.match(/^(\w+)\s*=\s*\?$/);
      if (m) {
        if (row[m[1]] !== params[paramIdx]) return false;
        paramIdx++;
        continue;
      }

      // col != ? or col <> ?
      m = trimmed.match(/^(\w+)\s*(?:!=|<>)\s*\?$/);
      if (m) {
        if (row[m[1]] === params[paramIdx]) return false;
        paramIdx++;
        continue;
      }

      // col > ?
      m = trimmed.match(/^(\w+)\s*>\s*\?$/);
      if (m) {
        if (!(Number(row[m[1]]) > Number(params[paramIdx]))) return false;
        paramIdx++;
        continue;
      }

      // col < ?
      m = trimmed.match(/^(\w+)\s*<\s*\?$/);
      if (m) {
        if (!(Number(row[m[1]]) < Number(params[paramIdx]))) return false;
        paramIdx++;
        continue;
      }

      // col IS NULL
      m = trimmed.match(/^(\w+)\s+IS\s+NULL$/i);
      if (m) {
        if (row[m[1]] !== null && row[m[1]] !== undefined) return false;
        continue;
      }

      // col IS NOT NULL
      m = trimmed.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
      if (m) {
        if (row[m[1]] === null || row[m[1]] === undefined) return false;
        continue;
      }

      // ORDER BY seq DESC LIMIT 1 -> skip non-where clauses
      if (/^ORDER\s+BY/i.test(trimmed)) continue;
      if (/^LIMIT/i.test(trimmed)) continue;

      // Unknown condition — assume true (permissive for complex queries)
    }

    return true;
  }
}

export class MemDatabase {
  tables = new Map<string, Row[]>();
  schemas = new Map<string, string[]>();

  prepare(sql: string): MemStatement {
    return new MemStatement(this, sql);
  }

  exec(sql: string): void {
    // Parse CREATE TABLE statements to extract column names
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);

    for (const stmt of statements) {
      // Skip PRAGMA statements
      if (/^PRAGMA/i.test(stmt)) continue;

      // CREATE TABLE
      const tableMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.+)\)/is);
      if (tableMatch) {
        const tableName = tableMatch[1];
        const body = tableMatch[2];
        const columns = this.parseColumns(body);
        if (!this.tables.has(tableName)) {
          this.tables.set(tableName, []);
        }
        this.schemas.set(tableName, columns);
        continue;
      }

      // CREATE INDEX — skip
      if (/^CREATE\s+INDEX/i.test(stmt)) continue;
    }
  }

  private parseColumns(body: string): string[] {
    const columns: string[] = [];
    // Split by commas, but not inside parentheses
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of body) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());

    for (const part of parts) {
      // Skip FOREIGN KEY constraints
      if (/^FOREIGN\s+KEY/i.test(part)) continue;
      // Skip standalone PRIMARY KEY (multi-column) constraints
      // but NOT inline "column_name TEXT PRIMARY KEY"
      if (/^PRIMARY\s+KEY/i.test(part)) continue;
      // Skip standalone UNIQUE/CHECK/CONSTRAINT clauses
      if (/^(UNIQUE|CHECK|CONSTRAINT)\s/i.test(part)) continue;

      // Column name is the first word
      const colName = part.split(/\s+/)[0];
      if (colName && !/^(FOREIGN|PRIMARY|UNIQUE|CHECK|CONSTRAINT)$/i.test(colName)) {
        columns.push(colName);
      }
    }

    return columns;
  }
}
