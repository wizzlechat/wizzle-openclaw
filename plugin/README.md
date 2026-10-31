# Wizzle for OpenClaw

Chat with your OpenClaw agents in the Wizzle app. Messages are end to end
encrypted between the app and this plugin; the Wizzle relay only forwards
ciphertext.

Install it with `curl -fsSL https://wizzle.app/install.sh | bash`, then pair the
app:

```bash
openclaw wizzle pair            # one-time QR code, expires after 15 minutes
openclaw wizzle pair --replace  # unpair the current app and show a new code
openclaw wizzle status          # none, inviting or paired
openclaw wizzle unpair          # remove the app at the relay
```

Config, under `channels.wizzle`:

- `relayUrl`: the relay, default `wss://relay.wizzle.app` (or `WIZZLE_RELAY_URL`).
- `inviteTtlMinutes`: how long a pairing code lives, 1 to 1440, default 15.
