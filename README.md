# wizzle-openclaw

Connects the Wizzle app to an OpenClaw install through the Wizzle relay. It is
an OpenClaw channel plugin (id `wizzle`), built against OpenClaw 2026.10.9.
Messages are end to end encrypted between the app and this plugin, and the
relay only forwards ciphertext.

From the app you can chat with your agents and read their history, send and
receive files, see typing and tool activity, start topics, clear a chat, and
get messages agents start on their own. Creating, pausing, restarting and
deleting agents, keys, templates, questions and approvals are not available:
OpenClaw keeps the Gateway calls they need for its bundled plugins.

## Install

```
curl -fsSL https://wizzle.app/install.sh | bash
```

## Use

- `openclaw wizzle pair` shows a one-time pairing QR code that expires after 15
  minutes. `--replace` unpairs the current app and shows a new code.
- `openclaw wizzle status` and `openclaw wizzle unpair`.
- Config under `channels.wizzle`: `relayUrl` (default `wss://relay.wizzle.app`,
  or `WIZZLE_RELAY_URL`) and `inviteTtlMinutes` (1 to 1440, default 15).

## Build and test

```
npm test
npm install
./pack.sh <version>
```

Node 24.22.1 or later. `pack.sh` compiles with TypeScript (set `TSC` to the compiler) and writes the
archive that `openclaw plugins install` takes.
