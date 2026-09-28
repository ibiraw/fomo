/**
 * @file code-templates.test.ts
 * @description Recognising EVM launchpads by their tokens' code: minimal-proxy clones (both proxy forms), templates
 *              whose per-token slots are ignored, look-alikes with other differences, chains a template isn't on.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { cloneImplementation, codeFingerprint, evmCodeTemplateDetector, matchTemplate, type CodeTemplate } from '../../src/core/tokens/code-templates.js';
import type { Hex } from '../../src/ports/evm-rpc.js';
import { FakeEvmRpc } from '../helpers/fake-evm.js';

const IMPL = '3be8b97fd0e713b5abe0649fa830223b6b4bc599';
const LONG_CLONE = `0x3d3d3d3d363d3d37363d73${IMPL}5af43d3d93803e602a57fd5bf3` as Hex;
const EIP1167 = `0x363d3d373d3d3d363d73${IMPL}5af43d82803e903d91602b57fd5bf3` as Hex;

/** A 64-byte "template" with per-token slots at 10–19 and 40–41. */
const code = (slotA: string, slotB: string, tail = 'ee'): Hex => `0x${'aa'.repeat(10)}${slotA}${'bb'.repeat(20)}${slotB}${'cc'.repeat(21)}${tail}` as Hex;
const SLOTS = [[10, 19], [40, 41]] as const;
const TEMPLATE: CodeTemplate = { id: 'pons', name: 'pons', chains: ['robinhood'], match: { kind: 'code', length: 64, slots: SLOTS, fingerprint: codeFingerprint(code('11'.repeat(10), '2222'), SLOTS) } };
const CLONES: CodeTemplate = { id: 'long', name: 'long', chains: ['robinhood'], match: { kind: 'clone', implementation: `0x${IMPL}` } };

describe('code templates', () => {
  it('reads the implementation of both proxy forms, and nothing from ordinary contracts', () => {
    expect(cloneImplementation(LONG_CLONE)).toBe(`0x${IMPL}`);
    expect(cloneImplementation(EIP1167)).toBe(`0x${IMPL}`);
    expect(cloneImplementation(code('11'.repeat(10), '2222'))).toBeNull();
  });

  it('matches a template whatever its per-token slots hold, but not other differences or lengths', () => {
    expect(matchTemplate(code('99'.repeat(10), 'abcd'), [TEMPLATE])?.id).toBe('pons');
    expect(matchTemplate(code('99'.repeat(10), 'abcd', 'ef'), [TEMPLATE])).toBeNull(); // a look-alike variant
    expect(matchTemplate(`${code('99'.repeat(10), 'abcd')}00` as Hex, [TEMPLATE])).toBeNull();
    expect(matchTemplate(LONG_CLONE, [TEMPLATE, CLONES])?.id).toBe('long');
    expect(matchTemplate('0x', [TEMPLATE, CLONES])).toBeNull(); // a wallet
  });

  it('detects on the template\'s chains only, with the curve status unknown', async () => {
    const rh = new FakeEvmRpc('robinhood');
    rh.codes.set('0x' + '1'.repeat(40), LONG_CLONE);
    expect(await evmCodeTemplateDetector(rh, [TEMPLATE, CLONES]).detect('0x' + '1'.repeat(40))).toEqual({ id: 'long', name: 'long', onCurve: null });
    expect(await evmCodeTemplateDetector(rh, [TEMPLATE, CLONES]).detect('0x' + '2'.repeat(40))).toBeNull();
    const base = new FakeEvmRpc('base');
    base.codes.set('0x' + '1'.repeat(40), LONG_CLONE);
    expect(await evmCodeTemplateDetector(base, [TEMPLATE, CLONES]).detect('0x' + '1'.repeat(40))).toBeNull();
  });
});
