// ─── AppsClient ───────────────────────────────────────────────────────────────
// Sub-client for managed application container operations.
// Used via `coa.apps` — not instantiated directly.

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import os from 'os';
import {
  AppInfo,
  CreateAppOptions,
  UpdateAppOptions,
  AppLogs,
  BuildImageOptions,
  BuildImageResult,
} from './types';

type FetchFn = (urlPath: string, init?: RequestInit) => Promise<Response>;
type ParseFn = <T>(res: Response, operation: string) => Promise<T>;

export class AppsClient {
  private readonly fetch: FetchFn;
  private readonly parse: ParseFn;

  /** @internal — use `coa.apps` instead */
  constructor(fetchFn: FetchFn, parseFn: ParseFn) {
    this.fetch = fetchFn;
    this.parse = parseFn;
  }

  // ─── List all apps ─────────────────────────────────────────────────────────

  /**
   * List all managed apps for the authenticated user.
   *
   * ```ts
   * const apps = await coa.apps.list();
   * for (const app of apps) {
   *   console.log(`${app.name} — ${app.status} — ${app.url}`);
   * }
   * ```
   */
  async list(): Promise<AppInfo[]> {
    const res = await this.fetch('/api/v1/apps');
    const json = await this.parse<{ data: AppInfo[] }>(res, 'apps.list');
    return json.data ?? (json as unknown as AppInfo[]);
  }

  // ─── Get a single app ─────────────────────────────────────────────────────

  /**
   * Get details for a specific app.
   *
   * ```ts
   * const app = await coa.apps.get('uuid-…');
   * console.log(app.status); // 'RUNNING'
   * console.log(app.url);    // 'http://your-server:9001'
   * ```
   */
  async get(appId: string): Promise<AppInfo> {
    const res = await this.fetch(`/api/v1/apps/${appId}`);
    const json = await this.parse<{ data: AppInfo }>(res, 'apps.get');
    return json.data ?? (json as unknown as AppInfo);
  }

  // ─── Create a new app ─────────────────────────────────────────────────────

  /**
   * Create and deploy a new application container.
   *
   * ```ts
   * const app = await coa.apps.create({
   *   name: 'my-bot',
   *   image: 'node:20-slim',
   *   env: {
   *     BOT_TOKEN: 'abc123',
   *     NODE_ENV: 'production',
   *   },
   *   ports: { '3000': 'http' },
   *   memoryMb: 1024,
   * });
   * console.log(app.url);    // http://your-server:9001
   * console.log(app.status); // 'CREATING' → polls to 'RUNNING'
   * ```
   */
  async create(opts: CreateAppOptions): Promise<AppInfo> {
    const body = JSON.stringify({
      name: opts.name,
      image: opts.image,
      env: opts.env ?? {},
      ports: opts.ports ?? {},
      memoryMb: opts.memoryMb ?? 512,
      cpus: opts.cpus ?? 1,
    });
    const res = await this.fetch('/api/v1/apps', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await this.parse<{ data: AppInfo }>(res, 'apps.create');
    return json.data ?? (json as unknown as AppInfo);
  }

  // ─── Stop an app ──────────────────────────────────────────────────────────

  /**
   * Stop a running app. The container is paused — data and config preserved.
   *
   * ```ts
   * await coa.apps.stop('uuid-…');
   * ```
   */
  async stop(appId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/apps/${appId}/stop`, { method: 'POST' });
    await this.parse(res, 'apps.stop');
  }

  // ─── Start an app ─────────────────────────────────────────────────────────

  /**
   * Start a previously stopped app.
   *
   * ```ts
   * await coa.apps.start('uuid-…');
   * ```
   */
  async start(appId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/apps/${appId}/start`, { method: 'POST' });
    await this.parse(res, 'apps.start');
  }

  // ─── Restart an app ───────────────────────────────────────────────────────

