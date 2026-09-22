import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { Modal } from './Modal';

interface TitleInspectionProps {
  title: DiscoveryTitle;
  locale: Locale;
  isInBasket: boolean;
  basketFull: boolean;
  onToggleBasket: () => void;
  onClose: () => void;
}

export function TitleInspection({
  title,
  locale,
  isInBasket,
  basketFull,
  onToggleBasket,
  onClose,
}: TitleInspectionProps) {
  const t = copy[locale];
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
          <button type="button" disabled title={t.development}>{t.watchDevelopment}</button>
          <button type="button" className="text-action" onClick={onClose}>{t.close}</button>
        </div>
      </section>
    </Modal>
  );
}
