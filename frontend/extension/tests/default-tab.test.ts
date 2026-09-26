/**
 * @file default-tab.test.ts
 * @description Tests for the default-tab setting parser.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { parseDefaultTab } from '../hooks/use-default-tab';

describe('parseDefaultTab', () => {
  it("keeps 'limit' and treats anything else as fomo's Buy tab", () => {
    expect(parseDefaultTab('limit')).toBe('limit');
    expect(parseDefaultTab('buy')).toBe('buy');
    expect(parseDefaultTab(undefined)).toBe('buy');
    expect(parseDefaultTab(42)).toBe('buy');
  });
});
