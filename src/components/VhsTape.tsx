import type { CSSProperties } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import type { Locale } from '../locadora/catalog';
import { useCachedArtwork } from '../locadora/artworkCache';

interface VhsTapeProps {
  title: DiscoveryTitle;
  accent: string;
  locale: Locale;
  // Local progress for this series, resolved once per shelf render by the shelf
  // owner. Zero means "no local progress" and renders no marker at all.
  watchedCount?: number;
  onInspect: (title: DiscoveryTitle) => void;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 3).map((part) => part[0]).join('').toUpperCase();
}

export function VhsTape({ title, accent, locale, watchedCount = 0, onInspect }: VhsTapeProps) {
  const label = locale === 'pt-BR'
    ? `Inspecionar ${title.name}, ${title.year ?? 'ano desconhecido'}`
    : `Inspect ${title.name}, ${title.year ?? 'unknown year'}`;
  const pt = locale === 'pt-BR';
  const style = { '--tape-accent': accent } as CSSProperties;
  const posterUrl = useCachedArtwork(title.posterUrl, 'poster');
  const progress = title.identity.type === 'series' && watchedCount > 0 ? watchedCount : 0;
  const progressLabel = pt
    ? `${title.name}: ${progress} ${progress === 1 ? 'episódio assistido' : 'episódios assistidos'}`
    : `${title.name}: ${progress} ${progress === 1 ? 'episode watched' : 'episodes watched'}`;
  return (
    <article className="vhs-item" style={style}>
      <button className="vhs-case" type="button" aria-label={label} onClick={() => onInspect(title)}>
        <span className="case-art" aria-hidden="true">
          {posterUrl
            ? <img src={posterUrl} alt="" decoding="async" />
            : <span className="case-initials">{initials(title.name)}</span>}
        </span>
        <span className="case-spine"><span>{title.year ?? '—'}</span></span>
        <span className="case-label">
          <strong>{title.name}</strong>
          <small>{title.year ?? '—'} · {title.identity.type === 'series' ? (pt ? 'série' : 'series') : (pt ? 'filme' : 'movie')}</small>
        </span>
      </button>
      {/* A sibling of the tape button: it never joins the button's accessible
          name, never takes clicks (pointer-events: none) and is not focusable,
          so the case keeps its hit region and its single tab stop. */}
      {progress > 0 && <span className="case-progress" role="img" aria-label={progressLabel}>
        {pt ? 'Em curso' : 'In progress'}
      </span>}
    </article>
  );
}
