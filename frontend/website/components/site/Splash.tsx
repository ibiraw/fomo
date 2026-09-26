/**
 * @file Splash.tsx
 * @description First-visit loading screen built around the logo: the black tile lands, the blue orbit ring spins
 *              in, the crescent rises, then the "limit" wordmark fades up and its two blue i-dots drop in. Pure CSS,
 *              so it plays and then gets out of the way even if scripts never load; an inline script in <head>
 *              skips it for the rest of the session.
 * @author Reborn1987
 */

import { LOGO_BLUE, LogoWord } from './Logo';

/** Inline script (runs before paint): skip the splash if it was already shown this session. */
export const SPLASH_SKIP_SCRIPT = `try{if(sessionStorage.getItem('af-splash')){document.documentElement.classList.add('af-no-splash')}else{sessionStorage.setItem('af-splash','1')}}catch(e){}`;

/** Full-screen intro overlay. */
export function Splash() {
  return (
    <div className="af-splash" aria-hidden="true">
      <div className="af-splash-inner">
        <svg viewBox="0 0 64 64" width="112" height="112" className="af-splash-mark" role="presentation">
          <rect width="64" height="64" rx="14" fill="#09090b" stroke="#26262c" strokeWidth="1" />
          <g transform="rotate(-18 32 36)">
            <ellipse className="af-splash-ring" cx="32" cy="36" rx="25" ry="11" fill="none" stroke={LOGO_BLUE} strokeWidth="3" strokeDasharray="5 4" />
          </g>
          <path className="af-splash-moon" d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill="#fafafa" />
        </svg>
        <LogoWord className="af-splash-word text-5xl text-foreground" />
      </div>
    </div>
  );
}
