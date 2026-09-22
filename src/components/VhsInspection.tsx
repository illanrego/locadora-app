import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { DiscoveryTitle } from '../domain/content';
import { externalId } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';

/**
 * 3D tape inspection, ported from the reference web inspector
 * (`locadora/public/vhs-3d.mjs`): one VHS case with painted front and back
 * faces, drag to rotate, double-click/Enter to flip, wheel or pinch to zoom.
 *
 * Every label lives on the tape, as in the reference. The DOM action row stays
 * outside this component so browsing remains usable when WebGL is unavailable.
 */

const TEX_W = 1024;
const TEX_H = 1536;
const MIN_ZOOM = 0.62;
const MAX_ZOOM = 1.45;
const ZOOM_STEP = 0.12;

interface VhsInspectionProps {
  title: DiscoveryTitle;
  locale: Locale;
  inBasket: boolean;
  onInspectClose: () => void;
}

function paintBackdrop(context: CanvasRenderingContext2D, accent: string): void {
  context.fillStyle = '#080d17';
  context.fillRect(0, 0, TEX_W, TEX_H);
  context.fillStyle = '#101827';
  context.fillRect(32, 32, TEX_W - 64, TEX_H - 64);
  context.fillStyle = '#b7392d';
  context.fillRect(32, 32, TEX_W - 64, 142);
  context.strokeStyle = '#ffd447';
  context.lineWidth = 10;
  context.strokeRect(44, 44, TEX_W - 88, TEX_H - 88);
  context.fillStyle = accent;
  context.fillRect(32, TEX_H - 40, TEX_W - 64, 8);
}

function drawBarcode(context: CanvasRenderingContext2D, seed: string, x: number, y: number, width: number, height: number): void {
  context.fillStyle = '#eadcae';
  context.fillRect(x, y, width, height);
  context.fillStyle = '#101827';
  let cursor = x + 8;
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) % 100000;
  while (cursor < x + width - 12) {
    const bar = 2 + ((hash >> (cursor % 7)) % 4);
    context.fillRect(cursor, y + 8, bar, height - 30);
    cursor += bar + 3 + (hash % 3);
  }
  context.font = '700 18px "Courier New", monospace';
  context.fillText(seed.slice(0, 18).toUpperCase(), x + 8, y + height - 8);
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = word;
      if (lines >= maxLines) {
        context.fillText(`${line}…`, x, y + lines * lineHeight);
        return;
      }
    } else {
      line = candidate;
    }
  }
  if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight);
}

function drawFront(context: CanvasRenderingContext2D, title: DiscoveryTitle, locale: Locale, image: HTMLImageElement | null): void {
  const pt = locale === 'pt-BR';
  context.fillStyle = '#171310';
  context.fillRect(0, 0, TEX_W, TEX_H);

  if (image) {
    const scale = Math.max(TEX_W / image.width, TEX_H / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (TEX_W - width) / 2, (TEX_H - height) / 2, width, height);
    context.fillStyle = 'rgba(8,13,23,.86)';
    context.fillRect(56, TEX_H - 356, TEX_W - 112, 218);
    context.fillStyle = '#ffd447';
    context.font = '900 62px Impact, "Arial Narrow Bold", sans-serif';
    wrapText(context, title.name.toUpperCase(), 92, TEX_H - 286, TEX_W - 184, 70, 2);
    context.fillStyle = '#eadcae';
    context.font = '700 30px "Courier New", monospace';
    context.fillText(
      `${title.year ?? '—'} · ${title.identity.type === 'series' ? (pt ? 'SÉRIE' : 'SERIES') : (pt ? 'FILME' : 'MOVIE')}`,
      92,
      TEX_H - 168,
    );
    return;
  }

  context.fillStyle = '#eadcae';
  context.fillRect(64, 1100, TEX_W - 128, 290);
  context.fillStyle = '#b7392d';
  context.fillRect(64, 1100, TEX_W - 128, 22);
  context.fillStyle = '#211914';
  context.font = '900 70px Impact, "Arial Narrow Bold", sans-serif';
  wrapText(context, title.name.toUpperCase(), 108, 1210, TEX_W - 216, 78, 2);
  context.fillStyle = '#66583f';
  context.font = '700 30px "Courier New", monospace';
  context.fillText(
    `${title.year ?? '—'} · ${title.identity.type === 'series' ? (pt ? 'SÉRIE' : 'SERIES') : (pt ? 'FILME' : 'MOVIE')}`,
    108,
    1350,
  );
}

