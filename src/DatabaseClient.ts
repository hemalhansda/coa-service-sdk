// ─── DatabaseClient ───────────────────────────────────────────────────────────
// Sub-client for managed PostgreSQL database operations.
// Used via `coa.databases` — not instantiated directly.

import fs from 'fs';
import path from 'path';
import {
  DatabaseInfo,
  DatabaseCreatedResult,
  CreateDatabaseOptions,
  ImportSqlResult,
  ImportSqlOptions,
  SchemaResult,
  ConnectionInfo,
  DatabaseMetrics,
  TableListItem,
  TableDetail,
  QueryResult,
  TransactionQuery,
  TransactionResult,
} from './types';

type FetchFn  = (urlPath: string, init?: RequestInit) => Promise<Response>;
type ParseFn  = <T>(res: Response, operation: string) => Promise<T>;

export class DatabaseClient {
  private readonly fetch: FetchFn;
  private readonly parse: ParseFn;

  /** @internal — use `coa.databases` instead */
  constructor(fetchFn: FetchFn, parseFn: ParseFn) {
    this.fetch = fetchFn;
    this.parse = parseFn;
  }

  // ─── List all databases ────────────────────────────────────────────────────

  /**
   * List all managed databases for the authenticated user.
   *
   * ```ts
   * const dbs = await coa.databases.list();
   * console.log(dbs); // [{ id, name, status, host, port, … }]
   * ```
   */
  async list(): Promise<DatabaseInfo[]> {
    const res = await this.fetch('/api/v1/databases');
    const json = await this.parse<{ data: DatabaseInfo[] }>(res, 'databases.list');
    return json.data ?? (json as unknown as DatabaseInfo[]);
  }

  // ─── Get a single database ────────────────────────────────────────────────

