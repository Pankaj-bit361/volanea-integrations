import { VolaneaError } from "@volanea/integrations-core";

export interface StrapiAttachment {
  filename?: string;
  content?: unknown;
  contentType?: string;
  /**
   * Node Buffer encoding for a string `content`. Defaults to `utf8`.
   *
   * Spelled out rather than using the `BufferEncoding` global, so the published
   * .d.ts type-checks in a project that has not installed @types/node.
   */
  encoding?: "utf8" | "utf-8" | "base64" | "base64url" | "hex" | "ascii" | "latin1" | "binary" | "ucs2" | "ucs-2" | "utf16le" | "utf-16le";
}

export interface VolaneaAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

/**
 * Encode Strapi/Nodemailer-style attachments for the Volanea API.
 *
 * ── This is deliberately NOT shared with the Medusa provider. ──
 * Here a string `content` is **raw text**, because that is Nodemailer's rule
 * and Strapi's Email plugin passes attachments through untouched. In
 * `packages/medusa` a string is **already base64**, because that is what
 * Medusa's own type declares and what its providers hand to SendGrid. The two
 * ecosystems genuinely disagree; unifying them would corrupt every attachment
 * in one of them, so each package keeps its own rule. See the matching note in
 * `packages/medusa/src/attachments.ts`.
 *
 * To pass bytes that are already encoded, use a `data:` URI or set `encoding`
 * the way Nodemailer does: `{ content: '<base64>', encoding: 'base64' }`.
 * Sniffing the string for base64-looking characters is not an option — plenty
 * of ordinary text is valid base64.
 */
export function normalizeAttachments(
  attachments: StrapiAttachment[] | null | undefined,
): VolaneaAttachment[] | undefined {
  if (!attachments?.length) return undefined;

  return attachments.map((attachment, index) => {
    const { filename, content, contentType, encoding } = attachment;

    if (content === undefined || content === null) {
      throw new VolaneaError(
        `Attachment ${index} ("${filename || "unnamed"}") has no \`content\`. ` +
          "The Volanea provider does not read attachments from disk or URLs — " +
          "pass a Buffer, a string, or a data: URI.",
        { code: "invalid_attachment" },
      );
    }

    let base64: string;
    if (Buffer.isBuffer(content)) {
      base64 = content.toString("base64");
    } else if (content instanceof Uint8Array) {
      base64 = Buffer.from(content).toString("base64");
    } else {
      const str = String(content);
      const dataUri = str.match(/^data:[^;]*;base64,(.*)$/s);
      if (dataUri) {
        base64 = dataUri[1];
      } else if (encoding === "base64") {
        // Already encoded — re-encoding it would double-wrap the bytes.
        base64 = str;
      } else {
        base64 = Buffer.from(str, encoding || "utf8").toString("base64");
      }
    }

    return {
      filename: filename || `attachment-${index + 1}`,
      content: base64,
      ...(contentType ? { contentType } : {}),
    };
  });
}