function drawBack(
  context: CanvasRenderingContext2D,
  title: DiscoveryTitle,
  locale: Locale,
  accent: string,
  poster: HTMLImageElement | null,
  backdrop: HTMLImageElement | null,
): void {
  const t = copy[locale];
  const pt = locale === 'pt-BR';
  paintBackdrop(context, accent);

  context.fillStyle = '#eadcae';
  context.font = '900 24px "Arial Narrow", Arial, sans-serif';
  context.fillText("WILL'S LOCADORA · ACERVO EM VHS", 72, 92);
  context.fillText(
    `${title.identity.type === 'series' ? (pt ? 'SÉRIE PARA CASA' : 'HOME VIDEO SERIES') : (pt ? 'LONGA-METRAGEM' : 'FEATURE PRESENTATION')} · ${title.year ?? (pt ? 'ANO DESCONHECIDO' : 'UNKNOWN YEAR')}`,
    72,
    130,
  );

  drawBarcode(context, externalId(title.identity, 'tmdb') ?? title.identity.canonicalKey, 596, 68, 356, 126);

  context.fillStyle = '#ffd447';
  context.font = '900 74px Impact, "Arial Narrow Bold", sans-serif';
  wrapText(context, title.name.toUpperCase(), 72, 260, 610, 82, 2);

  context.fillStyle = '#b5aa92';
  context.font = '700 26px "Courier New", monospace';
  const meta = [
    title.genres.slice(0, 3).join(' · '),
    externalId(title.identity, 'imdb') ?? null,
  ].filter(Boolean).join('  ·  ') || (pt ? 'EDIÇÃO DE CATÁLOGO' : 'CATALOGUE EDITION');
  context.fillText(meta, 72, 372);

  const frames: Array<[HTMLImageElement | null, number, number, number, number]> = [
    [poster, 72, 405, 348, 285],
    [backdrop, 448, 405, 504, 285],
  ];
  for (const [image, x, y, width, height] of frames) {
    context.fillStyle = '#05080d';
    context.fillRect(x, y, width, height);
    if (image) {
      const scale = Math.max(width / image.width, height / image.height);
      context.save();
      context.beginPath();
      context.rect(x, y, width, height);
      context.clip();
      context.drawImage(
        image,
        x + (width - image.width * scale) / 2,
        y + (height - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      context.restore();
    }
    context.strokeStyle = '#ffd447';
    context.lineWidth = 7;
    context.strokeRect(x, y, width, height);
  }

  context.fillStyle = '#b7392d';
  context.fillRect(72, 720, TEX_W - 144, 8);
  context.fillStyle = '#ffd447';
  context.font = '900 29px "Arial Narrow", Arial, sans-serif';
  context.fillText(t.synopsis, 72, 764);
  context.fillStyle = '#eadcae';
  context.font = '25px Arial, sans-serif';
  wrapText(
    context,
    title.description || t.noSynopsis,
    72,
    806,
    TEX_W - 144,
    36,
    6,
  );

  context.fillStyle = '#b5aa92';
  context.font = '700 22px "Courier New", monospace';
  context.fillText(
    `TMDB ${externalId(title.identity, 'tmdb') ?? '—'}  ·  ${externalId(title.identity, 'imdb') ?? '—'}`,
    72,
    1140,
  );
  context.fillText(t.vhsFooter, 72, 1480);
}

const ACCENT = '#e24730';

export function VhsInspection({ title, locale, inBasket, onInspectClose }: VhsInspectionProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [flat, setFlat] = useState(false);
  const [focused, setFocused] = useState<'front' | 'back' | 'whole'>('whole');
  const focusRef = useRef<(target: 'front' | 'back' | 'whole') => void>(() => undefined);
  const zoomRef = useRef<(delta: number) => void>(() => undefined);

  const setFocusedState = useCallback((target: 'front' | 'back' | 'whole') => {
    setFocused(target);
    focusRef.current(target);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const text = copy[locale];
    const pt = locale === 'pt-BR';
    let disposed = false;
    let frame = 0;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let velocity = 0;
    let targetY = 0;
    let targetX = 0;
    let zoom = 1;
    let pointerId: number | null = null;
    let pinchDistance = 0;

    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      camera.position.set(0, 0, 11.5);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: window.devicePixelRatio <= 1.5 });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      const canvas = renderer.domElement;
      canvas.className = 'vhs-canvas';
      canvas.tabIndex = 0;
      canvas.style.touchAction = 'none';
      host.appendChild(canvas);

      scene.add(new THREE.HemisphereLight(0xffe7c5, 0x21130e, 2.1));
      const keyLight = new THREE.DirectionalLight(0xffd8ae, 4.2);
      keyLight.position.set(-4, 6, 8);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x6fc7d0, 2.4);
      rimLight.position.set(6, -2, -5);
      scene.add(rimLight);

      const group = new THREE.Group();
      scene.add(group);

      const frontCanvas = document.createElement('canvas');
      frontCanvas.width = TEX_W;
      frontCanvas.height = TEX_H;
      const frontContext = frontCanvas.getContext('2d');
      const backCanvas = document.createElement('canvas');
      backCanvas.width = TEX_W;
      backCanvas.height = TEX_H;
      const backContext = backCanvas.getContext('2d');
      if (!frontContext || !backContext) throw new Error('Canvas is unavailable');

      drawFront(frontContext, title, locale, null);
      drawBack(backContext, title, locale, ACCENT, null, null);
      const frontTexture = new THREE.CanvasTexture(frontCanvas);
      frontTexture.colorSpace = THREE.SRGBColorSpace;
      const backTexture = new THREE.CanvasTexture(backCanvas);
      backTexture.colorSpace = THREE.SRGBColorSpace;

      const shell = new THREE.Mesh(
        new THREE.BoxGeometry(4.08, 6.08, 0.46),
        new THREE.MeshStandardMaterial({ color: 0x171411, roughness: 0.55, metalness: 0.08 }),
      );
      group.add(shell);
      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(3.82, 5.82),
        new THREE.MeshStandardMaterial({ map: frontTexture, roughness: 0.6 }),
      );
      front.position.z = 0.236;
      group.add(front);
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(3.82, 5.82),
        new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.72 }),
      );
      back.position.z = -0.236;
      back.rotation.y = Math.PI;
      group.add(back);
      for (const x of [-1.97, 1.97]) {
        const ridge = new THREE.Mesh(
          new THREE.BoxGeometry(0.09, 5.92, 0.54),
          new THREE.MeshStandardMaterial({ color: 0x29231f, roughness: 0.8 }),
        );
        ridge.position.x = x;
        group.add(ridge);
      }

      // The poster is only painted onto the cover when the canvas stays clean;
      // a cross-origin image without CORS headers would taint it and fail the
      // WebGL upload.
      const paintImage = (url: string | null, draw: (image: HTMLImageElement | null) => void) => {
        if (!url) return;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          if (disposed) return;
          try {
            const probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            const probeContext = probe.getContext('2d');
            if (!probeContext) return;
            probeContext.drawImage(image, 0, 0, 1, 1);
            probeContext.getImageData(0, 0, 1, 1);
          } catch {
            return;
          }
          draw(image);
        };
        image.src = url;
      };

      paintImage(title.posterUrl, (image) => {
        drawFront(frontContext, title, locale, image);
        frontTexture.needsUpdate = true;
      });
      paintImage(title.posterUrl, (image) => {
        drawBack(backContext, title, locale, ACCENT, image, null);
        backTexture.needsUpdate = true;
      });
      paintImage(title.backdropUrl, (image) => {
        drawBack(backContext, title, locale, ACCENT, null, image);
        backTexture.needsUpdate = true;
      });

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(280, Math.min(620, window.innerHeight * 0.6));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.z = (width / height < 0.7 ? 13.5 : 11.5) / zoom;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      const render = () => {
        if (disposed) return;
        group.rotation.y += (targetY - group.rotation.y) * 0.12;
        group.rotation.x += (targetX - group.rotation.x) * 0.12;
        renderer.render(scene, camera);
        frame = window.requestAnimationFrame(render);
      };
      render();

      const focusTarget = (target: 'front' | 'back' | 'whole') => {
        if (target === 'front') {
          targetY = 0;
          zoom = 1;
        } else if (target === 'back') {
          targetY = Math.PI;
          zoom = 1;
        } else {
          targetY = 0;
          targetX = 0;
          zoom = 0.86;
        }
        resize();
        canvas.setAttribute(
          'aria-label',
          `${title.name} VHS ${target === 'whole' ? (pt ? 'caixa completa' : 'whole case') : target === 'front' ? (pt ? 'capa' : 'front cover') : (pt ? 'contracapa' : 'back cover')} · ${text.inspectLabel}`,
        );
      };
      focusRef.current = focusTarget;
      zoomRef.current = (delta: number) => {
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
        resize();
      };
      canvas.setAttribute('aria-label', `${title.name} VHS · ${text.inspectLabel}`);

      const onPointerDown = (event: PointerEvent) => {
        if (pointerId !== null) return;
        pointerId = event.pointerId;
        dragging = true;
        moved = 0;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.classList.add('is-dragging');
        canvas.setPointerCapture(event.pointerId);
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!dragging || event.pointerId !== pointerId) return;
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        velocity = dx * 0.012;
        targetY += velocity;
        targetX = Math.min(0.72, Math.max(-0.72, targetX + dy * 0.008));
      };
      const onPointerUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        dragging = false;
        pointerId = null;
        canvas.classList.remove('is-dragging');
        if (moved >= 8) {
          targetY += velocity * 2.5;
          return;
        }
        // A tap on the case flips it; closing stays on the dialog's own button.
        onDoubleClick();
      };
      const onDoubleClick = () => {
        targetY += Math.PI;
        focusTarget(targetY % (2 * Math.PI) === 0 ? 'front' : 'back');
      };
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        zoomRef.current(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') targetY -= 0.22;
        else if (event.key === 'ArrowRight') targetY += 0.22;
        else if (event.key === 'ArrowUp') targetX = Math.max(-0.72, targetX - 0.16);
        else if (event.key === 'ArrowDown') targetX = Math.min(0.72, targetX + 0.16);
        else if (event.key === 'Enter' || event.key === ' ') onDoubleClick();
        else if (event.key === '+' || event.key === '=') zoomRef.current(ZOOM_STEP);
        else if (event.key === '-') zoomRef.current(-ZOOM_STEP);
        else return;
        event.preventDefault();
      };
      const onTouchMove = (event: TouchEvent) => {
        if (event.touches.length !== 2) return;
        const [a, b] = [event.touches[0], event.touches[1]];
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchDistance) zoomRef.current(((distance - pinchDistance) / pinchDistance) * 0.75);
        pinchDistance = distance;
      };
      const onTouchEnd = () => {
        pinchDistance = 0;
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('dblclick', onDoubleClick);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('keydown', onKeyDown);
      canvas.addEventListener('touchmove', onTouchMove, { passive: true });
      canvas.addEventListener('touchend', onTouchEnd);
      canvas.focus({ preventScroll: true });
      focusTarget('whole');

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('dblclick', onDoubleClick);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        frontTexture.dispose();
        backTexture.dispose();
        renderer.dispose();
        canvas.remove();
      };
    } catch {
      setFlat(true);
      return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
      };
    }
  }, [locale, onInspectClose, title]);

  const pt = locale === 'pt-BR';
  const t = copy[locale];

  return (
    <div className="vhs-stage">
      <div className="vhs-focus-controls" role="group" aria-label={pt ? 'Foco da fita' : 'Tape focus'}>
        <button type="button" onClick={() => zoomRef.current(-ZOOM_STEP)} aria-label={pt ? 'Menos zoom' : 'Zoom out'}>−</button>
        <button type="button" aria-pressed={focused === 'front'} onClick={() => setFocusedState('front')}>{pt ? 'Capa' : 'Front'}</button>
        <button type="button" aria-pressed={focused === 'whole'} onClick={() => setFocusedState('whole')}>{pt ? 'Caixa' : 'Case'}</button>
        <button type="button" aria-pressed={focused === 'back'} onClick={() => setFocusedState('back')}>{pt ? 'Contracapa' : 'Back'}</button>
        <button type="button" onClick={() => zoomRef.current(ZOOM_STEP)} aria-label={pt ? 'Mais zoom' : 'Zoom in'}>+</button>
      </div>
      <div ref={hostRef} className="vhs-stage-host">
        {flat && (
          <div className="vhs-stage-flat">
            {title.posterUrl
              ? <img src={title.posterUrl} alt="" loading="lazy" />
              : <span>{title.name.split(/\s+/).slice(0, 3).map((part) => part[0]).join('')}</span>}
            <p>{title.description || t.noSynopsis}</p>
          </div>
        )}
      </div>
      <p className="vhs-caption">
        {pt ? 'Arraste para girar · clique para virar a fita · roda para o zoom' : 'Drag to rotate · click to flip the tape · wheel to zoom'}
      </p>
    </div>
  );
}
