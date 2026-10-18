import { pathToFileURL } from 'node:url';

export function buildRequest(packet, model) {
  if (!model) throw new Error('Set OMARCHYLOG_MODEL to an available model supporting structured outputs');
  const citation = { type: 'object', additionalProperties: false,
    properties: { sourceId: { type: 'string' }, quote: { type: 'string' } }, required: ['sourceId', 'quote'] };
  const schema = { type: 'object', additionalProperties: false,
    properties: { id: { type: 'string', enum: [packet.event.id] }, summary: { type: 'string' }, impact: { type: 'string' },
      category: { type: 'string', enum: ['Desktop', 'Apps', 'Agents', 'System', 'Themes', 'Other'] },
      evidence: { type: 'object', additionalProperties: false, properties: {
        summary: { type: 'array', items: citation }, impact: { type: 'array', items: citation }
      }, required: ['summary', 'impact'] } }, required: ['id', 'summary', 'impact', 'category', 'evidence'] };
  return { model, store: false, instructions: packet.instructions.join('\n'),
    input: JSON.stringify({ event: packet.event, sources: packet.sources }),
    text: { format: { type: 'json_schema', name: 'omarchylog_summary', strict: true, schema } }, max_output_tokens: 4000 };
}

export async function generate(packet, { key = process.env.OPENAI_API_KEY, model = process.env.OMARCHYLOG_MODEL, fetcher = fetch } = {}) {
  if (!key) throw new Error('Set OPENAI_API_KEY');
  const response = await fetcher('https://api.openai.com/v1/responses', { method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest(packet, model)), signal: AbortSignal.timeout(110000), redirect: 'error' });
  if (!response.ok) throw new Error(`Summary API failed: HTTP ${response.status}`);
  const result = await response.json();
  if (result.status !== 'completed') throw new Error('Summary response incomplete');
  const text = (result.output ?? []).flatMap(item => item.type === 'message' ? item.content ?? [] : [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('');
  return JSON.parse(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 500000) throw new Error('Input exceeds context budget');
    }
    console.log(JSON.stringify(await generate(JSON.parse(input))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
