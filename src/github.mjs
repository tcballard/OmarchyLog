export class GitHub {
  constructor({ token = process.env.GITHUB_TOKEN, fetcher = fetch, maxPages = 100, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    Object.assign(this, { token, fetcher, maxPages, pause });
  }
  async get(path) {
    const url = new URL(path, 'https://api.github.com');
    if (url.origin !== 'https://api.github.com') throw new Error('Unexpected GitHub pagination origin');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.fetcher(url, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        signal: AbortSignal.timeout(30000), redirect: 'error'
      });
      if (response.ok) return { data: await response.json(), link: response.headers.get('link') };
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const wait = Number(response.headers.get('retry-after') ?? 2 ** attempt);
        if (!Number.isFinite(wait) || wait > 30) throw new Error(`GitHub retry deferred: HTTP ${response.status}`);
        await this.pause(Math.max(1, wait) * 1000);
        continue;
      }
      throw new Error(`GitHub HTTP ${response.status} at ${url.pathname}; collection has not advanced`);
    }
  }
  async pages(path, field) {
    let next = path;
    const items = [];
    let first;
    for (let page = 0; next; page++) {
      if (page >= this.maxPages) throw new Error('GitHub pagination limit reached; increase maxPages and retry');
      const { data, link } = await this.get(next);
      first ??= data;
      const batch = field ? data[field] : data;
      if (!Array.isArray(batch)) throw new Error('Unexpected GitHub list response');
      items.push(...batch);
      next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return { items, first };
  }
  async resolve(repo, ref) {
    return (await this.get(`/repos/${repo}/commits/${encodeURIComponent(ref)}`)).data.sha;
  }
  async compare(repo, base, head) {
    const { items, first } = await this.pages(`/repos/${repo}/compare/${base}...${head}?per_page=100`, 'commits');
    if (!['ahead', 'identical'].includes(first.status)) throw new Error(`Non-linear history for ${repo}: ${first.status}; rebaseline explicitly`);
    if (items.length !== first.total_commits) throw new Error('Incomplete comparison; refusing to advance cursor');
    return items;
  }
  async commit(repo, sha) {
    const { items: files, first } = await this.pages(`/repos/${repo}/commits/${sha}?per_page=100`, 'files');
    return { sha, title: first.commit.message.split('\n')[0], message: first.commit.message,
      author: first.author?.login ?? first.commit.author?.name, date: first.commit.committer.date,
      url: `https://github.com/${repo}/commit/${sha}`,
      files: files.map(f => ({ path: f.filename, previousPath: f.previous_filename, status: f.status,
        additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })) };
  }
  async pulls(repo, sha) {
    const { items } = await this.pages(`/repos/${repo}/commits/${sha}/pulls?per_page=100`);
    return items.filter(p => p.merged_at).map(p => ({ number: p.number, title: p.title, body: p.body ?? '',
      labels: (p.labels ?? []).map(l => l.name), url: `https://github.com/${repo}/pull/${p.number}`,
      mergedAt: p.merged_at, mergeSha: p.merge_commit_sha }));
  }
  async releases(repo) {
    return (await this.pages(`/repos/${repo}/releases?per_page=100`)).items.filter(r => !r.draft)
      .map(r => ({ id: r.id, tag: r.tag_name, title: r.name ?? r.tag_name, body: r.body ?? '',
        prerelease: r.prerelease, publishedAt: r.published_at, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(r.tag_name)}` }));
  }
}
