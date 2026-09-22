import type { CSSProperties } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import type { Locale } from '../locadora/catalog';

interface VhsTapeProps {
  title: DiscoveryTitle;
  accent: string;
  locale: Locale;
  onInspect: (title: DiscoveryTitle) => void;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 3).map((part) => part[0]).join('').toUpperCase();
}

export function VhsTape({ title, accent, locale, onInspect }: VhsTapeProps) {
  const label = locale === 'pt-BR'
    ? `Inspecionar ${title.name}, ${title.year ?? 'ano desconhecido'}`
    : `Inspect ${title.name}, ${title.year ?? 'unknown year'}`;
  const style = { '--tape-accent': accent } as CSSProperties;
  return (
    <article className="vhs-item" style={style}>
      <button className="vhs-case" type="button" aria-label={label} onClick={() => onInspect(title)}>
        <span className="case-art" aria-hidden="true">
          {title.posterUrl
            ? <img src={title.posterUrl} alt="" loading="lazy" />
            : <span className="case-initials">{initials(title.name)}</span>}
        </span>
        <span className="case-spine"><span>{title.year ?? '—'}</span></span>
        <span className="case-label">
          <strong>{title.name}</strong>
          <small>{title.year ?? '—'} · {title.identity.type === 'series' ? (locale === 'pt-BR' ? 'série' : 'series') : (locale === 'pt-BR' ? 'filme' : 'movie')}</small>
        </span>
      </button>
    </article>
  );
}
