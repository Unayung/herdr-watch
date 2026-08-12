#!/usr/bin/env node
// Serves herdr's agent roster to the watch over SSE.
//
//   node bridge.js                 # prints the token, listens on 127.0.0.1:7860
//   tailscale funnel 7860          # publish it at https://<node>.<tailnet>.ts.net
//
// Funnel puts this on the public internet, so every route except /health requires
// the token. The token is generated once and kept in TOKEN_FILE.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { agents, agentAt, screen, cleanScreen, sendKeys, promptAgent } from "./herdr.js";

const PORT = Number(process.env.PORT || 7860);
const HOST = process.env.HOST || "127.0.0.1";
const POLL_MS = Number(process.env.POLL_MS || 2000);
const STATE_DIR = path.join(os.homedir(), ".local/state/herdr-watch");
const TOKEN_FILE = path.join(STATE_DIR, "token");
const CODE_FILE = path.join(STATE_DIR, "pair-code");
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;

function loadToken() {
  if (process.env.WATCH_TOKEN) return process.env.WATCH_TOKEN;
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    const token = crypto.randomBytes(24).toString("base64url");
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
    return token;
  }
}

/** Only what the watch renders — the rest of an AgentInfo is noise on a wrist. */
export function projectRoster(list) {
  return list
    .map((a) => ({
      paneId: a.pane_id,
      sessionId: a.agent_session?.value ?? null,
      agent: a.agent ?? "unknown",
      agentName: agentName(a.agent),
      status: a.agent_status ?? "unknown",
      title: a.terminal_title_stripped || a.title || a.agent || a.pane_id,
      folder: path.basename(a.cwd || "") || a.pane_id,
      cwd: a.cwd ?? "",
      focused: Boolean(a.focused),
      // What /reply compares against, so a stale tap cannot type into the next prompt.
      seq: a.state_change_seq ?? 0,
    }))
    .sort((x, y) => RANK.indexOf(x.status) - RANK.indexOf(y.status) || x.title.localeCompare(y.title));
}

// What you want to see first on a wrist: whoever is waiting on you.
const RANK = ["blocked", "done", "working", "idle", "unknown"];

// herdr names an agent by a short id of its own. Spell out the ones a person would
// recognise and capitalise the rest, rather than carrying a table that has to stay
// right about every agent herdr will ever learn. It lives here so both clients read
// the same names instead of each keeping a copy to drift.
const AGENT_NAMES = {
  agy: "Antigravity",
  claude: "Claude",
  cline: "Cline",
  codex: "Codex",
  copilot: "Copilot",
  cursor: "Cursor",
  devin: "Devin",
  gemini: "Gemini",
  grok: "Grok",
  opencode: "OpenCode",
  qodercli: "Qoder",
};

const agentName = (id) => AGENT_NAMES[id] ?? (id ? id[0].toUpperCase() + id.slice(1) : "Unknown");

/**
 * A rotating 6-digit code, so the watch never has to type the real token. It is
 * written to CODE_FILE rather than served over HTTP — reading it means having a
 * shell on this machine, which is the point.
 *
 * ponytail: six digits is only safe because the window is short and the tries are
 * few. Keep both if you touch this.
 */
export function makePairing(now = () => Date.now()) {
  let code = null;
  let born = 0;
  let tries = 0;
  const rotate = () => {
    code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    born = now();
    tries = 0;
    return code;
  };
  return {
    current() {
      if (code === null || now() - born > CODE_TTL_MS) return rotate();
      return code;
    },
    /** True once, for the right code, while it is live and not burnt. */
    accept(candidate) {
      if (code === null || now() - born > CODE_TTL_MS) return false;
      if (tries >= CODE_TRIES) return false;
      if (String(candidate) !== code) {
        tries += 1;
        return false;
      }
      rotate();
      return true;
    },
  };
}

/**
 * A Claude Code hook payload, reduced to what a wrist can use. `session_id` is the
 * join key: herdr stores the same uuid as an agent's `agent_session.value`.
 */
