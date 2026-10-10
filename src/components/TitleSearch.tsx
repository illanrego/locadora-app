import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { searchTitles } from '../locadora/discovery';
import { Modal } from './Modal';

interface TitleSearchProps {
  locale: Locale;
  onInspect: (title: DiscoveryTitle) => void;
  onClose: () => void;
}

export function TitleSearch({ locale, onInspect, onClose }: TitleSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DiscoveryTitle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pt = locale === 'pt-BR';

  useEffect(() => {
    inputRef.current?.focus();
    return () => requestRef.current?.abort();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    requestRef.current?.abort();
    setResults(null);
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
    void searchTitles(trimmed, locale, controller.signal).then((titles) => {
      if (!controller.signal.aborted) setResults(titles);
    }).catch(() => {
      if (!controller.signal.aborted) setError(pt ? 'Não foi possível buscar títulos.' : 'Could not search titles.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }

  function inspect(title: DiscoveryTitle) {
    requestRef.current?.abort();
    onClose();
    onInspect(title);
  }

  return <Modal label={pt ? 'Buscar título' : 'Search titles'} onClose={onClose} className="title-search-modal">
    <div className="title-search-header">
      <div><p className="eyebrow">{pt ? 'Acervo' : 'Catalogue'}</p><h2>{pt ? 'Buscar título' : 'Search titles'}</h2></div>
      <button type="button" onClick={onClose} aria-label={copy[locale].close}>×</button>
    </div>
    <form className="title-search-form" onSubmit={submit}>
      <label htmlFor="title-search-query">{pt ? 'Nome do filme ou série' : 'Movie or series title'}</label>
      <div><input id="title-search-query" ref={inputRef} type="search" value={query} maxLength={160} aria-describedby="title-search-status" onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        <button type="submit" disabled={loading}>{pt ? 'Buscar' : 'Search'}</button></div>
    </form>
    <p id="title-search-status" className="title-search-status" role="status" aria-live="polite">{loading ? (pt ? 'Buscando títulos…' : 'Searching titles…') : error || (results ? results.length ? (pt ? `${results.length} ${results.length === 1 ? 'título encontrado.' : 'títulos encontrados.'}` : `${results.length} ${results.length === 1 ? 'title found.' : 'titles found.'}`) : (pt ? 'Nenhum título encontrado.' : 'No titles found.') : (pt ? 'Digite um título para começar.' : 'Enter a title to begin.'))}</p>
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
