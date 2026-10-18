import { execFileSync } from 'node:child_process';
const options = process.argv.slice(2);
for (const command of ['collect', 'draft']) {
  execFileSync(process.execPath, ['src/cli.mjs', command, ...options], { stdio: 'inherit' });
}
