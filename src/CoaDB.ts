// ─── CoaDB — Serverless Database Client ──────────────────────────────────────
// Lightweight client for querying COA-managed PostgreSQL databases from
// serverless environments (Vercel, Netlify, Cloudflare Workers, AWS Lambda).
//
// Uses HTTPS via the COA REST API — no TCP connections, no drivers, no
// cloudflared tunnel needed. Works anywhere that supports `fetch()`.
//
// Usage:
//   import { CoaDB } from 'coa-service-sdk';
//
//   const db = new CoaDB({
//     apiUrl:     process.env.COA_API_URL!,   // https://coa-service.cloud/api/v1
//     apiKey:     process.env.COA_API_KEY!,
//     databaseId: process.env.COA_DB_ID!,
//   });
//
//   const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [42]);
//   await db.transaction([
//     { sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [100, fromId] },
//     { sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [100, toId] },
//   ]);

import type { QueryResult, TransactionResult, CoaDBOptions, TransactionQuery } from './types';

export class CoaDB {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly databaseId: string;

  constructor(opts: CoaDBOptions) {
    if (!opts.apiUrl)     throw new Error('CoaDB: apiUrl is required');
    if (!opts.apiKey)     throw new Error('CoaDB: apiKey is required');
    if (!opts.databaseId) throw new Error('CoaDB: databaseId is required');

    this.apiUrl     = opts.apiUrl.replace(/\/$/, '');
    this.apiKey     = opts.apiKey;
    this.databaseId = opts.databaseId;
  }

  // ─── Internal HTTP helper ──────────────────────────────────────────────────

  private async request<T>(path: string, body: object): Promise<T> {
    const url = `${this.apiUrl}/databases/${this.databaseId}${path}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    this.apiKey,
      },
      body: JSON.stringify(body),
      // Prevent caching in serverless/edge runtimes
      ...(typeof Request !== 'undefined' && 'cache' in new Request(url) ? { cache: 'no-store' as any } : {}),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw new Error(
        `CoaDB ${path} failed (HTTP ${res.status}): ${(err as any).message || JSON.stringify(err)}`,
      );
    }

    const json = await res.json() as { data: T };
    return json.data;
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  /**
   * Execute a SQL query with optional parameterized values.
   *
   * Uses `$1, $2, …` placeholders for SQL injection protection.
   *
   * ```ts
   * // Simple query
   * const { rows } = await db.query('SELECT * FROM users');
   *
   * // Parameterized query (recommended)
   * const { rows } = await db.query(
   *   'SELECT * FROM users WHERE email = $1 AND active = $2',
   *   ['alice@example.com', true],
   * );
   *
   * // Insert
   * const { rows } = await db.query(
   *   'INSERT INTO posts (title, body) VALUES ($1, $2) RETURNING *',
   *   ['Hello', 'World'],
   * );
   * ```
   *
   * @param sql    SQL query (max 50 KB). Use `$1, $2, …` for parameters.
   * @param params Parameter values for `$1, $2, …` placeholders (max 500).
   * @returns      `{ columns, rows, rowCount, command, durationMs }`
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.request<QueryResult<T>>('/query', {
      sql,
      ...(params && params.length > 0 ? { params } : {}),
    });
  }

  // ─── Transaction ───────────────────────────────────────────────────────────

  /**
   * Execute multiple queries in a single atomic transaction.
   * All queries succeed together or are fully rolled back on any error.
   *
   * ```ts
   * // Transfer funds atomically
   * const { results } = await db.transaction([
   *   { sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [100, fromId] },
   *   { sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [100, toId] },
   *   { sql: 'INSERT INTO transfers (from_id, to_id, amount) VALUES ($1, $2, $3) RETURNING *', params: [fromId, toId, 100] },
   * ]);
   * ```
   *
   * @param queries Array of `{ sql, params? }` objects (max 50 queries).
   * @returns       `{ results, durationMs }` — results is an array of QueryResult objects.
   */
  async transaction(queries: TransactionQuery[]): Promise<TransactionResult> {
    return this.request<TransactionResult>('/transaction', { queries });
  }

  // ─── Convenience helpers ───────────────────────────────────────────────────

  /**
   * Execute a query and return just the rows array.
   *
   * ```ts
   * const users = await db.rows('SELECT * FROM users WHERE active = $1', [true]);
   * // users → [{ id: 1, name: 'Alice' }, …]
   * ```
   */
  async rows<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute a query and return only the first row, or `null` if no rows.
   *
   * ```ts
   * const user = await db.one('SELECT * FROM users WHERE id = $1', [42]);
   * // user → { id: 42, name: 'Alice' } or null
   * ```
   */
  async one<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] ?? null;
  }
}
