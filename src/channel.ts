// The wizzle channel: one account that owns the relay connection, the pairing and the bridge.
import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import path from 'node:path';

import type { ChannelGatewayContext } from 'openclaw/plugin-sdk/channel-contract';
import { createChatChannelPlugin, type ChannelPlugin, type OpenClawConfig, type PluginRuntime } from 'openclaw/plugin-sdk/channel-core';
import { waitUntilAbort } from 'openclaw/plugin-sdk/channel-outbound';
import { createPluginRuntimeStore } from 'openclaw/plugin-sdk/runtime-store';
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths';

import {
  BridgeStore,
  DEFAULT_RELAY_URL,
  INVITE_TTL_MS,
  PairingManager,
  WizzleBridge,
  inviteText,
  isRelayUrl,
  webSocketTransport,
  type Logger,
} from '../../wizzle-nanoclaw/src/index.ts';
import { nodeCrypto } from '../../wizzle-protocol/src/crypto-node.ts';
import { CHANNEL_ID, parseConv } from './conv.ts';
import { OpenClawHost } from './host.ts';
import { TopicStore } from './topics.ts';

export const PAIR_COMMAND = 'openclaw wizzle pair';
const ACCOUNT_ID = 'default';

export type WizzleAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  relayUrl: string | null;
  inviteTtlMs: number;
};

type WizzleSection = { enabled?: boolean; relayUrl?: string; inviteTtlMinutes?: number };

export const runtimeStore = createPluginRuntimeStore<PluginRuntime>({ pluginId: CHANNEL_ID, errorMessage: 'wizzle runtime not initialized' });

// inAccount runs work in the account's async context; a relay socket opened inside a Gateway request
// would keep that request's work admission, which OpenClaw closes when the request returns.
export type ActiveWizzle = { manager: PairingManager; host: OpenClawHost; bridge: WizzleBridge; relay: string; inAccount<R>(run: () => R): R };
let active: ActiveWizzle | null = null;

export function activeWizzle(): ActiveWizzle | null {
  return active;
}

function requireActive(): ActiveWizzle {
  if (!active) throw new Error('The wizzle channel is not running. Check channels.wizzle in the OpenClaw config.');
  return active;
}

// channels.wizzle.relayUrl wins over WIZZLE_RELAY_URL; anything but wss (or ws on this machine) disables the channel.
export function resolveWizzleAccount(cfg: OpenClawConfig, accountId?: string | null): WizzleAccount {
  const section = (cfg.channels as Record<string, WizzleSection | undefined> | undefined)?.[CHANNEL_ID];
  const relay = section?.relayUrl ?? process.env.WIZZLE_RELAY_URL ?? DEFAULT_RELAY_URL;
  const minutes = section?.inviteTtlMinutes;
  return {
    accountId: accountId ?? ACCOUNT_ID,
    enabled: section?.enabled !== false,
    configured: true,
    relayUrl: isRelayUrl(relay) ? relay : null,
    inviteTtlMs: Number.isInteger(minutes) && minutes !== undefined && minutes >= 1 && minutes <= 1440 ? minutes * 60_000 : INVITE_TTL_MS,
  };
}

function bridgeLog(ctx: ChannelGatewayContext<WizzleAccount>): Logger {
  const line = (msg: string, data?: Record<string, unknown>) => (data ? `${msg} ${JSON.stringify(data)}` : msg);
  return {
    info: (msg, data) => ctx.log?.info?.(line(msg, data)),
    warn: (msg, data) => ctx.log?.warn?.(line(msg, data)),
    error: (msg, data) => ctx.log?.error?.(line(msg, data)),
  };
}

async function startAccount(ctx: ChannelGatewayContext<WizzleAccount>): Promise<void> {
  const relay = ctx.account.relayUrl;
  if (!ctx.account.enabled) {
    await waitUntilAbort(ctx.abortSignal);
    return;
  }
  if (!relay) {
    ctx.log?.warn?.('wizzle: channels.wizzle.relayUrl must be a wss:// URL (ws:// only for a relay on this machine), channel disabled');
    await waitUntilAbort(ctx.abortSignal);
    return;
  }
  const inAccount = AsyncLocalStorage.snapshot();
  const log = bridgeLog(ctx);
  const dir = path.join(resolveStateDir(), CHANNEL_ID);
  const store = new BridgeStore(dir);
  let bridge: WizzleBridge | null = null;
  const host = new OpenClawHost({
    runtime: runtimeStore.getRuntime(),
    ctx,
    topics: new TopicStore(dir),
    log,
    bridge: () => {
      if (!bridge) throw new Error('wizzle bridge not started');
      return bridge;
    },
  });
  // OpenClaw questions and approvals are not bridged yet, so wizzle hides them.
  bridge = new WizzleBridge({ host, log, capabilities: { questions: false, approvals: false } });
  const manager = new PairingManager({
    bridge,
    store,
    crypto: nodeCrypto,
    transport: webSocketTransport,
    log,
    relay,
    name: os.hostname(),
    runtime: 'openclaw',
    pairCommand: PAIR_COMMAND,
    ttlMs: ctx.account.inviteTtlMs,
    announce: (url, expiresAt) => store.saveInvite(`${inviteText(url, expiresAt)}\n`),
  });
  manager.start();
  bridge.start({ onInbound: (conv, message) => host.inbound(conv, message), onAction: () => undefined });
  active = { manager, host, bridge, relay, inAccount };
  ctx.setStatus({ ...ctx.getStatus(), accountId: ctx.accountId, running: true, lastStartAt: Date.now() });
  log.info('wizzle: channel started', { relay, pairing: manager.state });
  try {
    await waitUntilAbort(ctx.abortSignal);
  } finally {
    if (active?.bridge === bridge) active = null;
    manager.stop();
    bridge.stop();
    ctx.setStatus({ ...ctx.getStatus(), accountId: ctx.accountId, running: false, connected: false, lastStopAt: Date.now() });
  }
}

export const wizzlePlugin: ChannelPlugin<WizzleAccount> = createChatChannelPlugin<WizzleAccount>({
  base: {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: 'Wizzle',
      selectionLabel: 'Wizzle (app)',
      docsPath: '/channels/wizzle',
      docsLabel: 'wizzle',
      blurb: 'The Wizzle app, end to end encrypted through the Wizzle relay.',
      order: 90,
    },
    capabilities: { chatTypes: ['direct'], media: true },
    reload: { configPrefixes: ['channels.wizzle'] },
    config: {
      listAccountIds: () => [ACCOUNT_ID],
      resolveAccount: (cfg, accountId) => resolveWizzleAccount(cfg, accountId),
      defaultAccountId: () => ACCOUNT_ID,
      isConfigured: (account) => account.configured,
      isEnabled: (account) => account.enabled,
    },
    messaging: {
      normalizeTarget: (raw) => (parseConv(raw.trim()) ? raw.trim() : undefined),
      targetResolver: {
        looksLikeId: (raw) => parseConv(raw.trim()) !== undefined,
        hint: '<wizzle:agent:AGENT or wizzle:agent:AGENT:TOPIC>',
      },
    },
    gateway: { startAccount },
  },
  outbound: {
    // Only the Gateway holds the relay connection, so other processes hand their sends to it.
    base: { deliveryMode: 'gateway' },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async (ctx) => ({ messageId: await requireActive().host.send(ctx.to, ctx.text, [], ctx.cfg) }),
      sendMedia: async (ctx) => ({ messageId: await requireActive().host.send(ctx.to, ctx.text ?? '', ctx.mediaUrl ? [ctx.mediaUrl] : [], ctx.cfg) }),
    },
  },
});
