/**
 * @file evm-addresses.ts
 * @description Per-chain contract addresses (verified on-chain 2026-09-26): Uniswap v4, stablecoins priced at $1,
 *              wrapped native tokens, and launchpad contracts. All addresses lowercase.
 * @author Reborn1987
 */

import type { EvmChain } from '../chains/token-key.js';
import type { Hex } from '../../ports/evm-rpc.js';
import type { V4Deployment } from './evm-pool-price-feed.js';

export interface EvmChainAddresses {
  readonly v4: V4Deployment | null;
  /** USD stablecoins priced at $1. */
  readonly stables: readonly Hex[];
  /** Wrapped native token, used to price native currency (0x0) in v4 pools and launchpads. On Arc the native gas token is USDC. */
  readonly wrappedNative: Hex;
  /** four.meme TokenManager2 (trade events) and TokenManagerHelper3 (state reads) — BNB only. */
  readonly fourMeme: { readonly manager: Hex; readonly helper: Hex } | null;
  /** flap.sh Portal (trade events and state reads). */
  readonly flapPortal: Hex | null;
}

export const EVM_ADDRESSES: Record<EvmChain, EvmChainAddresses> = {
  ethereum: {
    v4: { poolManager: '0x000000000004444c5dc75cb358380d2e3de08a90', stateView: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227' },
    stables: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7'],
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    fourMeme: null,
    flapPortal: null,
  },
  base: {
    v4: { poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b', stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71' },
    stables: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
    wrappedNative: '0x4200000000000000000000000000000000000006',
    fourMeme: null,
    flapPortal: '0x0000bc1c4fd15dd79029af8f5d77d68ae4490000',
  },
  bnb: {
    v4: { poolManager: '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df', stateView: '0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4' },
    stables: ['0x55d398326f99059ff775485246999027b3197955', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d'],
    wrappedNative: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    fourMeme: { manager: '0x5c952063c7fc8610ffdb798152d69f0b9550762b', helper: '0xf251f83e40a78868fcfa3fa4599dad6494e46034' },
    flapPortal: '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
  },
  robinhood: {
    v4: { poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' },
    stables: ['0x5fc5360d0400a0fd4f2af552add042d716f1d168'],
    wrappedNative: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    fourMeme: null,
    flapPortal: '0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09',
  },
  arc: {
    v4: { poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' },
    stables: ['0x3600000000000000000000000000000000000000'],
    wrappedNative: '0x3600000000000000000000000000000000000000',
    fourMeme: null,
    flapPortal: null,
  },
};
