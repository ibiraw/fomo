/**
 * @file Splash.tsx
 * @description First-visit loading screen: the wordmark while a tiny market-cap line runs down to a dashed
 *              target and turns green. Pure CSS, so it plays and then gets out of the way even if scripts
 *              never load; an inline script in <head> skips it for the rest of the session.
 * @author Reborn1987
 */

/** Inline script (runs before paint): skip the splash if it was already shown this session. */
export const SPLASH_SKIP_SCRIPT = `try{if(sessionStorage.getItem('af-splash')){document.documentElement.classList.add('af-no-splash')}else{sessionStorage.setItem('af-splash','1')}}catch(e){}`;

/** Full-screen intro overlay. */
export function Splash() {
  return (
    <div className="af-splash" aria-hidden="true">
      <div className="af-splash-inner">
        <div className="text-4xl font-bold tracking-tight">
          auto <span className="text-brand">fomo</span>
        </div>
        <svg viewBox="0 0 200 60" className="af-splash-chart" role="presentation">
          <line x1="0" x2="200" y1="44" y2="44" stroke="var(--faint)" strokeDasharray="4 4" strokeWidth="1" />
          <polyline className="af-splash-line" fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            points="0,14 25,10 50,20 75,16 100,28 125,24 150,38 175,36 200,44" />
          <circle className="af-splash-dot" cx="200" cy="44" r="4" />
        </svg>
        <p className="af-splash-caption">Target hit · order filled</p>
      </div>
    </div>
  );
}
