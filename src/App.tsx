import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { externalId, type ContentType, type DiscoveryTitle } from './domain/content';
import { GENRES, copy, type Locale } from './locadora/catalog';
import { loadShelf, loadTitleDetails, type ShelfPage } from './locadora/discovery';
import { SidePanel } from './components/SidePanel';
import { MediaSettings } from './components/MediaSettings';
import { TitleInspection } from './components/TitleInspection';
import { VhsTape } from './components/VhsTape';
import { WatchFlow } from './components/WatchFlow';
import { DonationPanel } from './components/DonationPanel';
import { readMemberSession, readNativeCapabilities, updateMemberCollection, type NativeCapabilities } from './platform/nativeBridge';
import { readQuickWatchEnabled, writeQuickWatchEnabled } from './media/quickWatchPreference';
import { readImmersiveEnabled, writeImmersiveEnabled } from './locadora/immersive';
import { hasLocalSavedTitle, readLocalSavedCollections, setLocalSavedTitle, writeLocalSavedCollections, type SavedCollection } from './member/localSaved';
import './styles.css';

const ImmersiveShelf = lazy(() => import('./components/ImmersiveShelf'));

type Panel = 'basket' | 'saved' | 'account' | null;

function clampYear(value: number): number {
  return Math.min(new Date().getFullYear(), Math.max(1920, Math.round(value)));
}

const YEAR_OPTIONS = Array.from({ length: new Date().getFullYear() - 1920 + 1 }, (_, index) => new Date().getFullYear() - index);

