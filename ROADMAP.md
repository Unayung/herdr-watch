# Directions

Two things worth building next, kept apart because they have almost nothing in
common except the bridge they both talk to.

---

## 1. A phone web page

The bridge already serves everything a browser needs. Nothing new is required on
the server except a route that returns the page.

| Existing route | What the page does with it |
|---|---|
| `POST /pair` | six digits in, token out |
| `GET /events` | `EventSource` is native to browsers |
| `GET /screen?pane=` | the pane's screen when a row is opened |
| `POST /reply` · `POST /prompt` | the buttons and the text field |

`EventSource` cannot set an `Authorization` header. It does not have to:
`authorized()` already accepts `?token=`, which was added so curl could test the
stream. SSE through cloudflared is verified.

### Why this clears the wall the watch could not

On one Wi-Fi, a phone browser reaches the bridge directly:

```bash
HOST=0.0.0.0 node bridge.js
# open http://<lan-ip>:7860 on the phone, pair, add to home screen
```

No Mac, no Xcode, no Apple account, no domain, no certificate, no tunnel. The
hardest step in this whole project — publishing the bridge — simply does not apply
at home, and a tunnel becomes something only travellers need.

watchOS can never have this. App Transport Security blocks cleartext HTTP, and a
watch cannot join a tailnet, so the watch app has no path that avoids a public
hostname with a real certificate.

### What it costs

One HTML file of vanilla JS, roughly two hundred lines, plus a `GET /` route. No
framework and no bundler: this project has zero dependencies today, and a list view
is not worth a front-end toolchain.

It also beats the watch on the things that annoyed us here — a reload ships a
change instead of a rebuild, there is no seven-day resigning, and a phone screen
fits the pane text that a wrist has to scroll.

### Open questions

- **Cleartext on the LAN.** Plain HTTP means the token crosses the local network in
  the open. Fine at home, but it has to be said out loud rather than glossed.
- **Notifications.** Web Push needs iOS 16.4 or newer, the page installed to the
  home screen, VAPID keys and a service worker. Keep Bark or ntfy for the alert and
  let the page handle looking and acting; revisit only if someone asks.

---

## 2. Open-sourcing the watch app

Three things genuinely block this, and they are not effort — they change what the
project can be.

### Distribution

A watchOS app cannot be downloaded. Every user needs a Mac, Xcode, an Apple
developer account, and the willingness to build and sideload; a free account means
re-signing every seven days. The audience narrows from "herdr users" to "herdr
users who own a Mac, a paid Apple account and an Apple Watch".

The App Store is not an easy escape either. Without a bridge of their own the app
shows an empty screen, and a reviewer cannot run one. Passing review would likely
mean building a demo mode that stands on its own — a separate project's worth of
work.

### Transport

Every user has to publish their bridge themselves: Funnel, cloudflared, ngrok, or
a reverse proxy. We could not even get Funnel's certificate to issue. There is no
version of this that installs and works.

### Security

What this actually is: **a service that types into your terminal, reachable from
the internet.** `/reply` sends arbitrary keys and `/prompt` submits arbitrary text.
The only thing in front of it is one bearer token that never expires, cannot be
revoked, and is not rate limited.

That is a defensible trade for one person who understands it. Handing it to
strangers needs per-device tokens, revocation, rotation, failure rate limiting, and
a warning that says plainly what is being exposed. The pairing code deserves a
second look too: six digits, five tries per ten-minute window, is roughly four
years of expected brute force — usable, but not a number to tell people to relax
about.

### Chores, once the above is settled

- `Bridge.swift` hardcodes `herdr.ccy.works`
- Every UI string is Traditional Chinese, hardcoded; English at minimum
- Push is written against Bark's payload; others will want ntfy, Pushover, APNs
- No LICENSE
- `brief()` was tuned against Claude Code's screen, and the numbered buttons assume
  a bare digit selects an option there. Codex or Gemini may want Enter or arrows.
- Hooks are Claude Code only, while herdr recognises twenty-odd agent kinds — other
  agents get the roster and the screen but no structured options

### The split worth making

`herdr-notify.js` has none of these problems. It is outbound only, opens no port,
needs no Apple account and no build step. Any herdr user can run it today, and
swapping the push channel is a few lines. That half is publishable now.

The bridge and the watch app are better labelled a reference implementation, with
the security warning attached, for people equipped to publish a service safely. If
the goal is reach rather than a demo, the phone page above is the version people
would actually install.
