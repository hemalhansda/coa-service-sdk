# coa-service-sdk

> SDK and CLI for deploying Dockerized apps to **[coa-service](https://github.com/hemaal/coa-service)** — your self-hosted personal container cloud.

[![npm version](https://img.shields.io/npm/v/coa-service-sdk)](https://www.npmjs.com/package/coa-service-sdk)
[![npm downloads](https://img.shields.io/npm/dm/coa-service-sdk)](https://www.npmjs.com/package/coa-service-sdk)
[![CI](https://github.com/hemaal/coa-service-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/hemaal/coa-service-sdk/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Full Documentation →](https://your-coa-server/docs)**

---

## What is coa-service?

**coa-service** is a self-hosted mini-PaaS that runs on any single Linux server with Docker. It maintains a warm pool of containers and lets you deploy any Dockerized app to one via a REST API or this SDK — similar to [Railway](https://railway.app) or [Render](https://render.com), but running on **your own machine**.

```
┌─────────────────────────────────────────────────────────────────┐
│                      coa-service (your server)                  │
│                                                                 │
│  Pool of 5 containers, always ready:                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ...    │
│  │ slot 0   │  │ slot 1   │  │ slot 2   │  │ slot 3   │         │
│  │ ssh:2201 │  │ ssh:2202 │  │ ssh:2203 │  │ ssh:2204 │         │
│  │ app:8001 │  │ app:8002 │  │ app:8003 │  │ app:8004 │         │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │
└─────────────────────────────────────────────────────────────────┘
         ▲ coa-service-sdk uploads your project tarball,
           builds it, and deploys it to a slot
```

---

## Prerequisites

- A running **coa-service** instance ([set up guide](https://github.com/hemaal/coa-service))
- Your `API_KEY` from the server's `.env`
- Node.js **18+** (uses native `fetch` and `FormData`)
- `tar` and `docker` available on the server (already there if coa-service is running)

---

## Installation

```bash
# As a project dependency (SDK usage)
npm install coa-service-sdk

# Globally (CLI usage)
npm install -g coa-service-sdk
```

Or use without installing via `npx`:

```bash
npx coa-service-sdk deploy
```

---

## Quick Start

### 1. Create `coa.config.json` in your project

```json
{
  "baseUrl": "http://your-server-ip:3000",
  "apiKey":  "your-api-key",
  "containerPort": 3000
}
```

### 2. Make sure your project has a `Dockerfile`

```dockerfile
# Example for a Node.js app
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### 3. Deploy

```bash
npx coa-deploy deploy
```

Output:
```
→ Allocating container slot…
→ Slot allocated (port 2203). Building and deploying…
→ Project tarball: 42 KB
→ docker-compose.yml detected — using port 3000, env keys: [NODE_ENV]

✓ Deployed!
  App URL:  http://your-server-ip:8003
  SSH:      ssh -p 2203 sandbox@your-server-ip
  ID:       d3317ca7-0788-42ec-a843-8a628e803e34
```

---

## CLI Reference

```
coa-deploy <command> [options]
```

| Command | Description |
|---------|-------------|
| `deploy` | Allocate a slot + build + deploy (default) |
| `allocate` | Allocate a container slot without deploying |
| `release <id>` | Return a container to the pool |
| `status` | Show pool availability |

### `deploy` options

| Flag | Description | Default |
|------|-------------|---------|
| `--dir <path>` | Project directory (must contain `Dockerfile`) | `process.cwd()` |
| `--port <n>` | Port your app listens on inside the container | `3000` |
| `--container <id>` | Deploy to an existing allocated container | _(allocates a new one)_ |
| `--env KEY=val` | Inject env var (repeatable) | — |
| `--name <label>` | Label this allocation | — |

### Examples

```bash
# Deploy current directory
npx coa-deploy deploy

# Deploy a specific directory with env vars
npx coa-deploy deploy --dir ./apps/api --port 8080 --env NODE_ENV=production --env DB_URL=postgres://...

# Re-deploy to the same container (hot-swap)
npx coa-deploy deploy --container d3317ca7-0788-42ec-a843-8a628e803e34

# Allocate a slot (SSH only, no deployment)
npx coa-deploy allocate --name my-project

# Check pool availability
npx coa-deploy status

# Release a container
npx coa-deploy release d3317ca7-0788-42ec-a843-8a628e803e34
```

### Config via environment variables

If you don't want a `coa.config.json`, set these instead:

```bash
export COA_BASE_URL=http://your-server-ip:3000
export COA_API_KEY=your-api-key
npx coa-deploy deploy
```

---

## SDK Reference

### `new CoaClient(options)`

```typescript
import { CoaClient } from 'coa-service-sdk';

const coa = new CoaClient({
  baseUrl: 'http://your-server-ip:3000',  // coa-service URL
  apiKey:  'your-api-key',
});
```

---

### `coa.deployNew(options)` — allocate + build + deploy in one call

```typescript
const result = await coa.deployNew({
  projectDir:    './my-app',      // directory with Dockerfile (default: process.cwd())
  containerPort: 3000,            // port app listens on inside container
  env: {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://...',
  },
  assignedTo:  'clawdbot',        // optional label
  sshPublicKey: '...',            // optional; reads ~/.ssh/id_ed25519.pub by default
});

console.log(result.url);          // http://your-server:8003
console.log(result.sshCommand);   // ssh -p 2203 sandbox@your-server
console.log(result.containerId);  // d3317ca7-... (save this for re-deploys)
```

---

### `coa.deploy(options)` — deploy to an existing container

Use this for **updates** — rebuilds the image in-place (hot-swap, zero downtime:

```typescript
await coa.deploy({
  containerId:   'd3317ca7-0788-42ec-a843-8a628e803e34',
  projectDir:    '.',
  containerPort: 3000,
  env: { VERSION: '2.1.0' },
});
```

---

### `coa.allocate(options)` — get SSH access only

```typescript
const slot = await coa.allocate({
  assignedTo:  'my-app',
  sshPublicKey: '...',  // optional; reads ~/.ssh/id_ed25519.pub by default
});

console.log(slot.sshCommand);  // ssh -p 2203 sandbox@your-server
console.log(slot.sshPort);     // 2203
console.log(slot.containerId); // d3317ca7-...
```

---

### `coa.release(containerId)` — return container to pool

```typescript
await coa.release('d3317ca7-0788-42ec-a843-8a628e803e34');
// → Service reverted to sandbox image, slot marked AVAILABLE
```

---

### `coa.getPoolStatus()` — check availability

```typescript
const status = await coa.getPoolStatus();
console.log(status);
// { total: 5, available: 3, inUse: 2, error: 0 }
```

---

## Managed Databases (Aurora-style PostgreSQL)

The SDK provides a `databases` sub-client for managing PostgreSQL instances — similar to AWS Aurora or Railway Databases.

### `coa.databases.create({ name })` — provision a new database

```typescript
const db = await coa.databases.create({ name: 'my-app-db' });
console.log(db.connectionString);
// postgresql://coa:SECRET_PASSWORD@your-server:6001/my_app_db

// ⚠ Save these credentials — the password is only shown once!
console.log(db.dbPassword);  // clear-text password
console.log(db.host);        // your-server
console.log(db.port);        // 6001
console.log(db.dbName);      // my_app_db
console.log(db.dbUser);      // coa
```

You can also provide custom credentials:

```typescript
const db = await coa.databases.create({
  name:       'my-app-db',
  dbName:     'custom_db_name',
  dbUser:     'custom_user',
  dbPassword: 'custom_password',
});
```

---

### `coa.databases.list()` — list all databases

```typescript
const dbs = await coa.databases.list();
for (const db of dbs) {
  console.log(`${db.name} — ${db.status} — ${db.host}:${db.port}`);
}
```

---

### `coa.databases.get(id)` — get database details

```typescript
const db = await coa.databases.get('uuid-…');
console.log(db.status); // 'AVAILABLE'
console.log(db.health); // 'running'
```

---

### `coa.databases.stop(id)` / `start(id)` — pause & resume

```typescript
await coa.databases.stop('uuid-…');   // data preserved
await coa.databases.start('uuid-…');  // back online
```

---

### `coa.databases.delete(id)` — permanently delete

```typescript
await coa.databases.delete('uuid-…');
// ⚠ Database, container, and all data are destroyed
```

---

### `coa.databases.importSql({ databaseId, filePath })` — import a .sql file

```typescript
const result = await coa.databases.importSql({
  databaseId: 'uuid-…',
  filePath: './schema.sql',
});
console.log(result.statementsRun); // 42
console.log(result.durationMs);   // 120
```

---

### `coa.databases.getSchema(id)` — introspect schema & get ERD

```typescript
const schema = await coa.databases.getSchema('uuid-…');

// List tables
for (const table of schema.tables) {
  console.log(`${table.name} (${table.columns.length} columns, ~${table.rowEstimate} rows)`);
  for (const col of table.columns) {
    const flags = [col.isPrimaryKey && 'PK', col.isForeignKey && 'FK', col.isUnique && 'UQ'].filter(Boolean);
    console.log(`  ${col.name} ${col.dataType} ${flags.join(' ')}`);
  }
}

// Get the Mermaid ERD source (render with mermaid.js or paste into any Mermaid viewer)
console.log(schema.mermaidERD);

// Save ERD to a file
import fs from 'fs';
fs.writeFileSync('erd.mmd', schema.mermaidERD);
```

---

### `coa.databases.getConnectionInfo(id)` — ORM connection snippets

```typescript
const info = await coa.databases.getConnectionInfo('uuid-…');
console.log(info.prisma);     // datasource db { provider = "postgresql" … }
console.log(info.sequelize);  // new Sequelize({ … })
console.log(info.typeorm);    // new DataSource({ type: 'postgres', … })
console.log(info.drizzle);    // drizzle(postgres('…'))
console.log(info.pg);         // new Pool({ … })
console.log(info.knex);       // knex({ client: 'pg', … })
console.log(info.python);     // psycopg2.connect(…)
console.log(info.env);        // DATABASE_URL="postgresql://…"
```

---

### `coa.databases.getMetrics(id)` — live database metrics

```typescript
const m = await coa.databases.getMetrics('uuid-…');
console.log(m.sizeHuman);          // "12.4 MB"
console.log(m.connections.active);  // 3
console.log(m.maxConnections);      // 100
console.log(m.cacheHitRatio);       // "99.87%"
console.log(m.uptime);             // "2d 14h 32m"
```

---

### `coa.databases.listTables(id)` — SQL Explorer

```typescript
const tables = await coa.databases.listTables('uuid-…');
tables.forEach(t => console.log(`${t.schema}.${t.table} — ${t.columns} cols, ~${t.estimatedRows} rows`));
```

---

### `coa.databases.getTableDetail(id, table, schema?)` — table detail

```typescript
const detail = await coa.databases.getTableDetail('uuid-…', 'users');
detail.columns.forEach(c => console.log(`${c.name} ${c.type} ${c.isPrimaryKey ? 'PK' : ''}`));
console.log(detail.sizeTotal);   // "24 kB"
console.log(detail.indexes);     // [{ name, unique, columns, definition }]
console.log(detail.foreignKeys); // [{ name, column, foreignTable, foreignColumn }]
```

---

### `coa.databases.query(id, sql)` — execute SQL

```typescript
const result = await coa.databases.query('uuid-…', 'SELECT * FROM users LIMIT 10');
console.log(result.columns);    // ['id', 'email', 'name']
console.log(result.rows);       // [{ id: 1, email: '…' }, …]
console.log(result.rowCount);   // 10
console.log(result.durationMs); // 12
```

---

## Managed Apps (Container-as-a-Service)

The `apps` sub-client lets you deploy and manage long-running application containers from any Docker image — no Dockerfile build step needed. Think of it as a lightweight Fly.io or Railway, running on your own server.

### `coa.apps.create(opts)` — deploy a new app

```typescript
const app = await coa.apps.create({
  name:     'my-bot',
  image:    'ghcr.io/my-org/discord-bot:latest',
  env:      { BOT_TOKEN: 'abc123', NODE_ENV: 'production' },
  ports:    { '3000': 'http' },
  memoryMb: 1024,
  cpus:     2,
});

// Wait for it to start
const ready = await coa.apps.waitUntilReady(app.id);
console.log(ready.url); // http://your-server:9001
```

---

### `coa.apps.list()` — list all apps

```typescript
const apps = await coa.apps.list();
for (const app of apps) {
  console.log(`${app.name} — ${app.status} — ${app.url}`);
}
```

---

### `coa.apps.get(id)` — get app details

```typescript
const app = await coa.apps.get('uuid-…');
console.log(app.status);      // 'RUNNING'
console.log(app.url);         // 'http://your-server:9001'
console.log(app.containerId); // Docker container ID
```

---

### `coa.apps.stop(id)` / `start(id)` / `restart(id)`

```typescript
await coa.apps.stop('uuid-…');    // pause — config preserved
await coa.apps.start('uuid-…');   // resume
await coa.apps.restart('uuid-…'); // stop + start
```

---

### `coa.apps.update(id, opts)` — update env / image

```typescript
// Merge new env vars
await coa.apps.update('uuid-…', {
  env: { MODEL: 'gpt-5-2', OPENAI_API_KEY: 'sk-new-key' },
});

// Change Docker image → triggers container recreation
await coa.apps.update('uuid-…', { image: 'my-app:v2' });
```

---

### `coa.apps.delete(id)` — permanently destroy

```typescript
await coa.apps.delete('uuid-…');
// ⚠ Container and all data destroyed
```

---

### `coa.apps.getLogs(id, tail?)` — container logs

```typescript
const { logs } = await coa.apps.getLogs('uuid-…', 500);
console.log(logs);
```

---

### `coa.apps.waitUntilReady(id, timeoutMs?)` — poll until running

Useful after `create()` — polls every 2s until the app is `RUNNING` or times out.

```typescript
const app = await coa.apps.create({ name: 'bot', image: 'node:20-slim' });
const ready = await coa.apps.waitUntilReady(app.id, 120_000);
console.log(ready.status); // 'RUNNING'
```

---

## Full Database Workflow Example

```typescript
import { CoaClient } from 'coa-service-sdk';
import fs from 'fs';

const coa = new CoaClient({
  baseUrl: process.env.COA_BASE_URL!,
  apiKey:  process.env.COA_API_KEY!,
});

async function setupDatabase() {
  // 1. Create a database
  const db = await coa.databases.create({ name: 'myapp-prod' });
  console.log(`✓ Database created: ${db.connectionString}`);
  console.log(`  Save this password: ${db.dbPassword}`);

  // 2. Import schema
  const importResult = await coa.databases.importSql({
    databaseId: db.id,
    filePath: './migrations/schema.sql',
  });
  console.log(`✓ Schema imported: ${importResult.statementsRun} statements in ${importResult.durationMs}ms`);

  // 3. View ERD
  const schema = await coa.databases.getSchema(db.id);
  console.log(`✓ ${schema.tables.length} tables found`);
  fs.writeFileSync('erd.mmd', schema.mermaidERD);
  console.log('✓ ERD saved to erd.mmd');

  // 4. Deploy an app that uses this database
  const app = await coa.deployNew({
    projectDir: '.',
    env: { DATABASE_URL: db.connectionString },
  });
  console.log(`✓ App deployed: ${app.url}`);
}

setupDatabase().catch(console.error);
```

---

## docker-compose.yml support

The SDK auto-reads `docker-compose.yml` (if present) and extracts port + env vars as defaults — so if your project already has one, you don't need to specify anything extra:

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"          # ← SDK reads containerPort=3000 from here
    environment:
      - NODE_ENV=production   # ← merged as default env vars
      - APP_NAME=ClawdBot
```

Then just run:
```bash
npx coa-deploy deploy  # port + env read automatically from compose file
```

---

## Port Layout

Each slot has a fixed SSH port and app port on the host:

| Slot | SSH Port | App Port |
|------|----------|----------|
| 0 | 2201 | 8001 |
| 1 | 2202 | 8002 |
| 2 | 2203 | 8003 |
| 3 | 2204 | 8004 |
| 4 | 2205 | 8005 |

---

## TypeScript Types

```typescript
import type {
  CoaClientOptions,
  AllocateOptions,
  AllocateResult,
  DeployOptions,
  DeployNewOptions,
  DeployResult,
  PoolStatus,
  // Databases
  DatabaseInfo,
  DatabaseCreatedResult,
  CreateDatabaseOptions,
  ImportSqlOptions,
  ImportSqlResult,
  // Schema / ERD
  SchemaResult,
  TableInfo,
  ColumnInfo,
  ForeignKeyInfo,
  DatabaseStatus,
  // Connection Info & Metrics
  ConnectionInfo,
  DatabaseMetrics,
  DatabaseConnectionStats,
  DatabaseStats,
  // SQL Explorer
  TableListItem,
  TableDetail,
  TableDetailColumn,
  TableDetailIndex,
  TableDetailForeignKey,
  QueryResult,
  // Managed Apps
  AppInfo,
  AppLogs,
  AppStatus,
  CreateAppOptions,
  UpdateAppOptions,
} from 'coa-service-sdk';
```

---

## Full Workflow Example (Programmatic)

```typescript
import { CoaClient } from 'coa-service-sdk';

const coa = new CoaClient({
  baseUrl: process.env.COA_BASE_URL!,
  apiKey:  process.env.COA_API_KEY!,
});

async function deployClawdBot() {
  // 1. Check pool before deploying
  const pool = await coa.getPoolStatus();
  if (pool.available === 0) throw new Error('Pool exhausted — try later');

  // 2. Deploy (allocate + build + run)
  const deploy = await coa.deployNew({
    projectDir:    '.',
    containerPort: 3000,
    assignedTo:    'clawdbot-prod',
    env: {
      NODE_ENV:   'production',
      BOT_TOKEN:  process.env.BOT_TOKEN!,
    },
  });

  console.log(`✓ ClawdBot live at ${deploy.url}`);
  console.log(`  SSH: ${deploy.sshCommand}`);

  // 3. Save containerId for future re-deploys
  return deploy.containerId;
}

deployClawdBot().catch(console.error);
```

---

## Contributing

Issues and PRs welcome at [github.com/hemaal/coa-service-sdk](https://github.com/hemaal/coa-service-sdk).

## License

MIT © [Hemaal](https://github.com/hemaal)


## Install

```bash
npm install coa-service-sdk
# or
npx coa-service-sdk deploy
```

## Quick Start

### Option 1 — Programmatic (Node.js / TypeScript)

```typescript
import { CoaClient } from 'coa-service-sdk';

const coa = new CoaClient({
  baseUrl: 'http://192.168.0.127:3000',  // your coa-service URL
  apiKey:  'your-api-key',
});

// One-liner: allocate a slot + build + deploy
const result = await coa.deployNew({
  projectDir:    './my-app',      // must contain a Dockerfile
  containerPort: 3000,            // port your app listens on inside container
  env: { NODE_ENV: 'production' },
  assignedTo: 'clawdbot',
});

console.log(`✓ Live at: ${result.url}`);
// → ✓ Live at: http://192.168.0.127:8003

// Later — release the slot back to the pool
await coa.release(result.containerId);
```

### Option 2 — CLI (`coa-deploy`)

Create `coa.config.json` in your project root:

```json
{
  "baseUrl": "http://192.168.0.127:3000",
  "apiKey":  "your-api-key",
  "containerPort": 3000
}
```

Then from your project directory:

```bash
# Allocate + build + deploy (one command)
npx coa-deploy deploy

# Or deploy to a specific already-allocated container
npx coa-deploy deploy --container <containerId>

# With env vars
npx coa-deploy deploy --env NODE_ENV=production --env DATABASE_URL=postgres://...

# Check pool availability
npx coa-deploy status

# Release a container back to pool
npx coa-deploy release <containerId>
```

### docker-compose.yml support

If your project has a `docker-compose.yml`, the SDK automatically reads:
- `ports: ["HOST:CONTAINER"]` → uses `CONTAINER` as `containerPort`
- `environment:` → merged as default env vars (explicit `env` option overrides)

```yaml
# docker-compose.yml in your project
services:
  app:
    build: .
    ports:
      - "3000:3000"       # ← SDK reads containerPort=3000 from here
    environment:
      - NODE_ENV=production
      - APP_NAME=ClawdBot
```

---

## Deploy Flow

```
your project/               coa-service (host)
    Dockerfile         →    docker build -t coa-app-slot2:latest
    docker-compose.yml →    port/env extraction
                       →    service update (new image + port mapping)
                       →    http://192.168.0.127:8003  ← your app
```

## Port Layout

| Slot | SSH Port | App Port |
|------|----------|----------|
| 0    | 2201     | 8001     |
| 1    | 2202     | 8002     |
| 2    | 2203     | 8003     |
| 3    | 2204     | 8004     |
| 4    | 2205     | 8005     |

## Re-deploy (update your app)

Just call `deploy()` again with the same `containerId` — the server rebuilds the image and hot-swaps the Swarm service:

```typescript
await coa.deploy({
  containerId: 'existing-container-id',
  projectDir:  '.',
  env: { VERSION: '2.0' },
});
```

## Release

When you're done, release the container back to the pool so others can use it:

```typescript
await coa.release(containerId);
// → Service reverted to sandbox image, slot marked AVAILABLE
```
