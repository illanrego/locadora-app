export function visibleVideoBounds(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, viewportWidth: number, viewportHeight: number, playing: boolean, fullscreen = false) {
  if (fullscreen) return { x: 0, y: 0, width: viewportWidth, height: viewportHeight, viewportWidth, viewportHeight, visible: playing && viewportWidth > 0 && viewportHeight > 0, fullscreen };
  const x = Math.max(0, Math.min(rect.left, viewportWidth));
  const y = Math.max(0, Math.min(rect.top, viewportHeight));
  const width = Math.max(0, Math.min(rect.right, viewportWidth) - x);
  const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - y);
  return { x, y, width, height, viewportWidth, viewportHeight, visible: playing && width > 0 && height > 0, fullscreen };
}
