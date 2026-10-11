import { DEPARTMENTS, validPersonId, type CreditStandSelection } from './creditStands';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/** Portrait URLs follow the same TMDB-image-only rule as every other artwork path. */
function portrait(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'image.tmdb.org'
      && url.pathname.startsWith('/t/p/') && !url.username && !url.password
      && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

/**
 * Treats `/v1/person-search` as untrusted bounded input: numeric TMDB ids only,
 * a bounded name, a TMDB-only portrait, and a department from the credit-stand
 * allowlist with an `Acting` fallback. The result feeds `PersonView` directly.
 */
export function normalizePersonSearch(body: unknown): CreditStandSelection[] | null {
  const response = record(body);
  if (!response || !Array.isArray(response.people)) return null;
  const seen = new Set<string>();
  return response.people.slice(0, 8).flatMap((value) => {
    const item = record(value);
    if (!item) return [];
    const id = validPersonId(item.id) ? item.id : null;
    const name = boundedText(item.name, 200);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    const department = DEPARTMENTS.includes(item.department as typeof DEPARTMENTS[number])
      ? item.department as string
      : 'Acting';
    return [{ id, name, department, profile: portrait(item.profile) }];
  });
}
