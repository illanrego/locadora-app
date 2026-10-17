import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependency = path.join(root, 'node_modules/@stremio/stremio-video/src/withStreamingServer/withStreamingServer.js');
const original = 'return isFormatSupported && areStreamsSupported && !hasEmbeddedSubtitles && supportedAudioTracks.length < 2;';
const patched = 'return isFormatSupported && areStreamsSupported && (options.nativePlayer === true || (!hasEmbeddedSubtitles && supportedAudioTracks.length < 2));';

export async function patchNativeVideoPlayability(file = dependency) {
  const source = await readFile(file, 'utf8');
  if (source.includes(patched)) return false;
  if (!source.includes(original)) throw new Error('Stremio Video playability predicate changed; review the native patch');
  await writeFile(file, source.replace(original, patched));
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = await patchNativeVideoPlayability();
  process.stdout.write(`Stremio Video native playability patch ${changed ? 'applied' : 'already present'}\n`);
}
