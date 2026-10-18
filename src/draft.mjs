import { hash } from './store.mjs';
import { summarize } from './summary.mjs';
import { postsFor } from './render.mjs';

export async function draft(config, store) {
  const assigned = new Set(store.list('edition').flatMap(e => [...e.entries.map(i => i.event.id), ...e.omitted.map(i => i.id)]));
  const events = store.list('event').filter(e => !assigned.has(e.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const entries = [];
  const omitted = [];
  for (const event of events) {
    const summary = await summarize(event, config, store);
    if (summary.mode === 'omitted') omitted.push({ id: event.id, reason: summary.reason });
    else if (entries.length < config.maxItems) entries.push({ event, summary });
    else break;
  }
  if (!entries.length && !omitted.length) return null;
  const title = `${config.title} · ${new Date().toISOString().slice(0, 10)}`;
  const posts = entries.length ? postsFor(title, entries) : [];
  const edition = { id: hash({ entries, omitted, posts }).slice(0, 20), title, createdAt: new Date().toISOString(), entries, omitted, posts };
  store.set('edition', edition.id, edition);
  return edition;
}
