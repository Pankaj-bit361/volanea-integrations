import { VolaneaError } from "@volanea/integrations-core";

export interface MedusaAttachment {
  filename?: string;
  /** Medusa hands attachments over already base64-encoded, as SendGrid wants. */
  content?: unknown;
  content_type?: string;
  contentType?: string;
  disposition?: string;
  id?: string;
}

export interface VolaneaAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

/**
 * Encode Medusa attachments for the Volanea API.
 *
 * ── This is deliberately NOT shared with the Strapi provider. ──
 * Here a string `content` is **already base64**: Medusa's own type declares
 * `content: string` and its first-party providers pass it straight to SendGrid,
 * which expects base64. In `packages/strapi` a string is **raw text**, because
 * that is Nodemailer's rule and what Strapi's Email plugin passes through. The
 * two ecosystems genuinely disagree; unifying them would corrupt every
 * attachment in one of them, so each package keeps its own rule. See the
 * matching note in `packages/strapi/src/attachments.ts`.
 *
 * Buffers, typed arrays and `data:` URIs are also accepted, because callers
 * building notifications by hand reach for those.
 */
export function normalizeAttachments(
  attachments: MedusaAttachment[] | null | undefined,
): VolaneaAttachment[] | undefined {
  if (!attachments?.length) return undefined;

  return attachments.map((attachment, index) => {
    const { filename, content } = attachment;
    const contentType = attachment.content_type ?? attachment.contentType;

    if (content === undefined || content === null || content === "") {
      throw new VolaneaError(
        `Attachment ${index} ("${filename || "unnamed"}") has no content. ` +
          "Pass base64 text, a Buffer, or a data: URI — the provider does not " +
          "read attachments from disk or from a URL.",
        { code: "invalid_attachment" },
      );
    }

    let base64: string;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) {
      base64 = content.toString("base64");
    } else if (content instanceof Uint8Array) {
      base64 = Buffer.from(content).toString("base64");
    } else {
      const str = String(content);
      const dataUri = str.match(/^data:[^;]*;base64,(.*)$/s);
      base64 = dataUri ? dataUri[1] : str;
    }

    return {
      filename: filename || `attachment-${index + 1}`,
      content: base64,
      ...(contentType ? { contentType } : {}),
    };
  });
}
