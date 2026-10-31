// OpenClaw plugin entry: the wizzle channel, its CLI and the Gateway methods the CLI calls.
import { defineChannelPluginEntry, type OpenClawPluginApi } from 'openclaw/plugin-sdk/channel-core';

import { activeWizzle, runtimeStore, wizzlePlugin } from './channel.ts';
import { registerWizzleCli } from './cli.ts';
import { CHANNEL_ID } from './conv.ts';

type Respond = (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;

function refuse(respond: Respond, err: unknown, fallback: string): void {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : fallback;
  respond(false, undefined, { code, message: err instanceof Error ? err.message : String(err) });
}

function notRunning(respond: Respond): void {
  respond(false, undefined, { code: 'unavailable', message: 'The wizzle channel is not running. Check channels.wizzle in the OpenClaw config.' });
}

function registerGatewayMethods(api: OpenClawPluginApi): void {
  api.registerGatewayMethod(
    'wizzle.pair',
    async ({ params, respond }) => {
      const wizzle = activeWizzle();
      if (!wizzle) return notRunning(respond);
      try {
        respond(true, wizzle.inAccount(() => wizzle.manager.issue((params as { replace?: unknown }).replace === true)));
      } catch (err) {
        refuse(respond, err, 'pair_failed');
      }
    },
    { scope: 'operator.admin' },
  );
  api.registerGatewayMethod(
    'wizzle.status',
    async ({ respond }) => {
      const wizzle = activeWizzle();
      if (!wizzle) return notRunning(respond);
      respond(true, { state: wizzle.manager.state, relay: wizzle.relay });
    },
    { scope: 'operator.read' },
  );
  api.registerGatewayMethod(
    'wizzle.unpair',
    async ({ respond }) => {
      const wizzle = activeWizzle();
      if (!wizzle) return notRunning(respond);
      respond(true, { unpaired: wizzle.inAccount(() => wizzle.manager.unpair()) });
    },
    { scope: 'operator.admin' },
  );
}

export default defineChannelPluginEntry({
  id: CHANNEL_ID,
  name: 'Wizzle',
  description: 'Chat with your OpenClaw agents in the Wizzle app, end to end encrypted through the Wizzle relay',
  plugin: wizzlePlugin,
  setRuntime: runtimeStore.setRuntime,
  registerCliMetadata: registerWizzleCli,
  registerFull: registerGatewayMethods,
});