export default function App() {
  const [locale, setLocale] = useState<Locale>('pt-BR');
  const [genreIndex, setGenreIndex] = useState(0);
  const [yearDraft, setYearDraft] = useState(1999);
  const [year, setYear] = useState(1999);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [type, setType] = useState<ContentType>('movie');
  const [pages, setPages] = useState<ShelfPage[]>([]);
  const [stand, setStand] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DiscoveryTitle | null>(null);
  const [basket, setBasket] = useState<DiscoveryTitle[]>([]);
  const [saved, setSaved] = useState(readLocalSavedCollections);
  const [panel, setPanel] = useState<Panel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  const [watchTitle, setWatchTitle] = useState<DiscoveryTitle | null>(null);
  const [donationOpen, setDonationOpen] = useState(false);
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeCapabilities | null>(null);
  const [quickWatchEnabled, setQuickWatchEnabled] = useState(readQuickWatchEnabled);
  const [immersiveEnabled, setImmersiveEnabled] = useState(readImmersiveEnabled);
  const [immersiveStand, setImmersiveStand] = useState(0);
  const [immersiveFiltersOpen, setImmersiveFiltersOpen] = useState(false);
  const [immersiveReady, setImmersiveReady] = useState(false);
  const [immersiveError, setImmersiveError] = useState('');
  const shelfRequestRef = useRef(0);
  const inspectionRequestRef = useRef(0);
  const yearPickerRef = useRef<HTMLDivElement>(null);
  const t = copy[locale];
  const genre = GENRES[genreIndex];

  const fetchPage = useCallback(async (nextStand: number, signal?: AbortSignal) => {
    const request = ++shelfRequestRef.current;
    setStatus('loading');
    setError('');
    try {
      const page = await loadShelf({ genres: genre.apiGenres, year, type, stand: nextStand, locale }, signal);
      if (request !== shelfRequestRef.current) return;
      // Each API page is one physical stand. Additional pages stay separate in
      // the DOM so the store grows downward without becoming one giant rack.
      setPages((current) => nextStand === 0 ? [page] : [...current, page]);
      setStand(nextStand);
      setStatus('ready');
      return true;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (request !== shelfRequestRef.current) return;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : (locale === 'pt-BR' ? 'Não foi possível abrir a estante.' : 'Could not open the shelf.'));
    }
  }, [genre.apiGenres, locale, type, year]);

  useEffect(() => {
    const controller = new AbortController();
    setImmersiveStand(0);
    void fetchPage(0, controller.signal);
    return () => controller.abort();
  }, [fetchPage]);

  const visiblePages = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return pages.map((page) => ({
      ...page,
      titles: normalized
        ? page.titles.filter((title) => title.name.toLocaleLowerCase(locale).includes(normalized))
        : page.titles,
    }));
  }, [locale, pages, query]);
  const visibleTitles = useMemo(() => visiblePages.flatMap((page) => page.titles), [visiblePages]);

  const immersiveTitles = visiblePages[Math.min(immersiveStand, Math.max(0, visiblePages.length - 1))]?.titles ?? [];
  const navigateImmersive = (direction: number) => {
    if (status === 'loading') return;
    const next = immersiveStand + direction;
    if (next < 0) return;
    if (next < pages.length) setImmersiveStand(next);
    else if (pages.at(-1)?.hasNextStand) {
      void fetchPage(pages.length).then((loaded) => { if (loaded) setImmersiveStand(next); });
    }
  };
  const configureImmersive = (index: number, nextYear: number) => {
    setGenreIndex(index);
    setQuery('');
    setYearDraft(clampYear(nextYear));
    setYear(clampYear(nextYear));
    setImmersiveStand(0);
  };

  const hasNextStand = pages.at(-1)?.hasNextStand ?? false;
  const source = pages[0]?.source ?? 'fixture';
  const inBasket = (title: DiscoveryTitle) => basket.some((item) => item.identity.canonicalKey === title.identity.canonicalKey);
  const toggleBasket = (title: DiscoveryTitle) => {
    setBasket((current) => current.some((item) => item.identity.canonicalKey === title.identity.canonicalKey)
      ? current.filter((item) => item.identity.canonicalKey !== title.identity.canonicalKey)
      : current.length < 3 ? [...current, title] : current);
  };
  const setSavedTitle = async (title: DiscoveryTitle, collection: SavedCollection, enabled: boolean): Promise<boolean> => {
    setSaved((current) => {
      const next = setLocalSavedTitle(current, title, collection, enabled);
      writeLocalSavedCollections(next);
      return next;
    });
    try {
      const session = await readMemberSession();
      if (!session.signedIn) return false;
      const tmdbId = Number(externalId(title.identity, 'tmdb'));
      if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) return false;
      await updateMemberCollection({
        collection,
        enabled,
        tmdbId,
        contentType: title.identity.type,
        name: title.name,
        year: title.year,
      });
      return true;
    } catch {
      return false;
    }
  };
  const chooseGenre = (index: number) => {
    setGenreIndex(index);
    setQuery('');
  };
  const applyYear = () => setYear(clampYear(yearDraft));
  const inspectTitle = useCallback((title: DiscoveryTitle) => {
    const request = ++inspectionRequestRef.current;
    setSelected(title);
    void loadTitleDetails(title, locale).then((details) => {
      if (request !== inspectionRequestRef.current) return;
      setSelected((current) => current?.identity.canonicalKey === title.identity.canonicalKey ? details : current);
    }).catch(() => {
      // Inspection remains useful with the lightweight shelf record offline.
    });
  }, [locale]);
  const closeInspection = useCallback(() => {
    inspectionRequestRef.current += 1;
    setSelected(null);
  }, []);
  const toggleImmersive = () => {
    setImmersiveEnabled((enabled) => {
      const next = !enabled;
      writeImmersiveEnabled(next);
      setImmersiveReady(false);
      setImmersiveError('');
      return next;
    });
  };
  const immersiveFailed = useCallback(() => {
    setImmersiveEnabled(false);
    setImmersiveReady(false);
    writeImmersiveEnabled(false);
    setImmersiveError(locale === 'pt-BR'
      ? 'O modo imersivo não abriu; a estante 2D continua disponível.'
      : 'Immersive mode could not start; the 2D shelf remains available.');
  }, [locale]);
  const immersiveStarted = useCallback(() => setImmersiveReady(true), []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === 'pt-BR' ? "Will's Locadora — seu player" : "Will's Video Store — your player";
  }, [locale]);

  useEffect(() => {
    if (!yearPickerOpen) return;

    const selectedOption = yearPickerRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selectedOption?.focus({ preventScroll: true });
    selectedOption?.scrollIntoView?.({ block: 'nearest' });

    const closeOutside = (event: PointerEvent) => {
      if (!yearPickerRef.current?.contains(event.target as Node)) setYearPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setYearPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [yearPickerOpen]);

  useEffect(() => {
    void readNativeCapabilities().then(setNativeCapabilities).catch(() => {
      setNativeCapabilities({ mpv: { available: false, version: null } });
    });
  }, []);

  return (
    <div className={`app-shell${immersiveEnabled ? ' is-immersive' : ''}`} style={{ '--genre-accent': genre.accent } as React.CSSProperties}>
      <a className="skip-link" href={immersiveEnabled ? '#immersive-shelf' : '#shelf'}>{locale === 'pt-BR' ? 'Pular para a prateleira' : 'Skip to shelf'}</a>
      <header className="store-header">
        <div className="masthead">
          <a className="brand" href="#top" aria-label="Will's Locadora">
            <strong>WILL'S LOCADORA</strong>
            <span>{t.tagline}</span>
          </a>
          <nav className="header-actions" aria-label={locale === 'pt-BR' ? 'Ações da loja' : 'Store actions'}>
            <button type="button" onClick={() => setPanel('saved')}>{locale === 'pt-BR' ? 'Salvos' : 'Saved'}</button>
            <button type="button" onClick={() => setPanel('account')}>{t.account}</button>
            <button type="button" aria-pressed={immersiveEnabled} onClick={toggleImmersive}>
              {immersiveEnabled ? (locale === 'pt-BR' ? 'Modo 2D' : '2D mode') : (locale === 'pt-BR' ? 'Modo imersivo' : 'Immersive mode')}
            </button>
            {immersiveEnabled && <button type="button" aria-expanded={immersiveFiltersOpen} onClick={() => setImmersiveFiltersOpen((value) => !value)}>{locale === 'pt-BR' ? 'Buscar fitas' : 'Find tapes'}</button>}
            <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>{t.settings}</button>
            <button type="button" className="basket-button" onClick={() => setPanel('basket')}>
              {t.basket}<span aria-label={`${basket.length} / 3`}>{basket.length}</span>
            </button>
          </nav>
        </div>

        <div className="browse-controls" hidden={immersiveEnabled && !immersiveFiltersOpen}>
          <label>
            <span>{t.genre}</span>
            <select className="genre-picker" value={genreIndex} onChange={(event) => chooseGenre(Number(event.target.value))}>
              {GENRES.map((item, index) => <option key={item.id} value={index}>{item.label[locale]}</option>)}
            </select>
          </label>
          <form className="year-machine" onSubmit={(event) => { event.preventDefault(); applyYear(); }}>
            <span>{t.year}</span>
            <button type="button" onClick={() => setYearDraft((value) => clampYear(value - 1))} aria-label={locale === 'pt-BR' ? 'Ano anterior' : 'Previous year'}>−</button>
            <div className="year-picker" ref={yearPickerRef}>
              <button
                type="button"
                className="year-picker-trigger"
                aria-label={t.year}
                aria-haspopup="listbox"
                aria-expanded={yearPickerOpen}
                onClick={() => setYearPickerOpen((open) => !open)}
              >
                {yearDraft}
              </button>
              {yearPickerOpen && (
                <div className="year-picker-options" role="listbox" aria-label={t.year}>
                  {YEAR_OPTIONS.map((option) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={option === yearDraft}
                      key={option}
                      onClick={() => {
                        setYearDraft(option);
                        setYearPickerOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
            <button type="button" onClick={() => setMediaSettingsOpen(true)}>
              {locale === 'pt-BR' ? 'Fontes de mídia' : 'Media sources'}
            </button>
            <button
              type="button"
              aria-pressed={quickWatchEnabled}
              onClick={() => setQuickWatchEnabled((enabled) => {
                writeQuickWatchEnabled(!enabled);
                return !enabled;
              })}
            >
              {locale === 'pt-BR' ? 'Quick Watch automático' : 'Automatic Quick Watch'}
            </button>
            <p>
              <strong>Player:</strong>{' '}
              {nativeCapabilities?.mpv.available
                ? `${nativeCapabilities.mpv.version ?? 'mpv'} · ${locale === 'pt-BR' ? 'pronto' : 'ready'}`
                : t.development}
            </p>
          </section>
        )}
      </header>

      {immersiveEnabled ? <main className="immersive-room" id="top" aria-label={locale === 'pt-BR' ? 'Locadora imersiva' : 'Immersive store'}>
        {pages.length > 0 && <Suspense fallback={<p className="immersive-loading">{t.loading}</p>}>
          <ImmersiveShelf titles={immersiveTitles} genre={genre} year={year} locale={locale} stand={immersiveStand}
            paused={watchTitle !== null || selected !== null || panel !== null || mediaSettingsOpen || donationOpen}
            onInspect={inspectTitle} onReady={immersiveStarted} onFailure={immersiveFailed}
            onConfigure={configureImmersive} onNavigate={navigateImmersive} />
        </Suspense>}
        {(status === 'loading' || (!immersiveReady && status !== 'error')) && <p className="immersive-loading" role="status">{t.loading}</p>}
        {status === 'error' && <p className="immersive-error" role="alert">{error} <button type="button" onClick={() => void fetchPage(pages.length)}>{t.retry}</button></p>}
        {!immersiveTitles.length && status === 'ready' && <p className="immersive-loading" role="status">{t.empty}</p>}
        <button className="immersive-stand-button immersive-previous-stand" type="button" disabled={immersiveStand === 0 || status === 'loading'} onClick={() => navigateImmersive(-1)} aria-label={locale === 'pt-BR' ? 'Estante anterior' : 'Previous stand'}>‹</button>
        <button className="immersive-stand-button immersive-next-stand" type="button" disabled={status === 'loading' || (immersiveStand >= pages.length - 1 && !hasNextStand)} onClick={() => navigateImmersive(1)} aria-label={locale === 'pt-BR' ? 'Próxima estante' : 'Next stand'}>›</button>
      </main> : <main id="top">
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

          {immersiveError && <p className="immersive-error" role="status">{immersiveError}</p>}

          {status === 'error' && !pages.length ? (
            <div className="empty-state">
              <span className="empty-tape" aria-hidden="true" />
              <h2>{t.empty}</h2>
              <p>{error}</p>
              <button type="button" onClick={() => void fetchPage(stand)}>{t.retry}</button>
            </div>
          ) : (
            <div id="shelf" className="shelf-stack" aria-busy={status === 'loading'}>
              {visiblePages.map((page, pageIndex) => (
                <section className="shelf-stand" aria-label={`${locale === 'pt-BR' ? 'Estante' : 'Stand'} ${pageIndex + 1}`} key={pageIndex}>
                  <span className="shelf-stand-label" aria-hidden="true">
                    {locale === 'pt-BR' ? 'ESTANTE' : 'STAND'} {String(pageIndex + 1).padStart(2, '0')}
                  </span>
                  <div className="shelf">
                    {page.titles.map((title) => (
                      <VhsTape key={title.identity.canonicalKey} title={title} accent={genre.accent} locale={locale} onInspect={inspectTitle} />
                    ))}
                  </div>
                </section>
              ))}
              {status === 'loading' && !pages.length && (
                <section className="shelf-stand" aria-label={locale === 'pt-BR' ? 'Abrindo primeira estante' : 'Opening first stand'}>
                  <div className="shelf">
                    {Array.from({ length: 8 }, (_, index) => <span className="tape-skeleton" key={index} aria-hidden="true" />)}
                  </div>
                </section>
              )}
            </div>
          )}

          {status === 'error' && pages.length > 0 && (
            <p className="shelf-load-error" role="alert">
              {error} <button type="button" onClick={() => void fetchPage(stand + 1)}>{t.retry}</button>
            </p>
          )}

          {hasNextStand && status !== 'loading' && (
            <button className="load-more" type="button" onClick={() => void fetchPage(stand + 1)}>{t.loadMore}</button>
          )}
          {!visibleTitles.length && status === 'ready' && <p className="search-empty">{t.empty}</p>}
        </section>
      </main>}

      {!immersiveEnabled && <footer>
        <span>Be kind, rewind.</span>
        <button type="button" className="support-link" onClick={() => setDonationOpen(true)}>{locale === 'pt-BR' ? 'Me pague um café' : 'Buy me a coffee'}</button>
      </footer>}

      {selected && (
        <TitleInspection
          title={selected}
          locale={locale}
          isInBasket={inBasket(selected)}
          basketFull={basket.length >= 3}
          canWatch={Boolean(nativeCapabilities?.mpv.available)}
          savedForLater={hasLocalSavedTitle(saved, selected, 'watch_later')}
          favorite={hasLocalSavedTitle(saved, selected, 'favorite')}
          onToggleBasket={() => toggleBasket(selected)}
          onToggleSaved={(collection) => void setSavedTitle(selected, collection, !hasLocalSavedTitle(saved, selected, collection))}
          onWatch={() => { setWatchTitle(selected); closeInspection(); }}
          onClose={closeInspection}
        />
      )}
      {panel && <SidePanel
        kind={panel}
        locale={locale}
        basket={basket}
        saved={saved}
        onInspect={(title) => { setPanel(null); inspectTitle(title); }}
        onRemove={toggleBasket}
        onSetSaved={setSavedTitle}
        onBasketComplete={(rented) => setBasket((current) => current.filter((item) => !rented.some((title) => title.identity.canonicalKey === item.identity.canonicalKey)))}
        onOpenAccount={() => setPanel('account')}
        onClose={() => setPanel(null)}
      />}
      {mediaSettingsOpen && <MediaSettings locale={locale} onClose={() => setMediaSettingsOpen(false)} />}
      {donationOpen && <DonationPanel locale={locale} onClose={() => setDonationOpen(false)} />}
      {watchTitle && (
        <WatchFlow
          title={watchTitle}
          locale={locale}
          mpvVersion={nativeCapabilities?.mpv.version ?? null}
          quickWatchEnabled={quickWatchEnabled}
          onClose={() => setWatchTitle(null)}
        />
      )}
    </div>
  );
}
