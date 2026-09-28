import type { DiscoveryTitle } from '../../domain/content';
import type { ImmersiveTheme } from '../immersive';
export interface SceneTitle extends Omit<DiscoveryTitle, 'posterUrl'> {
  id: string;
  type: 'movie' | 'series';
  posterUrl: string;
}
export interface ShelfScene {
  setActive(active: boolean): void;
  setPoster(id: string, url: string): void;
  zoomIn(): void;
  zoomOut(): void;
  dispose(): void;
}
export function createImmersiveShelf(options: {
  container: HTMLElement;
  titles: SceneTitle[];
  genre: string;
  year: number;
  type: string;
  stand: number;
  theme: ImmersiveTheme;
  onSelect(title: SceneTitle): void;
  onBoundary(direction: string): void;
  onConfigure(draft: { genre: string; year: number }): void;
  plaqueOptions: {
    genres: string[]; genreLabel: string; yearLabel: string;
    go: string; allProviders: string; allYears: string;
  };
}): ShelfScene;
