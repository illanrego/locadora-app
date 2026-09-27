type IconName = 'back' | 'play' | 'pause' | 'replay' | 'rewind' | 'forward' | 'volume' | 'mute' | 'fullscreen' | 'tracks' | 'sources' | 'close';

/** Small, consistent line icons; labels belong to the surrounding buttons. */
export function PlayerIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    play: <path d="m8 4 12 8-12 8Z" fill="currentColor" strokeWidth="0" />,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="4" /></>,
    replay: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></>,
    rewind: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /><text x="12" y="16" textAnchor="middle" stroke="none" fill="currentColor" fontSize="8" fontFamily="sans-serif">10</text></>,
    forward: <><path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" /><text x="12" y="16" textAnchor="middle" stroke="none" fill="currentColor" fontSize="8" fontFamily="sans-serif">10</text></>,
    volume: <><path d="M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>,
    mute: <><path d="M11 4 6 8H3v8h3l5 4ZM16 9l6 6m0-6-6 6" /></>,
    fullscreen: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    tracks: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M6 10h4m4 0h4M6 15h7m3 0h2" /></>,
    sources: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M12 7h5m-5 10h5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
