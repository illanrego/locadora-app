import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ContentType, DiscoveryTitle } from './domain/content';
import { GENRES, copy, type Locale } from './locadora/catalog';
import { loadShelf, type ShelfPage } from './locadora/discovery';
import { SidePanel } from './components/SidePanel';
import { TitleInspection } from './components/TitleInspection';
import { VhsTape } from './components/VhsTape';
import { readNativeCapabilities, type NativeCapabilities } from './platform/nativeBridge';
import './styles.css';

type Panel = 'basket' | 'saved' | 'account' | null;

function clampYear(value: number): number {
  return Math.min(new Date().getFullYear(), Math.max(1920, Math.round(value)));
}

export default function App() {
  const [locale, setLocale] = useState<Locale>('pt-BR');
  const [genreIndex, setGenreIndex] = useState(0);
  const [yearDraft, setYearDraft] = useState(1999);
  const [year, setYear] = useState(1999);
  const [type, setType] = useState<ContentType>('movie');
  const [pages, setPages] = useState<ShelfPage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DiscoveryTitle | null>(null);
  const [basket, setBasket] = useState<DiscoveryTitle[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeCapabilities | null>(null);
  const t = copy[locale];
  const genre = GENRES[genreIndex];

  const fetchPage = useCallback(async (stand: number, append: boolean, signal?: AbortSignal) => {
    setStatus('loading');
    setError('');
    try {
      const page = await loadShelf({ genres: genre.apiGenres, year, type, stand, locale }, signal);
      setPages((current) => append ? [...current, page] : [page]);
      setStatus('ready');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : (locale === 'pt-BR' ? 'Não foi possível abrir a estante.' : 'Could not open the shelf.'));
    }
  }, [genre.apiGenres, locale, type, year]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPage(0, false, controller.signal);
    return () => controller.abort();
  }, [fetchPage]);

  const allTitles = useMemo(() => {
    const unique = new Map<string, DiscoveryTitle>();
    for (const page of pages) for (const title of page.titles) unique.set(title.identity.canonicalKey, title);
    return [...unique.values()];
  }, [pages]);

  const visibleTitles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return normalized ? allTitles.filter((title) => title.name.toLocaleLowerCase(locale).includes(normalized)) : allTitles;
  }, [allTitles, locale, query]);

  const hasNextStand = pages.at(-1)?.hasNextStand ?? false;
  const source = pages[0]?.source ?? 'fixture';
  const inBasket = (title: DiscoveryTitle) => basket.some((item) => item.identity.canonicalKey === title.identity.canonicalKey);
  const toggleBasket = (title: DiscoveryTitle) => {
    setBasket((current) => current.some((item) => item.identity.canonicalKey === title.identity.canonicalKey)
      ? current.filter((item) => item.identity.canonicalKey !== title.identity.canonicalKey)
      : current.length < 3 ? [...current, title] : current);
  };
  const chooseGenre = (index: number) => {
    setGenreIndex(index);
    setQuery('');
  };
  const applyYear = () => setYear(clampYear(yearDraft));

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === 'pt-BR' ? "Will's Locadora — seu player" : "Will's Video Store — your player";
  }, [locale]);

  useEffect(() => {
    void readNativeCapabilities().then(setNativeCapabilities).catch(() => {
      setNativeCapabilities({ mpv: { available: false, version: null } });
    });
  }, []);

  return (
    <div className="app-shell" style={{ '--genre-accent': genre.accent } as React.CSSProperties}>
      <a className="skip-link" href="#shelf">{locale === 'pt-BR' ? 'Pular para a prateleira' : 'Skip to shelf'}</a>
      <header className="store-header">
        <div className="masthead">
          <a className="brand" href="#top" aria-label="Will's Locadora">
            <strong>WILL'S LOCADORA</strong>
            <span>{t.tagline}</span>
          </a>
          <nav className="header-actions" aria-label={locale === 'pt-BR' ? 'Ações da loja' : 'Store actions'}>
            <button type="button" onClick={() => setPanel('saved')}>{locale === 'pt-BR' ? 'Salvos' : 'Saved'}</button>
            <button type="button" onClick={() => setPanel('account')}>{t.account}</button>
            <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>{t.settings}</button>
            <button type="button" className="basket-button" onClick={() => setPanel('basket')}>
              {t.basket}<span aria-label={`${basket.length} / 3`}>{basket.length}</span>
            </button>
          </nav>
        </div>

        <div className="browse-controls">
          <label>
            <span>{t.genre}</span>
            <select value={genreIndex} onChange={(event) => chooseGenre(Number(event.target.value))}>
              {GENRES.map((item, index) => <option key={item.id} value={index}>{item.label[locale]}</option>)}
            </select>
          </label>
          <form className="year-machine" onSubmit={(event) => { event.preventDefault(); applyYear(); }}>
            <span>{t.year}</span>
            <button type="button" onClick={() => setYearDraft((value) => clampYear(value - 1))} aria-label={locale === 'pt-BR' ? 'Ano anterior' : 'Previous year'}>−</button>
            <input type="number" min="1920" max={new Date().getFullYear()} value={yearDraft} onChange={(event) => setYearDraft(Number(event.target.value))} aria-label={t.year} />
            <button type="button" onClick={() => setYearDraft((value) => clampYear(value + 1))} aria-label={locale === 'pt-BR' ? 'Próximo ano' : 'Next year'}>+</button>
            <button type="submit">{t.go}</button>
          </form>
          <label className="search-control">
            <span>{t.search}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === 'pt-BR' ? 'Nome da fita…' : 'Tape name…'} />
          </label>
        </div>

        {settingsOpen && (
          <section className="settings-drawer" aria-label={t.settings}>
            <fieldset>
              <legend>{t.type}</legend>
              <button type="button" aria-pressed={type === 'movie'} onClick={() => setType('movie')}>{t.movies}</button>
              <button type="button" aria-pressed={type === 'series'} onClick={() => setType('series')}>{t.series}</button>
            </fieldset>
            <div className="language-setting">
              <span>{locale === 'pt-BR' ? 'Idioma' : 'Language'}</span>
              <button type="button" onClick={() => setLocale((value) => value === 'pt-BR' ? 'en-US' : 'pt-BR')}>
                {locale === 'pt-BR' ? 'English' : 'Português'}
              </button>
            </div>
            <p>
              <strong>Player:</strong>{' '}
              {nativeCapabilities?.mpv.available
                ? `${nativeCapabilities.mpv.version ?? 'mpv'} · ${locale === 'pt-BR' ? 'pronto' : 'ready'}`
                : t.development}
            </p>
          </section>
        )}
      </header>

      <main id="top">
        <p className="rental-intro">{t.intro}</p>
        <section className="shelf-room" aria-labelledby="shelf-title">
          <div className="fluorescent" aria-hidden="true" />
          <header className="shelf-heading">
            <div>
              <p>{t.aisle} {String(genreIndex + 1).padStart(2, '0')} · {year - 19}–{year} · <span className={`source-badge source-${source}`}>{source === 'fixture' ? t.demo : t.live}</span></p>
              <h1 id="shelf-title">{genre.label[locale]}</h1>
            </div>
            <p className="shelf-status" role="status" aria-live="polite">
              {status === 'loading' ? t.loading : status === 'error' ? error : `${visibleTitles.length} ${t.tapesFound}`}
            </p>
          </header>

          {status === 'error' ? (
            <div className="empty-state">
              <span className="empty-tape" aria-hidden="true" />
              <h2>{t.empty}</h2>
              <p>{error}</p>
              <button type="button" onClick={() => void fetchPage(0, false)}>{t.retry}</button>
            </div>
          ) : (
            <div id="shelf" className="shelf" aria-busy={status === 'loading'}>
              {visibleTitles.map((title) => (
                <VhsTape key={title.identity.canonicalKey} title={title} accent={genre.accent} locale={locale} onInspect={setSelected} />
              ))}
              {status === 'loading' && !visibleTitles.length && Array.from({ length: 8 }, (_, index) => <span className="tape-skeleton" key={index} aria-hidden="true" />)}
            </div>
          )}

          {hasNextStand && status !== 'loading' && (
            <button className="load-more" type="button" onClick={() => void fetchPage(pages.length, true)}>{t.loadMore}</button>
          )}
          {!visibleTitles.length && status === 'ready' && <p className="search-empty">{t.empty}</p>}
        </section>
      </main>

      <footer>
        <span>Be kind, rewind.</span>
        <span>Phase 1 · accessible 2D shelf</span>
      </footer>

      {selected && (
        <TitleInspection
          title={selected}
          locale={locale}
          isInBasket={inBasket(selected)}
          basketFull={basket.length >= 3}
          onToggleBasket={() => toggleBasket(selected)}
          onClose={() => setSelected(null)}
        />
      )}
      {panel && <SidePanel kind={panel} locale={locale} basket={basket} onRemove={toggleBasket} onClose={() => setPanel(null)} />}
    </div>
  );
}
