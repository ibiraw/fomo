/**
 * @file config.ts
 * @description Loads and validates environment configuration; creates/loads the pairing token.
 * @author Reborn1987
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { EvmChain } from './core/chains/token-key.js';
import { ConfigError } from './core/errors.js';

const EnvSchema = z.object({
  SOLANA_RPC_HTTP: z.url({ protocol: /^https?$/ }),
  SOLANA_RPC_WSS: z.url({ protocol: /^wss?$/ }),
  GATEWAY_HOST: z.string().default('127.0.0.1'),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATA_DIR: z.string().default('data'),
  EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  /** The user's FOMO Solana wallet; enables on-chain trade confirmation when set. */
  FOMO_WALLET: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Not a valid Solana address').optional(),
  /** The user's FOMO EVM wallet (same address on every EVM chain); enables on-chain confirmation for EVM trades. */
  FOMO_EVM_WALLET: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Not a valid EVM address').optional(),
  ETH_RPC_HTTP: z.url({ protocol: /^https?$/ }).optional(),
  ETH_RPC_WSS: z.url({ protocol: /^wss?$/ }).optional(),
  BASE_RPC_HTTP: z.url({ protocol: /^https?$/ }).optional(),
  BASE_RPC_WSS: z.url({ protocol: /^wss?$/ }).optional(),
  BNB_RPC_HTTP: z.url({ protocol: /^https?$/ }).optional(),
  BNB_RPC_WSS: z.url({ protocol: /^wss?$/ }).optional(),
  ROBINHOOD_RPC_HTTP: z.url({ protocol: /^https?$/ }).optional(),
  ROBINHOOD_RPC_WSS: z.url({ protocol: /^wss?$/ }).optional(),
  ARC_RPC_HTTP: z.url({ protocol: /^https?$/ }).optional(),
  ARC_RPC_WSS: z.url({ protocol: /^wss?$/ }).optional(),
  /** Optional Jupiter API key; without it the keyless lite endpoint is used. */
  JUPITER_API_KEY: z.string().min(1).optional(),
  JUPITER_POLL_MS: z.coerce.number().int().min(1_000).default(1_500),
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
  readonly fomoWallet: string | null;
  readonly fomoEvmWallet: `0x${string}` | null;
  /** RPC endpoints per EVM chain; chains without both URLs are not enabled. */
  readonly evm: ReadonlyMap<EvmChain, { readonly http: string; readonly wss: string }>;
  readonly jupiter: { readonly url: string; readonly apiKey: string | null; readonly pollMs: number };
}

/** Reads the pairing token from DATA_DIR, generating one on first run. */
function loadOrCreateToken(dataDir: string): string {
  const file = join(dataDir, 'pairing-token.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

/** env var prefix per EVM chain. */
const EVM_ENV_PREFIX: Record<EvmChain, string> = { ethereum: 'ETH', base: 'BASE', bnb: 'BNB', robinhood: 'ROBINHOOD', arc: 'ARC' };

/** Collects the EVM chains that have both an HTTP and a WebSocket URL; throws when only one of the pair is set. */
function evmEndpoints(e: Record<string, unknown>): Map<EvmChain, { http: string; wss: string }> {
  const out = new Map<EvmChain, { http: string; wss: string }>();
  for (const [chain, prefix] of Object.entries(EVM_ENV_PREFIX) as [EvmChain, string][]) {
    const http = e[`${prefix}_RPC_HTTP`];
    const wss = e[`${prefix}_RPC_WSS`];
    if (typeof http === 'string' && typeof wss === 'string') out.set(chain, { http, wss });
    else if (http !== undefined || wss !== undefined) throw new ConfigError(`${prefix}_RPC_HTTP and ${prefix}_RPC_WSS must be set together`);
  }
  return out;
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
    fomoWallet: e.FOMO_WALLET ?? null,
    fomoEvmWallet: (e.FOMO_EVM_WALLET?.toLowerCase() as `0x${string}` | undefined) ?? null,
    evm: evmEndpoints(e),
    jupiter: {
      url: e.JUPITER_API_KEY ? 'https://api.jup.ag/price/v3' : 'https://lite-api.jup.ag/price/v3',
      apiKey: e.JUPITER_API_KEY ?? null,
      pollMs: e.JUPITER_POLL_MS,
    },
  };
}
