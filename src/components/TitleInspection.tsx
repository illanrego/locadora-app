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
  const [reviewsOpen, setReviewsOpen] = useState(false);
  return (
    <Modal label={title.name} onClose={onClose} className="title-modal">
      <div className="inspection-art" aria-hidden="true">
        <span>{title.name.split(/\s+/).slice(0, 3).map((part) => part[0]).join('')}</span>
      </div>
      <section className="inspection-copy">
        <p className="eyebrow">VHS · {title.year ?? '—'} · {title.identity.type}</p>
        <h2>{title.name}</h2>
        <p className="inspection-genres">{title.genres.join(' · ') || '—'}</p>
        <p>{title.description || (locale === 'pt-BR' ? 'Sinopse ainda não disponível.' : 'Synopsis not available yet.')}</p>
        <dl className="identity-list">
          <div><dt>TMDB</dt><dd>{externalId(title.identity, 'tmdb')}</dd></div>
          <div><dt>IMDb</dt><dd>{externalId(title.identity, 'imdb') ?? '—'}</dd></div>
        </dl>
        <div className="inspection-actions">
          <button type="button" className="primary-action" onClick={onToggleBasket} disabled={!isInBasket && basketFull}>
            {isInBasket ? t.removeBasket : t.addBasket}
          </button>
          <button type="button" disabled={!canWatch} title={canWatch ? undefined : t.development} onClick={onWatch}>
            {canWatch ? 'Quick Watch' : t.watchDevelopment}
          </button>
          <button type="button" aria-pressed={savedForLater} onClick={() => onToggleSaved('watch_later')}>
            {savedForLater ? (locale === 'pt-BR' ? 'Remover de Ver depois' : 'Remove from Watch later') : (locale === 'pt-BR' ? 'Salvar para depois' : 'Save for later')}
          </button>
          <button type="button" aria-pressed={favorite} onClick={() => onToggleSaved('favorite')}>
            {favorite ? (locale === 'pt-BR' ? 'Remover das favoritas' : 'Remove from favorites') : (locale === 'pt-BR' ? 'Marcar como favorita' : 'Add to favorites')}
          </button>
          <button type="button" aria-expanded={reviewsOpen} onClick={() => setReviewsOpen((open) => !open)}>
            {reviewsOpen ? (locale === 'pt-BR' ? 'Fechar avaliações' : 'Close reviews') : (locale === 'pt-BR' ? 'Ver avaliações' : 'See reviews')}
          </button>
          {reviewsOpen && <TitleReviews title={title} locale={locale} />}
          <button type="button" className="text-action" onClick={onClose}>{t.close}</button>
        </div>
      </section>
    </Modal>
  );
}
