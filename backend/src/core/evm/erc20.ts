/**
 * @file erc20.ts
 * @description ERC-20 reads over EvmRpcPort: decimals / symbol / name / totalSupply (immutable ones cached) and balanceOf.
 * @author Reborn1987
 */

import { parseAbi } from 'viem';

import type { EvmRpcPort, Hex } from '../../ports/evm-rpc.js';
import { readContract } from './contract.js';

export const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);

/** Native gas token placeholder used by Uniswap v4 pools (currency 0x0). */
export const NATIVE = '0x0000000000000000000000000000000000000000';

export class Erc20Reader {
  private readonly decimalsCache = new Map<string, Promise<number>>();

  /** @param rpc chain access */
  constructor(private readonly rpc: EvmRpcPort) {}

  /** Token decimals (18 for the native currency), cached per token. */
  decimals(token: Hex): Promise<number> {
    if (token.toLowerCase() === NATIVE) return Promise.resolve(18);
    const key = token.toLowerCase();
    let hit = this.decimalsCache.get(key);
    if (!hit) {
      hit = readContract<number>(this.rpc, token, ERC20_ABI, 'decimals').then(Number);
      hit.catch(() => this.decimalsCache.delete(key));
      this.decimalsCache.set(key, hit);
    }
    return hit;
  }

  /** Raw total supply. */
  totalSupply(token: Hex): Promise<bigint> {
    return readContract<bigint>(this.rpc, token, ERC20_ABI, 'totalSupply');
  }

  /** Token symbol. */
  symbol(token: Hex): Promise<string> {
    return readContract<string>(this.rpc, token, ERC20_ABI, 'symbol');
  }

  /** Token name. */
  name(token: Hex): Promise<string> {
    return readContract<string>(this.rpc, token, ERC20_ABI, 'name');
  }

  /** Raw balance of `owner`. */
  balanceOf(token: Hex, owner: Hex): Promise<bigint> {
    return readContract<bigint>(this.rpc, token, ERC20_ABI, 'balanceOf', [owner]);
  }
}
