/**
 * @file config.ts
 * @description Loads and validates environment configuration; creates/loads the pairing token.
 * @author Reborn1987
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { ConfigError } from './core/errors.js';

const EnvSchema = z.object({
  SOLANA_RPC_HTTP: z.url({ protocol: /^https?$/ }),
  SOLANA_RPC_WSS: z.url({ protocol: /^wss?$/ }),
  GATEWAY_HOST: z.string().default('127.0.0.1'),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATA_DIR: z.string().default('data'),
  EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
});

/** Validated runtime configuration. */
export interface AppConfig {
  readonly rpcHttp: string;
  readonly rpcWss: string;
  readonly gatewayHost: string;
  readonly gatewayPort: number;
  readonly dbPath: string;
  readonly pairingToken: string;
  readonly execTimeoutMs: number;
}

/** Reads the pairing token from DATA_DIR, generating one on first run. */
function loadOrCreateToken(dataDir: string): string {
  const file = join(dataDir, 'pairing-token.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

/** Parses env vars; throws ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  mkdirSync(e.DATA_DIR, { recursive: true });
  return {
    rpcHttp: e.SOLANA_RPC_HTTP,
    rpcWss: e.SOLANA_RPC_WSS,
    gatewayHost: e.GATEWAY_HOST,
    gatewayPort: e.GATEWAY_PORT,
    dbPath: join(e.DATA_DIR, 'orders.db'),
    pairingToken: loadOrCreateToken(e.DATA_DIR),
    execTimeoutMs: e.EXEC_TIMEOUT_MS,
  };
}
