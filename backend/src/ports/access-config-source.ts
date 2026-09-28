/**
 * @file access-config-source.ts
 * @description AccessConfigSourcePort — where the public version, early-access list and free periods come from
 *              (a JSON file on the server today).
 * @author Reborn1987
 */

import type { AccessConfig } from '../core/releases/releases.js';

export abstract class AccessConfigSourcePort {
  /** Current config (the defaults when there is none). */
  abstract current(): AccessConfig;

  /** Starts watching; `onChange` fires with the new config after every valid change. */
  abstract start(onChange: (config: AccessConfig) => void): void;

  /** Stops watching. */
  abstract stop(): void;
}
