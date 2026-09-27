/**
 * @file error-log.test.ts
 * @description ErrorLog: first occurrence dumps the error object, repeats inside the window log one line,
 *              distinct contexts/messages are tracked separately, and the window expires.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { ErrorLog, errorHeadline } from '../../src/core/monitoring/error-log.js';

/** ErrorLog wired to an array sink and a settable clock. */
function setup() {
  const lines: unknown[][] = [];
  let t = 1_000_000;
  const log = new ErrorLog((...parts) => lines.push(parts), () => t, 60_000);
  return { log, lines, advance: (ms: number) => { t += ms; } };
}

describe('errorHeadline', () => {
  it('uses name and the first message line', () => {
    const err = new TypeError('socket closed\nat somewhere');
    expect(errorHeadline(err)).toBe('TypeError: socket closed');
  });

  it('stringifies non-errors', () => {
    expect(errorHeadline('plain\nsecond')).toBe('plain');
  });
});

describe('ErrorLog', () => {
  it('dumps the first error with the object, then one-lines repeats', () => {
    const { log, lines } = setup();
    const err = new Error('The socket has been closed.');
    log.log('rpc:robinhood', err);
    log.log('rpc:robinhood', new Error('The socket has been closed.'));
    expect(lines[0]![1]).toBe(err);
    expect(lines[1]).toHaveLength(1);
    expect(lines[1]![0]).toMatch(/\[rpc:robinhood\] \(repeat\) Error: The socket has been closed\.$/);
  });

  it('tracks contexts and messages separately', () => {
    const { log, lines } = setup();
    log.log('rpc:robinhood', new Error('a'));
    log.log('rpc:base', new Error('a'));
    log.log('rpc:robinhood', new Error('b'));
    expect(lines.every((l) => l.length === 2)).toBe(true);
  });

  it('forgets old messages once it remembers many (messages can carry addresses)', () => {
    const { log, advance } = setup();
    for (let i = 0; i < 500; i++) log.log('rpc', new Error(`empty update for addr${i}`));
    expect(log.tracked()).toBe(500);
    advance(60_000);
    log.log('rpc', new Error('a new one'));
    expect(log.tracked()).toBe(1);
  });

  it('dumps again once the window has passed', () => {
    const { log, lines, advance } = setup();
    log.log('rpc', new Error('x'));
    advance(60_000);
    log.log('rpc', new Error('x'));
    expect(lines[1]).toHaveLength(2);
  });
});
