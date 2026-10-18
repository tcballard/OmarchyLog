#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, hash } from './store.mjs';
import { loadConfig } from './config.mjs';
import { GitHub } from './github.mjs';
import { baseline, collect, sourceKey } from './collect.mjs';
import { draft } from './draft.mjs';
import { markdown, card, postsFor } from './render.mjs';
import { validateSummary } from './summary.mjs';
import { approve, publish, reconcile, XClient } from './publish.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string', default: 'omarchylog.config.json' },
  db: { type: 'string', default: '.omarchylog/state.sqlite' },
  out: { type: 'string', default: '.omarchylog/output' },
  reset: { type: 'boolean', default: false },
  'confirmed-absent': { type: 'boolean', default: false },
  'confirmed-stopped': { type: 'boolean', default: false }
} });
const [command, id, extra, last] = positionals;
const help = `OmarchyLog · Node 24+
  baseline                         Record current heads/releases without posting history
  baseline --reset                 Explicitly reset collection cursors (keeps archive)
  backfill REPO@REF SHA             Set a branch cursor to an exact SHA for a backfill
  collect                          Collect complete ranges atomically
  draft                            Build next unassigned edition and export JSON/Markdown/SVG
  show EDITION                     Export an existing edition
  request EVENT                    Export source packet for a summarizer or coding agent
  revise EDITION SUMMARIES.json     Validate one summary per entry and rebuild draft
  approve EDITION                   Approve the exact saved edition
  publish EDITION                   Publish/resume approved thread with per-part receipts
  reconcile EDITION INDEX POST_ID   Verify a remote post after uncertain delivery
  resolve-absent EDITION INDEX --confirmed-absent
                                   Reset uncertain delivery after manual account inspection
  unlock publisher --confirmed-stopped
                                   Clear a stale operation lock after stopping its process
  status                           Show archive and delivery state
Options: --config PATH --db PATH --out DIRECTORY
GitHub reads: optional GITHUB_TOKEN. X writes: X_USER_ACCESS_TOKEN, X_EXPECTED_USER_ID.`;

function exportEdition(edition) {
  const output = resolve(values.out);
  mkdirSync(output, { recursive: true });
  const base = resolve(output, edition.id);
  writeFileSync(`${base}.json`, JSON.stringify(edition, null, 2) + '\n');
  writeFileSync(`${base}.md`, markdown(edition));
  writeFileSync(`${base}.svg`, card(edition));
  console.log(JSON.stringify({ edition: edition.id, files: [`${base}.json`, `${base}.md`, `${base}.svg`] }));
}

async function main() {
  if (!command || command === 'help') return console.log(help);
  const config = loadConfig(values.config);
  const store = new Store(values.db);
  const github = new GitHub({ maxPages: config.maxPages });
  const owner = `${process.pid}:${crypto.randomUUID()}`;
  const guarded = async (operation, fn) => {
    store.lock(operation, owner);
    try { return await fn(); } finally { store.unlock(operation, owner); }
  };
  try {
    if (command === 'baseline') console.log(await guarded('collector', () => baseline(config, github, store, { reset: values.reset })));
    else if (command === 'collect') console.log({ collected: (await guarded('collector', () => collect(config, github, store))).length });
    else if (command === 'backfill') await guarded('collector', async () => {
      const source = config.sources.find(s => sourceKey(s) === id);
      if (!source || !/^[a-f0-9]{40}$/.test(extra ?? '')) throw new Error('Supply a configured source and full commit SHA');
      if (await github.resolve(source.repo, extra) !== extra) throw new Error('Could not verify backfill SHA');
      store.set('cursor', id, { ...source, sha: extra });
      console.log({ backfill: id, from: extra });
    });
    else if (command === 'draft') await guarded('editor', async () => {
      const edition = await draft(config, store);
      if (edition) exportEdition(edition); else console.log('No unassigned changes.');
    });
    else if (command === 'show') {
      const edition = store.get('edition', id);
      if (!edition) throw new Error('Unknown edition');
      exportEdition(edition);
    } else if (command === 'request') {
      const { requestFor } = await import('./summary.mjs');
      const event = store.get('event', id);
      if (!event) throw new Error('Unknown event');
      console.log(JSON.stringify(requestFor(event), null, 2));
    } else if (command === 'revise') await guarded('publisher', async () => {
      const edition = store.get('edition', id);
      if (!edition || store.list('receipt').some(r => r.editionId === id) || edition.posts.some((_, i) => store.get('receipt', `${id}:${i}`))) throw new Error('Unknown edition or delivery already started');
      const summaries = JSON.parse(readFileSync(extra, 'utf8'));
      if (!Array.isArray(summaries) || summaries.length !== edition.entries.length || new Set(summaries.map(s => s.id)).size !== summaries.length) throw new Error('Supply exactly one summary per entry');
      edition.entries = edition.entries.map(({ event }) => ({ event,
        summary: validateSummary(summaries.find(s => s.id === event.id), event) }));
      edition.posts = postsFor(edition.title, edition.entries);
      store.set('edition', id, edition);
      exportEdition(edition);
    });
    else if (command === 'approve') await guarded('publisher', async () => { approve(store, id); console.log({ approved: id }); });
    else if (command === 'publish') console.log({ lastPostId: await publish(store, id, new XClient()) });
    else if (command === 'reconcile') await reconcile(store, id, Number(extra), last, new XClient());
    else if (command === 'resolve-absent') await guarded('publisher', async () => {
      if (!values['confirmed-absent']) throw new Error('Inspect the account and confirm the post is absent with --confirmed-absent');
      const key = `${id}:${Number(extra)}`;
      const receipt = store.get('receipt', key);
      if (!['sending', 'unknown'].includes(receipt?.status)) throw new Error('Part is not uncertain');
      store.set('receipt', key, { ...receipt, status: 'rejected', resolvedAbsentAt: new Date().toISOString() });
    });
    else if (command === 'unlock') {
      if (!values['confirmed-stopped'] || !['collector', 'publisher', 'editor'].includes(id)) throw new Error('Stop the owning process, then use --confirmed-stopped with the operation name');
      store.db.prepare('DELETE FROM locks WHERE id=?').run(id);
    } else if (command === 'status') console.log(JSON.stringify({ cursors: store.list('cursor'),
      events: store.list('event').map(e => ({ id: e.id, title: e.title, channel: e.channel })),
      editions: store.list('edition').map(e => ({ id: e.id, entries: e.entries.length, approved: store.get('approval', e.id)?.hash === hash(e) })),
      receipts: store.list('receipt') }, null, 2));
    else throw new Error(help);
  } finally { store.close(); }
}
main().catch(error => { console.error(`OmarchyLog: ${error.message}`); process.exitCode = 1; });
