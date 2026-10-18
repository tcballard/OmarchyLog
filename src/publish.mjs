import { hash } from './store.mjs';
import { weight } from './render.mjs';

export function approve(store, editionId) {
  const edition = store.get('edition', editionId);
  if (!edition || !edition.posts.length) throw new Error('No publishable edition');
  store.set('approval', editionId, { hash: hash(edition), approvedAt: new Date().toISOString() });
}

export class XClient {
  constructor({ token = process.env.X_USER_ACCESS_TOKEN, expectedUserId = process.env.X_EXPECTED_USER_ID, fetcher = fetch } = {}) {
    if (!token || !expectedUserId) throw new Error('Set X_USER_ACCESS_TOKEN and X_EXPECTED_USER_ID');
    Object.assign(this, { token, expectedUserId, fetcher });
  }
  async request(path, options = {}) {
    return this.fetcher(`https://api.x.com/2${path}`, { ...options,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000), redirect: 'error' });
  }
  async verify() {
    const response = await this.request('/users/me');
    if (!response.ok) throw new Error(`X account verification failed: HTTP ${response.status}`);
    const data = await response.json();
    if (data.data?.id !== this.expectedUserId) throw new Error('X account does not match X_EXPECTED_USER_ID');
  }
  async post(text, replyTo) {
    const response = await this.request('/tweets', { method: 'POST', body: JSON.stringify({ text,
      ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) }) });
    if (!response.ok) {
      const error = new Error(`X post failed: HTTP ${response.status}`);
      error.definitelyRejected = [400, 401, 403, 404, 422, 429].includes(response.status);
      throw error;
    }
    const result = await response.json();
    if (!/^\d+$/.test(result.data?.id)) throw new Error('X returned no post ID; delivery is uncertain');
    return result.data.id;
  }
  async lookup(id) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid X post ID');
    const response = await this.request(`/tweets/${id}?tweet.fields=author_id,referenced_tweets,entities`);
    if (!response.ok) throw new Error(`X reconciliation lookup failed: HTTP ${response.status}`);
    return (await response.json()).data;
  }
}

export async function publish(store, editionId, client) {
  const edition = store.get('edition', editionId);
  const approval = store.get('approval', editionId);
  if (!edition || approval?.hash !== hash(edition)) throw new Error('Approve this exact edition before publishing');
  if (edition.posts.some(p => typeof p !== 'string' || !p || weight(p) > 280)) throw new Error('Invalid thread');
  const owner = `${process.pid}:${crypto.randomUUID()}`;
  store.lock('publisher', owner);
  try {
    await client.verify();
    let replyTo;
    for (let index = 0; index < edition.posts.length; index++) {
      const key = `${editionId}:${index}`;
      const receipt = store.get('receipt', key);
      if (receipt?.status === 'published') { replyTo = receipt.postId; continue; }
      if (['sending', 'unknown'].includes(receipt?.status)) throw new Error(`Part ${index} has uncertain delivery; reconcile it before retrying`);
      store.set('receipt', key, { status: 'sending', index, text: edition.posts[index], replyTo, attemptedAt: new Date().toISOString() });
      let postId;
      try { postId = await client.post(edition.posts[index], replyTo); }
      catch (error) {
        store.set('receipt', key, { ...store.get('receipt', key), status: error.definitelyRejected ? 'rejected' : 'unknown' });
        throw error;
      }
      store.set('receipt', key, { ...store.get('receipt', key), status: 'published', postId });
      replyTo = postId;
    }
    return replyTo;
  } finally { store.unlock('publisher', owner); }
}

export async function reconcile(store, editionId, index, postId, client) {
  const owner = `${process.pid}:${crypto.randomUUID()}`;
  store.lock('publisher', owner);
  try {
    const key = `${editionId}:${index}`;
    const receipt = store.get('receipt', key);
    if (!['unknown', 'sending'].includes(receipt?.status)) throw new Error('Part does not need reconciliation');
    await client.verify();
    const remote = await client.lookup(postId);
    let text = remote?.text ?? '';
    for (const url of remote?.entities?.urls ?? []) text = text.replace(url.url, url.expanded_url);
    const parent = remote?.referenced_tweets?.find(t => t.type === 'replied_to')?.id;
    if (remote?.author_id !== client.expectedUserId || text !== receipt.text || parent !== receipt.replyTo) {
      throw new Error('Remote post does not match this part, account and reply chain');
    }
    store.set('receipt', key, { ...receipt, status: 'published', postId, reconciledAt: new Date().toISOString() });
  } finally { store.unlock('publisher', owner); }
}
