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
tailscale funnel --bg 7860       # publish
npm run pair                     # the 6-digit code the watch asks for
```

| Route | |
|---|---|
| `GET /health` | the only route without a token |
| `POST /pair` | six digits in, token out |
| `GET /roster` | agents, sorted blocked → done → working → idle |
| `GET /events` | the roster over SSE, plus `hook` events |
| `GET /screen?pane=` | that pane's screen, on demand |
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

## Not built yet

Replying from the wrist. herdr can do the writing — `pane.send_keys` for an
approval, `agent.prompt` for dictated text — and Claude Code wants a decision
shaped like `hookSpecificOutput.decision.behavior`. What it needs first is a call
on which UI owns `PermissionRequest`: two deciders on the same hook race, and
whoever answers second is talking to a prompt that has already moved on.