  /**
   * Get details for a specific database.
   *
   * ```ts
   * const db = await coa.databases.get('uuid-…');
   * console.log(db.status); // 'AVAILABLE'
   * ```
   */
  async get(databaseId: string): Promise<DatabaseInfo> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}`);
    const json = await this.parse<{ data: DatabaseInfo }>(res, 'databases.get');
    return json.data ?? (json as unknown as DatabaseInfo);
  }

  // ─── Create a new database ────────────────────────────────────────────────

  /**
   * Provision a new PostgreSQL database.
   * Returns the credentials (password + connection string) **once** — save them immediately.
   *
   * ```ts
   * const db = await coa.databases.create({ name: 'my-app-db' });
   * console.log(db.connectionString); // postgresql://coa:SECRET@host:6001/my_app_db
   * ```
   */
  async create(opts: CreateDatabaseOptions): Promise<DatabaseCreatedResult> {
    const body = JSON.stringify({
      name: opts.name,
      ...(opts.dbName && { dbName: opts.dbName }),
      ...(opts.dbUser && { dbUser: opts.dbUser }),
      ...(opts.dbPassword && { dbPassword: opts.dbPassword }),
    });
    const res = await this.fetch('/api/v1/databases', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await this.parse<{ data: DatabaseCreatedResult; message: string }>(res, 'databases.create');
    return json.data ?? (json as unknown as DatabaseCreatedResult);
  }

  // ─── Stop a running database ──────────────────────────────────────────────

  /**
   * Stop (pause) a running database. Data is preserved.
   *
   * ```ts
   * await coa.databases.stop('uuid-…');
   * ```
   */
  async stop(databaseId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/stop`, { method: 'POST' });
    await this.parse(res, 'databases.stop');
  }

  // ─── Start a stopped database ─────────────────────────────────────────────

  /**
   * Start a previously stopped database.
   *
   * ```ts
   * await coa.databases.start('uuid-…');
   * ```
   */
  async start(databaseId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/start`, { method: 'POST' });
    await this.parse(res, 'databases.start');
  }

  // ─── Delete a database ────────────────────────────────────────────────────

  /**
   * Permanently delete a database and all its data.
   *
   * ```ts
   * await coa.databases.delete('uuid-…');
   * ```
   */
  async delete(databaseId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}`, { method: 'DELETE' });
    await this.parse(res, 'databases.delete');
  }

  // ─── Import SQL file ──────────────────────────────────────────────────────

  /**
   * Import a `.sql` file into a managed database. Executes within a transaction.
   *
   * ```ts
   * const result = await coa.databases.importSql({
   *   databaseId: 'uuid-…',
   *   filePath: './schema.sql',
   * });
   * console.log(result.statementsRun); // 42
   * ```
   */
  async importSql(opts: ImportSqlOptions): Promise<ImportSqlResult> {
    const { databaseId, filePath: sqlPath } = opts;

    const resolved = path.resolve(sqlPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`SQL file not found: ${resolved}`);
    }
    if (!resolved.endsWith('.sql')) {
      throw new Error('Only .sql files are supported');
    }

    const stat = fs.statSync(resolved);
    if (stat.size > 10 * 1024 * 1024) {
      throw new Error('SQL file exceeds 10 MB limit');
    }

    const fileData = fs.readFileSync(resolved);
    const fileName = path.basename(resolved);

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([fileData], { type: 'application/sql' }),
      fileName,
    );

    const res = await this.fetch(`/api/v1/databases/${databaseId}/import`, {
      method: 'POST',
      body: formData,
    });

    return this.parse<ImportSqlResult>(res, 'databases.importSql');
  }

  // ─── Schema introspection / ERD ───────────────────────────────────────────

  /**
   * Introspect the database schema — returns tables, columns, keys, and a Mermaid ERD.
   *
   * ```ts
   * const schema = await coa.databases.getSchema('uuid-…');
   * console.log(schema.tables);    // [{ name: 'users', columns: […], … }]
   * console.log(schema.mermaidERD); // erDiagram\n  users { … }
   *
   * // Write ERD to a file
   * fs.writeFileSync('erd.mmd', schema.mermaidERD);
   * ```
   */
  async getSchema(databaseId: string): Promise<SchemaResult> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/schema`);
    const json = await this.parse<{ data: SchemaResult }>(res, 'databases.getSchema');
    return json.data ?? (json as unknown as SchemaResult);
  }

  // ─── Connection info (ORM snippets) ───────────────────────────────────────

  /**
   * Get connection details formatted for every popular ORM and driver.
   * Includes ready-to-paste snippets for Prisma, Sequelize, TypeORM, Drizzle,
   * node-postgres, Knex, Python, .env, and raw URI.
   *
   * ```ts
   * const info = await coa.databases.getConnectionInfo('uuid-…');
   * console.log(info.prisma);     // datasource db { … }
   * console.log(info.sequelize);  // new Sequelize({ … })
   * console.log(info.env);        // DATABASE_URL="postgresql://…"
   * ```
   */
  async getConnectionInfo(databaseId: string): Promise<ConnectionInfo> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/connection-info`);
    const json = await this.parse<{ data: ConnectionInfo }>(res, 'databases.getConnectionInfo');
    return json.data ?? (json as unknown as ConnectionInfo);
  }

  // ─── Live database metrics ────────────────────────────────────────────────

  /**
   * Query live database metrics — size, active connections, cache hit ratio,
   * transaction stats, PostgreSQL settings, and uptime.
   *
   * ```ts
   * const m = await coa.databases.getMetrics('uuid-…');
   * console.log(m.sizeHuman);          // "12.4 MB"
   * console.log(m.connections.active);  // 3
   * console.log(m.maxConnections);      // 100
   * console.log(m.cacheHitRatio);       // "99.87%"
   * console.log(m.settings);            // { max_connections: "100", … }
   * ```
   */
  async getMetrics(databaseId: string): Promise<DatabaseMetrics> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/metrics`);
    const json = await this.parse<{ data: DatabaseMetrics }>(res, 'databases.getMetrics');
    return json.data ?? (json as unknown as DatabaseMetrics);
  }

  // ─── SQL Explorer — list tables ───────────────────────────────────────────

  /**
   * List all tables in a managed database.
   *
   * ```ts
   * const tables = await coa.databases.listTables('uuid-…');
   * tables.forEach(t => console.log(t.name, t.rowEstimate));
   * ```
   */
  async listTables(databaseId: string): Promise<TableListItem[]> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/tables`);
    const json = await this.parse<{ data: TableListItem[] }>(res, 'databases.listTables');
    return json.data ?? (json as unknown as TableListItem[]);
  }

  // ─── SQL Explorer — table detail ──────────────────────────────────────────

  /**
   * Get detailed column, index, and foreign-key info for a single table.
   *
   * ```ts
   * const detail = await coa.databases.getTableDetail('uuid-…', 'users');
   * detail.columns.forEach(c => console.log(c.name, c.dataType, c.isPrimaryKey));
   * ```
   *
   * @param schema — Optional schema name (defaults to `public`).
   */
  async getTableDetail(databaseId: string, table: string, schema?: string): Promise<TableDetail> {
    const qs = schema ? `?schema=${encodeURIComponent(schema)}` : '';
    const res = await this.fetch(`/api/v1/databases/${databaseId}/tables/${encodeURIComponent(table)}${qs}`);
    const json = await this.parse<{ data: TableDetail }>(res, 'databases.getTableDetail');
    return json.data ?? (json as unknown as TableDetail);
  }

  // ─── SQL Explorer — execute query ─────────────────────────────────────────

  /**
   * Execute a SQL query with optional parameterized values ($1, $2, …).
   *
   * ```ts
   * // Simple query
   * const result = await coa.databases.query('uuid-…', 'SELECT * FROM users LIMIT 10');
   *
   * // Parameterized query (recommended for user input)
   * const result = await coa.databases.query(
   *   'uuid-…',
   *   'SELECT * FROM users WHERE email = $1 AND active = $2',
   *   ['alice@example.com', true],
   * );
   * ```
   *
   * @param databaseId Database ID
   * @param sql        SQL query (max 50 KB). Use $1, $2, … for parameters.
   * @param params     Parameter values for $1, $2, … placeholders (max 500).
   */
  async query(databaseId: string, sql: string, params?: unknown[]): Promise<QueryResult> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        sql,
        ...(params && params.length > 0 ? { params } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await this.parse<{ data: QueryResult }>(res, 'databases.query');
    return json.data ?? (json as unknown as QueryResult);
  }

  // ─── Transaction ──────────────────────────────────────────────────────────

  /**
   * Execute multiple queries in a single atomic transaction.
   * All queries succeed together or are fully rolled back on any error.
   *
   * ```ts
   * const result = await coa.databases.transaction('uuid-…', [
   *   { sql: 'UPDATE accounts SET balance = balance - $1 WHERE id = $2', params: [100, fromId] },
   *   { sql: 'UPDATE accounts SET balance = balance + $1 WHERE id = $2', params: [100, toId] },
   * ]);
   * console.log(result.results);    // array of QueryResult
   * console.log(result.durationMs); // total transaction time
   * ```
   *
   * @param databaseId Database ID
   * @param queries    Array of { sql, params? } objects (max 50 queries)
   */
  async transaction(databaseId: string, queries: TransactionQuery[]): Promise<TransactionResult> {
    const res = await this.fetch(`/api/v1/databases/${databaseId}/transaction`, {
      method: 'POST',
      body: JSON.stringify({ queries }),
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await this.parse<{ data: TransactionResult }>(res, 'databases.transaction');
    return json.data ?? (json as unknown as TransactionResult);
  }
}
