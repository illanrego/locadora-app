const URL_PATTERN = /\b(?:https?|stremio|magnet):\/\/[^\s<>"']+/giu;
const SECRET_ASSIGNMENT = /\b(token|api[_-]?key|authorization|password|secret|signature|debrid)\s*[:=]\s*[^\s,;]+/giu;
const INFO_HASH = /\b[a-f0-9]{40}\b/giu;

export function redactDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? 'Unknown error');
  return message
    .replace(URL_PATTERN, '[REDACTED_URL]')
    .replace(SECRET_ASSIGNMENT, '$1=[REDACTED]')
    .replace(INFO_HASH, '[REDACTED_HASH]');
}

export function safeDiagnostic(error: unknown, fallback = 'Media request failed'): string {
  const redacted = redactDiagnostic(error).trim();
  return redacted && redacted.length <= 240 ? redacted : fallback;
}
