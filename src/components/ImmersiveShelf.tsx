import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { DiscoveryTitle } from '../domain/content';
import type { GenreDefinition, Locale } from '../locadora/catalog';
import { DEFAULT_IMMERSIVE_THEME, IMMERSIVE_THEMES } from '../locadora/immersive';

const COLUMNS = 10;
const ROWS = 4;
const MAX_TAPES = COLUMNS * ROWS;

interface ImmersiveShelfProps {
  titles: DiscoveryTitle[];
  genre: GenreDefinition;
  year: number;
  locale: Locale;
  /** Suspends the render loop, e.g. while the player owns the GPU. */
  paused?: boolean;
  onInspect: (title: DiscoveryTitle) => void;
  onReady: () => void;
  onFailure: () => void;
}

function labelTexture(title: DiscoveryTitle, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas text is unavailable');
  context.fillStyle = '#efe1bc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = accent;
  context.fillRect(0, 0, 28, canvas.height);
  context.fillStyle = '#18120e';
  context.font = '900 38px Arial Narrow, Arial, sans-serif';
  context.textBaseline = 'middle';
  const name = title.name.length > 27 ? `${title.name.slice(0, 26)}…` : title.name;
  context.fillText(name.toUpperCase(), 46, 49, 430);
  context.font = '700 24px Courier New, monospace';
  context.fillText(String(title.year ?? '—'), 46, 91);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function signTexture(genre: GenreDefinition, year: number, locale: Locale, theme: typeof DEFAULT_IMMERSIVE_THEME): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 240;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas text is unavailable');
  context.fillStyle = '#e7d8b1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = theme.trim;
  context.lineWidth = 18;
  context.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
  context.fillStyle = theme.sign;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '900 68px Impact, Arial Narrow, sans-serif';
  context.fillText(genre.label[locale].toUpperCase(), 512, 83, 900);
  context.font = '900 72px Courier New, monospace';
  context.fillText(String(year), 512, 170);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function ImmersiveShelf({ titles, genre, year, locale, paused = false, onInspect, onReady, onFailure }: ImmersiveShelfProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const resumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) resumeRef.current?.();
  }, [paused]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const textures: THREE.Texture[] = [];
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const tapes: THREE.Mesh[] = [];
    let selectedIndex = 0;

    try {
      const theme = IMMERSIVE_THEMES[genre.id] ?? DEFAULT_IMMERSIVE_THEME;
      const renderer = new THREE.WebGLRenderer({ antialias: !window.matchMedia('(max-width: 760px)').matches });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.domElement.className = 'immersive-canvas';
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', locale === 'pt-BR'
        ? `${genre.label[locale]}, prateleira imersiva. Use as setas e Enter para inspecionar.`
        : `${genre.label[locale]} immersive shelf. Use arrow keys and Enter to inspect.`);
      host.append(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x06090f);
      scene.fog = new THREE.Fog(0x06090f, 15, 28);
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
      camera.position.set(0, 0.55, 18.2);

      scene.add(new THREE.HemisphereLight(0xffefc2, 0x17150f, 2.1));
      const keyLight = new THREE.SpotLight(theme.lamp, 75, 30, Math.PI / 4, 0.45, 1.3);
      keyLight.position.set(-4, 8, 8);
      keyLight.castShadow = true;
      scene.add(keyLight);
      const amber = new THREE.PointLight(0xc99a2e, 18, 18);
      amber.position.set(5, 2, 5);
      scene.add(amber);

      const trackedGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
        geometries.push(geometry);
        return geometry;
      };
      const trackedMaterial = <T extends THREE.Material>(material: T): T => {
        materials.push(material);
        return material;
      };
      const wood = trackedMaterial(new THREE.MeshStandardMaterial({ color: 0x111011, roughness: 0.68, metalness: 0.08 }));
      const trim = trackedMaterial(new THREE.MeshStandardMaterial({ color: theme.trim, roughness: 0.72 }));
      const backing = new THREE.Mesh(
        trackedGeometry(new THREE.BoxGeometry(12, 9.2, 0.35)),
        trackedMaterial(new THREE.MeshStandardMaterial({ color: theme.backing, roughness: 0.78 })),
      );
      backing.position.z = -0.45;
      scene.add(backing);

      for (const x of [-6.05, 6.05]) {
        const post = new THREE.Mesh(trackedGeometry(new THREE.BoxGeometry(0.34, 9.85, 0.72)), wood);
        post.position.set(x, -0.12, -0.02);
        scene.add(post);
      }
      for (const y of [-4.25, -2.2, -0.15, 1.9, 3.95]) {
        const board = new THREE.Mesh(trackedGeometry(new THREE.BoxGeometry(12.4, 0.3, 1.05)), wood);
        board.position.set(0, y, 0);
        scene.add(board);
        const lip = new THREE.Mesh(trackedGeometry(new THREE.BoxGeometry(12.42, 0.09, 1.08)), trim);
        lip.position.set(0, y + 0.18, 0.02);
        scene.add(lip);
      }

      const plaqueMap = signTexture(genre, year, locale, theme);
      textures.push(plaqueMap);
      const plaque = new THREE.Mesh(
        trackedGeometry(new THREE.PlaneGeometry(7.4, 1.74)),
        trackedMaterial(new THREE.MeshBasicMaterial({ map: plaqueMap })),
      );
      plaque.position.set(0, 5.55, -0.12);
      scene.add(plaque);

      titles.slice(0, MAX_TAPES).forEach((title, index) => {
        const row = Math.floor(index / COLUMNS);
        const column = index % COLUMNS;
        const texture = labelTexture(title, genre.accent);
        textures.push(texture);
        const side = trackedMaterial(new THREE.MeshStandardMaterial({ color: index % 2 ? 0x24201c : 0x171513, roughness: 0.8 }));
        const label = trackedMaterial(new THREE.MeshBasicMaterial({ map: texture }));
        const materialsForTape = [side, side, side, side, label, side];
        const tape = new THREE.Mesh(trackedGeometry(new THREE.BoxGeometry(1.02, 1.62, 0.42)), materialsForTape);
        tape.position.set(-5.18 + column * 1.15, 3.03 - row * 2.05, 0.16);
        tape.userData.title = title;
        tape.userData.baseY = tape.position.y;
        scene.add(tape);
        tapes.push(tape);
      });

      const updateSelection = () => {
        tapes.forEach((tape, index) => {
          const selected = index === selectedIndex;
          tape.position.z = selected ? 0.72 : 0.16;
          tape.position.y = Number(tape.userData.baseY) + (selected ? 0.08 : 0);
          tape.scale.setScalar(selected ? 1.08 : 1);
        });
      };
      updateSelection();

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const inspectSelected = () => {
        const title = tapes[selectedIndex]?.userData.title as DiscoveryTitle | undefined;
        if (title) onInspect(title);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (!tapes.length) return;
        const row = Math.floor(selectedIndex / COLUMNS);
        const column = selectedIndex % COLUMNS;
        if (event.key === 'ArrowLeft') selectedIndex = Math.max(0, selectedIndex - 1);
        else if (event.key === 'ArrowRight') selectedIndex = Math.min(tapes.length - 1, selectedIndex + 1);
        else if (event.key === 'ArrowUp') selectedIndex = Math.max(0, (row - 1) * COLUMNS + column);
        else if (event.key === 'ArrowDown') selectedIndex = Math.min(tapes.length - 1, (row + 1) * COLUMNS + column);
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inspectSelected();
          return;
        } else return;
        event.preventDefault();
        updateSelection();
      };
      const onPointerDown = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(tapes, false)[0];
        if (!hit) return;
        selectedIndex = tapes.indexOf(hit.object as THREE.Mesh);
        updateSelection();
        inspectSelected();
      };
      renderer.domElement.addEventListener('keydown', onKeyDown);
      renderer.domElement.addEventListener('pointerdown', onPointerDown);

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(360, Math.min(760, window.innerHeight * 0.72));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.z = width < 760 ? 22.8 : 18.2;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      const render = () => {
        if (disposed) return;
        renderer.render(scene, camera);
        // Suspended while the player is open: this loop otherwise keeps the
        // iGPU busy at 60 fps and competes with video presentation.
        frame = pausedRef.current ? 0 : window.requestAnimationFrame(render);
      };
      resumeRef.current = () => {
        if (!disposed && !frame) render();
      };
      render();
      onReady();

      return () => {
        disposed = true;
        resumeRef.current = null;
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        renderer.domElement.removeEventListener('keydown', onKeyDown);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        textures.forEach((texture) => texture.dispose());
        materials.forEach((material) => material.dispose());
        geometries.forEach((geometry) => geometry.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch {
      onFailure();
      return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
      };
    }
  }, [genre, locale, onFailure, onInspect, onReady, titles, year]);

  return <div ref={hostRef} className="immersive-shelf" />;
}
