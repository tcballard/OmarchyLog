import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { baseline, collect } from '../src/collect.mjs';
import { draft } from '../src/draft.mjs';
import { GitHub } from '../src/github.mjs';
import { sourcesFor, summarize, validateSummary, disposition } from '../src/summary.mjs';
import { postsFor, weight, card } from '../src/render.mjs';

const config = { title: 'OmarchyLog', sources: [{ repo: 'omacom/omarchy', ref: 'dev', channel: 'Development' }],
  releases: [], maxCommits: 200, maxItems: 8, skipLabels: ['skip-changelog'], internalPrefixes: ['.github/', 'tests/'], summarizer: null };
const commit = (sha = 'b') => ({ sha, title: 'Fix panel positioning', message: 'Fix panel positioning',
  url: `https://github.com/omacom/omarchy/commit/${sha}`, date: '2026-10-18T10:00:00Z',
  files: [{ path: 'shell/Panel.qml', patch: '+ anchor: icon', status: 'modified' }] });
const fake = (overrides = {}) => ({ resolve: async () => 'b', compare: async () => [{ sha: 'b' }],
  commit: async (_, sha) => commit(sha), pulls: async () => [], releases: async () => [], ...overrides });
function store() {
  const db = new Store(':memory:');
  db.set('cursor', 'omacom/omarchy@dev', { sha: 'a' });
  return db;
}
function event(overrides = {}) {
  return { id: 'event', title: 'Fix panel positioning', channel: 'Development', availability: 'branch',
    url: commit().url, date: commit().date, commits: [commit()], ...overrides };
}
function valid(e) {
  return { id: e.id, summary: 'Fix panel positioning', impact: '', category: 'Desktop',
    evidence: { summary: [{ sourceId: 'commit:b', quote: 'Fix panel positioning' }], impact: [] } };
}

test('baseline records current heads without historical events', async () => {
  const db = new Store(':memory:');
  await baseline(config, fake(), db);
  assert.equal(db.get('cursor', 'omacom/omarchy@dev').sha, 'b');
  assert.deepEqual(db.list('event'), []);
  assert.deepEqual(await collect(config, fake(), db), []);
  db.close();
});

test('complete range advances atomically and replay emits no duplicates', async () => {
  const db = store();
  const result = await collect(config, fake(), db);
  assert.equal(result.length, 1);
  assert.equal(result[0].base, 'a');
  assert.equal(result[0].head, 'b');
  assert.equal(db.get('cursor', 'omacom/omarchy@dev').sha, 'b');
  assert.deepEqual(await collect(config, fake(), db), []);
  db.close();
});

test('failure on a later source commits neither earlier events nor cursors', async () => {
  const db = store();
  db.set('cursor', 'omacom/omarchy@rc', { sha: 'a' });
  const cfg = { ...config, sources: [...config.sources, { ...config.sources[0], ref: 'rc' }] };
  await assert.rejects(collect(cfg, fake({ resolve: async (_, ref) => { if (ref === 'rc') throw Error('API down'); return 'b'; } }), db));
  assert.equal(db.get('cursor', 'omacom/omarchy@dev').sha, 'a');
  assert.equal(db.list('event').length, 0);
  db.close();
});

test('collector groups several commits belonging to one merged PR', async () => {
  const db = store();
  const pr = { number: 12, title: 'Panel fix', body: '', url: 'https://github.com/omacom/omarchy/pull/12', labels: [] };
  const result = await collect(config, fake({ compare: async () => [{ sha: 'b' }, { sha: 'c' }], pulls: async () => [pr] }), db);
  assert.equal(result.length, 1);
  assert.equal(result[0].commits.length, 2);
  db.close();
});

test('same commit promoted to a second branch remains a labelled event', async () => {
  const db = store();
  await collect(config, fake(), db);
  db.set('cursor', 'omacom/omarchy@rc', { sha: 'a' });
  const result = await collect({ ...config, sources: [{ repo: 'omacom/omarchy', ref: 'rc', channel: 'Release candidate' }] }, fake(), db);
  assert.equal(result[0].channel, 'Release candidate');
  assert.equal(db.list('event').length, 2);
  db.close();
});

test('max-commit budget failure preserves cursor', async () => {
  const db = store();
  await assert.rejects(collect({ ...config, maxCommits: 1 }, fake({ compare: async () => [{ sha: 'b' }, { sha: 'c' }] }), db), /maxCommits/);
  assert.equal(db.get('cursor', 'omacom/omarchy@dev').sha, 'a');
  db.close();
});

test('published releases and prereleases retain their distinct status', async () => {
  const db = store();
  db.set('cursor', 'omacom/omarchy@releases', { ids: [1] });
  const result = await collect({ ...config, sources: [], releases: ['omacom/omarchy'] }, fake({ releases: async () => [
    { id: 1 }, { id: 2, title: 'v4rc', prerelease: true, publishedAt: commit().date },
    { id: 3, title: 'v4', prerelease: false, publishedAt: commit().date }
  ] }), db);
  assert.deepEqual(result.map(e => e.channel), ['Prerelease published', 'Release published']);
  db.close();
});

