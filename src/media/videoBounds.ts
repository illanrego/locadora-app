export function visibleVideoBounds(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, viewportWidth: number, viewportHeight: number, playing: boolean) {
  const x = Math.max(0, Math.min(rect.left, viewportWidth));
  const y = Math.max(0, Math.min(rect.top, viewportHeight));
  const width = Math.max(0, Math.min(rect.right, viewportWidth) - x);
  const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - y);
  return { x, y, width, height, viewportWidth, viewportHeight, visible: playing && width > 0 && height > 0 };
}
