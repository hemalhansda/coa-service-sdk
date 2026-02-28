// ─── CoaClient ────────────────────────────────────────────────────────────────
// Main SDK class. Requires Node.js 18+ (native fetch + FormData).

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CoaClientOptions,
  AllocateOptions,
  AllocateResult,
  DeployOptions,
  DeployNewOptions,
  DeployResult,
  PoolStatus,
} from './types';
import { DatabaseClient } from './DatabaseClient';
import { AppsClient } from './AppsClient';

export class CoaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  /** Sub-client for managed PostgreSQL database operations */
  readonly databases: DatabaseClient;

  /** Sub-client for managed application container operations */
  readonly apps: AppsClient;

  constructor(opts: CoaClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey  = opts.apiKey;

    // Wire up sub-clients with shared fetch/parse helpers
    this.databases = new DatabaseClient(
      (urlPath, init) => this.fetch(urlPath, init),
      (res, op) => this.parseResponse(res, op),
    );

    this.apps = new AppsClient(
      (urlPath, init) => this.fetch(urlPath, init),
      (res, op) => this.parseResponse(res, op),
    );
  }

  // ─── Allocate a container slot ─────────────────────────────────────────────
  async allocate(opts: AllocateOptions = {}): Promise<AllocateResult> {
    const { assignedTo, sshPublicKey } = opts;

    // If no key provided, try ~/.ssh/id_ed25519.pub then ~/.ssh/id_rsa.pub
    const pubKey = sshPublicKey ?? this.readDefaultPublicKey();
    if (!pubKey) {
      throw new Error(
        'No SSH public key provided and no default key found at ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub\n' +
        'Generate one with: ssh-keygen -t ed25519',
      );
    }

    const body = JSON.stringify({ publicKey: pubKey, assignedTo });
    const res  = await this.fetch('/api/v1/allocate', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    const json = await this.parseResponse<{ containerId: string; sshHost: string; sshPort: number; username: string }>(res, 'allocate');

    return {
      ...json,
      sshCommand: `ssh -p ${json.sshPort} ${json.username}@${json.sshHost}`,
    };
  }

  // ─── Release a container slot ──────────────────────────────────────────────
  async release(containerId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/release/${containerId}`, { method: 'DELETE' });
    await this.parseResponse(res, 'release');
  }

  // ─── Deploy a project to an allocated slot ─────────────────────────────────
  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const {
      containerId,
      projectDir = process.cwd(),
      containerPort = 3000,
      env = {},
    } = opts;

    // Detect docker-compose.yml and merge its env/port as defaults
    const composeDefaults = this.readComposeDefaults(projectDir);
    const resolvedPort = containerPort ?? composeDefaults.port ?? 3000;
    const resolvedEnv  = { ...composeDefaults.env, ...env };

    // Create a tarball of the project
    const tarPath = this.createTarball(projectDir);

    try {
      const formData = new FormData();
      formData.append('project',  new Blob([fs.readFileSync(tarPath)], { type: 'application/gzip' }), 'project.tar.gz');
      formData.append('appPort',  String(resolvedPort));
      formData.append('env',      JSON.stringify(resolvedEnv));

      const res = await this.fetch(`/api/v1/containers/${containerId}/deploy`, {
        method: 'POST',
        body: formData,
        // FormData sets Content-Type including boundary — do NOT set it manually
      });

      const data = await this.parseResponse<Omit<DeployResult, 'containerId'>>(res, 'deploy');
      return { ...data, containerId };
    } finally {
      try { fs.unlinkSync(tarPath); } catch { /* best-effort */ }
    }
  }

  // ─── Allocate + deploy in one call ─────────────────────────────────────────
  async deployNew(opts: DeployNewOptions = {}): Promise<DeployResult & AllocateResult> {
    const { assignedTo, sshPublicKey, ...deployOpts } = opts;

    process.stdout.write('→ Allocating container slot…\n');
    const allocation = await this.allocate({ assignedTo, sshPublicKey });

    process.stdout.write(`→ Slot allocated (port ${allocation.sshPort}). Building and deploying…\n`);
    const deployResult = await this.deploy({ containerId: allocation.containerId, ...deployOpts });

    process.stdout.write(`✓ Deployed: ${deployResult.url}\n`);
    return { ...allocation, ...deployResult };
  }

  // ─── Pool status ───────────────────────────────────────────────────────────
  async getPoolStatus(): Promise<PoolStatus> {
    const res = await this.fetch('/api/v1/pool/status');
    return this.parseResponse<PoolStatus>(res, 'getPoolStatus');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async fetch(urlPath: string, init: RequestInit = {}): Promise<Response> {
    const url     = `${this.baseUrl}${urlPath}`;
    const headers = new Headers((init.headers as Record<string, string>) ?? {});
    headers.set('x-api-key', this.apiKey);

    return globalThis.fetch(url, { ...init, headers });
  }

  private async parseResponse<T>(res: Response, operation: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        const body = JSON.parse(text);
        message = body?.error ?? text;
        // Include buildLog when present (e.g. from build-image endpoint)
        if (body?.buildLog) {
          message += `\n\n--- Build Log (last 3000 chars) ---\n${body.buildLog}`;
        }
      } catch { /* keep raw text */ }
      throw new Error(`coa-service ${operation} failed (HTTP ${res.status}): ${message}`);
    }
    try {
      const json = JSON.parse(text);
      return (json?.data ?? json) as T;
    } catch {
      throw new Error(`coa-service ${operation}: unexpected non-JSON response`);
    }
  }

  private readDefaultPublicKey(): string | null {
    const candidates = [
      path.join(os.homedir(), '.ssh', 'id_ed25519.pub'),
      path.join(os.homedir(), '.ssh', 'id_rsa.pub'),
      path.join(os.homedir(), '.ssh', 'id_ecdsa.pub'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    }
    return null;
  }

  /**
   * Creates a .tar.gz of projectDir (excluding .git, node_modules, .env, dist).
   * Returns the path to the temp tarball file.
   */
  private createTarball(projectDir: string): string {
    const tarPath = path.join(os.tmpdir(), `coa-deploy-${Date.now()}.tar.gz`);

    const excludes = [
      '--exclude=.git',
      '--exclude=node_modules',
      '--exclude=.env',
      '--exclude=.env.*',
      '--exclude=dist',
      '--exclude=build',
      '--exclude=*.tar.gz',
    ];

    // macOS tar and GNU tar both accept -C and -czf
    const result = spawnSync(
      'tar',
      [...excludes, '-czf', tarPath, '-C', projectDir, '.'],
      { encoding: 'utf8' },
    );

    if (result.status !== 0) {
      throw new Error(`Failed to create project tarball: ${result.stderr}`);
    }

    const size = fs.statSync(tarPath).size;
    process.stdout.write(`→ Project tarball: ${(size / 1024).toFixed(0)} KB\n`);

    return tarPath;
  }

  /**
   * Reads docker-compose.yml (if present) and extracts port + env as defaults.
   * Uses basic regex matching — no full YAML parser needed.
   */
  private readComposeDefaults(projectDir: string): { port?: number; env: Record<string, string> } {
    const composePaths = [
      path.join(projectDir, 'docker-compose.yml'),
      path.join(projectDir, 'docker-compose.yaml'),
      path.join(projectDir, 'compose.yml'),
    ];

    for (const p of composePaths) {
      if (!fs.existsSync(p)) continue;

      const raw = fs.readFileSync(p, 'utf8');

      // Extract first published port from `ports:` section: "HOST:CONTAINER"
      const portMatch = raw.match(/^\s*-\s*["']?(\d+):(\d+)["']?\s*$/m);
      const containerPort = portMatch ? parseInt(portMatch[2], 10) : undefined;

      // Extract environment key=value entries
      const env: Record<string, string> = {};
      const envSection = raw.match(/environment:([\s\S]*?)(?=\n\s*\w|\n?$)/);
      if (envSection) {
        const lines = envSection[1].split('\n');
        for (const line of lines) {
          const m = line.match(/^\s*-?\s*([A-Z_][A-Z0-9_]*)[:=]\s*(.*)$/i);
          if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
        }
      }

      process.stdout.write(`→ docker-compose.yml detected — using port ${containerPort ?? '(not found)'}, env keys: [${Object.keys(env).join(', ')}]\n`);
      return { port: containerPort, env };
    }

    return { env: {} };
  }
}

