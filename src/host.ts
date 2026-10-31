// The OpenClaw side of the bridge: agents from config, turns through the channel inbound runtime, history from transcripts.
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { listAgentIds, resolveAgentConfig } from 'openclaw/plugin-sdk/agent-scope-runtime';
import type { ChannelGatewayContext } from 'openclaw/plugin-sdk/channel-contract';
import type { OpenClawConfig, PluginRuntime } from 'openclaw/plugin-sdk/channel-core';
import { toInboundMediaFactsWithMetadata } from 'openclaw/plugin-sdk/channel-inbound';
import { getAgentScopedMediaLocalRoots } from 'openclaw/plugin-sdk/media-local-roots';
import { saveMediaBuffer } from 'openclaw/plugin-sdk/media-store';
import { loadOutboundMediaFromUrl } from 'openclaw/plugin-sdk/outbound-media';
import { buildAgentSessionKey } from 'openclaw/plugin-sdk/routing';
import { getSessionEntryAsync } from 'openclaw/plugin-sdk/session-store-runtime';
import { readSessionTranscriptEvents, readVisibleSessionTranscriptMessageEntries } from 'openclaw/plugin-sdk/session-transcript-runtime';

import type {
  BridgeHost,
  HostActivity,
  HostAgent,
  HostConversation,
  HostDeleted,
  HostHistory,
  InboundAttachment,
  InboundText,
  Logger,
  OutboundFile,
  WizzleBridge,
} from '../../wizzle-nanoclaw/src/index.ts';
import { MAX_FILE_BYTES } from '../../wizzle-protocol/src/index.ts';
import { CHANNEL_ID, convForAgent, parseConv, topicConv } from './conv.ts';
import type { TopicStore } from './topics.ts';
import { afterLastReset, historyMessages, replyEntryId, type TranscriptEntry } from './transcript.ts';

const OWNER_PEER = 'owner';
const SENDER_NAME = 'Wizzle';
// The bridge sends idle after 12 seconds without a typing refresh.
const TYPING_REFRESH_MS = 4000;

type Inbound = PluginRuntime['channel']['inbound'];
type Turn = { agentId: string; tool?: string; toolStartedAt?: number };

