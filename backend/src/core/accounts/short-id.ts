/**
 * @file short-id.ts
 * @description Short, readable user ids ("AF-7K3Q2P") for support and monitoring messages. Six characters from an
 *              alphabet without look-alikes (no 0/O, 1/I/L) give ~700 million combinations; uniqueness is enforced by
 *              the database.
 * @author Reborn1987
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LENGTH = 6;
export const SHORT_ID_RE = /^AF-[2-9A-HJKMNP-Z]{6}$/;

/** A random short id. */
export function newShortId(random: () => number = Math.random): string {
  let id = 'AF-';
  for (let i = 0; i < LENGTH; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return id;
}
