import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { TopicStore } from '../src/topics.ts';

function store() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wizzle-topics-')), 'wizzle');
  return { dir, topics: new TopicStore(dir) };
}

test('topics are kept per agent with unique slugs in a private file', () => {
  const { dir, topics } = store();
  assert.deepEqual(topics.list(), []);
  const first = topics.add('main', 'Trip Plans', 10);
  const second = topics.add('main', 'trip plans', 20);
  const other = topics.add('work', 'Trip Plans', 30);
  assert.deepEqual([first.slug, second.slug, other.slug], ['trip-plans', 'trip-plans-2', 'trip-plans']);
  assert.equal(fs.statSync(path.join(dir, 'topics.json')).mode & 0o777, 0o600);
  assert.equal(new TopicStore(dir).list().length, 3);
});

test('a rename keeps the slug and a remove drops only that topic', () => {
  const { topics } = store();
  topics.add('main', 'Trip');
  topics.add('main', 'Work');
  assert.equal(topics.rename('main', 'trip', 'Japan').slug, 'trip');
  assert.equal(topics.get('main', 'trip')?.title, 'Japan');
  topics.remove('main', 'trip');
  assert.deepEqual(topics.list().map((t) => t.slug), ['work']);
  assert.throws(() => topics.rename('main', 'trip', 'x'), (err: Error & { code?: string }) => err.code === 'unknown_conv');
});

test('a title with every suffix taken is refused', () => {
  const { topics } = store();
  for (let i = 0; i < 9; i++) topics.add('main', 'Same');
  assert.throws(() => topics.add('main', 'Same'), (err: Error & { code?: string }) => err.code === 'name_taken');
});
