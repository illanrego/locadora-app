import { useMemo, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import { useInspectionArtwork } from '../locadora/artworkCache';
import { copy, type Locale } from '../locadora/catalog';
import { creditSelection, type CreditStandSelection } from '../locadora/creditStands';
import { Modal } from './Modal';
import { VhsInspection } from './VhsInspection';
import { departmentLabel } from './PersonView';

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
  onCreditPerson: (credit: CreditStandSelection) => void;
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
  onCreditPerson,
  onClose,
}: TitleInspectionProps) {
  const [deepCredits, setDeepCredits] = useState(false);
  const t = copy[locale];
  const pt = locale === 'pt-BR';
  const tmdbId = externalId(title.identity, 'tmdb');
  const imdbId = externalId(title.identity, 'imdb');
  const posterUrl = useInspectionArtwork(title.posterUrl, 'poster');
  const backdropUrl = useInspectionArtwork(title.backdropUrl, 'backdrop');
  const inspectionTitle = useMemo(() => ({ ...title, posterUrl, backdropUrl }), [backdropUrl, posterUrl, title]);
  const crewByDepartment = useMemo(() => {
    const groups = new Map<string, NonNullable<DiscoveryTitle['credits']>['crew']>();
    for (const entry of title.credits?.crew ?? []) {
      if (!entry.department) continue;
      groups.set(entry.department, [...(groups.get(entry.department) ?? []), entry]);
    }
    return [...groups];
  }, [title.credits]);
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
      <VhsInspection title={inspectionTitle} locale={locale} onInspectClose={onClose}
        onCreditPerson={(entry, department) => onCreditPerson(creditSelection(entry, department))} />
      <details className="tape-credit-panel">
        <summary>{pt ? 'Créditos da fita' : 'Tape credits'}</summary>
        {([
          ['Directing', title.director, title.credits?.director],
          ['Writing', title.writer, title.credits?.writer],
          ['Acting', title.cast, title.credits?.cast],
        ] as const).map(([department, names, entries]) => <div className="tape-credit-row" key={department}>
          <strong>{departmentLabel(department, locale)}</strong>
          <span>{entries?.length ? entries.map((entry) => <button key={`${entry.id}:${entry.name}`} type="button"
            onClick={() => onCreditPerson(creditSelection(entry, department))}>{entry.name}</button>) : names.join(' · ') || '—'}</span>
        </div>)}
        <button type="button" className="credit-more" aria-expanded={deepCredits} onClick={() => setDeepCredits((open) => !open)}>
          {deepCredits ? (pt ? 'Menos' : 'Less') : (pt ? 'Ficha técnica · mais' : 'Full credits · more')}
        </button>
        {deepCredits && <div className="credit-deep">
          {crewByDepartment.map(([department, entries]) =>
            <div className="tape-credit-row" key={department}><strong>{departmentLabel(department, locale)}</strong><span>
              {entries.map((entry) => <button key={`${entry.id}:${entry.job ?? ''}`} type="button"
                onClick={() => onCreditPerson(creditSelection(entry, department))}>{entry.name}{entry.job ? ` · ${entry.job}` : ''}</button>)}
            </span></div>)}
          {!title.credits?.crew.length && <p>{pt ? 'Não há outros créditos nesta ficha.' : 'No other credits in this record.'}</p>}
        </div>}
      </details>
      <div className="tape-member-actions" role="group" aria-label={pt ? 'Cesta' : 'Basket'}>
        <button type="button" className="tape-primary" onClick={onToggleBasket} disabled={!isInBasket && basketFull}>
          {isInBasket ? t.removeBasket : t.addBasket}
        </button>
      </div>
      <div className="tape-actions" role="group" aria-label={pt ? 'Ações da fita' : 'Tape actions'}>
        <button type="button" disabled={!canWatch} title={canWatch ? undefined : t.development} onClick={onWatch}>
          {canWatch ? (pt ? 'Assistir' : 'Watch') : t.watchDevelopment}
        </button>
        <button type="button" aria-pressed={savedForLater} onClick={() => onToggleSaved('watch_later')}>
          {savedForLater ? (pt ? 'Remover de Ver depois' : 'Remove from Watch later') : (pt ? 'Salvar para depois' : 'Save for later')}
        </button>
        <button type="button" aria-pressed={favorite} onClick={() => onToggleSaved('favorite')}>
          {favorite ? (pt ? 'Remover das favoritas' : 'Remove from favorites') : (pt ? 'Marcar como favorita' : 'Add to favorites')}
        </button>
        <button type="button" className="text-action" onClick={onClose}>{t.close}</button>
      </div>
    </Modal>
  );
}
