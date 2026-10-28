import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

export async function mcpSmoke(serverFile: string, output: string) {
  const client = new Client({ name: 'synod-self-test', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverFile], env: { SYNOD_MUSIC_OUTPUT_DIR: output, PATH: process.env.PATH ?? '' }, stderr: 'pipe' });
  let errors = ''; transport.stderr?.on('data', chunk => { errors += chunk.toString(); });
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw new Error(`${name}: ${JSON.stringify(response.content)}`);
    return response.structuredContent as Record<string, any>;
  };
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    if (listed.tools.length !== 17) throw new Error(`Expected 17 tools, found ${listed.tools.length}`);
    const brief = await call('create_music_brief', { text: 'a bright platformer at 140 bpm in C major', bars: 2 });
    const generated = await call('generate_theme', { brief: brief.brief, seed: 42 });
    const locked = await call('lock_part', { projectId: generated.projectId, part: 'melody' });
    const variation = await call('generate_variation', { projectId: locked.projectId, seed: 99, change: ['drums'] });
    const invalid = await client.callTool({ name: 'regenerate_part', arguments: { projectId: variation.projectId, part: 'melody' } });
    if (!invalid.isError) throw new Error('Locked melody regeneration should fail');
    const inspection = await call('inspect_project', { projectId: variation.projectId });
    const result = await call('export_package', { projectId: variation.projectId, directory: 'mcp-theme' });
    if (result.report.status !== 'passed') throw new Error('MCP export did not pass validation');
    await call('save_project', { projectId: variation.projectId, filename: 'source.json' });
    const loaded = await call('load_project', { filename: 'source.json' });
    const reloaded = await call('inspect_project', { projectId: loaded.projectId });
    if (JSON.stringify(inspection.project) !== JSON.stringify(reloaded.project)) throw new Error('MCP save/load changed project');
    const traversal = await client.callTool({ name: 'save_project', arguments: { projectId: variation.projectId, filename: '../escape.json' } });
    if (!traversal.isError) throw new Error('Path traversal should fail');
    const invalidBpm = await client.callTool({ name: 'create_music_brief', arguments: { tempo: 0 } });
    if (!invalidBpm.isError) throw new Error('Invalid BPM should fail schema validation');
    return { status: 'passed', tools: listed.tools.length, roundTrip: true, locks: true, traversalRejected: true, stderr: errors };
  } finally { await client.close(); }
}
if (process.argv[1]?.endsWith('mcp-smoke.js')) {
  const root = path.dirname(process.argv[1]);
  console.log(JSON.stringify(await mcpSmoke(path.join(root, 'server.js'), path.resolve(process.argv[2] ?? 'output/mcp-smoke'))));
}
