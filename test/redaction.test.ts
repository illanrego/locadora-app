import { describe, expect, it } from 'vitest';
import { redactDiagnostic, safeDiagnostic } from '../src/media/redaction';

describe('diagnostic redaction', () => {
  it('removes URLs, credentials, hashes, and common secret assignments', () => {
    const secret = 'https://user:pass@example.invalid/config/token/manifest.json?api_key=abc';
    const hash = 'a'.repeat(40);
    const output = redactDiagnostic(`Failed ${secret} token=supersecret ${hash}`);
    expect(output).not.toContain('user');
    expect(output).not.toContain('supersecret');
    expect(output).not.toContain(hash);
    expect(output).toContain('[REDACTED_URL]');
  });

  it('bounds user-facing diagnostic length', () => {
    expect(safeDiagnostic('x'.repeat(300))).toBe('Media request failed');
  });
});
