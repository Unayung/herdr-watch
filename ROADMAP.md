# Directions

## Built

**The phone page.** Shipped in `web/`, served at `/`. Everything the watch does —
roster, screen, answer buttons, dictation — with no build step, no Apple account,
and no host to type, because the page talks to wherever it was loaded from.

It cleared the wall the watch could not. On one Wi-Fi a browser reaches the bridge
directly with no tunnel and no certificate; watchOS blocks cleartext and cannot
join a tailnet, so the watch always needs a public hostname. Two things helped that
were never planned: `EventSource` cannot set an `Authorization` header, and the
`?token=` form was already there because curl needed it to test the stream.

Answering a prompt with words landed too. The free-text choice is added by the
client, so it never reaches the hook, but it is printed on screen with a number
next to it — `/answer-text` reads that number, presses it, waits for the screen to
visibly change, and types only then.

**Notifications stay on Bark.** Web Push would need iOS 16.4, the page installed to
the home screen, VAPID keys and a service worker. The push already reaches the
wrist; the page is for looking and acting.

---

## Open

### Cleartext on the LAN

`HOST=0.0.0.0` is what makes the phone page reachable at home, and it puts the
token on the network in the open. Anything on that network can then reach a service
that types into your terminal. Fine on a network you trust, worth knowing before
carrying the machine onto one you do not.

### Tailscale Funnel's certificate

Never issued. `tailscale cert` failed six times, the DNS-01 order going `invalid`
within the same second `SetDNS` returned; DNS and Funnel config both check out.
The admin console's HTTPS Certificates toggle is the one thing not verified from
the machine. Fixing it removes an external dependency and changes nothing else —
the cloudflared ingress works.

### Open-sourcing the watch app

The repository is public and MIT. What still stands between that and something a
stranger can use:

**Distribution.** A watchOS app cannot be downloaded. Every user needs a Mac,
Xcode, an Apple developer account, and a willingness to sideload; a free account
means re-signing every seven days. The App Store is not an easy escape either —
without a bridge the app shows an empty screen and a reviewer cannot run one, so
passing review would mean building a demo mode that stands on its own.

The phone page is the answer to most of this. It is what people would actually
install, and it needs none of the above.

**Security.** One bearer token, no expiry, no revocation, no rate limiting, in
front of `/reply` and `/prompt`. Defensible for one person who understands it;
handing it to strangers wants per-device tokens, revocation, and failure rate
limiting. The pairing code is six digits with five tries per ten-minute window —
roughly four years of expected brute force, usable but not a number to tell people
to relax about.

**Chores.** `Bridge.swift` hardcodes `herdr.ccy.works`. Every UI string is
Traditional Chinese. Push is written against Bark's payload. `cleanScreen` was
tuned against Claude Code's layout, the buttons assume a bare digit selects an
option there, and `/answer-text` matches an English label. Hooks are Claude Code
only, while herdr recognises twenty-odd kinds — the rest get the roster and the
screen but no labelled buttons.

**Client names.** `Sample.swift`, the self-checks and both screenshots carry real
project names. Left deliberately; noted so nobody assumes it was missed.
