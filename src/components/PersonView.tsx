import { useEffect, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { creditSelection, type CreditStandSelection, type PersonProfile } from '../locadora/creditStands';
import { loadCreditStand, loadPerson, type ShelfPage, type ShelfSort } from '../locadora/discovery';
import { Modal } from './Modal';

const DEPARTMENT_LABELS: Record<string, { 'pt-BR': string; 'en-US': string }> = {
  Acting: { 'pt-BR': 'Elenco', 'en-US': 'Acting' },
  Directing: { 'pt-BR': 'Direção', 'en-US': 'Directing' },
  Writing: { 'pt-BR': 'Roteiro', 'en-US': 'Writing' },
  Camera: { 'pt-BR': 'Fotografia', 'en-US': 'Camera' },
  Editing: { 'pt-BR': 'Montagem', 'en-US': 'Editing' },
  'Visual Effects': { 'pt-BR': 'Efeitos visuais', 'en-US': 'Visual Effects' },
  Sound: { 'pt-BR': 'Som', 'en-US': 'Sound' },
  Art: { 'pt-BR': 'Arte', 'en-US': 'Art' },
  Production: { 'pt-BR': 'Produção', 'en-US': 'Production' },
  Music: { 'pt-BR': 'Música', 'en-US': 'Music' },
  'Costume & Make-Up': { 'pt-BR': 'Figurino e maquiagem', 'en-US': 'Costume & Make-Up' },
  Lighting: { 'pt-BR': 'Iluminação', 'en-US': 'Lighting' },
};

export function departmentLabel(department: string, locale: Locale): string {
  return DEPARTMENT_LABELS[department]?.[locale] ?? department;
}

interface PersonViewProps {
  credit: CreditStandSelection;
  year: number;
  sort: ShelfSort;
  locale: Locale;
  onViewAsStand: (credit: CreditStandSelection) => void;
  onInspect: (title: DiscoveryTitle) => void;
  onClose: () => void;
}

export function PersonView({ credit, year, sort, locale, onViewAsStand, onInspect, onClose }: PersonViewProps) {
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [department, setDepartment] = useState(credit.department);
  const [page, setPage] = useState<ShelfPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [titlesLoading, setTitlesLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadPerson(credit.id, locale, controller.signal).then((person) => {
      if (controller.signal.aborted) return;
      setProfile(person);
      setDepartment(person.roles.some((role) => role.department === credit.department) ? credit.department : (person.roles[0]?.department ?? credit.department));
      setLoading(false);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    });
    return () => controller.abort();
  }, [credit.department, credit.id, locale]);

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    setPage(null);
    setTitlesLoading(true);
    setError('');
    void loadCreditStand({ credit: creditSelection({ id: profile.id, name: profile.name }, department), year, stand: 0, sort, locale }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPage(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setTitlesLoading(false); });
    return () => controller.abort();
  }, [department, locale, profile, sort, year]);

  const selection: CreditStandSelection = {
    id: profile?.id ?? credit.id,
    name: profile?.name ?? credit.name,
    department,
    profile: profile?.profile ?? credit.profile,
  };
  const pt = locale === 'pt-BR';
  return <Modal label={pt ? `Créditos de ${selection.name}` : `Credits of ${selection.name}`} onClose={onClose} className="person-modal">
    <div className="person-header">
      {profile?.profile ? <img src={profile.profile} alt="" loading="lazy" /> : <span className="person-placeholder" aria-hidden="true">★</span>}
      <div>
        <p>{pt ? 'Ficha da pessoa' : 'Person credits'}</p>
        <h2>{selection.name}</h2>
        {profile?.knownFor && <p>{departmentLabel(profile.knownFor, locale)}</p>}
      </div>
      <button type="button" className="person-close" onClick={onClose} aria-label={copy[locale].close}>×</button>
    </div>
    {loading && <p role="status">{pt ? 'Abrindo ficha…' : 'Opening credits…'}</p>}
    {profile && <>
      <div className="person-roles" role="group" aria-label={pt ? 'Áreas de trabalho' : 'Departments'}>
        {profile.roles.map((role) => <button key={role.department} type="button" aria-pressed={department === role.department} onClick={() => setDepartment(role.department)}>
          {departmentLabel(role.department, locale)} <span>{role.count}</span>
        </button>)}
      </div>
      <div className="person-actions">
        <button type="button" className="primary-action" onClick={() => onViewAsStand(selection)}>{pt ? 'Ver como estante' : 'View as stand'}</button>
        <button type="button" onClick={onClose}>{copy[locale].close}</button>
      </div>
      <h3>{pt ? 'Títulos' : 'Titles'} · {departmentLabel(department, locale)}</h3>
      {titlesLoading && <p role="status">{copy[locale].loading}</p>}
      {page && !page.titles.length && <p>{pt ? 'Nenhum título nesta área.' : 'No titles in this department.'}</p>}
      {page && <ul className="person-titles">{page.titles.map((title) => <li key={title.identity.canonicalKey}>
        <button type="button" onClick={() => onInspect(title)}>
          {title.posterUrl && <img src={title.posterUrl} alt="" loading="lazy" />}
          <span><strong>{title.name}</strong><small>{title.year ?? '—'} · {title.identity.type === 'series' ? (pt ? 'Série' : 'Series') : (pt ? 'Filme' : 'Movie')}</small></span>
        </button>
      </li>)}</ul>}
      {page?.hasNextStand && <p>{pt ? 'Mais títulos na estante completa.' : 'More titles on the full stand.'}</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
