/**
 * @file code-templates.ts
 * @description Recognising EVM launchpads by the code of the tokens they deploy. A launchpad's tokens are either
 *              minimal-proxy clones of one implementation ("long": 44-byte clones of 0x3be8b9…), or copies of one
 *              template that differ only in a few per-token slots (addresses and short values baked into the code,
 *              "pons"): those slots are zeroed and the rest must hash to the template's fingerprint. Each template was
 *              checked against tokens whose launchpad fomo itself shows (2026-09-28): pons — VAULT, HOOD, ROBINHOOD;
 *              long — LONG, AI. Look-alikes fomo shows no launchpad for (e.g. a 5,274-byte "meme" variant) don't match.
 * @author Reborn1987
 */

import { keccak256 } from 'viem';

import type { EvmChain } from '../chains/token-key.js';
import type { EvmRpcPort, Hex } from '../../ports/evm-rpc.js';
import type { Launchpad, LaunchpadDetector } from './launchpad-service.js';

/** How a launchpad's tokens are recognised. */
export type TemplateMatch =
  | { readonly kind: 'clone'; readonly implementation: string }
  | { readonly kind: 'code'; readonly length: number; readonly slots: readonly (readonly [number, number])[]; readonly fingerprint: string };

export interface CodeTemplate {
  readonly id: string;
  readonly name: string;
  readonly chains: readonly EvmChain[];
  readonly match: TemplateMatch;
}

/** Launchpads known only by their tokens' code (the ones with a readable contract live in launchpad-price-feed.ts). */
export const EVM_CODE_TEMPLATES: readonly CodeTemplate[] = [
  {
    id: 'pons',
    name: 'pons',
    chains: ['robinhood'],
    match: {
      kind: 'code',
      length: 5274,
      slots: [[411, 412], [599, 618], [675, 677], [734, 735], [922, 941], [2319, 2320], [2570, 2572], [3982, 3983], [4038, 4039], [4226, 4228], [4540, 4542]],
      fingerprint: '0x2d64553c9e2b96b8d3f29e2942b33a20bf85a14256fa8d1af80fea1a8df275e2',
    },
  },
  { id: 'long', name: 'long', chains: ['robinhood'], match: { kind: 'clone', implementation: '0x3be8b97fd0e713b5abe0649fa830223b6b4bc599' } },
];

/** The implementation a minimal proxy delegates to (EIP-1167 and its 44-byte variant), or null for other code. */
export function cloneImplementation(code: Hex): string | null {
  if (code.length > 2 + 2 * 100) return null; // proxies are tiny
  const m = /73([0-9a-fA-F]{40})5af4/.exec(code);
  return m ? `0x${m[1]!.toLowerCase()}` : null;
}

/** keccak of the code with the template's per-token slots zeroed. */
export function codeFingerprint(code: Hex, slots: readonly (readonly [number, number])[]): string {
  const bytes = Buffer.from(code.slice(2), 'hex');
  for (const [start, end] of slots) bytes.fill(0, start, end + 1);
  return keccak256(`0x${bytes.toString('hex')}`);
}

/** The template a token's code matches, or null. */
export function matchTemplate(code: Hex, templates: readonly CodeTemplate[]): CodeTemplate | null {
  const impl = cloneImplementation(code);
  const length = (code.length - 2) / 2;
  for (const t of templates) {
    if (t.match.kind === 'clone' ? impl === t.match.implementation : length === t.match.length && codeFingerprint(code, t.match.slots) === t.match.fingerprint) {
      return t;
    }
  }
  return null;
}

/**
 * Recognises a chain's code-template launchpads. The curve status can't be read from the code, so it is unknown
 * (`onCurve: null`); the extension then judges it from where the token's live price comes from.
 */
export function evmCodeTemplateDetector(rpc: EvmRpcPort, templates: readonly CodeTemplate[] = EVM_CODE_TEMPLATES): LaunchpadDetector {
  const mine = templates.filter((t) => t.chains.includes(rpc.chain));
  return {
    async detect(address): Promise<Launchpad | null> {
      if (mine.length === 0) return null;
      const t = matchTemplate(await rpc.code(address as Hex), mine);
      return t ? { id: t.id, name: t.name, onCurve: null } : null;
    },
  };
}
