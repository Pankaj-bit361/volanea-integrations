/** A recipient or sender, split into its parts. */
export interface Address {
  email: string;
  name?: string;
}

/**
 * Parse one address.
 *
 * Accepts `"a@b.com"`, `"Name <a@b.com>"`, `'"Name, Inc." <a@b.com>'`, or an
 * object using either `email` or Nodemailer's `address` key.
 */
export function parseAddress(input: unknown): Address | null {
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "object") {
    const obj = input as { email?: unknown; address?: unknown; name?: unknown };
    const raw = obj.email ?? obj.address;
    if (!raw) return null;
    const email = String(raw).trim();
    if (!email) return null;
    const name = obj.name ? String(obj.name).trim() : "";
    return name ? { email, name } : { email };
  }

  const str = String(input).trim();
  if (!str) return null;

  const match = str.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) return { email: str };

  const name = match[1].trim().replace(/^["']|["']$/g, "").trim();
  const email = match[2].trim();
  return name ? { email, name } : { email };
}

/**
 * Parse one-or-many addresses into a flat list.
 *
 * A string is split on commas that are not inside an `<angle-bracketed>`
 * address, so `"A One <a@x.com>, b@x.com"` yields two recipients. A comma
 * inside an unquoted display name will still split — the same limitation
 * Nodemailer has, and the reason to pass an array when names contain commas.
 */
export function parseAddressList(input: unknown): Address[] {
  if (input === null || input === undefined || input === "") return [];

  const raw = Array.isArray(input) ? input : String(input).split(/,(?![^<]*>)/);

  return raw.map(parseAddress).filter((a): a is Address => a !== null);
}

/**
 * Collapse an address into what the API's `to`/`from` fields take: a bare
 * string when there is no display name, otherwise `{ email, name }`.
 */
export function toRecipient(address: Address): string | { email: string; name: string } {
  return address.name ? { email: address.email, name: address.name } : address.email;
}

/** The bare email out of a parsed address. */
export function addressEmail(address: Address | null): string | null {
  return address ? address.email : null;
}
