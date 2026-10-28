import { spawnSync } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or later is required');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = args => {
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) throw new Error(`Installation step failed: npm ${args.join(' ')}. ${result.error ?? ''}`);
};
run(['ci', '--cache', '.npm-cache', '--ignore-scripts', '--no-audit', '--no-fund', ...(process.argv.includes('--offline') ? ['--offline'] : [])]);
run(['run', 'build']);
run(['test']);
run(['run', 'self-test']);
run(['run', 'bundle:offline']);
if (process.platform === 'linux' && spawnSync(process.env.CC ?? 'cc', ['--version'], { stdio: 'ignore' }).status === 0) run(['run', 'verify:offline']);
else console.log('Installed and self-tested. Strict kernel-level offline verification requires Linux with a C compiler; see the CI workflow.');
