import { VolaneaError, parseAddress, parseAddressList, toRecipient } from "@volanea/integrations-core";
import { normalizeAttachments, type StrapiAttachment, type VolaneaAttachment } from "./attachments";

export interface StrapiSendOptions {
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  replyTo?: unknown;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: StrapiAttachment[];
  [key: string]: unknown;
}

export interface StrapiSettings {
  defaultFrom?: string;
  defaultFromName?: string;
  defaultReplyTo?: string;
  defaultSubject?: string;
  defaultType?: "transactional" | "marketing";
}

export interface VolaneaPayload {
  to: unknown;
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  attachments?: VolaneaAttachment[];
  type?: string;
  [key: string]: unknown;
}

/** Fields a caller may pass through to the Volanea send API untouched. */
const PASSTHROUGH_FIELDS = [
  "templateId",
  "variables",
  "headers",
  "sendAt",
  "createContact",
  "type",
] as const;

const MAX_RECIPIENTS = 50;

/** Build the Volanea request body from a Strapi `send()` payload. */
export function buildPayload(
  options: StrapiSendOptions | undefined,
  settings: StrapiSettings = {},
): VolaneaPayload {
  const { from, to, cc, bcc, replyTo, subject, text, html, attachments, ...rest } = options ?? {};

  // Volanea sends one discrete message per recipient, so cc/bcc recipients are
  // folded into the recipient list. They each receive their own copy and do not
  // see one another — bcc semantics, not cc semantics.
  const recipients = [...parseAddressList(to), ...parseAddressList(cc), ...parseAddressList(bcc)];

  if (!recipients.length) {
    throw new VolaneaError("No recipient: `to` is required.", { code: "validation_error" });
  }

  if (recipients.length > MAX_RECIPIENTS) {
    throw new VolaneaError(
      `Too many recipients (${recipients.length}). Volanea accepts up to ${MAX_RECIPIENTS} per send.`,
      { code: "validation_error" },
    );
  }

  const fromParsed = parseAddress(from) ?? parseAddress(settings.defaultFrom);
  const replyToParsed = parseAddress(replyTo) ?? parseAddress(settings.defaultReplyTo);

  const collapsed = recipients.map(toRecipient);
  const payload: VolaneaPayload = {
    to: collapsed.length === 1 ? collapsed[0] : collapsed,
  };

  const subjectLine = subject || settings.defaultSubject;
  if (subjectLine) payload.subject = subjectLine;
  if (html) payload.html = html;
  if (text) payload.text = text;

  if (fromParsed) {
    payload.from = fromParsed.email;
    const fromName = fromParsed.name || settings.defaultFromName;
    if (fromName) payload.fromName = fromName;
  }

  if (replyToParsed) payload.replyTo = replyToParsed.email;

  const files = normalizeAttachments(attachments);
  if (files) payload.attachments = files;

  // Strapi's own mail (password resets, invites, confirmations) is always
  // transactional. Callers can override per-send via `type`.
  payload.type = (rest.type as string) || settings.defaultType || "transactional";

  for (const field of PASSTHROUGH_FIELDS) {
    if (field === "type") continue;
    if (rest[field] !== undefined) payload[field] = rest[field];
  }

  return payload;
}
