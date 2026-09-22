import { describe, expect, it } from 'vitest';
import { toStremioPlayableStream } from '../src/media/stremioStream';
import type { StreamCandidate } from '../src/media/types';

function candidate(playbackDescriptor: StreamCandidate['playbackDescriptor']): StreamCandidate {
  return {
    stableId: 'fixture',
    addonId: 'fixture',
    sourceName: 'Fixture',
    resolution: 1080,
    sizeBytes: 1_000,
    seeders: 20,
    transportType: playbackDescriptor.kind === 'torrent' ? 'torrent' : 'http',
    displayName: 'Fixture',
    playbackDescriptor,
    parseConfidence: 'complete',
    rejectionReasons: [],
  };
}

describe('official Stremio Video stream mapping', () => {
  it('maps direct URLs without changing the private descriptor', () => {
    expect(toStremioPlayableStream(candidate({ kind: 'url', url: 'https://media.example/video?token=private' })))
      .toEqual({ url: 'https://media.example/video?token=private' });
  });

  it('maps torrent fields to the names used by Stremio Video', () => {
    expect(toStremioPlayableStream(candidate({
      kind: 'torrent',
      infoHash: 'a'.repeat(40),
      fileIndex: 4,
      announce: ['tracker:udp://tracker.example'],
    }))).toEqual({
      infoHash: 'a'.repeat(40),
      fileIdx: 4,
      announce: ['tracker:udp://tracker.example'],
    });
  });
});
