/**
 * The one error type every Volanea integration throws.
 *
 * Anything that can go wrong below the framework boundary — a config mistake,
 * an aborted request, a DNS failure, a 422 — arrives as one of these, so a raw
 * `TypeError: fetch failed` never reaches Strapi or Medusa. Each provider then
 * translates it into whatever its framework expects.
 */
export class VolaneaError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;
  readonly skipped?: unknown;

  constructor(
    message: string,
    opts: { code: string; status?: number; details?: unknown; skipped?: unknown },
  ) {
    super(message);
    this.name = "VolaneaError";
    this.code = opts.code;
    this.status = opts.status;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.skipped !== undefined) this.skipped = opts.skipped;
  }
}

/**
 * Codes that mean "the caller sent something wrong", as opposed to a fault on
 * our side or in transit. Frameworks that distinguish the two — Medusa's
 * `MedusaError.Types.INVALID_DATA` vs `UNEXPECTED_STATE` — branch on this.
 */
export const INVALID_DATA_CODES: ReadonlySet<string> = new Set([
  "validation_error",
  "invalid_attachment",
  "template_not_found",
  "idempotency_key_reused",
  "missing_recipient",
]);
