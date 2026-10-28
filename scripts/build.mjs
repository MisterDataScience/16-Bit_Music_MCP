import { build } from 'esbuild';
import { mkdir, writeFile, readFile, chmod, readdir } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { z } from 'zod';

await mkdir('dist', { recursive: true });
await build({ entryPoints: { server: 'src/server.ts', cli: 'src/cli.ts', engine: 'src/engine/index.ts', 'mcp-smoke': 'test/mcp-smoke.ts' },
  bundle: true, platform: 'node', target: 'node22', format: 'esm', outdir: 'dist', sourcemap: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'eof', metafile: true,
}).then(async result => {
  const external = Object.values(result.metafile.outputs).flatMap(x => x.imports).filter(x => x.external && !isBuiltin(x.path));
  if (external.length) throw new Error(`Portable build has non-builtin imports: ${JSON.stringify(external)}`);
  await writeFile('dist/build-manifest.json', JSON.stringify({ version: 1, externalRuntimePackages: [], entryPoints: Object.keys(result.metafile.outputs) }, null, 2) + '\n');
});
for (const filename of ['dist/server.js', 'dist/cli.js']) await chmod(filename, 0o755);
// Distribution notices are generated from exactly the packages whose code is bundled.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
let notices = 'Third-party packages installed for this build. Full upstream licence texts follow where shipped.\n\n';
for (const [name, metadata] of Object.entries(lock.packages)) {
  if (!name) continue;
  notices += `${name} ${metadata.version} | ${metadata.license ?? 'See upstream licence'}\n`;
  let filenames = [];
  try { filenames = (await readdir(name)).filter(file => /^(licen[cs]e|copying)(\..*)?$/i.test(file)); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const filename of filenames) notices += (await readFile(`${name}/${filename}`, 'utf8')) + '\n\n';
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices);
const { ProjectSchema, BriefInputSchema } = await import('../dist/engine.js');
await mkdir('schema', { recursive: true });
await writeFile('schema/project-v1.schema.json', JSON.stringify(z.toJSONSchema(ProjectSchema), null, 2) + '\n');
await writeFile('schema/brief-v1.schema.json', JSON.stringify(z.toJSONSchema(BriefInputSchema), null, 2) + '\n');
