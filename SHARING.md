# Sharing a dev build with someone

Everything below is for letting another person run the app on their own phone,
from their own network, off your machine. Nothing here is deployed — the app and
the API both run on your laptop and are exposed through temporary tunnels, so
they stop working the moment you close the terminals.

## What has to be running

Three processes, in three terminals, in this order.

**1. The API server**

```sh
cd server
npm run dev
```

Serves on port 8080. Check it with `curl http://localhost:8080/health` — expect
`{"ok":true}`.

**2. A public tunnel to the API**

```sh
cloudflared tunnel --url http://localhost:8080
```

It prints a `https://<random-words>.trycloudflare.com` URL in a box a few lines
in. If it has scrolled past, ask cloudflared directly instead of hunting for it:

```sh
curl http://127.0.0.1:20241/quicktunnel
```

The name is regenerated every run, so this URL is different each time.

**3. Point the app at that URL, then start Expo**

Edit `.env` in the project root:

```
EXPO_PUBLIC_API_URL=https://<the-trycloudflare-url>
```

Then, from the project root:

```sh
npx expo start --tunnel
```

Expo inlines every `EXPO_PUBLIC_*` variable at bundle time, so the `.env` edit
has to happen **before** Metro starts. Editing it while Metro is running changes
nothing.

If tunnelling has never been set up on this machine: `npm i -g @expo/ngrok`.

## What to send

`npx expo start --tunnel` draws a QR code in the terminal. The person scans it
with **Expo Go** (they need to install that first — it is free, on both stores).

There is also a saved PNG at `Desktop/panzi-qr.png`, and a plain link:

```
exp://m1icht0-coleexpo-8081.exp.direct
```

Either works, and both stay valid across restarts: Expo derives that subdomain
from the project slug, the Expo account and the port, so it is stable as long as
none of those three change. Only the cloudflared URL is different every run,
and that one never leaves your machine — it goes in `.env`, not to your friend.

Texting the link is usually easier than sending the image. Expo Go registers the
`exp://` scheme, so tapping it opens the app directly.

## Things worth knowing before you share

- **Scans cost you money.** The Anthropic key lives in `server/.env` and every
  scan they run bills your account.
- **Your API is briefly public.** Every route is behind `requireAuth`, so a
  caller needs a valid Firebase token for this project, but `/health` is open
  and the URL is guessable by nobody but reachable by anybody.
- **Everything dies with the terminals.** Closing cloudflared or Metro ends it.
- **Put `.env` back afterwards.** Leave the trycloudflare URL in there and the
  next session fails with "Could not reach the server" against a tunnel that no
  longer exists. The LAN address for local development looks like
  `http://192.168.x.x:8080` — your machine's IPv4, from `ipconfig`.

## If it fails on their phone

- "Could not reach the server at http://192.168.…" — `.env` still holds the LAN
  address, or Metro was started before `.env` was edited. Fix `.env`, restart
  Metro, and have them fully close and reopen the app in Expo Go.
- "Port 8081 is being used by another process" — an older Metro is still alive.
  Find and stop it:
  `Get-NetTCPConnection -LocalPort 8081 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- "failed to start tunnel / remote gone away" — an ngrok hiccup. Run
  `npx expo start --tunnel` again.
- They see an old version of the app — Expo Go caches the bundle. Fully closing
  and reopening the app is enough; `npx expo start --tunnel --clear` from your
  side also forces a rebuild.
