import type { Plugin } from 'vite';

export function preserveOverlayBackgrounds(source: string): string {
  const marker = 'function setBackground(visible) {';
  if (!source.includes(marker)) throw new Error('Stremio ShellVideo background contract changed');
  return source.replace(marker, `${marker}
        // React owns scoped transparency and restores it when playback closes.
        if (options.shellTransport && options.shellTransport.capabilities && options.shellTransport.capabilities.appOwnsVideoBackground) return;`);
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
