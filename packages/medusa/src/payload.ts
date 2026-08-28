import { VolaneaError, parseAddress, toRecipient } from "@volanea/integrations-core";
import { normalizeAttachments, type MedusaAttachment } from "./attachments";
import type { ResolvedOptions, VolaneaPayload } from "./types";

/** Medusa's notification shape, narrowed to the fields this provider reads. */
export interface NotificationLike {
  to?: string;
  channel?: string;
  template?: string;
  from?: string | null;
  data?: Record<string, unknown> | null;
  content?: { subject?: string; text?: string; html?: string } | null;
  provider_data?: Record<string, unknown> | null;
  attachments?: MedusaAttachment[] | null;
}

/**
 * Flatten `data` into the flat string/number/boolean map the API accepts.
 *
 * Volanea validates `variables` as `Record<string, string | number | boolean>`
 * and rejects anything else with a 422, so a nested object cannot be passed
 * through — but Medusa's `data` is routinely nested (`{ order: { id } }`).
 * Flattening to dotted keys is the mapping that survives both ends: the
 * renderer resolves a placeholder by trying the literal key first, so
 * `{{order.id}}` in a Volanea template picks up the flattened `"order.id"`
 * exactly as a template author would expect.
 *
 * Arrays flatten by index (`items.0.name`) and also get a `.length`, which is
 * enough to drive `{{items.length}}` in a subject line. Null and undefined are
 * dropped rather than stringified into the literal text "null".
 */
export function flattenVariables(
  data: Record<string, unknown> | null | undefined,
  prefix = "",
  out: Record<string, string | number | boolean> = {},
): Record<string, string | number | boolean> {
  if (!data || typeof data !== "object") return out;

  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) continue;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[path] = value;
    } else if (value instanceof Date) {
      out[path] = value.toISOString();
    } else if (Array.isArray(value)) {
      out[`${path}.length`] = value.length;
      value.forEach((item, i) => {
        flattenVariables({ [String(i)]: item }, path, out);
      });
    } else if (typeof value === "object") {
      flattenVariables(value as Record<string, unknown>, path, out);
    }
    // functions, symbols and bigints are dropped — none of them render.
  }

  return out;
}

/** Fields a caller may push through `provider_data` untouched. */
const PROVIDER_DATA_PASSTHROUGH = [
  "headers",
  "sendAt",
  "createContact",
  "type",
  "variables",
] as const;

/** Build the `/v1/send` body from a Medusa notification. */
export function buildPayload(
  notification: NotificationLike,
  options: ResolvedOptions,
): VolaneaPayload {
  if (!notification) {
    throw new VolaneaError("No notification was provided.", { code: "missing_recipient" });
  }

  const recipient = parseAddress(notification.to);
  if (!recipient) {
    throw new VolaneaError("The notification has no `to` address.", {
      code: "missing_recipient",
    });
  }

  const provider = (notification.provider_data ?? {}) as Record<string, unknown>;
  const content = notification.content ?? undefined;
  const template = notification.template?.trim();

  const payload: VolaneaPayload = {
    to: toRecipient(recipient),
  };

  // A template names the body; inline content is the fallback when there is no
  // template. A subject travels either way, so a caller can keep a stored
  // template's markup and still override its subject line per notification.
  if (template) {
    payload.templateId = template;
  } else {
    if (content?.html) payload.html = content.html;
    if (content?.text) payload.text = content.text;
  }
  if (content?.subject) payload.subject = content.subject;

  if (!template && !payload.html && !payload.text) {
    throw new VolaneaError(
      "Nothing to send: the notification has neither a `template` nor " +
        "`content.html` / `content.text`.",
      { code: "validation_error" },
    );
  }

  const from = parseAddress(notification.from) ?? parseAddress(options.from);
  if (from) {
    payload.from = from.email;
    const fromName = from.name ?? options.fromName;
    if (fromName) payload.fromName = fromName;
  }

  const replyTo = parseAddress(provider.replyTo as string) ?? parseAddress(options.replyTo);
  if (replyTo) payload.replyTo = replyTo.email;

  const variables = flattenVariables(notification.data);
  if (Object.keys(variables).length) payload.variables = variables;

  const files = normalizeAttachments(notification.attachments);
  if (files) payload.attachments = files;

  // Medusa's notification module is transactional by definition — order
  // confirmations and password resets must reach people who unsubscribed from
  // marketing. `provider_data.type` can still override it for a campaign-like
  // send that should honour unsubscribes.
  payload.type = "transactional";

  for (const field of PROVIDER_DATA_PASSTHROUGH) {
    const value = provider[field];
    if (value === undefined) continue;
    if (field === "variables") {
      payload.variables = {
        ...(payload.variables ?? {}),
        ...(value as Record<string, string | number | boolean>),
      };
    } else {
      (payload as unknown as Record<string, unknown>)[field] = value;
    }
  }

  return payload;
}