export type HostDeps = {
  runtime: PluginRuntime;
  ctx: ChannelGatewayContext;
  topics: TopicStore;
  log: Logger;
  bridge(): WizzleBridge;
};

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function modelName(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && typeof (value as { primary?: unknown }).primary === 'string') {
    return (value as { primary: string }).primary;
  }
  return undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class OpenClawHost implements BridgeHost {
  readonly runtime = 'openclaw';
  readonly runtimeVersion: string;
  readonly hostName = os.hostname();
  private readonly deps: HostDeps;
  private readonly turns = new Map<string, Turn>();

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.runtimeVersion = deps.runtime.version;
  }

  private get cfg(): OpenClawConfig {
    return this.deps.runtime.config.current() as OpenClawConfig;
  }

  private get inboundRuntime(): Inbound {
    // The Gateway supplies the full runtime; the public context type narrows it.
    const runtime = this.deps.ctx.channelRuntime as { inbound?: Inbound } | undefined;
    if (!runtime?.inbound) throw new Error('wizzle needs the OpenClaw channel runtime; update OpenClaw');
    return runtime.inbound;
  }

  // The default conversation follows the install's DM scope; a topic always gets a session of its own.
  private sessionKey(cfg: OpenClawConfig, agentId: string, slug: string | undefined): string {
    const accountId = this.deps.ctx.accountId;
    if (slug === undefined) {
      const dmScope = cfg.session?.dmScope;
      return buildAgentSessionKey({ agentId, channel: CHANNEL_ID, accountId, peer: { kind: 'direct', id: OWNER_PEER }, ...(dmScope && { dmScope }) });
    }
    return buildAgentSessionKey({ agentId, channel: CHANNEL_ID, accountId, peer: { kind: 'direct', id: `topic-${slug}` }, dmScope: 'per-channel-peer' });
  }

  private async session(agentId: string, slug: string | undefined): Promise<{ sessionKey: string; sessionId?: string; updatedAt?: number }> {
    const sessionKey = this.sessionKey(this.cfg, agentId, slug);
    const entry = await getSessionEntryAsync({ agentId, sessionKey });
    return { sessionKey, ...(entry?.sessionId && { sessionId: entry.sessionId }), ...(entry?.updatedAt && { updatedAt: entry.updatedAt }) };
  }

  private async entries(conv: string): Promise<TranscriptEntry[]> {
    const parsed = parseConv(conv);
    if (!parsed) return [];
    const { sessionKey, sessionId } = await this.session(parsed.agentId, parsed.slug);
    if (!sessionId) return [];
    const target = { agentId: parsed.agentId, sessionKey, sessionId };
    // A reset keeps the session id and adds a reset row, so the conversation is what follows the latest one.
    const current = afterLastReset(await readSessionTranscriptEvents(target));
    const rows = (await readVisibleSessionTranscriptMessageEntries(target)).filter((row) => current === null || current.has(row.entryId));
    return rows.map((row) => ({ entryId: row.entryId, role: row.role, message: row.message, ...(row.createdAt && { createdAt: row.createdAt }) }));
  }

  private agentIds(): string[] {
    return listAgentIds(this.cfg);
  }

  private agentName(cfg: OpenClawConfig, agentId: string): string {
    return resolveAgentConfig(cfg, agentId)?.name ?? agentId;
  }

  async listAgents(): Promise<HostAgent[]> {
    const cfg = this.cfg;
    const running = new Set([...this.turns.values()].map((turn) => turn.agentId));
    const fallbackModel = modelName(cfg.agents?.defaults?.model);
    return Promise.all(
      listAgentIds(cfg).map(async (id): Promise<HostAgent> => {
        const model = modelName(resolveAgentConfig(cfg, id)?.model) ?? fallbackModel;
        const { updatedAt } = await this.session(id, undefined);
        return {
          id,
          name: this.agentName(cfg, id),
          conv: convForAgent(id),
          status: running.has(id) ? 'running' : 'idle',
          ...(model && { model }),
          ...(updatedAt && { lastAt: updatedAt }),
        };
      }),
    );
  }

  async history(conv: string, limit: number): Promise<HostHistory> {
    return historyMessages(conv, await this.entries(conv), limit);
  }

  async activity(conv: string): Promise<HostActivity> {
    const turn = this.turns.get(conv);
    if (!turn) return { running: false };
    return { running: true, ...(turn.tool && { tool: turn.tool }), ...(turn.toolStartedAt && { toolStartedAt: turn.toolStartedAt }) };
  }

  async questionRender(): Promise<undefined> {
    return undefined;
  }

  async listConversations(): Promise<HostConversation[]> {
    const cfg = this.cfg;
    const ids = listAgentIds(cfg);
    const convs: HostConversation[] = [];
    for (const id of ids) {
      const { updatedAt } = await this.session(id, undefined);
      convs.push({ conv: convForAgent(id), agentId: id, title: this.agentName(cfg, id), topic: false, ...(updatedAt && { lastAt: updatedAt }) });
    }
    for (const topic of this.deps.topics.list()) {
      if (!ids.includes(topic.agentId)) continue;
      const { updatedAt } = await this.session(topic.agentId, topic.slug);
      convs.push({
        conv: topicConv(topic.agentId, topic.slug),
        agentId: topic.agentId,
        title: topic.title,
        topic: true,
        createdAt: topic.createdAt,
        ...(updatedAt && { lastAt: updatedAt }),
      });
    }
    return convs;
  }

  async createConversation(agentId: string, title: string): Promise<HostConversation> {
    if (!this.agentIds().includes(agentId)) throw coded('unknown_agent', 'No such agent');
    const topic = this.deps.topics.add(agentId, title);
    return { conv: topicConv(agentId, topic.slug), agentId, title: topic.title, topic: true, createdAt: topic.createdAt };
  }

  async renameConversation(conv: string, title: string): Promise<HostConversation> {
    const parsed = parseConv(conv);
    if (!parsed?.slug) throw coded('read_only', 'Only a topic can be renamed');
    const topic = this.deps.topics.rename(parsed.agentId, parsed.slug, title);
    return { conv, agentId: parsed.agentId, title: topic.title, topic: true, createdAt: topic.createdAt };
  }

  // The topic's session is reset first, so a new topic with the same title starts without its context.
  async deleteConversation(conv: string): Promise<HostDeleted> {
    const parsed = parseConv(conv);
    if (!parsed?.slug) throw coded('read_only', 'Only a topic can be deleted');
    if (!this.deps.topics.get(parsed.agentId, parsed.slug)) throw coded('unknown_conv', 'No such conversation');
    if ((await this.session(parsed.agentId, parsed.slug)).sessionId) await this.reset(conv);
    this.deps.topics.remove(parsed.agentId, parsed.slug);
    return {};
  }

  // OpenClaw's own /reset: the conversation keeps its key and the next message opens a fresh session.
  async clearConversation(conv: string): Promise<HostDeleted> {
    const parsed = parseConv(conv);
    if (!parsed) throw coded('unknown_conv', 'No such conversation');
    if ((await this.session(parsed.agentId, parsed.slug)).sessionId) await this.reset(conv);
    return {};
  }

  private async reset(conv: string): Promise<void> {
    await this.turn(conv, `wizzle-reset-${randomUUID()}`, '/reset', [], true);
  }

  inbound(conv: string, message: InboundText): void {
    void this.turn(conv, message.msgId, message.text, message.attachments ?? [], false).catch((err: unknown) => {
      this.deps.log.error('wizzle: could not hand the message to OpenClaw', { conv, err: errorText(err) });
      this.deps.bridge().notify(conv, `The message could not be delivered to the agent: ${errorText(err)}`);
    });
  }

  // A quiet turn (a reset) delivers nothing to wizzle and shows no typing.
  private async turn(conv: string, msgId: string, text: string, attachments: InboundAttachment[], quiet: boolean): Promise<void> {
    const parsed = parseConv(conv);
    if (!parsed) throw coded('unknown_conv', 'No such conversation');
    const { agentId, slug } = parsed;
    const cfg = this.cfg;
    const inbound = this.inboundRuntime;
    const accountId = this.deps.ctx.accountId;
    const sessionKey = this.sessionKey(cfg, agentId, slug);
    const media = await this.saveAttachments(attachments);
    const label = slug ? (this.deps.topics.get(agentId, slug)?.title ?? slug) : SENDER_NAME;
    const ctxPayload = inbound.buildContext({
      channel: CHANNEL_ID,
      accountId,
      messageId: msgId,
      messageIdFull: msgId,
      timestamp: Date.now(),
      from: conv,
      sender: { id: OWNER_PEER, name: SENDER_NAME },
      conversation: { kind: 'direct', id: conv, label },
      route: { agentId, accountId, routeSessionKey: sessionKey, dispatchSessionKey: sessionKey },
      reply: { to: conv, originatingTo: conv },
      message: { body: text, bodyForAgent: text, rawBody: text, commandBody: text },
      ...(media.length > 0 && { media }),
      channelIngress: 'unsupported',
      access: { commands: { authorized: true } },
    });
    const turn: Turn = { agentId };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!quiet) {
      this.turns.set(conv, turn);
      timer = setInterval(() => this.typing(conv), TYPING_REFRESH_MS);
      timer.unref?.();
      this.typing(conv);
    }
    try {
      await inbound.dispatch({
        cfg,
        channel: CHANNEL_ID,
        accountId,
        route: { agentId, sessionKey },
        ctxPayload,
        delivery: {
          deliver: async (payload, info) => {
            if (quiet || payload.isReasoning || payload.isCommentary) return;
            const urls = [...new Set([payload.mediaUrl, ...(payload.mediaUrls ?? [])].filter((url): url is string => Boolean(url)))];
            await this.deliverReply(conv, agentId, msgId, payload.text ?? '', urls, info?.assistantMessageIndex, cfg);
          },
          onError: (err) => this.deps.log.warn('wizzle: a reply could not be delivered', { conv, err: errorText(err) }),
        },
        replyOptions: {
          allowToolLifecycleWhenProgressHidden: true,
          onToolStart: (payload) => {
            if (quiet || (payload.phase && payload.phase !== 'start') || !payload.name) return;
            turn.tool = payload.name;
            turn.toolStartedAt = Date.now();
            this.typing(conv);
          },
        },
        record: { onRecordError: (err) => this.deps.log.warn('wizzle: OpenClaw could not record the session', { conv, err: errorText(err) }) },
      });
    } finally {
      clearInterval(timer);
      if (this.turns.get(conv) === turn) this.turns.delete(conv);
    }
  }

  private typing(conv: string): void {
    void this.deps.bridge().typing(conv).catch((err: unknown) => {
      this.deps.log.warn('wizzle: typing update failed', { conv, err: errorText(err) });
    });
  }

  private async deliverReply(conv: string, agentId: string, msgId: string, text: string, urls: string[], assistantIndex: number | undefined, cfg: OpenClawConfig): Promise<void> {
    const files = await this.loadFiles(conv, cfg, agentId, urls);
    if (text.trim().length === 0 && files.length === 0) return;
    // The reply's transcript row is written before delivery, so its id is the one history hands back.
    const entries = await this.entries(conv).catch(() => []);
    const id = replyEntryId(entries, msgId, assistantIndex);
    await this.deps.bridge().deliver(conv, { kind: 'chat', content: { text }, files, ...(id !== undefined && { id }) });
  }

  // Agent-initiated sends (the message tool, automation announcements) that did not start from a wizzle message.
  async send(to: string, text: string, urls: string[], cfg: OpenClawConfig): Promise<string> {
    const parsed = parseConv(to);
    if (!parsed) throw new Error(`wizzle: ${to} is not a wizzle conversation`);
    const files = await this.loadFiles(to, cfg, parsed.agentId, urls);
    return (await this.deps.bridge().deliver(to, { kind: 'chat', content: { text }, files })) ?? randomUUID();
  }

  private async loadFiles(conv: string, cfg: OpenClawConfig, agentId: string, urls: string[]): Promise<OutboundFile[]> {
    const files: OutboundFile[] = [];
    for (const url of urls) {
      try {
        const media = await loadOutboundMediaFromUrl(url, { maxBytes: MAX_FILE_BYTES, mediaLocalRoots: getAgentScopedMediaLocalRoots(cfg, agentId), optimizeImages: false });
        files.push({ filename: media.fileName ?? path.basename(url), data: new Uint8Array(media.buffer) });
      } catch (err) {
        this.deps.log.warn('wizzle: an attachment could not be loaded', { conv, url, err: errorText(err) });
        this.deps.bridge().notify(conv, `Attachment ${path.basename(url)} could not be sent: ${errorText(err)}`);
      }
    }
    return files;
  }

  private async saveAttachments(attachments: InboundAttachment[]) {
    const saved: Array<{ path: string; contentType?: string }> = [];
    for (const attachment of attachments) {
      const file = await saveMediaBuffer(Buffer.from(attachment.data, 'base64'), attachment.mimeType, 'inbound', MAX_FILE_BYTES, attachment.name);
      saved.push({ path: file.path, ...(file.contentType && { contentType: file.contentType }) });
    }
    return saved.length > 0 ? toInboundMediaFactsWithMetadata(saved) : [];
  }
}
