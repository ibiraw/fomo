/**
 * @file line-source.ts
 * @description Port: a growing text log read line by line (e.g. the website's download log).
 * @author Reborn1987
 */

export abstract class LineSourcePort {
  /** Complete lines added since the last call (the first call returns everything already there). */
  abstract readNew(): string[];
}
