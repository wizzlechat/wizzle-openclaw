# wizzle-openclaw

Connects one Wizzle app to an OpenClaw install through the Wizzle relay. An
OpenClaw channel plugin (id `wizzle`), built against OpenClaw 2026.10.9. It
reuses the bridge core from `../wizzle-nanoclaw/src` and the protocol from
`../wizzle-protocol/src`; only the host is OpenClaw specific.

## What it offers

Chat, history, files both ways, typing and tool activity, topics, Clear chat,
and messages the agent starts itself. Agent create, pause, restart and delete,
keys, templates, questions and approvals are off: an installed plugin cannot
call the Gateway's RPC methods (`runtime.gateway.request` is reserved for
bundled plugins), so it can only do what a channel can.

## Files

| File | What it does |
| --- | --- |
| `src/index.ts` | Plugin entry and the Gateway methods `wizzle.pair`, `wizzle.status`, `wizzle.unpair` |
| `src/channel.ts` | The channel: one account that owns the bridge, relay connection and pairing; the outbound adapter |
| `src/host.ts` | The `BridgeHost` on OpenClaw: agents, history, activity, topics, clear, turns, reply delivery |
| `src/cli.ts` | `openclaw wizzle pair \| status \| unpair`, each calling its Gateway method |
| `src/conv.ts`, `src/transcript.ts`, `src/topics.ts` | Conversation ids, transcript rows to messages, topic titles |
| `src/openclaw-sdk.d.ts` | Types for two SDK modules 2026.10.9 ships without them |
| `plugin/` | The published `package.json`, `openclaw.plugin.json` and user README |
| `pack.sh` | Compiles `src` with its sibling sources and runs `npm pack` |

## Use

- `openclaw wizzle pair [--replace]`, `openclaw wizzle status`,
  `openclaw wizzle unpair`.
- Config under `channels.wizzle`: `relayUrl` (else `WIZZLE_RELAY_URL`, default
  `wss://relay.wizzle.app`) and `inviteTtlMinutes` (default 15).
- State lives in `<OpenClaw state dir>/wizzle`.

## Things to know

- An agent's default conversation is its main session, shared with the Control
  UI and other channels. A topic gets its own session.
- Message ids: a user row keeps wizzle's `msgId`; a reply's id is its
  transcript entry id, the same live and in history.
- OpenClaw resets a session in place, so history starts after the latest reset
  row.
- Only turns wizzle started show an agent as running.
- Pairing changes run in the account's async context; a relay socket opened
  inside a Gateway request dies when the request ends.

## Install

Users run `wizzle.sh` from `../wizzle-install`. It installs the archive with
`openclaw plugins install npm-pack:<file>`, enables the plugin, sets
`channels.wizzle` and shows the pairing code, all without a Gateway restart.

## Checks

```
npm test
npm install --min-release-age=0
../wizzle/node_modules/.bin/tsc -p tsconfig.json
./pack.sh <version>
```

`npm install` needs Node 24.22.1 or later; typecheck and pack need it first.
