export function weight(text) {
  return Array.from(text.replace(/https:\/\/[^\s]+/g, 'x'.repeat(23)).normalize('NFC'))
    .reduce((total, char) => total + (char.codePointAt(0) <= 0x10ff ? 1 : 2), 0);
}
export function fit(text, budget) {
  let result = '';
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    if (weight(result + char + '…') > budget) return result.trimEnd() + '…';
    result += char;
  }
  return result;
}
function safeText(text) { return text.replace(/https?:\/\/\S+|@[\w]+/g, '').replace(/[\r\n]+/g, ' ').trim(); }
export function postsFor(title, entries) {
  const posts = [fit(`${title}: ${entries.length} ${entries.length === 1 ? 'change' : 'changes'}.\nBranch observations and published releases are labelled separately. Sources in each reply.`, 280)];
  for (const { event, summary } of entries) {
    const label = `[${event.channel}]`;
    const suffix = `\n${event.url}`;
    const content = fit(safeText(summary.summary), 280 - weight(label + '\n' + suffix));
    posts.push(`${label}\n${content}${suffix}`);
    if (summary.impact) posts.push(`${fit(safeText(summary.impact), 250)}\n${event.url}`);
  }
  if (posts.some(p => weight(p) > 280)) throw new Error('Thread exceeds the conservative 280-character budget');
  return posts;
}
export function markdown(edition) {
  const lines = [`# ${edition.title}`, '', `Edition: ${edition.id}`, '', 'Status: draft; editorial review required.', ''];
  for (const { event, summary } of edition.entries) {
    lines.push(`## ${event.channel}: ${summary.summary.replace(/[\r\n]/g, ' ')}`, '',
      summary.impact || 'Source headline retained; user impact has not been inferred.', '',
      `Source: ${event.url}`, '', `Evidence mode: ${summary.mode}`, '');
    if (event.compareUrl) lines.push(`Exact range: ${event.compareUrl}`, '');
  }
  lines.push('## X thread', '');
  edition.posts.forEach((post, i) => lines.push(`### ${i + 1}`, '', post, ''));
  lines.push('## Omission audit', '');
  for (const item of edition.omitted) lines.push(`- ${item.id}: ${item.reason}`);
  return lines.join('\n') + '\n';
}
export function card(edition) {
  const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const first = edition.entries[0];
  const lines = (first?.summary.summary ?? 'No changes').match(/.{1,44}(?:\s|$)|.{1,44}/g)?.slice(0, 4) ?? [];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#1a1b26"/><path d="M64 100H1136" stroke="#414868"/><g font-family="monospace"><text x="64" y="72" font-size="26" fill="#7aa2f7">${escape(edition.title)}</text><text x="64" y="165" font-size="24" fill="#9ece6a">${escape(first?.event.channel ?? '')}</text>${lines.map((line, i) => `<text x="64" y="${250 + i * 62}" font-size="42" fill="#c0caf5">${escape(line.trim())}</text>`).join('')}<text x="64" y="565" font-size="22" fill="#a9b1d6">${edition.entries.length} changes · independent source-linked log</text></g></svg>`;
}
