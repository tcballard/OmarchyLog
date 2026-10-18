import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, generate } from '../scripts/openai-summary.mjs';

test('summary adapter separates instructions, pins event ID and refuses incomplete output', async () => {
  const packet = { instructions: ['Evidence only'], event: { id: 'abc' }, sources: [{ text: 'untrusted text' }] };
  const body = buildRequest(packet, 'configured-model');
  assert.equal(body.store, false);
  assert.deepEqual(body.text.format.schema.properties.id.enum, ['abc']);
  assert(!body.instructions.includes('untrusted text'));
  assert.throws(() => buildRequest(packet), /OMARCHYLOG_MODEL/);
  const options = { key: 'test', model: 'configured-model', fetcher: async () => new Response(JSON.stringify({ status: 'incomplete' })) };
  await assert.rejects(generate(packet, options), /incomplete/);
  const generated = await generate(packet, { ...options, fetcher: async () => new Response(JSON.stringify({ status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text: '{"id":"abc"}' }] }
  ] })) });
  assert.deepEqual(generated, { id: 'abc' });
});
