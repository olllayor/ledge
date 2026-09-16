/**
 * Secret-shaped text detection for clipboard capture, ported as an idea
 * from vorssaint-utils' ClipboardHistorySensitiveText (see
 * docs/vorssaint-shelf-plan.md). Password managers that never mark the
 * pasteboard with `org.nspasteboard.ConcealedType` still get skipped
 * when the text itself looks like a secret.
 *
 * Two carve-outs keep false positives near zero:
 * - URLs are never sensitive (ordinary work, often shared).
 * - Generated identifier codes (strict 8-4-4-4-12 hex, optionally
 *   braced) are nobody's secret and get copied around constantly.
 */

const OBVIOUS_SECRET_WORDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
];

/** 20–160 chars: long enough to be a credential, short enough to be one. */
const MIN_SENSITIVE_LENGTH = 20;
const MAX_SENSITIVE_LENGTH = 160;

export function looksSensitive(text: string): boolean {
  // URL check runs first: a link whose path happens to contain
  // "/token/" is ordinary work, and skipping it would surprise.
  if (isWebUrl(text)) return false;

  const lowered = text.toLowerCase();
  if (OBVIOUS_SECRET_WORDS.some((word) => lowered.includes(word))) {
    return true;
  }

  if (isIdentifierCode(text)) return false;

  if (
    text.length < MIN_SENSITIVE_LENGTH ||
    text.length > MAX_SENSITIVE_LENGTH ||
    /\s/.test(text)
  ) {
    return false;
  }

  const hasLetter = /[a-zA-Z]/.test(text);
  const hasDigit = /[0-9]/.test(text);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(text);
  return hasLetter && hasDigit && hasSymbol;
}

function isWebUrl(text: string): boolean {
  const candidate = text.trim();
  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Strict UUID shape on purpose: thirty-two hex digits in five dashed
 * groups, optionally wrapped in braces. Nothing that merely resembles a
 * UUID gets a pass.
 */
function isIdentifierCode(text: string): boolean {
  let value = text.trim();
  if (value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1);
  }

  const groups = value.split('-');
  if (groups.length !== 5) return false;
  const expectedLengths = [8, 4, 4, 4, 12];
  return groups.every(
    (group, index) =>
      group.length === expectedLengths[index] && /^[0-9a-fA-F]+$/.test(group),
  );
}
