/**
 * @file Logo.tsx
 * @description The limit logo: the moon mark (white crescent on a dashed orbit ring in fomo's Buy-button blue) and
 *              the "limit" wordmark whose i's carry blue dots (dotless ı + a positioned dot, see .wm-i in globals.css).
 * @author Reborn1987
 */

/** fomo's Buy-button blue: the orbit ring and the i-dots. */
export const LOGO_BLUE = '#516af6';

/** The moon mark on its black tile. */
export function MoonMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#09090b" />
      <ellipse cx="32" cy="36" rx="25" ry="11" fill="none" stroke={LOGO_BLUE} strokeWidth="3" strokeDasharray="5 4" transform="rotate(-18 32 36)" />
      <path d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill="#fafafa" />
    </svg>
  );
}

/** "limit" with blue dots on both i's. */
export function LogoWord({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`} aria-label="limit">
      <span aria-hidden="true">l<span className="wm-i">ı</span>m<span className="wm-i">ı</span>t</span>
    </span>
  );
}
