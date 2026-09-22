import { useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { Modal } from './Modal';
import { TitleReviews } from './TitleReviews';

interface TitleInspectionProps {
  title: DiscoveryTitle;
  locale: Locale;
  isInBasket: boolean;
  basketFull: boolean;
  canWatch: boolean;
  savedForLater: boolean;
  favorite: boolean;
  onToggleBasket: () => void;
  onToggleSaved: (collection: 'watch_later' | 'favorite') => void;
  onWatch: () => void;
  onClose: () => void;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 3).map((part) => part[0]).join('');
}

export function TitleInspection({
  title,
  locale,
  isInBasket,
  basketFull,
  canWatch,
  savedForLater,
  favorite,
  onToggleBasket,
  onToggleSaved,
  onWatch,
  onClose,
}: TitleInspectionProps) {
  const t = copy[locale];
  const pt = locale === 'pt-BR';
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const tmdbId = externalId(title.identity, 'tmdb');
  const imdbId = externalId(title.identity, 'imdb');
  return (
    <Modal label={title.name} onClose={onClose} className="title-modal">
      <div className="inspection-art" aria-hidden="true">
        {title.posterUrl
          ? <img src={title.posterUrl} alt="" loading="lazy" />
          : <span>{initials(title.name)}</span>}
      </div>
      <section className="inspection-copy">
        <p className="eyebrow">VHS · {title.year ?? '—'} · {title.identity.type === 'series' ? (pt ? 'Série' : 'Series') : (pt ? 'Filme' : 'Movie')}</p>
        <h2>{title.name}</h2>
        <p className="inspection-genres">{title.genres.join(' · ') || '—'}</p>
        <p>{title.description || (pt ? 'Sinopse ainda não disponível.' : 'Synopsis not available yet.')}</p>
        <dl className="identity-list">
          <div><dt>{pt ? 'Ano' : 'Year'}</dt><dd>{title.year ?? '—'}</dd></div>
          <div><dt>{pt ? 'Gêneros' : 'Genres'}</dt><dd>{title.genres.length || '—'}</dd></div>
          <div><dt>TMDB</dt><dd>{tmdbId ?? '—'}</dd></div>
          <div><dt>IMDb</dt><dd>{imdbId ?? '—'}</dd></div>
        </dl>
        <div className="inspection-actions">
          <button type="button" className="primary-action" onClick={onToggleBasket} disabled={!isInBasket && basketFull}>
            {isInBasket ? t.removeBasket : t.addBasket}
          </button>
          <button type="button" disabled={!canWatch} title={canWatch ? undefined : t.development} onClick={onWatch}>
            {canWatch ? (pt ? 'Assistir' : 'Watch') : t.watchDevelopment}
          </button>
          <button type="button" aria-pressed={savedForLater} onClick={() => onToggleSaved('watch_later')}>
            {savedForLater ? (pt ? 'Remover de Ver depois' : 'Remove from Watch later') : (pt ? 'Salvar para depois' : 'Save for later')}
          </button>
          <button type="button" aria-pressed={favorite} onClick={() => onToggleSaved('favorite')}>
            {favorite ? (pt ? 'Remover das favoritas' : 'Remove from favorites') : (pt ? 'Marcar como favorita' : 'Add to favorites')}
          </button>
          <button type="button" aria-expanded={reviewsOpen} onClick={() => setReviewsOpen((open) => !open)}>
            {reviewsOpen ? (pt ? 'Fechar avaliações' : 'Close reviews') : (pt ? 'Ver avaliações' : 'See reviews')}
          </button>
          {reviewsOpen && <TitleReviews title={title} locale={locale} />}
          <button type="button" className="text-action" onClick={onClose}>{t.close}</button>
        </div>
      </section>
    </Modal>
  );
}
