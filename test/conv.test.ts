import assert from 'node:assert/strict';
import { test } from 'node:test';

import { convForAgent, freeSlug, parseConv, slugForTitle, topicConv } from '../src/conv.ts';

test('conversation ids round trip for the default conversation and topics', () => {
  assert.equal(convForAgent('main'), 'wizzle:agent:main');
  assert.equal(topicConv('main', 'trip-plans'), 'wizzle:agent:main:trip-plans');
  assert.deepEqual(parseConv('wizzle:agent:main'), { agentId: 'main' });
  assert.deepEqual(parseConv('wizzle:agent:main:trip-plans'), { agentId: 'main', slug: 'trip-plans' });
});

test('anything else is not a wizzle conversation', () => {
  for (const conv of ['wizzle:system', 'wizzle:agent:', 'wizzle:agent::x', 'wizzle:agent:main:', 'wizzle:agent:main:a:b', `wizzle:agent:${'a'.repeat(200)}`]) {
    assert.equal(parseConv(conv), undefined, conv);
  }
});

test('slugs are lowercase dashes, 40 characters at most, suffixed on a collision', () => {
  assert.equal(slugForTitle('  Trip Plans: Japan!  '), 'trip-plans-japan');
  assert.equal(slugForTitle('x'.repeat(39) + ' yz'), 'x'.repeat(39));
  assert.equal(freeSlug('Trip', new Set()), 'trip');
  assert.equal(freeSlug('Trip', new Set(['trip', 'trip-2'])), 'trip-3');
  assert.equal(freeSlug('!!!', new Set()), 'topic');
  const full = new Set(['trip', ...Array.from({ length: 8 }, (_, i) => `trip-${i + 2}`)]);
  assert.equal(freeSlug('Trip', full), null);
});
