import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { patchNativeVideoPlayability } from '../tools/patch-native-video-playability.mjs';

const installedFile = path.resolve('node_modules/@stremio/stremio-video/src/withStreamingServer/withStreamingServer.js');
const original = 'return isFormatSupported && areStreamsSupported && !hasEmbeddedSubtitles && supportedAudioTracks.length < 2;';

describe('native Stremio Video playability patch', () => {
  it('keeps browser limits while allowing libmpv to handle embedded subtitles and multiple audio tracks', async () => {
    const source = await readFile(installedFile, 'utf8');
    const functionSource = source.match(/function canPlayProbe\(probe, options\) \{[\s\S]*?\n    \}/)?.[0];
    expect(functionSource).toBeDefined();
    const canPlayProbe = runInNewContext(`(${functionSource})`);
    const probe = {
      format: { name: 'matroska,webm' },
      streams: [
        { track: 'video', codec: 'hevc' },
        { track: 'audio', codec: 'aac', channels: 6 },
        { track: 'audio', codec: 'ac3', channels: 6 },
        { track: 'subtitle', codec: 'ass' },
      ],
    };
    const options = {
      formats: ['matroska,webm'], videoCodecs: ['hevc'],
      audioCodecs: ['aac', 'ac3'], maxAudioChannels: 8,
    };
    expect(canPlayProbe(probe, options)).toBe(false);
    expect(canPlayProbe(probe, { ...options, nativePlayer: true })).toBe(true);
  });

  it('applies once and detects a changed upstream predicate', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'locadora-video-patch-'));
    const fixture = path.join(directory, 'withStreamingServer.js');
    try {
      await writeFile(fixture, original);
      expect(await patchNativeVideoPlayability(fixture)).toBe(true);
      expect(await patchNativeVideoPlayability(fixture)).toBe(false);
      await writeFile(fixture, 'return changedByUpstream;');
      await expect(patchNativeVideoPlayability(fixture)).rejects.toThrow('predicate changed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
