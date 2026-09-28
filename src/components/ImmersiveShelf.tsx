import { useEffect, useRef } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { GENRES, type GenreDefinition, type Locale } from '../locadora/catalog';
import { DEFAULT_IMMERSIVE_THEME, IMMERSIVE_THEMES } from '../locadora/immersive';
import { resolveArtwork } from '../locadora/artworkCache';
import { createImmersiveShelf, type ShelfScene, type SceneTitle } from '../locadora/web-scene/immersive-shelf.mjs';

interface ImmersiveShelfProps {
  titles: DiscoveryTitle[];
  genre: GenreDefinition;
  year: number;
  locale: Locale;
  stand: number;
  paused?: boolean;
  onInspect: (title: DiscoveryTitle) => void;
  onReady: () => void;
  onFailure: () => void;
  onConfigure: (genreIndex: number, year: number) => void;
  onNavigate: (direction: number) => void;
}

export default function ImmersiveShelf({ titles, genre, year, locale, stand, paused = false, onInspect, onReady, onFailure, onConfigure, onNavigate }: ImmersiveShelfProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ShelfScene | null>(null);
  const callbacks = useRef({ onInspect, onReady, onFailure, onConfigure, onNavigate });
  callbacks.current = { onInspect, onReady, onFailure, onConfigure, onNavigate };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => { sceneRef.current?.setActive(!paused); }, [paused]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const urls: string[] = [];
    let scene: ShelfScene | null = null;
    const fail = (event?: Event) => {
      event?.preventDefault();
      if (!disposed) callbacks.current.onFailure();
    };
    host.addEventListener('webglcontextlost', fail, true);
    try {
      // Public remote artwork must cross the desktop's canvas-safe cache boundary.
      // Render the room immediately; four workers populate individual covers.
      const sceneTitles: SceneTitle[] = titles.slice(0, 40).map((title) => ({
        ...title, id: title.identity.canonicalKey, type: title.identity.type, posterUrl: '',
      }));
      scene = createImmersiveShelf({
        container: host, titles: sceneTitles, genre: genre.label[locale], year,
        type: titles[0]?.identity.type ?? 'movie', stand,
        theme: IMMERSIVE_THEMES[genre.id] ?? DEFAULT_IMMERSIVE_THEME,
        onSelect: (title) => {
          const original = titles.find((item) => item.identity.canonicalKey === title.id);
          if (original) callbacks.current.onInspect(original);
        },
        onBoundary: (direction) => callbacks.current.onNavigate(direction === 'left' || direction === 'up' ? -1 : 1),
        onConfigure: (draft) => {
          const index = GENRES.findIndex((item) => item.label[locale] === draft.genre);
          if (index >= 0) callbacks.current.onConfigure(index, draft.year);
        },
        plaqueOptions: {
          genres: GENRES.map((item) => item.label[locale]),
          genreLabel: locale === 'pt-BR' ? 'Gênero' : 'Genre', yearLabel: locale === 'pt-BR' ? 'Ano' : 'Year',
          go: locale === 'pt-BR' ? 'IR' : 'GO', allProviders: '', allYears: '',
        },
      });
      sceneRef.current = scene;
      scene.setActive(!pausedRef.current);
      callbacks.current.onReady();
      let next = 0;
      const worker = async () => {
        while (!disposed && next < sceneTitles.length) {
          const index = next++;
          const source = titles[index].posterUrl;
          if (!source) continue;
          const artwork = await resolveArtwork(source, 'poster');
          if (disposed || !artwork) continue;
          const url = URL.createObjectURL(artwork.blob);
          urls.push(url);
          scene?.setPoster(sceneTitles[index].id, url);
        }
      };
      for (let i = 0; i < 4; i++) void worker().catch(() => { /* Individual missing artwork retains its label. */ });
    } catch {
      fail();
    }
    return () => {
      disposed = true;
      host.removeEventListener('webglcontextlost', fail, true);
      scene?.dispose();
      sceneRef.current = null;
      urls.forEach((url) => URL.revokeObjectURL(url));
      host.replaceChildren();
    };
  }, [genre, locale, stand, titles, year]);

  return <>
    <div ref={hostRef} className="immersive-stage" id="immersive-shelf" />
    <div className="immersive-zoom" aria-label={locale === 'pt-BR' ? 'Zoom da estante' : 'Shelf zoom'}>
      <button type="button" aria-label={locale === 'pt-BR' ? 'Aproximar' : 'Zoom in'} onClick={() => sceneRef.current?.zoomIn()}>+</button>
      <button type="button" aria-label={locale === 'pt-BR' ? 'Afastar' : 'Zoom out'} onClick={() => sceneRef.current?.zoomOut()}>−</button>
    </div>
  </>;
}
