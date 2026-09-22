import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { externalId, type ContentType, type DiscoveryTitle } from './domain/content';
import { GENRES, copy, type Locale } from './locadora/catalog';
import { loadShelf, type ShelfPage } from './locadora/discovery';
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
  const [saved, setSaved] = useState(readLocalSavedCollections);
  const [panel, setPanel] = useState<Panel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  const [watchTitle, setWatchTitle] = useState<DiscoveryTitle | null>(null);
  const [donationOpen, setDonationOpen] = useState(false);
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeCapabilities | null>(null);
  const [quickWatchEnabled, setQuickWatchEnabled] = useState(readQuickWatchEnabled);
  const [immersiveEnabled, setImmersiveEnabled] = useState(readImmersiveEnabled);
  const [immersiveReady, setImmersiveReady] = useState(false);
  const [immersiveError, setImmersiveError] = useState('');
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
            <button type="button" aria-pressed={immersiveEnabled} onClick={toggleImmersive}>
              {locale === 'pt-BR' ? 'Modo imersivo' : 'Immersive mode'}
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

          {immersiveError && <p className="immersive-error" role="status">{immersiveError}</p>}

          {immersiveEnabled && status === 'ready' && (
            <Suspense fallback={<p className="immersive-loading">{locale === 'pt-BR' ? 'Acendendo as luzes…' : 'Turning on the lights…'}</p>}>
              <ImmersiveShelf
                titles={visibleTitles}
                genre={genre}
                year={year}
                locale={locale}
                paused={watchTitle !== null}
                onInspect={setSelected}
                onReady={immersiveStarted}
                onFailure={immersiveFailed}
              />
            </Suspense>
          )}

          {status === 'error' ? (
            <div className="empty-state">
              <span className="empty-tape" aria-hidden="true" />
              <h2>{t.empty}</h2>
              <p>{error}</p>
              <button type="button" onClick={() => void fetchPage(0, false)}>{t.retry}</button>
            </div>
          ) : (
            <div id="shelf" className="shelf" aria-busy={status === 'loading'} hidden={immersiveEnabled && immersiveReady}>
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
        <button type="button" className="support-link" onClick={() => setDonationOpen(true)}>{locale === 'pt-BR' ? 'Me pague um café' : 'Buy me a coffee'}</button>
      </footer>

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
          onWatch={() => { setWatchTitle(selected); setSelected(null); }}
          onClose={() => setSelected(null)}
        />
      )}
      {panel && <SidePanel
        kind={panel}
        locale={locale}
        basket={basket}
        saved={saved}
        onRemove={toggleBasket}
        onSetSaved={setSavedTitle}
        onBasketComplete={() => setBasket([])}
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
