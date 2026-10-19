import { describe, expect, it } from 'vitest';
import {
  MAX_TAPES,
  MAX_TAPE_BYTES,
  MAX_TORRENT_BYTES,
  emptyTapeManifest,
  encodedManifestBytes,
  normalizeManifest,
  normalizeTape,
  removeTape,
  totalBytes,
  touchTape,
  upsertTape,
  type TapeManifest,
  type TapeRecord,
} from '../src/rentals/tapeManifest';

function hash(index: number): string {
  return index.toString(16).padStart(40, '0');
}

function tape(overrides: Partial<TapeRecord> = {}): TapeRecord {
  return {
    rentalId: 'rental-1',
    contentId: 'movie:1',
    title: 'Synthetic fixture',
    infoHash: hash(1),
    fileIdx: 3,
    fileName: 'fixture.mkv',
    sizeBytes: 1_610_612_736,
    descriptor: { sources: [`dht:${hash(1)}`], magnet: `magnet:?xt=urn:btih:${hash(1)}` },
    torrentBytesB64: null,
    state: 'ready',
    addedAt: '2026-10-19T12:00:00Z',
    completedAt: '2026-10-19T13:00:00Z',
    lastPlayedAt: null,
    ...overrides,
  };
}

function manifest(...tapes: TapeRecord[]): TapeManifest {
  return { version: 1, tapes };
}