test('GitHub follows pagination and refuses truncated or diverged ranges', async () => {
  let calls = 0;
  const github = new GitHub({ fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ status: 'ahead', total_commits: 2, commits: [{ sha: String(calls) }] }),
      { headers: calls === 1 ? { link: '<https://api.github.com/page2>; rel="next"' } : {} });
  } });
  assert.equal((await github.compare('a/b', 'a', 'b')).length, 2);
  for (const response of [{ status: 'ahead', total_commits: 2, commits: [] }, { status: 'diverged', total_commits: 0, commits: [] }]) {
    const client = new GitHub({ fetcher: async () => new Response(JSON.stringify(response)) });
    await assert.rejects(client.compare('a/b', 'a', 'b'));
  }
});

test('pagination cap, foreign origin and API errors fail visibly', async () => {
  const client = new GitHub({ maxPages: 1, fetcher: async () => new Response('[]', { headers: { link: '<https://api.github.com/next>; rel="next"' } }) });
  await assert.rejects(client.pages('/list'), /pagination limit/);
  await assert.rejects(client.get('https://evil.example/list'), /origin/);
  const failed = new GitHub({ fetcher: async () => new Response('{}', { status: 403 }) });
  await assert.rejects(failed.pages('/list'), /403/);
});

test('retryable GET failure is retried, long rate limit fails without sleeping', async () => {
  let count = 0;
  const client = new GitHub({ pause: async () => {}, fetcher: async () => ++count === 1 ? new Response('{}', { status: 503 }) : new Response('[]') });
  assert.deepEqual((await client.pages('/list')).items, []);
  assert.equal(count, 2);
  await assert.rejects(new GitHub({ fetcher: async () => new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }) }).get('/list'), /deferred/);
});

test('summaries reject invented IDs, links, release claims and forged quotes', () => {
  const e = event();
  assert.equal(validateSummary(valid(e), e).mode, 'generated');
  for (const changed of [{ id: 'invented' }, { summary: 'Available now for everyone' }, { summary: 'See https://evil.example' },
    { evidence: { summary: [{ sourceId: 'commit:b', quote: 'not actually in source' }], impact: [] } }]) {
    assert.throws(() => validateSummary({ ...valid(e), ...changed }, e));
  }
  assert.throws(() => validateSummary({ ...valid(e), impact: 'It is faster' }, e), /impact evidence/);
});

test('generated summary cache avoids repeat model calls', async () => {
  const db = store();
  let calls = 0;
  const cfg = { ...config, summarizer: { command: ['model'] } };
  const invoke = async () => { calls++; return valid(event()); };
  await summarize(event(), cfg, db, invoke);
  await summarize(event(), cfg, db, invoke);
  assert.equal(calls, 1);
  db.close();
});

test('internal-only omissions are audited; mixed product changes survive', () => {
  const e = event();
  e.commits[0].files = [{ path: '.github/workflows/ci.yml' }];
  assert.match(disposition(e, config), /internal/);
  e.commits[0].files.push({ path: 'shell/Panel.qml' });
  assert.equal(disposition(e, config), null);
});

test('draft queue preserves overflow and omitted events without duplicate editions', async () => {
  const db = store();
  for (let i = 0; i < 3; i++) db.set('event', String(i), event({ id: String(i) }));
  const first = await draft({ ...config, maxItems: 1 }, db);
  const second = await draft({ ...config, maxItems: 1 }, db);
  assert.notEqual(first.entries[0].event.id, second.entries[0].event.id);
  await draft({ ...config, maxItems: 1 }, db);
  assert.equal(await draft(config, db), null);
  db.close();
});

test('posts preserve source links, label branches and fit conservative Unicode limits', () => {
  const posts = postsFor('OmarchyLog', [{ event: event(), summary: { summary: '🚀'.repeat(300), impact: '界'.repeat(200) } }]);
  assert(posts.every(p => weight(p) <= 280));
  assert(posts[1].includes('[Development]'));
  assert(posts[1].endsWith(commit().url));
});

test('SVG escapes source text', () => {
  assert(!card({ title: '<script>', entries: [] }).includes('<script>'));
});

test('omitted-only editions audit omissions without producing an empty announcement', async () => {
  const db = store();
  db.set('event', 'internal', event({ id: 'internal', pr: { labels: ['skip-changelog'] } }));
  const edition = await draft(config, db);
  assert.equal(edition.entries.length, 0);
  assert.equal(edition.posts.length, 0);
  assert.equal(edition.omitted[0].reason, 'Upstream skip-changelog label');
  assert.equal(await draft(config, db), null);
  db.close();
});

test('SQLite archive rolls back partial writes', () => {
  const db = store();
  assert.throws(() => db.transaction(() => {
    db.set('event', 'partial', event());
    throw Error('disk/write failure');
  }));
  assert.equal(db.get('event', 'partial'), null);
  db.close();
});
