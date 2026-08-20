/** HTML escaping helpers. Everything user- or parser-derived goes through these. */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(input: string): string {
  return escapeHtml(input);
}

/** Only http(s) and mailto survive; javascript:, data: and friends are dropped. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:[^\s<>"']+$/i.test(trimmed)) return trimmed;
  if (/^\/[^/\\]/.test(trimmed)) return trimmed; // internal absolute path
  if (/^#[A-Za-z0-9._:-]+$/.test(trimmed)) return trimmed; // in-page anchor
  return null;
}
