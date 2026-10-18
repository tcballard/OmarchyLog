import { hash } from './store.mjs';

export const sourceKey = source => `${source.repo}@${source.ref}`;

export async function baseline(config, github, store, { reset = false } = {}) {
  const updates = [];
  for (const source of config.sources) {
    const key = sourceKey(source);
    if (!reset && store.get('cursor', key)) continue;
    updates.push([key, { ...source, sha: await github.resolve(source.repo, source.ref) }]);
  }
  for (const repo of config.releases) {
    const key = `${repo}@releases`;
    if (!reset && store.get('cursor', key)) continue;
    updates.push([key, { ids: (await github.releases(repo)).map(r => r.id) }]);
  }
  store.transaction(() => { for (const [id, cursor] of updates) store.set('cursor', id, cursor); });
  return updates.map(([key]) => key);
}

export async function collect(config, github, store) {
  const pending = [];
  const cursors = [];
  const fetched = new Map();
  for (const source of config.sources) {
    const key = sourceKey(source);
    const cursor = store.get('cursor', key);
    if (!cursor) throw new Error(`Run baseline first: ${key}`);
    const head = await github.resolve(source.repo, source.ref);
    if (head === cursor.sha) continue;
    const commits = await github.compare(source.repo, cursor.sha, head);
    if (commits.length > config.maxCommits) throw new Error(`${key} exceeds maxCommits; increase the limit to backfill explicitly`);
    const groups = new Map();
    for (const item of commits) {
      const cacheKey = `${source.repo}:${item.sha}`;
      let evidence = fetched.get(cacheKey) ?? store.get('evidence', cacheKey);
      if (!evidence) {
        const [commit, pulls] = await Promise.all([github.commit(source.repo, item.sha), github.pulls(source.repo, item.sha)]);
        evidence = { commit, pulls };
      }
      fetched.set(cacheKey, evidence);
      const exact = evidence.pulls.find(p => p.mergeSha === item.sha);
      const pr = exact ?? (evidence.pulls.length === 1 ? evidence.pulls[0] : null);
      const groupKey = pr ? `pr:${pr.number}` : `commit:${item.sha}`;
      const group = groups.get(groupKey) ?? { pr, commits: [] };
      group.commits.push(evidence.commit);
      groups.set(groupKey, group);
    }
    for (const [groupKey, group] of groups) {
      const id = hash({ key, base: cursor.sha, head, groupKey });
      pending.push({ id, repo: source.repo, ref: source.ref, channel: source.channel,
        availability: 'branch', base: cursor.sha, head, ...group,
        title: group.pr?.title ?? group.commits[0].title,
        url: group.pr?.url ?? group.commits[0].url,
        compareUrl: `https://github.com/${source.repo}/compare/${cursor.sha}...${head}`,
        date: group.commits.at(-1).date });
    }
    cursors.push([key, { ...source, sha: head }]);
  }
  for (const repo of config.releases) {
    const key = `${repo}@releases`;
    const cursor = store.get('cursor', key);
    if (!cursor) throw new Error(`Run baseline first: ${key}`);
    const releases = await github.releases(repo);
    for (const release of releases.filter(r => !cursor.ids.includes(r.id))) {
      pending.push({ id: hash({ repo, release: release.id }), repo, availability: 'release',
        channel: release.prerelease ? 'Prerelease published' : 'Release published',
        title: release.title, url: release.url, date: release.publishedAt, release, commits: [] });
    }
    cursors.push([key, { ids: [...new Set([...cursor.ids, ...releases.map(r => r.id)])] }]);
  }
  store.transaction(() => {
    for (const [key, value] of fetched) store.set('evidence', key, value);
    for (const event of pending) store.set('event', event.id, event);
    for (const [key, value] of cursors) store.set('cursor', key, value);
  });
  return pending;
}
