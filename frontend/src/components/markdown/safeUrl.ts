const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/** Only http(s) and mailto links are kept; anything else (javascript:, data:, relative paths)
 * is dropped so Markdown written by one person can never run code in someone else's browser. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return ALLOWED.has(parsed.protocol) ? parsed.href : null;
  } catch {
    // Bare domains are common in notes ("example.com/page"): treat them as https.
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed)) return `https://${trimmed}`;
    return null;
  }
}
