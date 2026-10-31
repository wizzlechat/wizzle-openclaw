import type { ChatMessage } from '../../wizzle-protocol/src/index.ts';
import { CHANNEL_ID } from './conv.ts';

// One visible row of an OpenClaw session transcript, as readVisibleSessionTranscriptMessageEntries returns it.
export type TranscriptEntry = { entryId: string; role: string; message: Record<string, unknown>; createdAt?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parts(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : [];
}

export function entryText(message: Record<string, unknown>): string {
  if (typeof message.content === 'string') return message.content;
  return parts(message)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
}

// wizzle's own id for a message it sent, which OpenClaw keeps as the transport message id.
export function wizzleMessageId(message: Record<string, unknown>): string | undefined {
  const meta = isRecord(message.__openclaw) ? message.__openclaw : undefined;
  const transport = meta && isRecord(meta.transport) ? meta.transport : undefined;
  if (transport?.channel !== CHANNEL_ID || typeof transport.messageId !== 'string') return undefined;
  return transport.messageId;
}

// Text written next to a tool call is commentary, which OpenClaw does not deliver to the channel.
function isDeliveredReply(message: Record<string, unknown>): boolean {
  if (parts(message).some((part) => part.type === 'toolCall')) return false;
  const text = entryText(message).trim();
  return text.length > 0 && text !== 'NO_REPLY';
}

function entryAt(entry: TranscriptEntry): number {
  if (typeof entry.message.timestamp === 'number') return entry.message.timestamp;
  const parsed = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMessage(conv: string, entry: TranscriptEntry): ChatMessage | null {
  if (entry.role === 'user') {
    const text = entryText(entry.message);
    if (text.trim().length === 0) return null;
    return { conv, msgId: wizzleMessageId(entry.message) ?? entry.entryId, role: 'user', text, format: 'text', at: entryAt(entry) };
  }
  if (entry.role === 'assistant' && isDeliveredReply(entry.message)) {
    return { conv, msgId: entry.entryId, role: 'agent', text: entryText(entry.message), format: 'markdown', at: entryAt(entry) };
  }
  return null;
}

// Ids of the transcript rows after the latest reset row; null when the session was never reset.
export function afterLastReset(events: ReadonlyArray<Record<string, unknown>>): Set<string> | null {
  let reset = -1;
  events.forEach((event, index) => {
    if (event.type === 'reset') reset = index;
  });
  if (reset < 0) return null;
  return new Set(events.slice(reset + 1).flatMap((event) => (typeof event.id === 'string' ? [event.id] : [])));
}

export function historyMessages(conv: string, entries: readonly TranscriptEntry[], limit: number): { messages: ChatMessage[]; hasMore: boolean } {
  const all = entries.map((entry) => toMessage(conv, entry)).filter((message): message is ChatMessage => message !== null);
  return { messages: all.slice(-limit), hasMore: all.length > limit };
}

// The transcript row of a delivered reply: the index-th assistant row after the user row wizzle sent.
export function replyEntryId(entries: readonly TranscriptEntry[], inboundMsgId: string, assistantIndex: number | undefined): string | undefined {
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.role === 'user' && wizzleMessageId(entry.message) === inboundMsgId) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const replies: TranscriptEntry[] = [];
  for (const entry of entries.slice(start + 1)) {
    if (entry.role === 'user') break;
    if (entry.role === 'assistant') replies.push(entry);
  }
  if (assistantIndex !== undefined) return replies[assistantIndex - 1]?.entryId;
  return replies.filter((entry) => isDeliveredReply(entry.message)).pop()?.entryId;
}
