/**
 * Shared internals for Volanea's framework integrations.
 *
 * This package is never published. Each provider lists it in devDependencies
 * so its bundler inlines it at build time, which is what keeps every published
 * tarball at zero runtime dependencies.
 *
 * What belongs here: anything that is genuinely the same everywhere — the HTTP
 * client, the `send_failed` → `details[0].code` unwrapping, skip handling,
 * address parsing, the error type.
 *
 * What deliberately does NOT belong here: attachment encoding. A string
 * `content` means raw text in Strapi (Nodemailer's rule) and already-base64 in
 * Medusa (SendGrid's rule). That is a real difference between two ecosystems,
 * not an inconsistency to iron out — unifying it would silently corrupt
 * attachments in one of them. Each package implements its own, and says so.
 */
export { VolaneaError, INVALID_DATA_CODES } from "./errors";
export {
  parseAddress,
  parseAddressList,
  toRecipient,
  addressEmail,
  type Address,
} from "./address";
export {
  VolaneaClient,
  resolveClientConfig,
  toSendError,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  type VolaneaClientConfig,
  type VolaneaMessage,
  type VolaneaSendResult,
} from "./client";
