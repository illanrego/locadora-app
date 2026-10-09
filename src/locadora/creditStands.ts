import type { PersonCredit } from '../domain/content';

export interface PersonRole {
  department: string;
  count: number;
}

export interface PersonProfile {
  id: string;
  name: string;
  profile: string | null;
  knownFor: string;
  roles: PersonRole[];
}

export interface CreditStandSelection {
  id: string;
  name: string;
  department: string;
  profile: string | null;
}

export const DEPARTMENTS = [
  'Acting', 'Directing', 'Writing', 'Camera', 'Editing', 'Visual Effects',
  'Sound', 'Art', 'Production', 'Music', 'Costume & Make-Up', 'Lighting',
] as const;

export function validPersonId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
}

export function creditSelection(entry: PersonCredit, department: string): CreditStandSelection {
  return { id: entry.id, name: entry.name, department, profile: null };
}

export function normalizePerson(body: unknown): PersonProfile | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = (body as Record<string, unknown>).person;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const person = raw as Record<string, unknown>;
  const id = String(person.id ?? '');
  const name = typeof person.name === 'string' ? person.name.trim().slice(0, 120) : '';
  if (!validPersonId(id) || !name) return null;
  const departments = new Map<string, number>();
  if (Array.isArray(person.roles)) for (const rawRole of person.roles.slice(0, 100)) {
    if (!rawRole || typeof rawRole !== 'object' || Array.isArray(rawRole)) continue;
    const role = rawRole as Record<string, unknown>;
    if (!DEPARTMENTS.includes(role.department as typeof DEPARTMENTS[number])) continue;
    if (typeof role.count !== 'number' || !Number.isSafeInteger(role.count) || role.count <= 0) continue;
    const department = role.department as string;
    departments.set(department, (departments.get(department) ?? 0) + role.count);
  }
  let profile: string | null = null;
  if (typeof person.profile === 'string') {
    try {
      const url = new URL(person.profile);
      if (url.protocol === 'https:' && url.hostname === 'image.tmdb.org' && url.pathname.startsWith('/t/p/')) profile = url.href;
    } catch { /* A missing portrait is allowed. */ }
  }
  return {
    id, name, profile,
    knownFor: typeof person.knownFor === 'string' ? person.knownFor.slice(0, 80) : '',
    roles: [...departments].map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department)),
  };
}
