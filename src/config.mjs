import { readFileSync } from 'node:fs';

export function loadConfig(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  if (typeof config.title !== 'string' || !config.title || config.title.length > 80) throw new Error('Invalid title');
  if (!Array.isArray(config.sources) || !Array.isArray(config.releases)) throw new Error('Sources and releases must be arrays');
  const seen = new Set();
  for (const source of config.sources) {
    if (!repoPattern.test(source.repo) || typeof source.ref !== 'string' || !source.ref || typeof source.channel !== 'string' || !source.channel || source.channel.length > 48) throw new Error('Invalid branch source');
    const id = `${source.repo}@${source.ref}`;
    if (seen.has(id)) throw new Error('Duplicate branch source');
    seen.add(id);
  }
  if (config.releases.some(repo => !repoPattern.test(repo)) || new Set(config.releases).size !== config.releases.length) throw new Error('Invalid or duplicate release repository');
  for (const key of ['maxPages', 'maxCommits', 'maxItems']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['skipLabels', 'internalPrefixes']) {
    if (!Array.isArray(config[key]) || config[key].some(s => typeof s !== 'string' || !s)) throw new Error(`Invalid ${key}`);
  }
  if (config.summarizer !== null && (!Array.isArray(config.summarizer?.command) || !config.summarizer.command.length || config.summarizer.command.some(v => typeof v !== 'string' || !v))) throw new Error('Invalid summarizer command');
  return config;
}
