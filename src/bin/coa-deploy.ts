#!/usr/bin/env node
// ─── coa-deploy CLI ─────────────────────────────────────────────────────────
// Usage (after `npm install -g coa-service-sdk` or via npx):
//
//   coa-deploy deploy [--dir ./myapp] [--port 3000] [--env KEY=val ...]
//   coa-deploy allocate
//   coa-deploy release <containerId>
//   coa-deploy status
//
// Config (coa.config.json in project root or current dir):
//   { "baseUrl": "http://...", "apiKey": "...", "containerPort": 3000 }

import fs from 'fs';
import path from 'path';
import { CoaClient } from '../CoaClient';

// ─── Read config ──────────────────────────────────────────────────────────────
interface CoaConfig {
  baseUrl: string;
  apiKey: string;
  containerPort?: number;
  assignedTo?: string;
}

function readConfig(): CoaConfig {
  const configPath = path.join(process.cwd(), 'coa.config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8')) as CoaConfig;
    } catch { /* fall through to env */ }
  }

  const baseUrl = process.env['COA_BASE_URL'];
  const apiKey  = process.env['COA_API_KEY'];

  if (!baseUrl || !apiKey) {
    console.error(`
Error: No coa.config.json found and COA_BASE_URL/COA_API_KEY env vars not set.

Create a coa.config.json in your project root:
  {
    "baseUrl": "http://192.168.0.127:3000",
    "apiKey":  "your-api-key",
    "containerPort": 3000
  }

Or set environment variables:
  export COA_BASE_URL=http://192.168.0.127:3000
  export COA_API_KEY=your-api-key
`);
    process.exit(1);
  }

  return { baseUrl, apiKey };
}

// ─── Parse CLI args ───────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        result[key] = true;
      } else {
        // --env can repeat — collect into array
        if (key === 'env') {
          const existing = result['env'];
          result['env'] = Array.isArray(existing) ? [...existing, next] : [next];
        } else {
          result[key] = next;
        }
        i++;
      }
    } else if (!result['_command']) {
      result['_command'] = arg;
    } else if (!result['_arg']) {
      result['_arg'] = arg;
    }
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv  = process.argv.slice(2);
  const args  = parseArgs(argv);
  const cmd   = (args['_command'] as string | undefined) ?? 'deploy';
  const cfg   = readConfig();
  const client = new CoaClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });

  // Parse --env KEY=val into object
  const envPairs = (args['env'] as string[] | undefined) ?? [];
  const envVars: Record<string, string> = {};
  for (const pair of envPairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) envVars[pair.slice(0, idx)] = pair.slice(idx + 1);
  }

  switch (cmd) {
    // ── coa-deploy deploy ────────────────────────────────────────────────────
    case 'deploy': {
      const projectDir    = (args['dir'] as string | undefined) ?? process.cwd();
      const containerPort = parseInt((args['port'] as string | undefined) ?? String(cfg.containerPort ?? 3000), 10);
      const container     = args['container'] as string | undefined;
      const assignedTo    = (args['name'] as string | undefined) ?? cfg.assignedTo;

      if (container) {
        // Deploy to an existing allocation
        console.log(`Deploying ${projectDir} → container ${container}`);
        const result = await client.deploy({ containerId: container, projectDir, containerPort, env: envVars });
        console.log(`\n✓ Live at: ${result.url}`);
        console.log(`  Image:    ${result.imageTag}`);
      } else {
        // Allocate + deploy in one shot
        console.log(`Deploying ${projectDir} → new container`);
        const result = await client.deployNew({ assignedTo, projectDir, containerPort, env: envVars });
        console.log(`\n✓ Deployed!`);
        console.log(`  App URL:  ${result.url}`);
        console.log(`  SSH:      ${result.sshCommand}`);
        console.log(`  ID:       ${result.containerId}  (use this to re-deploy or release)`);
      }
      break;
    }

    // ── coa-deploy allocate ──────────────────────────────────────────────────
    case 'allocate': {
      const assignedTo = (args['name'] as string | undefined) ?? cfg.assignedTo;
      const result = await client.allocate({ assignedTo });
      console.log(`✓ Allocated container`);
      console.log(`  ID:   ${result.containerId}`);
      console.log(`  SSH:  ${result.sshCommand}`);
      break;
    }

    // ── coa-deploy release <id> ──────────────────────────────────────────────
    case 'release': {
      const id = (args['_arg'] as string | undefined) ?? (args['container'] as string | undefined);
      if (!id) { console.error('Usage: coa-deploy release <containerId>'); process.exit(1); }
      await client.release(id);
      console.log(`✓ Container ${id} released back to pool`);
      break;
    }

    // ── coa-deploy status ────────────────────────────────────────────────────
    case 'status': {
      const status = await client.getPoolStatus();
      console.log(`Pool status:`);
      console.log(`  Total:     ${status.total}`);
      console.log(`  Available: ${status.available}`);
      console.log(`  In use:    ${status.inUse}`);
      console.log(`  Error:     ${status.error}`);
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Commands: deploy, allocate, release, status');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
});