export function projectHook(body) {
  const input = body.tool_input ?? {};
  const detail =
    input.command ?? input.file_path ?? input.pattern ?? input.prompt ?? input.description ?? "";
  const hook = {
    sessionId: body.session_id ?? null,
    event: body.hook_event_name ?? "unknown",
    tool: body.tool_name ?? null,
    detail: String(detail).slice(0, 200),
  };
  // AskUserQuestion carries its own options; plain permission prompts carry
  // suggestions. Either way the watch renders a list, so normalise to one shape.
  const questions = input.questions;
  if (questions?.length) {
    hook.questions = questions.map((q) => ({
      question: q.question ?? "",
      options: (q.options ?? []).map((o) => ({ label: o.label ?? "", description: o.description ?? "" })),
    }));
  } else if (body.permission_suggestions?.length) {
    hook.questions = [
      {
        question: `${body.tool_name ?? "tool"}?`,
        options: body.permission_suggestions.map((s) => ({ label: String(s.behavior ?? s), description: "" })),
      },
    ];
  }
  return hook;
}

/**
 * The number that selects the free-text choice on a numbered prompt, read off the
 * screen rather than inferred. It sits below the options the hook reported, and
 * counting them to guess it would be right until the day it was not.
 *
 * ponytail: matches the English label. A localised client would need its own
 * pattern, and finding nothing correctly offers no button at all.
 */
export function freeTextKey(screenText) {
  const match = (screenText || "").match(/^\s*(\d+)\.\s*Type something/im);
  return match ? match[1] : null;
}

/** True once the pane stops looking like it did, which is how you know a keystroke landed. */
async function screenChanged(paneId, before, tries = 8, waitMs = 250) {
  for (let i = 0; i < tries; i++) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const now = await screen(paneId).catch(() => before);
    if (now !== before) return true;
  }
  return false;
}

export function authorized(req, url, token) {
  const header = req.headers.authorization || "";
  return header === `Bearer ${token}` || url.searchParams.get("token") === token;
}

