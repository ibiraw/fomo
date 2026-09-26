/**
 * @file errors.ts
 * @description Typed errors for the FOMO limit-order backend.
 * @author Reborn1987
 */

/** Base class so callers can catch every app-specific error in one place. */
export class FomoError extends Error {
  /** Creates an error with the subclass name set for logging. */
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** On-chain account bytes did not match the expected layout. */
export class AccountDecodeError extends FomoError {}

/** The token trades on a pool type we cannot price yet. */
export class UnsupportedPoolError extends FomoError {}

/** A required on-chain account does not exist. */
export class AccountNotFoundError extends FomoError {}

/** Invalid or missing configuration. */
export class ConfigError extends FomoError {}
