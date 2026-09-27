// Build-time acquisition only. No engine download occurs on an end user's PC.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = 'v0.16.1';
const archiveHash = '51bd98295ae1d61eafa671f1b2883a21818fad2b42313dd401a53eda5298fbf1';
const sbomHash = '6c40f868efbc3436036a7b7be73d03810f8df40cc60bfabc0f6aa1dfd0f7548b';
const asset = 'stremio-server_Linux_x86_64.tar.gz';
const base = `https://github.com/M0Rf30/stremio-server-go/releases/download/${version}/`;
const cache = path.join(root, '.local', 'engine-downloads', version);
const output = path.join(root, 'src-tauri', 'resources', 'streaming-engine');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function acquire(name, hash) {
  const destination = path.join(cache, name);
  let data = await readFile(destination).catch(() => null);
  if (!data || sha256(data) !== hash) {
    const response = await fetch(base + name, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Engine download failed (${response.status})`);
    data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== hash) throw new Error('Engine artifact checksum mismatch');
    await writeFile(destination, data);
  }
  return destination;
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The bundled streaming engine currently targets Linux x86_64');
}
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const archive = await acquire(asset, archiveHash);
// Extract only named regular release members, never arbitrary archive paths.
for (const member of ['stremio-server', 'LICENSE']) {
  const bytes = execFileSync('tar', ['-xOf', archive, member], { maxBuffer: 64 * 1024 * 1024 });
  await writeFile(path.join(output, member), bytes);
}
await chmod(path.join(output, 'stremio-server'), 0o755);
const sbom = await acquire(`${asset}.sbom.json`, sbomHash);
await writeFile(path.join(output, 'sbom.json'), await readFile(sbom));
await writeFile(path.join(output, 'provenance.json'), JSON.stringify({
  project: 'https://github.com/M0Rf30/stremio-server-go', version, asset,
  archiveSha256: archiveHash,
  binarySha256: sha256(await readFile(path.join(output, 'stremio-server'))),
  sbomSha256: sbomHash,
}, null, 2) + '\n');
console.log(`Prepared verified streaming engine ${version} for Linux x86_64`);