function sse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function main() {
  const token = loadToken();
  const pairing = makePairing();
  const clients = new Set();
  /** sessionId -> { hook, sawBlocked } for questions still waiting to be answered. */
  const questions = new Map();
  let roster = [];

  const publishCode = () => {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(CODE_FILE, pairing.current() + "\n", { mode: 0o600 });
  };
  publishCode();
  setInterval(publishCode, 60_000).unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/health") return json(res, 200, { ok: true });

    // The page and its icon carry no data — they ask for a pairing code like any
    // other client. Serving them unauthenticated is what lets a phone reach this at
    // all, and on one Wi-Fi that needs no tunnel and no Apple anything.
    if (url.pathname === "/" || url.pathname === "/index.html") return file(res, "web/index.html", "text/html");
    if (url.pathname === "/icon.png") {
      return file(res, "watch/Sources/Assets.xcassets/AppIcon.appiconset/icon-1024.png", "image/png");
    }

    if (url.pathname === "/pair" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      if (!pairing.accept(body.code)) return json(res, 403, { error: "bad code" });
      publishCode();
      console.log("paired a client");
      return json(res, 200, { token });
    }

    if (!authorized(req, url, token)) return json(res, 401, { error: "unauthorized" });

    if (url.pathname === "/roster") return json(res, 200, { roster });

    if (url.pathname === "/screen") {
      const pane = url.searchParams.get("pane");
      if (!pane) return json(res, 400, { error: "pane required" });
      const text = cleanScreen(await screen(pane).catch(() => ""));
      return json(res, 200, { pane, text });
    }

    // Answer a prompt by typing into the pane, exactly as a hand at the keyboard
    // would. Nothing here touches the hook decision, so any other tool hooked into
    // PermissionRequest keeps working and simply finds the prompt already gone.
    //
    // `seq` is the state_change_seq the caller last saw. If herdr has moved on —
    // someone answered in the terminal, or in another UI — the keystroke is refused
    // rather than landing in whatever came next.
    if (url.pathname === "/reply" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const agent = await agentAt(body.pane).catch(() => null);
      if (!agent) return json(res, 404, { error: "no such pane" });
      if (agent.agent_status !== "blocked") return json(res, 409, { error: "not blocked", status: agent.agent_status });
      if (body.seq !== undefined && agent.state_change_seq !== body.seq) {
        return json(res, 409, { error: "stale", seq: agent.state_change_seq });
      }
      const keys = Array.isArray(body.keys) ? body.keys.slice(0, 8).map(String) : [];
      if (!keys.length) return json(res, 400, { error: "keys required" });
      await sendKeys(body.pane, keys);
      console.log(`reply ${body.pane} ${keys.join(" ")}`);
      return json(res, 200, { ok: true });
    }

    // Dictated text, sent as a prompt rather than as keystrokes. Refused unless the
    // agent is waiting for input: typing a sentence into a numbered permission
    // dialog answers nothing and leaves a mess in the prompt behind it.
    if (url.pathname === "/prompt" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const agent = await agentAt(body.pane).catch(() => null);
      if (!agent) return json(res, 404, { error: "no such pane" });
      if (!["idle", "done"].includes(agent.agent_status)) {
        return json(res, 409, { error: "not accepting text", status: agent.agent_status });
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json(res, 400, { error: "text required" });
      await promptAgent(body.pane, text);
      console.log(`prompt ${body.pane} ${text.slice(0, 60)}`);
      return json(res, 200, { ok: true });
    }

    // Answering a numbered prompt with words. The free-text choice is added by the
    // client, so it never appears in the hook's questions — but it is printed on
    // the screen with a number, and that number is readable rather than guessable.
    //
    // Two steps, and the second only happens if the first visibly worked: press the
    // number, wait for the screen to actually change, then type. Sending text into
    // a prompt that never opened a field would submit it as a turn instead.
    if (url.pathname === "/answer-text" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const agent = await agentAt(body.pane).catch(() => null);
      if (!agent) return json(res, 404, { error: "no such pane" });
      if (agent.agent_status !== "blocked") return json(res, 409, { error: "not blocked", status: agent.agent_status });
      if (body.seq !== undefined && agent.state_change_seq !== body.seq) {
        return json(res, 409, { error: "stale", seq: agent.state_change_seq });
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json(res, 400, { error: "text required" });

      const before = await screen(body.pane).catch(() => "");
      const key = freeTextKey(cleanScreen(before));
      if (!key) return json(res, 409, { error: "no free-text option" });

      await sendKeys(body.pane, [key]);
      if (!(await screenChanged(body.pane, before))) {
        return json(res, 409, { error: "the prompt did not open a field" });
      }
      await promptAgent(body.pane, text);
      console.log(`answer-text ${body.pane} via ${key}: ${text.slice(0, 60)}`);
      return json(res, 200, { ok: true, key });
    }

    // One endpoint for every hook — the payload names its own event. Observe only:
    // an empty response leaves the permission decision to whoever else is hooked in.
    if (url.pathname === "/hook" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const hook = projectHook(body);
      if (hook.questions && hook.sessionId) questions.set(hook.sessionId, { hook, sawBlocked: false });
      for (const send of clients) send("hook", hook);
      // The session id is here because the join to herdr's roster runs through it,
      // and every question about a missing button starts with "did they match".
      const asked = hook.questions ? ` ${hook.questions[0].options.length} options` : "";
      console.log(`hook ${hook.event} ${hook.tool ?? "-"} session=${hook.sessionId ?? "-"}${asked}`);
      return json(res, 200, {});
    }

    if (url.pathname === "/events") {
      const send = sse(res);
      send("roster", { roster });
      // A hook fires once, at the moment of the prompt. By the time the push has
      // reached a wrist and the app is open it is long gone, so the questions
      // still outstanding are replayed to every client that arrives.
      for (const entry of questions.values()) send("hook", entry.hook);
      clients.add(send);
      // ponytail: 25s comment keeps Funnel's proxy from reaping an idle stream.
      const beat = setInterval(() => res.write(": beat\n\n"), 25000);
      req.on("close", () => {
        clearInterval(beat);
        clients.delete(send);
      });
      return;
    }

    return json(res, 404, { error: "not found" });
  });

  server.listen(PORT, HOST, () => {
    console.log(`bridge on http://${HOST}:${PORT}`);
    console.log(`pair code: cat ${CODE_FILE}`);
    console.log(`publish: tailscale funnel ${PORT}`);
  });

  for (;;) {
    try {
      const next = projectRoster(await agents());
      // A question outlives its hook but not its prompt. Dropping it needs "was
      // blocked and now is not", never "is not blocked": the hook and herdr's
      // detection land within the same fraction of a second, so a poll landing in
      // that gap would throw the question away before anyone saw it.
      const blocked = new Set(next.filter((a) => a.status === "blocked").map((a) => a.sessionId));
      for (const [sessionId, entry] of questions) {
        if (blocked.has(sessionId)) entry.sawBlocked = true;
        else if (entry.sawBlocked) questions.delete(sessionId);
      }

      if (JSON.stringify(next) !== JSON.stringify(roster)) {
        roster = next;
        for (const send of clients) send("roster", { roster });
      }
    } catch (err) {
      console.error("herdr unreachable:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function file(res, relative, type) {
  try {
    const body = fs.readFileSync(new URL(relative, import.meta.url));
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(body);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function selftest() {
  const rows = projectRoster([
    { pane_id: "p1", agent_status: "idle", cwd: "/a/pluto", terminal_title_stripped: "JP" },
    { pane_id: "p2", agent_status: "blocked", cwd: "/a/pluto", terminal_title_stripped: "Styx" },
    { pane_id: "p3", agent_status: "working", cwd: "/a/x", agent: "claude", agent_session: { value: "uuid-3" }, state_change_seq: 42 },
  ]);
  assert.equal(rows[1].seq, 42, "sequence carried for the reply guard");
  assert.equal(rows[0].seq, 0, "a missing sequence is zero, never undefined");
  assert.deepEqual(rows.map((r) => r.paneId), ["p2", "p3", "p1"], "blocked sorts above working above idle");
  assert.equal(rows[0].folder, "pluto");
  assert.equal(rows[1].sessionId, "uuid-3", "claude session uuid carried for the hook join");
  assert.equal(rows[1].agentName, "Claude", "agents are named once, here, for every client");
  assert.equal(projectRoster([{ pane_id: "p", agent: "agy" }])[0].agentName, "Antigravity");
  assert.equal(projectRoster([{ pane_id: "p", agent: "kimi" }])[0].agentName, "Kimi", "an unknown id is capitalised, not guessed at");
  assert.equal(rows[2].title, "JP");

  const bash = projectHook({ session_id: "u1", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
  assert.deepEqual(bash, { sessionId: "u1", event: "PreToolUse", tool: "Bash", detail: "npm test" });
  assert.equal(projectHook({ tool_input: { file_path: "/a/b.ts" } }).detail, "/a/b.ts", "file tools summarise by path");
  assert.equal(projectHook({}).sessionId, null, "a payload without a session still projects");
  assert.equal(projectHook({ tool_input: { command: "x".repeat(500) } }).detail.length, 200, "detail capped");

  const asked = projectHook({
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question: "Ship it?", options: [{ label: "Yes" }, { label: "No", description: "wait" }] }] },
  });
  assert.deepEqual(asked.questions[0].options.map((o) => o.label), ["Yes", "No"], "options normalised");
  const suggested = projectHook({ hook_event_name: "PermissionRequest", tool_name: "Bash", permission_suggestions: [{ behavior: "allow" }] });
  assert.deepEqual(suggested.questions[0].options.map((o) => o.label), ["allow"], "suggestions normalise to the same shape");

  let clock = 0;
  const pairing = makePairing(() => clock);
  const code = pairing.current();
  assert.match(code, /^\d{6}$/, "six digits");
  assert.equal(pairing.current(), code, "stable while live");
  assert.ok(!pairing.accept("000000") || code === "000000", "a wrong code is refused");
  assert.ok(pairing.accept(code), "the right code pairs");
  assert.ok(!pairing.accept(code), "and cannot be replayed");
  const fresh = pairing.current();
  for (let i = 0; i < CODE_TRIES; i++) pairing.accept("bad");
  assert.ok(!pairing.accept(fresh), "burnt after too many tries, even for the right code");
  clock = CODE_TTL_MS + 1;
  assert.notEqual(pairing.current(), fresh, "rotates once expired");

  assert.equal(
    freeTextKey("❯ 1. 只推 blocked\n  2. 維持現狀\n  4. Type something.\n  5. Chat about this"),
    "4",
    "the free-text number is read off the screen",
  );
  assert.equal(freeTextKey("1. a\n2. b"), null, "a prompt without one offers nothing to press");
  assert.equal(freeTextKey(""), null, "and neither does an empty screen");

  const url = new URL("http://x/events?token=good");
  assert.ok(authorized({ headers: {} }, url, "good"), "query token accepted");
  assert.ok(authorized({ headers: { authorization: "Bearer good" } }, new URL("http://x/events"), "good"), "bearer accepted");
  assert.ok(!authorized({ headers: {} }, new URL("http://x/events"), "good"), "no token rejected");
  assert.ok(!authorized({ headers: {} }, new URL("http://x/events?token=bad"), "good"), "wrong token rejected");
  console.log("ok");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === "--selftest") selftest();
  else main();
}
