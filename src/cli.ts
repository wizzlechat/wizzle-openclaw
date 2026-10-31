// openclaw wizzle pair | status | unpair: the CLI runs in its own process and asks the Gateway, where the pairing lives.
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/channel-core';
import { callGatewayFromCli } from 'openclaw/plugin-sdk/gateway-runtime';

import { inviteText, type IssuedInvite } from '../../wizzle-nanoclaw/src/index.ts';

const TIMEOUT_MS = '20000';

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return (await callGatewayFromCli(method, { timeout: TIMEOUT_MS }, params, { progress: false })) as T;
}

// A refusal (already paired, channel not running) prints its message and exits 1.
function run(action: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await action();
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  };
}

export function registerWizzleCli(api: OpenClawPluginApi): void {
  api.registerCli(
    ({ program }) => {
      const root = program.command('wizzle').description('Pair the Wizzle app with this OpenClaw install');
      root
        .command('pair')
        .description('Show a one-time QR code that pairs the Wizzle app. --replace unpairs the current app first.')
        .option('--replace', 'unpair the current Wizzle app and show a new code')
        .action(async (opts: { replace?: boolean }) =>
          run(async () => {
            const issued = await call<IssuedInvite>('wizzle.pair', { replace: opts.replace === true });
            process.stdout.write(`${inviteText(issued.url, issued.expiresAt)}\n`);
          })(),
        );
      root
        .command('status')
        .description('Whether a Wizzle app is paired: none, inviting or paired')
        .option('--json', 'machine-readable output')
        .action(async (opts: { json?: boolean }) =>
          run(async () => {
            const status = await call<{ state: string; relay: string }>('wizzle.status');
            process.stdout.write(opts.json ? `${JSON.stringify(status)}\n` : `${status.state} (relay ${status.relay})\n`);
          })(),
        );
      root
        .command('unpair')
        .description('Remove the paired Wizzle app at the relay and forget the pairing')
        .action(async () =>
          run(async () => {
            const result = await call<{ unpaired: boolean }>('wizzle.unpair');
            process.stdout.write(result.unpaired ? 'Unpaired.\n' : 'No Wizzle app was paired.\n');
          })(),
        );
    },
    { descriptors: [{ name: 'wizzle', description: 'Pair the Wizzle app with this OpenClaw install', hasSubcommands: true }] },
  );
}
