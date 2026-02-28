// ─── coa-service-sdk Types ────────────────────────────────────────────────────

export interface CoaClientOptions {
  /** Base URL of your coa-service instance, e.g. http://192.168.0.127:3000 */
  baseUrl: string;
  /** API key (same as API_KEY in server .env) */
  apiKey: string;
}

// ─── Allocate ─────────────────────────────────────────────────────────────────

export interface AllocateOptions {
  /** Opaque label to tag this allocation (project name, user ID, etc.) */
  assignedTo?: string;
  /** Your SSH public key (e.g. contents of ~/.ssh/id_ed25519.pub) */
  sshPublicKey?: string;
}

export interface AllocateResult {
  containerId: string;
  sshHost: string;
  sshPort: number;
  username: string;
  /** SSH command ready to paste: ssh -p PORT USER@HOST */
  sshCommand: string;
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

export interface DeployOptions {
  /** UUID of an already-allocated container */
  containerId: string;
  /** Local directory containing the Dockerfile (defaults to process.cwd()) */
  projectDir?: string;
  /** Port your app listens on INSIDE the container (default: 3000) */
  containerPort?: number;
  /** Environment variables to inject into the container */
  env?: Record<string, string>;
}

export interface DeployNewOptions extends Omit<DeployOptions, 'containerId'> {
  /** Tag this deployment (used as assignedTo on the allocation) */
  assignedTo?: string;
  /** Your SSH public key — optional if you only need HTTP, not SSH */
  sshPublicKey?: string;
}

export interface DeployResult {
  /** Public URL of the deployed app, e.g. http://192.168.0.127:8003 */
  url: string;
  appPort: number;
  imageTag: string;
  /** Last 3 KB of the docker build log */
  buildLog: string;
  containerId: string;
}

// ─── Pool status ──────────────────────────────────────────────────────────────

export interface PoolStatus {
  total: number;
  available: number;
  inUse: number;
  error: number;
}

// ─── Managed Databases ───────────────────────────────────────────────────────

export type DatabaseStatus = 'CREATING' | 'AVAILABLE' | 'STOPPED' | 'STOPPING' | 'STARTING' | 'DELETING' | 'ERROR';

export interface CreateDatabaseOptions {
  /** Display name for the database instance */
  name: string;
  /** PostgreSQL database name (default: auto-derived from name) */
  dbName?: string;
  /** Master username (default: auto-generated) */
  dbUser?: string;
  /** Master password (default: auto-generated) */
  dbPassword?: string;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  engine: string;
  version: string;
  status: DatabaseStatus;
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
  storageMb: number;
  health: 'running' | 'stopped' | 'unknown';
  createdAt: string;
  /** Connection string with masked password */
  connectionString: string;
}

export interface DatabaseCreatedResult extends Omit<DatabaseInfo, 'storageMb' | 'health'> {
  /** Clear-text password — shown only at creation time */
  dbPassword: string;
  /** Full connection string with actual password */
  connectionString: string;
}

export interface ImportSqlOptions {
  /** Database ID to import into */
  databaseId: string;
  /** Path to the .sql file on disk */
  filePath: string;
}

export interface ImportSqlResult {
  message: string;
  statementsRun: number;
  durationMs: number;
  warnings: string[];
}

// ─── Schema / ERD ─────────────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
}

export interface ForeignKeyInfo {
  constraintName: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  rowEstimate: number;
}

export interface SchemaResult {
  tables: TableInfo[];
  /** Mermaid erDiagram source — render with mermaid.js or paste into any Mermaid viewer */
  mermaidERD: string;
  introspectedAt: string;
}

// ─── Connection Info & Metrics ────────────────────────────────────────────────

export interface ConnectionInfo {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  directUrl: string;
  poolMode: string;
  /** Ready-to-paste .env variables */
  env: string;
  /** Prisma datasource block */
  prisma: string;
  /** Sequelize constructor config */
  sequelize: string;
  /** TypeORM DataSource config */
  typeorm: string;
  /** Drizzle ORM config */
  drizzle: string;
  /** node-postgres Pool config */
  pg: string;
  /** Knex.js config */
  knex: string;
  /** Python psycopg2 config */
  python: string;
  /** PostgreSQL URI */
  connectionString: string;
  /** PostgreSQL URI with sslmode=prefer */
  connectionStringWithSsl: string;
}

export interface DatabaseConnectionStats {
  total: number;
  active: number;
  idle: number;
  idleInTx: number;
  waiting: number;
}

export interface DatabaseStats {
  txCommit: number;
  txRollback: number;
  blocksRead: number;
  blocksHit: number;
  tupReturned: number;
  tupFetched: number;
  tupInserted: number;
  tupUpdated: number;
  tupDeleted: number;
  deadlocks: number;
  conflicts: number;
  tempFiles: number;
  tempBytes: number;
}

export interface DatabaseMetrics {
  sizeBytes: number;
  sizeHuman: string;
  connections: DatabaseConnectionStats;
  maxConnections: number;
  version: string;
  startedAt: string;
  uptime: string;
  settings: Record<string, string>;
  stats: DatabaseStats;
  cacheHitRatio: string;
}

// ─── SQL Explorer ─────────────────────────────────────────────────────────────

export interface TableListItem {
  schema: string;
  table: string;
  type: string;
  columns: number;
  estimatedRows: number;
}

export interface TableDetailColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}

export interface TableDetailIndex {
  name: string;
  unique: boolean;
  columns: string[];
  definition: string;
}

export interface TableDetailForeignKey {
  name: string;
  column: string;
  foreignTable: string;
  foreignColumn: string;
}

export interface TableDetail {
  schema: string;
  table: string;
  columns: TableDetailColumn[];
  indexes: TableDetailIndex[];
  foreignKeys: TableDetailForeignKey[];
  rowEstimate: number;
  sizeTotal: string;
  sizeTable: string;
  sizeIndexes: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  command: string;
  durationMs: number;
}

// ─── Managed Apps ─────────────────────────────────────────────────────────────

export type AppStatus = 'CREATING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'DELETING';

export interface CreateAppOptions {
  /** Unique name for the app (e.g. "my-bot", "openclaw-prod") */
  name: string;
  /** Docker image to run (e.g. "node:20-slim", "registry.fly.io/my-app:latest") */
  image: string;
  /** Environment variables injected into the container */
  env?: Record<string, string>;
  /** Port mapping: { "containerPort": "protocol" }. E.g. { "3000": "http" } */
  ports?: Record<string, string>;
  /** Memory limit in MB (default: 512) */
  memoryMb?: number;
  /** CPU cores (default: 1) */
  cpus?: number;
}

export interface UpdateAppOptions {
  /** Updated/additional environment variables (merged with existing) */
  env?: Record<string, string>;
  /** New Docker image (triggers container recreation) */
  image?: string;
}

export interface AppInfo {
  id: string;
  name: string;
  image: string;
  status: AppStatus;
  env: Record<string, string>;
  ports: Record<string, string>;
  hostPort: number | null;
  memoryMb: number;
  cpus: number;
  containerId: string | null;
  health: 'running' | 'stopped' | 'unknown';
  /** Public URL if the app has an exposed port */
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppLogs {
  logs: string;
}

export interface BuildImageOptions {
  /** Path to a directory containing a Dockerfile (.tar.gz created automatically) */
  projectDir: string;
  /** Custom image tag (default: auto-generated) */
  tag?: string;
}

export interface BuildImageResult {
  /** The Docker image tag that was built on the server */
  imageTag: string;
  /** Last 3 KB of docker build output */
  buildLog: string;
}

