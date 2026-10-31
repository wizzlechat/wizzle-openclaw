import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterLastReset, historyMessages, replyEntryId, type TranscriptEntry } from '../src/transcript.ts';

const CONV = 'wizzle:agent:main';

// Shapes copied from an OpenClaw 2026.10.9 transcript: a CLI turn, a wizzle turn, and a wizzle turn with a tool call.
const entries: TranscriptEntry[] = [
  { entryId: 'u-cli', role: 'user', createdAt: '2026-10-29T23:45:33.678Z', message: { role: 'user', content: 'hello probe', timestamp: 1000, __openclaw: { senderIsOwner: true } } },
  { entryId: 'a-cli', role: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi from the CLI turn' }], timestamp: 1100, __openclaw: { runId: 'r1' } } },
  {
    entryId: 'u-wz1',
    role: 'user',
    message: { role: 'user', content: 'hello from wizzle', timestamp: 2000, __openclaw: { senderId: 'owner', transport: { channel: 'wizzle', messageId: 'wz-1' } } },
  },
  { entryId: 'a-wz1', role: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'answer one' }], timestamp: 2100, __openclaw: { runId: 'r2' } } },
  {
    entryId: 'u-wz2',
    role: 'user',
    message: { role: 'user', content: 'please use a tool', timestamp: 3000, __openclaw: { transport: { channel: 'wizzle', messageId: 'wz-2' } } },
  },
  {
    entryId: 'a-wz2-call',
    role: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Checking first.' }, { type: 'toolCall', id: 'c1', name: 'read' }], timestamp: 3100 },
  },
  { entryId: 't-wz2', role: 'toolResult', message: { role: 'toolResult', content: [{ type: 'text', text: 'file contents' }], timestamp: 3200 } },
  { entryId: 'a-wz2', role: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'answer two' }], timestamp: 3300 } },
  { entryId: 'a-silent', role: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY' }], timestamp: 3400 } },
];

test('history keeps user text and delivered replies, with wizzle ids for what wizzle sent', () => {
  const { messages, hasMore } = historyMessages(CONV, entries, 50);
  assert.equal(hasMore, false);
  assert.deepEqual(
    messages.map((m) => [m.msgId, m.role, m.text, m.at]),
    [
      ['u-cli', 'user', 'hello probe', 1000],
      ['a-cli', 'agent', 'hi from the CLI turn', 1100],
      ['wz-1', 'user', 'hello from wizzle', 2000],
      ['a-wz1', 'agent', 'answer one', 2100],
      ['wz-2', 'user', 'please use a tool', 3000],
      ['a-wz2', 'agent', 'answer two', 3300],
    ],
  );
  assert.ok(messages.every((m) => m.conv === CONV));
  assert.equal(messages[1]?.format, 'markdown');
  assert.equal(messages[0]?.format, 'text');
});

test('history returns the newest page and says when there is more', () => {
  const { messages, hasMore } = historyMessages(CONV, entries, 2);
  assert.equal(hasMore, true);
  assert.deepEqual(messages.map((m) => m.msgId), ['wz-2', 'a-wz2']);
});

test('a delivered reply maps to its transcript row through the message wizzle sent', () => {
  assert.equal(replyEntryId(entries, 'wz-1', 1), 'a-wz1');
  // OpenClaw counts the tool call row, so the final reply is the second assistant row.
  assert.equal(replyEntryId(entries, 'wz-2', 2), 'a-wz2');
  assert.equal(replyEntryId(entries, 'wz-2', undefined), 'a-wz2');
  assert.equal(replyEntryId(entries, 'wz-1', 2), undefined);
  assert.equal(replyEntryId(entries, 'nope', 1), undefined);
});

test('after a reset only the rows past the latest reset row count', () => {
  // Raw event shapes from an OpenClaw 2026.10.9 transcript that /reset ran on twice.
  const events = [
    { type: 'session', id: 's1' },
    { type: 'message', id: 'u-old' },
    { type: 'message', id: 'a-old' },
    { type: 'reset', id: 'r1', reason: 'reset' },
    { type: 'message', id: 'u-mid' },
    { type: 'reset', id: 'r2', reason: 'reset' },
    { type: 'message', id: 'u-new' },
    { type: 'custom', id: 'c1', customType: 'model-snapshot' },
    { type: 'message', id: 'a-new' },
  ];
  assert.deepEqual([...(afterLastReset(events) ?? [])], ['u-new', 'c1', 'a-new']);
  assert.equal(afterLastReset(events.filter((e) => e.type !== 'reset')), null);
  assert.deepEqual([...(afterLastReset([...events, { type: 'reset', id: 'r3' }]) ?? [])], []);
});
