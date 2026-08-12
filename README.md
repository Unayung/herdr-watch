# herdr-watch

Agent status from [herdr](https://herdr.dev) on an Apple Watch.

herdr owns the roster and the state machine (which agents exist, where, and whether
they are `working` / `blocked` / `done`). Claude Code hooks own the detail (what a
prompt is actually asking). They join on the Claude session UUID: a hook's
`session_id` is the same value herdr stores as `agent_session.value` for that pane.

Everything in the data path runs on the machine hosting the agents. A laptop
attached with `herdr --remote` is a terminal client, not part of the path.

```
herdr.sock ───> herdr-notify ──> Bark push ──> phone ──> wrist
           └──> bridge ──> SSE over Tailscale Funnel ──> watch app
Claude Code hooks ──┘
```

Two ways in, because they cover different moments. Push reaches you when the app is
closed, which on watchOS is nearly always — the OS will not hold a socket open in
the background. The app is for when you raise your wrist and want the whole board.

## Push — `herdr-notify.js`

```bash
BARK_KEY=<key> node herdr-notify.js      # push on blocked / done
node herdr-notify.js                     # no key: dry run, prints instead
npm test                                 # self-checks for both services
```

| Env | Default | |
|---|---|---|
| `BARK_KEY` | — | unset means dry run |
| `BARK_SERVER` | `https://api.day.app` | |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | |
| `POLL_MS` | `3000` | |
| `BRIEF_LINES` / `BRIEF_CHARS` | `12` / `400` | how much screen rides along |

The notification carries the tail of the pane, so you can tell from your wrist
whether it needs you. Raw screens are kept in `~/.local/state/herdr-watch/samples`
— the text-cleaning rule should be retuned against real captures, not guesses.

`done` means idle after unseen background work; focusing the tab in herdr marks it
seen. Startup takes a baseline and does not push for agents already sitting in
`blocked` or `done`.

## Bridge — `bridge.js`

```bash
node bridge.js                   # 127.0.0.1:7860
node setup-hooks.js              # point Claude Code at it (--remove to undo)
npm run pair                     # the 6-digit code the watch asks for
```

Publishing it is the one part that has to reach the open internet, because a watch
cannot join a tailnet. Two routes, and the second is what actually shipped:

- `tailscale funnel --bg 7860` — fewest dependencies, but it needs the node's
  Let's Encrypt cert, and here `tailscale cert` failed six times with the DNS-01
  order going `invalid` moments after `SetDNS` returned. Worth retrying if the
  admin console's HTTPS Certificates toggle turns out to have been off.
- A cloudflared ingress rule, which is what `herdr.ccy.works` uses. Reload with
  `kill -HUP` rather than restarting, so anything else on that tunnel stays up.

Skip `trycloudflare` quick tunnels: one registered a connection and still 404'd at
the edge with no request ever reaching cloudflared.

| Route | |
|---|---|
| `GET /health` | the only route without a token |
| `POST /pair` | six digits in, token out |
| `GET /roster` | agents, sorted blocked → done → working → idle |
| `GET /events` | the roster over SSE, plus `hook` events |
| `GET /screen?pane=` | that pane's screen, on demand |
| `POST /reply` | type keys into a pane, guarded by its state counter |
| `POST /hook` | every Claude Code hook; observed, never answered |

Funnel puts this on the public internet, so the token is the whole trust boundary.
It lives in `~/.local/state/herdr-watch/token` (0600) and survives restarts. The
pairing code exists because nobody can type a 32-character token on a watch; it
rotates every 10 minutes, dies after 5 wrong guesses, and cannot be replayed.

Hooks are wired for `PermissionRequest` and `Stop` only. `PostToolUse` would fire
hundreds of times an hour across a full herdr, and `/screen` already answers "what
is this pane doing". The bridge replies `{}` to every hook, so whatever else is
hooked into `PermissionRequest` keeps deciding.

## Watch app — `watch/`

Standalone watchOS target. No iPhone app and no WCSession: the Funnel URL is
public, so the watch reaches the bridge directly over any network.

```bash
cd watch
xcodegen generate       # brew install xcodegen
open HerdrWatch.xcodeproj
```

Set your team under Signing & Capabilities, build to the watch, then pair with the
code from `npm run pair`. The default host is baked into `Bridge.swift` — change it
there rather than typing a hostname on a watch.

**The Swift has never been compiled.** It was written on Linux with no Swift
toolchain and no watchOS SDK, so treat the first build as part of the work. Two
things were already corrected by inspection and are worth knowing about if more
turn up: `@AppStorage` does not drive `objectWillChange` from inside an
`ObservableObject`, and `textSelection` does not exist on watchOS.

## Running as services

Copy the units from `systemd/`, fill in `BARK_KEY`, then:

```bash
systemctl --user enable --now herdr-watch          # push
systemctl --user enable --now herdr-watch-bridge   # bridge
```

`ExecStart` calls bare `node`. If yours comes from a version manager, put its
absolute path in instead — systemd does not read your shell profile.

## Answering from the wrist

No UI has to own `PermissionRequest`. The wrist answers by typing into the pane
through `pane.send_keys`, which is what your hands would have done — so the
terminal, a notch app, and the watch are three inputs to one TTY rather than three
tools fighting over one hook response. First one there wins.

Dismissal falls out of the same place the status came from. Buttons render only
while herdr reports that pane `blocked`; whoever answers, herdr sees the prompt
leave the screen and the next roster event takes the buttons away everywhere.

The remaining race is the two seconds between a poll and a tap. `/reply` closes it
by comparing the `state_change_seq` the watch last saw against herdr's current one
and refusing on a mismatch, so a late tap cannot type into whatever prompt arrived
next. Worth keeping if you touch this: without the check, a stale `1` lands in the
agent's input box and submits a turn.

Still not built: dictating a prompt from the wrist. `agent.prompt` handles
bracketed paste and Enter atomically, so it is the right call when it happens.
