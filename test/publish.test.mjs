import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { approve, publish, reconcile, XClient } from '../src/publish.mjs';

function setup() {
  const store = new Store(':memory:');
  store.set('edition', 'edition', { id: 'edition', posts: ['First', 'Second', 'Third'] });
  approve(store, 'edition');
  return store;
}
const client = overrides => ({ verify: async () => {}, post: async () => '123', ...overrides });

test('unapproved or modified editions cannot publish', async () => {
  const store = setup();
  store.set('edition', 'edition', { id: 'edition', posts: ['Changed'] });
  await assert.rejects(publish(store, 'edition', client()), /Approve/);
  store.close();
});

test('per-part receipts resume a rejected reply without repeating the root', async () => {
  const store = setup();
  const seen = [];
  await assert.rejects(publish(store, 'edition', client({ post: async (text, replyTo) => {
    seen.push({ text, replyTo });
    if (text === 'Second') { const error = Error('403'); error.definitelyRejected = true; throw error; }
    return '100';
  } })));
  assert.equal(store.get('receipt', 'edition:0').status, 'published');
  await publish(store, 'edition', client({ post: async (text, replyTo) => { seen.push({ text, replyTo }); return text === 'Second' ? '200' : '300'; } }));
  assert.deepEqual(seen.map(s => s.text), ['First', 'Second', 'Second', 'Third']);
  assert.equal(seen[2].replyTo, '100');
  assert.equal(seen[3].replyTo, '200');
  const again = await publish(store, 'edition', client({ post: async () => { throw Error('must not post'); } }));
  assert.equal(again, '300');
  store.close();
});

test('timeout and crash-window sends block retries until reconciled', async () => {
  const store = setup();
  let attempts = 0;
  await assert.rejects(publish(store, 'edition', client({ post: async () => { attempts++; throw Error('timeout'); } })));
  await assert.rejects(publish(store, 'edition', client()), /uncertain/);
  assert.equal(attempts, 1);
  store.set('receipt', 'edition:0', { ...store.get('receipt', 'edition:0'), status: 'sending' });
  await assert.rejects(publish(store, 'edition', client()), /uncertain/);
  store.close();
});

test('account mismatch is rejected before any send', async () => {
  const store = setup();
  await assert.rejects(publish(store, 'edition', client({ verify: async () => { throw Error('wrong account'); } })), /account/);
  assert.deepEqual(store.list('receipt'), []);
  store.close();
});

test('SQLite lock prevents concurrent publishers', async () => {
  const store = setup();
  store.lock('publisher', 'other');
  await assert.rejects(publish(store, 'edition', client()), /locked/);
  assert.deepEqual(store.list('receipt'), []);
  store.close();
});

test('reconcile verifies account, text and reply chain', async () => {
  const store = setup();
  store.set('receipt', 'edition:0', { status: 'unknown', text: 'First' });
  const remote = { expectedUserId: '42', verify: async () => {}, lookup: async () => ({ author_id: '42', text: 'First' }) };
  await reconcile(store, 'edition', 0, '100', remote);
  assert.equal(store.get('receipt', 'edition:0').postId, '100');
  store.set('receipt', 'edition:1', { status: 'unknown', text: 'Second', replyTo: '100' });
  await assert.rejects(reconcile(store, 'edition', 1, '200', remote), /does not match/);
  store.close();
});

test('X adapter verifies user and never retries a POST automatically', async () => {
  let calls = 0;
  const x = new XClient({ token: 'test', expectedUserId: '42', fetcher: async () => { calls++; return new Response('{}', { status: 503 }); } });
  await assert.rejects(x.post('hello'), error => !error.definitelyRejected);
  assert.equal(calls, 1);
  const wrong = new XClient({ token: 'test', expectedUserId: '42', fetcher: async () => new Response('{"data":{"id":"99"}}') });
  await assert.rejects(wrong.verify(), /does not match/);
});