  /**
   * Restart an app — useful after env var changes or to clear state.
   *
   * ```ts
   * await coa.apps.restart('uuid-…');
   * ```
   */
  async restart(appId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/apps/${appId}/restart`, { method: 'POST' });
    await this.parse(res, 'apps.restart');
  }

  // ─── Update an app ────────────────────────────────────────────────────────

  /**
   * Update environment variables and/or the Docker image, then restart.
   * Env vars are **merged** with existing — pass `null` values to remove keys.
   *
   * ```ts
   * // Change model + API key
   * await coa.apps.update('uuid-…', {
   *   env: {
   *     OPENCLAW_MODEL: 'gpt-5-2',
   *     OPENAI_API_KEY: 'sk-new-key',
   *   },
   * });
   *
   * // Update to new image version
   * await coa.apps.update('uuid-…', {
   *   image: 'registry.fly.io/my-app:v2',
   * });
   * ```
   */
  async update(appId: string, opts: UpdateAppOptions): Promise<void> {
    const body = JSON.stringify({
      ...(opts.env != null && { env: opts.env }),
      ...(opts.image != null && { image: opts.image }),
    });
    const res = await this.fetch(`/api/v1/apps/${appId}`, {
      method: 'PATCH',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    await this.parse(res, 'apps.update');
  }

  // ─── Delete an app ────────────────────────────────────────────────────────

  /**
   * Permanently destroy an app and its container.
   *
   * ```ts
   * await coa.apps.delete('uuid-…');
   * ```
   */
  async delete(appId: string): Promise<void> {
    const res = await this.fetch(`/api/v1/apps/${appId}`, { method: 'DELETE' });
    await this.parse(res, 'apps.delete');
  }

  // ─── Get app logs ─────────────────────────────────────────────────────────

  /**
   * Fetch recent container logs.
   *
   * ```ts
   * const { logs } = await coa.apps.getLogs('uuid-…', 500);
   * console.log(logs);
   * ```
   */
  async getLogs(appId: string, tail: number = 200): Promise<AppLogs> {
    const res = await this.fetch(`/api/v1/apps/${appId}/logs?tail=${tail}`);
    const json = await this.parse<{ data: AppLogs }>(res, 'apps.getLogs');
    return json.data ?? (json as unknown as AppLogs);
  }

  // ─── Wait for app to be ready ─────────────────────────────────────────────

  /**
   * Poll until the app reaches 'RUNNING' status (or timeout).
   * Useful after `create()` since provisioning is async.
   *
   * ```ts
   * const app = await coa.apps.create({ name: 'my-bot', image: '…' });
   * const ready = await coa.apps.waitUntilReady(app.id, 60000);
   * console.log(ready.status); // 'RUNNING'
   * ```
   */
  async waitUntilReady(appId: string, timeoutMs: number = 120_000): Promise<AppInfo> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const app = await this.get(appId);
      if (app.status === 'RUNNING' || app.health === 'running') return app;
      if (app.status === 'ERROR') throw new Error(`App ${appId} failed to start — status: ERROR`);
      // Wait 2s before next poll
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`App ${appId} did not become ready within ${timeoutMs / 1000}s`);
  }

  // ─── Build a Docker image on the server ────────────────────────────────────

  /**
   * Upload a project directory (with a Dockerfile) to the COA server,
   * build a Docker image, and return the image tag.
   * The tag can then be used with `apps.create({ image: tag })`.
   *
   * ```ts
   * const { imageTag } = await coa.apps.buildImage({
   *   projectDir: './docker',
   *   tag: 'my-app:latest',
   * });
   * const app = await coa.apps.create({ name: 'my-app', image: imageTag });
   * ```
   */
  async buildImage(opts: BuildImageOptions): Promise<BuildImageResult> {
    const { projectDir, tag } = opts;
    const resolved = path.resolve(projectDir);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Project directory not found: ${resolved}`);
    }
    if (!fs.existsSync(path.join(resolved, 'Dockerfile'))) {
      throw new Error(`No Dockerfile found in: ${resolved}`);
    }

    // Create tarball of the project directory
    const tarPath = path.join(os.tmpdir(), `coa-build-${Date.now()}.tar.gz`);
    const excludes = [
      '--exclude=.git',
      '--exclude=node_modules',
      '--exclude=.env',
      '--exclude=.env.*',
      '--exclude=dist',
      '--exclude=build',
      '--exclude=*.tar.gz',
    ];

    const tarResult = spawnSync(
      'tar',
      [...excludes, '-czf', tarPath, '-C', resolved, '.'],
      { encoding: 'utf8' },
    );

    if (tarResult.status !== 0) {
      throw new Error(`Failed to create project tarball: ${tarResult.stderr}`);
    }

    try {
      const fileData = fs.readFileSync(tarPath);
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([fileData], { type: 'application/gzip' }),
        'project.tar.gz',
      );
      if (tag) {
        formData.append('tag', tag);
      }

      const res = await this.fetch('/api/v1/apps/build-image', {
        method: 'POST',
        body: formData,
      });

      const json = await this.parse<{ data: BuildImageResult }>(res, 'apps.buildImage');
      return json.data ?? (json as unknown as BuildImageResult);
    } finally {
      try { fs.unlinkSync(tarPath); } catch { /* best-effort */ }
    }
  }
}
