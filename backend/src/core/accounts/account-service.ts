/**
 * @file account-service.ts
 * @description Anonymous accounts. The extension creates a random secret on install; the server keeps only its
 *              SHA-256 hash (the secret is high-entropy, so a fast hash is enough). Logging in with an unknown secret
 *              creates the account when the client asks for it. Also validates and saves wallet addresses.
 * @author Reborn1987
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AuthError, ValidationError } from '../errors.js';
import type { Account, AccountStorePort, UserWallets } from '../../ports/account-store.js';

/** Secrets are ≥ 32 characters of base64url (the extension sends 43: 32 random bytes). */
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;

const WalletsSchema = z.object({
  solana: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Not a valid Solana address').nullable(),
  evm: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Not a valid EVM address').nullable(),
}).strict();

/** SHA-256 hex of a secret. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class AccountService {
  /** @param store account storage */
  constructor(private readonly store: AccountStorePort) {}

  /**
   * Returns the account for `secret`. Unknown secrets create an account when `create` is true;
   * otherwise AuthError. Malformed secrets are always rejected.
   */
  login(secret: string, create: boolean): { account: Account; created: boolean } {
    if (!SECRET.test(secret)) throw new AuthError('Invalid account key');
    const hash = hashSecret(secret);
    const found = this.store.findBySecretHash(hash);
    if (found) {
      this.store.touch(found.id);
      return { account: found, created: false };
    }
    if (!create) throw new AuthError('Unknown account key');
    return { account: this.store.create(hash, { solana: null, evm: null }), created: true };
  }

  /** Validates and saves the account's wallet addresses (EVM lowercased). */
  setWallets(id: string, input: unknown): Account {
    const parsed = WalletsSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const wallets: UserWallets = { solana: parsed.data.solana, evm: (parsed.data.evm?.toLowerCase() as `0x${string}` | undefined) ?? null };
    const updated = this.store.setWallets(id, wallets);
    if (!updated) throw new AuthError('Account no longer exists');
    return updated;
  }

  /** The account; AuthError when it no longer exists. */
  get(id: string): Account {
    const a = this.store.get(id);
    if (!a) throw new AuthError('Account no longer exists');
    return a;
  }

  /** Current wallets of an account (none when the account is gone). */
  wallets(id: string): UserWallets {
    return this.store.get(id)?.wallets ?? { solana: null, evm: null };
  }

  /**
   * Makes sure the pre-accounts owner can keep using the server: an account with a fixed id whose secret is the
   * old pairing token, holding the wallets from the environment. Existing orders were migrated to this id.
   */
  ensureLegacy(id: string, pairingToken: string, wallets: UserWallets): Account {
    const existing = this.store.get(id);
    if (existing) return existing;
    return this.store.create(hashSecret(pairingToken), wallets, id);
  }

  /** Deletes the account record (callers delete its orders first). */
  delete(id: string): boolean {
    return this.store.delete(id);
  }
}
