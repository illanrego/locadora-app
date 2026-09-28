import type { Plugin } from 'vite';

export function preserveOverlayBackgrounds(source: string): string {
  const marker = 'function setBackground(visible) {';
  if (!source.includes(marker)) throw new Error('Stremio ShellVideo background contract changed');
  return source.replace(marker, `${marker}
        // Locadora paints native video ABOVE the WebView, not behind it.
        if (options.shellTransport && options.shellTransport.capabilities && options.shellTransport.capabilities.nativeVideoOverlay) return;`);
}

export function shellOverlayShim(): Plugin {
  return {
    name: 'locadora:shell-overlay-background', enforce: 'pre',
    transform(source, id) {
      if (!/[\\/]@stremio[\\/]stremio-video[\\/]src[\\/]ShellVideo[\\/]ShellVideo\.js$/.test(id)) return null;
      return { code: preserveOverlayBackgrounds(source), map: { mappings: '' } };
    },
  };
}
