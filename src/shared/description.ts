export const RICH_TEXT_PREFIX = "<!--dedsiwork-richtext-v1-->";
export const MAX_DESCRIPTION_LENGTH = 2_000_000;
export const MAX_REQUEST_BODY_SIZE = 8 * 1024 * 1024;
export const MAX_IMAGE_SIZE = 1024 * 1024;

// Display-only summaries: remove complete image payloads before truncation.
// Source material handed to the assistant must retain its original content.
export function descriptionPreview(value: string, length = 220): string {
  return value
    .replace(RICH_TEXT_PREFIX, "")
    .replace(/<img\b[^>]*(?:>|$)/gi, " [图片] ")
    .replace(/<[^>]*(?:>|$)/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}
