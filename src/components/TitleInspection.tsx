import { useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { Modal } from './Modal';
import { TitleReviews } from './TitleReviews';
import { VhsInspection } from './VhsInspection';

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
  const pt = locale === 'pt-BR';
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const tmdbId = externalId(title.identity, 'tmdb');
  const imdbId = externalId(title.identity, 'imdb');
  return (
    <Modal label={title.name} onClose={onClose} className="title-modal tape-modal">
      <p className="sr-only">
        {[
          title.name,
          title.year ? String(title.year) : null,
          title.genres.join(', '),
          title.description,
          `TMDB ${tmdbId ?? '—'}`,
          imdbId,
        ].filter(Boolean).join(' · ')}
      </p>
      <button type="button" className="tape-close" onClick={onClose} aria-label={pt ? 'Fechar inspeção' : 'Close inspection'}>×</button>
      <VhsInspection title={title} locale={locale} inBasket={isInBasket} onInspectClose={onClose} />
      <div className="tape-actions" role="group" aria-label={pt ? 'Ações da fita' : 'Tape actions'}>
        <button type="button" className="tape-primary" onClick={onToggleBasket} disabled={!isInBasket && basketFull}>
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
        <button type="button" className="text-action" onClick={onClose}>{t.close}</button>
      </div>
      {reviewsOpen && (
        <div className="tape-reviews">
          <TitleReviews title={title} locale={locale} />
        </div>
      )}
    </Modal>
  );
}
