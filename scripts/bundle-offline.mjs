import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const destination = 'artifacts/synod-music-0.1.0';
await mkdir(destination, { recursive: true });
for (const filename of ['server.js', 'cli.js', 'engine.js', 'mcp-smoke.js', 'THIRD_PARTY_NOTICES.txt', 'build-manifest.json']) await cp(`dist/${filename}`, `${destination}/${filename}`);
for (const filename of ['LICENSE', 'README.md']) await cp(filename, `${destination}/${filename}`);
await cp('examples', `${destination}/examples`, { recursive: true });
await writeFile(`${destination}/package.json`, '{"name":"synod-music-portable","version":"0.1.0","type":"module","private":true,"engines":{"node":">=22"}}\n');
const names = ['server.js', 'cli.js', 'engine.js', 'mcp-smoke.js', 'THIRD_PARTY_NOTICES.txt', 'build-manifest.json'];
const checksums = Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await readFile(`${destination}/${name}`)).digest('hex')])));
await writeFile(`${destination}/SHA256SUMS.json`, JSON.stringify(checksums, null, 2) + '\n');
console.log(path.resolve(destination));
