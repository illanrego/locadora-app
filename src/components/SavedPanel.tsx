import { useEffect, useMemo, useState } from 'react';
import { normalizeDiscoveryTitle, type DiscoveryTitle } from '../domain/content';
import type { LocalSavedCollections, SavedCollection } from '../member/localSaved';
import { normalizeMemberState, type MemberState, type MemberTitle } from '../member/memberState';
import { fetchMemberState, readMemberSession } from '../platform/nativeBridge';
import type { Locale } from '../locadora/catalog';

interface SavedPanelProps {
  locale: Locale;
  local: LocalSavedCollections;
  onSet: (title: DiscoveryTitle, collection: SavedCollection, enabled: boolean) => Promise<boolean>;
}

interface SavedDisplay {
  key: string;
  title: DiscoveryTitle;
}

function memberDiscoveryTitle(title: MemberTitle): DiscoveryTitle | null {
  return normalizeDiscoveryTitle({
    tmdbId: title.tmdbId,
    type: title.type,
    name: title.name,
    year: title.year,
  });
}

function displayItems(local: DiscoveryTitle[], remote: MemberTitle[]): SavedDisplay[] {
  const items = new Map<string, DiscoveryTitle>();
  for (const title of remote) {
    const normalized = memberDiscoveryTitle(title);
    if (normalized) items.set(normalized.identity.canonicalKey, normalized);
  }
  for (const title of local) items.set(title.identity.canonicalKey, title);
  return [...items].map(([key, title]) => ({ key, title }));
}

export function SavedPanel({ locale, local, onSet }: SavedPanelProps) {
  const [collection, setCollection] = useState<SavedCollection>('watch_later');
  const [member, setMember] = useState<MemberState | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [status, setStatus] = useState('');
  const pt = locale === 'pt-BR';

  useEffect(() => {
    let active = true;
    void readMemberSession()
      .then(async (session) => {
        if (!active) return;
        setSignedIn(session.signedIn);
        if (session.signedIn) {
          const value = await fetchMemberState();
          if (active) setMember(normalizeMemberState(value));
        }
      })
      .catch(() => { if (active) setStatus(pt ? 'As fitas locais continuam disponíveis.' : 'Local tapes remain available.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pt]);

  const remote = collection === 'watch_later' ? member?.collections.watchLater ?? [] : member?.collections.favorites ?? [];
  const items = useMemo(() => displayItems(local[collection], remote), [collection, local, remote]);

  async function remove(item: SavedDisplay) {
    setBusyKey(item.key);
    setStatus('');
    const synced = await onSet(item.title, collection, false);
    if (member) {
      setMember({
        ...member,
        collections: {
          ...member.collections,
          [collection === 'watch_later' ? 'watchLater' : 'favorites']:
            remote.filter((title) => `${title.type}:tmdb:${title.tmdbId}` !== item.key),
        },
      });
    }
    setStatus(synced
      ? (pt ? 'Lista sincronizada.' : 'List synchronized.')
      : (pt ? 'Removido deste dispositivo.' : 'Removed from this device.'));
    setBusyKey('');
  }

  return (
    <div className="saved-panel">
      <div className="saved-tabs" role="tablist" aria-label={pt ? 'Listas salvas' : 'Saved lists'}>
        <button type="button" role="tab" aria-selected={collection === 'watch_later'} onClick={() => setCollection('watch_later')}>{pt ? 'Ver depois' : 'Watch later'}</button>
        <button type="button" role="tab" aria-selected={collection === 'favorite'} onClick={() => setCollection('favorite')}>{pt ? 'Favoritas' : 'Favorites'}</button>
      </div>
      <p className="configuration-status" role="status">{loading
        ? (pt ? 'Procurando suas fitas…' : 'Finding your tapes…')
        : status || (signedIn ? (pt ? 'Conta e dispositivo combinados.' : 'Account and device combined.') : (pt ? 'Salvas só neste dispositivo.' : 'Saved on this device only.'))}</p>
      {items.length ? (
        <ul className="saved-title-list">
          {items.map((item) => (
            <li key={item.key}>
              <span><strong>{item.title.name}</strong><small>{item.title.year ?? '—'} · {item.title.identity.type}</small></span>
              <button type="button" disabled={busyKey === item.key} onClick={() => void remove(item)}>{pt ? 'Remover' : 'Remove'}</button>
            </li>
          ))}
        </ul>
      ) : <p className="panel-empty">{pt ? 'Nenhuma fita nesta lista.' : 'No tapes in this list.'}</p>}
    </div>
  );
}
