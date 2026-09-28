/**
 * @file launchpad-icon.test.ts
 * @description Reading where a token launched from fomo's own launchpad icon: names from the icon address (named
 *              files and program addresses), and picking the icon on the token name's line over other lists' icons.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { launchpadFromIcon, readLaunchpadName } from '../lib/fomo-dom';

const HOST = 'https://crypto-exchange-logos-production.s3.us-west-2.amazonaws.com';

/** Gives an element a fixed on-screen box (happy-dom has no layout). */
function place(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

describe('launchpadFromIcon', () => {
  it('names named launchpad files and known program addresses, nothing else', () => {
    expect(launchpadFromIcon(`${HOST}/launchpad/stonkfun.png`)).toBe('stonkfun');
    expect(launchpadFromIcon(`${HOST}/launchpad/pons.png?v=2`)).toBe('pons');
    expect(launchpadFromIcon(`${HOST}/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P.webp`)).toBe('pump.fun');
    expect(launchpadFromIcon(`${HOST}/SomeOtherProgram111111111111111111111111111.webp`)).toBeNull();
    expect(launchpadFromIcon(`${HOST}/launchpad/%E0%A4%A.png`)).toBeNull(); // malformed escape
    expect(launchpadFromIcon(`${HOST}/launchpad/<script>.png`)).toBeNull();
  });
});

describe('readLaunchpadName', () => {
  it("takes the icon right after the token's name, not other lists' icons", () => {
    document.body.innerHTML = `
      <div id="list"><span>OTHER</span><img id="a" src="${HOST}/launchpad/long.png"></div>
      <div id="hdr"><div id="name">VAULT</div><img id="b" src="${HOST}/launchpad/pons.png"></div>
      <div id="trending"><span>VAULT</span><img id="c" src="${HOST}/launchpad/stonkfun.png"></div>`;
    place(document.getElementById('name')!, 420, 79, 60, 20);
    place(document.getElementById('b')!, 518, 81, 16, 16);
    place(document.getElementById('a')!, 20, 108, 16, 16);
    place(document.querySelector('#trending span')!, 20, 400, 50, 20);
    place(document.getElementById('c')!, 90, 402, 16, 16);
    expect(readLaunchpadName(document, 'VAULT')).toBe('pons');
    expect(readLaunchpadName(document, 'NOPE')).toBeNull();
    place(document.getElementById('b')!, 900, 81, 16, 16); // too far from the name
    expect(readLaunchpadName(document, 'VAULT')).toBeNull();
  });
});
