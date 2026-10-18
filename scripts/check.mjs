import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
function check(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) check(path);
    else if (path.endsWith('.mjs')) {
      execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (statSync(path).size > 20000) throw new Error(`${path} exceeds the 5,000 estimated token limit`);
    }
  }
}
check('src');
check('test');
check('scripts');
console.log('Syntax and file-size checks passed.');