describe('tape manifest normalisation', () => {
  it('keeps a valid manifest field for field', () => {
    const valid = manifest(tape(), tape({ infoHash: hash(2), rentalId: 'rental-2', state: 'queued', completedAt: null }));
    expect(normalizeManifest(valid)).toEqual(valid);
    expect(normalizeManifest(normalizeManifest(valid))).toEqual(valid);
  });

  it('rejects a bad infohash and drops that tape whole, keeping the good ones', () => {
    const bad = tape({ infoHash: hash(10).toUpperCase(), rentalId: 'rental-bad' });
    const kept = tape({ infoHash: hash(2) });
    const normalized = normalizeManifest({ version: 1, tapes: [bad, kept] });
    expect(normalized.tapes.map((entry) => entry.infoHash)).toEqual([hash(2)]);
    expect(JSON.stringify(normalized)).not.toContain('rental-bad');
  });

  it('rejects every infohash shape the native validator rejects', () => {
    for (const infoHash of ['A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), '', `${'a'.repeat(39)}-`]) {
      expect(normalizeTape(tape({ infoHash }))).toBeNull();
    }
  });

  it('refuses unknown fields instead of carrying them into the store', () => {
    expect(normalizeTape({ ...tape(), playbackUrl: 'http://example.invalid/movie.mkv' })).toBeNull();
    expect(normalizeManifest({ version: 1, tapes: [], extra: true })).toEqual(emptyTapeManifest());
  });

  it('reads a corrupt document or an unknown version as the empty manifest', () => {
    expect(normalizeManifest(null)).toEqual(emptyTapeManifest());
    expect(normalizeManifest('{not-json')).toEqual(emptyTapeManifest());
    expect(normalizeManifest([tape()])).toEqual(emptyTapeManifest());
    expect(normalizeManifest({ version: 2, tapes: [tape()] })).toEqual(emptyTapeManifest());
    expect(normalizeManifest({ version: 1, tapes: 'nope' })).toEqual(emptyTapeManifest());
  });

  it('truncates a collection the native writer would refuse', () => {
    const oversized = Array.from({ length: MAX_TAPES + 2 }, (_, index) => tape({ infoHash: hash(index + 1) }));
    expect(normalizeManifest({ version: 1, tapes: oversized }).tapes).toHaveLength(MAX_TAPES);
  });

  it('bounds bounded text by utf-8 bytes and refuses control characters', () => {
    expect(normalizeTape(tape({ title: 'é'.repeat(300) }))).toBeNull();
    expect(normalizeTape(tape({ title: 'é'.repeat(256) }))).not.toBeNull();
    expect(normalizeTape(tape({ title: 'Line\nbreak' }))).toBeNull();
    expect(normalizeTape(tape({ title: '' }))).toBeNull();
  });

  it('requires a magnet descriptor and bounds its sources', () => {
    expect(normalizeTape(tape({ descriptor: { sources: [], magnet: 'http://example.invalid' } }))).toBeNull();
    expect(normalizeTape(tape({ descriptor: { sources: [], magnet: '' } }))).toBeNull();
    const tooMany = Array.from({ length: 65 }, (_, index) => `dht:${hash(index)}`);
    expect(normalizeTape(tape({ descriptor: { sources: tooMany, magnet: `magnet:?xt=urn:btih:${hash(1)}` } }))).toBeNull();
    expect(normalizeTape(tape({ descriptor: { sources: [], magnet: `magnet:?xt=urn:btih:${hash(1)}` } }))).not.toBeNull();
  });

  it('closes the state set', () => {
    expect(normalizeTape(tape({ state: 'seeding' }))).not.toBeNull();
    expect(normalizeTape(tape({ state: 'paused' as TapeRecord['state'] }))).toBeNull();
  });

  it('bounds the file index and the size exactly as the native side does', () => {
    for (const fileIdx of [-1, 1.5, 10_000]) expect(normalizeTape(tape({ fileIdx }))).toBeNull();
    expect(normalizeTape(tape({ fileIdx: 9_999 }))).not.toBeNull();

    for (const sizeBytes of [0, -1, 1.5, MAX_TAPE_BYTES + 1]) {
      expect(normalizeTape(tape({ sizeBytes }))).toBeNull();
    }
    expect(normalizeTape(tape({ sizeBytes: MAX_TAPE_BYTES }))).not.toBeNull();
  });

  it('accepts only a decodable, bounded, non-empty torrent payload', () => {
    expect(normalizeTape(tape({ torrentBytesB64: 'AAECAw==' }))?.torrentBytesB64).toBe('AAECAw==');
    expect(normalizeTape(tape({ torrentBytesB64: null }))).not.toBeNull();
    for (const torrentBytesB64 of ['', 'not base64!', 'AAAA=', 'AAECAw']) {
      expect(normalizeTape(tape({ torrentBytesB64 }))).toBeNull();
    }
    const oversize = 'A'.repeat(Math.ceil(MAX_TORRENT_BYTES / 3) * 4 + 4);
    expect(normalizeTape(tape({ torrentBytesB64: oversize }))).toBeNull();
  });
});

describe('tape manifest edits', () => {
  it('appends a new tape and replaces an existing one in place', () => {
    const base = upsertTape(emptyTapeManifest(), tape({ infoHash: hash(1) }));
    expect(base).not.toBeNull();
    const second = upsertTape(base!, tape({ infoHash: hash(2) }));
    expect(second?.tapes.map((entry) => entry.infoHash)).toEqual([hash(1), hash(2)]);

    const replaced = upsertTape(second!, tape({ infoHash: hash(1), state: 'seeding' }));
    expect(replaced?.tapes).toHaveLength(2);
    expect(replaced?.tapes[0]).toMatchObject({ infoHash: hash(1), state: 'seeding' });
    expect(replaced?.tapes[1].infoHash).toBe(hash(2));
  });

  it('refuses an eleventh tape and any malformed tape', () => {
    let current: TapeManifest = emptyTapeManifest();
    for (let index = 1; index <= MAX_TAPES; index += 1) {
      const next = upsertTape(current, tape({ infoHash: hash(index) }));
      expect(next).not.toBeNull();
      current = next!;
    }
    expect(upsertTape(current, tape({ infoHash: hash(11) }))).toBeNull();
    expect(upsertTape(current, tape({ infoHash: hash(1), sizeBytes: 0 }))).toBeNull();
    // Replacing a row already present never grows the collection.
    expect(upsertTape(current, tape({ infoHash: hash(1), state: 'seeding' }))?.tapes).toHaveLength(MAX_TAPES);
  });

  it('removes one tape and leaves the rest in order', () => {
    const base = manifest(tape({ infoHash: hash(1) }), tape({ infoHash: hash(2) }), tape({ infoHash: hash(3) }));
    expect(removeTape(base, hash(2)).tapes.map((entry) => entry.infoHash)).toEqual([hash(1), hash(3)]);
    expect(removeTape(base, hash(9)).tapes).toHaveLength(3);
  });

  it('touches state and timestamps of one tape only', () => {
    const base = manifest(tape({ infoHash: hash(1), completedAt: null }), tape({ infoHash: hash(2) }));
    const touched = touchTape(base, hash(1), { state: 'seeding', completedAt: '2026-10-19T14:00:00Z' });
    expect(touched?.tapes[0]).toMatchObject({ state: 'seeding', completedAt: '2026-10-19T14:00:00Z' });
    expect(touched?.tapes[1]).toEqual(base.tapes[1]);
    expect(base.tapes[0].state).toBe('ready');
    expect(touchTape(base, hash(9), { state: 'failed' })).toBeNull();
    expect(touchTape(base, hash(1), { completedAt: 'bad\nvalue' })).toBeNull();
  });

  it('sums declared bytes without losing precision and saturates at the safe ceiling', () => {
    expect(totalBytes([{ sizeBytes: 10 }, { sizeBytes: 32 }])).toBe(42);
    expect(totalBytes([{ sizeBytes: MAX_TAPE_BYTES }, { sizeBytes: MAX_TAPE_BYTES }])).toBe(MAX_TAPE_BYTES);
    expect(totalBytes([{ sizeBytes: 0 }, { sizeBytes: 10 }])).toBe(10);
    expect(totalBytes([])).toBe(0);
  });

  it('measures the encoded manifest in utf-8 bytes', () => {
    const doc = manifest(tape({ title: 'Fita nº 1' }));
    expect(encodedManifestBytes(doc)).toBe(new TextEncoder().encode(JSON.stringify(doc)).length);
  });
});
