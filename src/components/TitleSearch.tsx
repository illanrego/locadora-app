import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { searchPeople, searchTitles } from '../locadora/discovery';
import type { CreditStandSelection } from '../locadora/creditStands';
import { departmentLabel } from './PersonView';
import { Modal } from './Modal';

interface TitleSearchProps {
  locale: Locale;
  onInspect: (title: DiscoveryTitle) => void;
  onOpenPerson: (person: CreditStandSelection) => void;
  onClose: () => void;
}

export function TitleSearch({ locale, onInspect, onOpenPerson, onClose }: TitleSearchProps) {
  const [query, setQuery] = useState('');
  const [peopleMode, setPeopleMode] = useState(false);
  const [results, setResults] = useState<DiscoveryTitle[] | null>(null);
  const [people, setPeople] = useState<CreditStandSelection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pt = locale === 'pt-BR';

  useEffect(() => {
    inputRef.current?.focus();
    return () => requestRef.current?.abort();
  }, []);

  function togglePeopleMode(enabled: boolean) {
    requestRef.current?.abort();
    setPeopleMode(enabled);
    setResults(null);
    setPeople(null);
    setLoading(false);
    setError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    requestRef.current?.abort();
    setResults(null);
    setPeople(null);
    setError('');
    const length = Array.from(trimmed).length;
    if (length < 2 || length > 80) {
      setLoading(false);
      setError(pt ? 'Digite de 2 a 80 caracteres.' : 'Enter 2 to 80 characters.');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    const request = peopleMode
      ? searchPeople(trimmed, locale, controller.signal).then((found) => { if (!controller.signal.aborted) setPeople(found); })
      : searchTitles(trimmed, locale, controller.signal).then((titles) => { if (!controller.signal.aborted) setResults(titles); });
    void request.catch(() => {
      if (!controller.signal.aborted) setError(peopleMode
        ? (pt ? 'Não foi possível buscar pessoas.' : 'Could not search people.')
        : (pt ? 'Não foi possível buscar títulos.' : 'Could not search titles.'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }

  function inspect(title: DiscoveryTitle) {
    requestRef.current?.abort();
    onClose();
    onInspect(title);
  }

  function openPerson(person: CreditStandSelection) {
    requestRef.current?.abort();
    onClose();
    onOpenPerson(person);
  }

  const status = loading
    ? (peopleMode ? (pt ? 'Buscando pessoas…' : 'Searching people…') : (pt ? 'Buscando títulos…' : 'Searching titles…'))
    : error || (peopleMode
      ? people ? (people.length
        ? `${people.length} ${people.length === 1 ? (pt ? 'pessoa encontrada.' : 'person found.') : (pt ? 'pessoas encontradas.' : 'people found.')}`
        : (pt ? 'Nenhuma pessoa encontrada.' : 'No people found.'))
        : (pt ? 'Digite um nome para começar.' : 'Enter a name to begin.')
      : results ? (results.length
        ? `${results.length} ${results.length === 1 ? (pt ? 'título encontrado.' : 'title found.') : (pt ? 'títulos encontrados.' : 'titles found.')}`
        : (pt ? 'Nenhum título encontrado.' : 'No titles found.'))
        : (pt ? 'Digite um título para começar.' : 'Enter a title to begin.'));

  return <Modal label={pt ? 'Buscar título' : 'Search titles'} onClose={onClose} className="title-search-modal">
    <div className="title-search-header">
      <div><p className="eyebrow">{pt ? 'Acervo' : 'Catalogue'}</p><h2>{pt ? 'Buscar título' : 'Search titles'}</h2></div>
      <button type="button" onClick={onClose} aria-label={copy[locale].close}>×</button>
    </div>
    <form className="title-search-form" onSubmit={submit}>
      <label htmlFor="title-search-query">{peopleMode ? (pt ? 'Nome da pessoa' : 'Person name') : (pt ? 'Nome do filme ou série' : 'Movie or series title')}</label>
      <div><input id="title-search-query" ref={inputRef} type="search" value={query} maxLength={160} aria-describedby="title-search-status" onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        <button type="submit" disabled={loading}>{pt ? 'Buscar' : 'Search'}</button></div>
      <label className="title-search-people" htmlFor="title-search-people">
        <input id="title-search-people" type="checkbox" checked={peopleMode} onChange={(event) => togglePeopleMode(event.target.checked)} />
        <span>{pt ? 'Buscar pessoas' : 'Search people'}</span>
      </label>
    </form>
    <p id="title-search-status" className="title-search-status" role="status" aria-live="polite">{status}</p>
    {people && people.length > 0 && <ul className="title-search-results">
      {people.map((person) => <li key={person.id}>
        <button type="button" onClick={() => openPerson(person)} aria-label={`${pt ? 'Abrir ficha de' : 'Open profile for'} ${person.name}`}>
          {person.profile ? <img src={person.profile} alt="" loading="lazy" /> : <span className="title-search-placeholder" aria-hidden="true">★</span>}
          <span><strong>{person.name}</strong><small>{departmentLabel(person.department, locale)}</small></span>
        </button>
      </li>)}
    </ul>}
    {results && results.length > 0 && <ul className="title-search-results">
      {results.map((title) => <li key={title.identity.canonicalKey}>
        <button type="button" onClick={() => inspect(title)} aria-label={`${pt ? 'Inspecionar' : 'Inspect'} ${title.name}`}>
          {title.posterUrl ? <img src={title.posterUrl} alt="" loading="lazy" /> : <span className="title-search-placeholder" aria-hidden="true">▣</span>}
          <span><strong>{title.name}</strong><small>{title.year ?? '—'} · {title.identity.type === 'movie' ? (pt ? 'Filme' : 'Movie') : (pt ? 'Série' : 'Series')}</small></span>
        </button>
      </li>)}
    </ul>}
  </Modal>;
}
