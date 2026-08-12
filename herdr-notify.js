#!/usr/bin/env node
// Watch herdr's agent roster and push a Bark notification when an agent starts
// waiting for you (blocked) or finishes unseen background work (done). The push
// carries the tail of the pane so you can read what it wants without walking back
// to the machine.
//
//   BARK_KEY=xxxx node herdr-notify.js
//   node herdr-notify.js              # no key -> dry run, prints what it would send
//   node herdr-notify.js --selftest
//
// ponytail: polls agent.list instead of subscribing. events.subscribe requires a
// pane_id per subscription, so "all agents" would mean tracking pane lifecycle by
// hand. Ceiling is POLL_MS of latency; switch to per-pane subscriptions if that
// ever matters.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { SOCKET, agents, screen, cleanScreen, displayWidth } from "./herdr.js";

const BARK_SERVER = process.env.BARK_SERVER || "https://api.day.app";
const BARK_KEY = process.env.BARK_KEY;
const POLL_MS = Number(process.env.POLL_MS || 3000);
const BRIEF_LINES = Number(process.env.BRIEF_LINES || 12);
const BRIEF_CHARS = Number(process.env.BRIEF_CHARS || 400);
const SAMPLE_DIR = path.join(os.homedir(), ".local/state/herdr-watch/samples");
const NOTIFY = new Set(["blocked", "done"]);

/**
 * Agents that just entered a notify-worthy status. Mutates `prev` into the new
 * status map. An empty `prev` seeds silently, so startup does not fire for every
 * agent already sitting in blocked/done.
 */
export function transitions(prev, agents) {
  const seeded = prev.size > 0;
  const live = new Set();
  const fired = [];
  for (const agent of agents) {
    live.add(agent.pane_id);
    const before = prev.get(agent.pane_id);
    prev.set(agent.pane_id, agent.agent_status);
    if (seeded && before !== agent.agent_status && NOTIFY.has(agent.agent_status)) fired.push(agent);
  }
  for (const paneId of prev.keys()) if (!live.has(paneId)) prev.delete(paneId);
  return fired;
}

/** A notification's worth of screen. The watch asks for far more of the same. */
export function brief(text) {
  return cleanScreen(text, { lines: BRIEF_LINES, chars: BRIEF_CHARS });
}

export function describe(agent, briefText = "") {
  const blocked = agent.agent_status === "blocked";
  // Several agents commonly share one cwd, so the task title is what tells them
  // apart — it leads, and the folder drops to the subtitle.
  const task = agent.terminal_title_stripped || agent.title || agent.agent || agent.pane_id;
  return {
    title: `${blocked ? "⏸" : "✅"} ${task}`,
    subtitle: `${path.basename(agent.cwd || "") || agent.pane_id} · ${blocked ? "等你回覆" : "完成"}`,
    body: briefText || (blocked ? "等你回覆" : "完成"),
    group: "herdr",
    level: blocked ? "timeSensitive" : "active",
  };
}

/** Keep the raw screen so the brief() rule can be tuned against real captures. */
function sample(agent, text) {
  try {
    fs.mkdirSync(SAMPLE_DIR, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${agent.agent_status}-${agent.pane_id.replace(/:/g, "_")}.txt`;
    fs.writeFileSync(path.join(SAMPLE_DIR, name), text);
  } catch (err) {
    console.error("sample failed:", err.message);
  }
}

async function push(payload) {
  if (!BARK_KEY) {
    console.log(`[dry-run] ${payload.title} / ${payload.subtitle}\n${payload.body}\n---`);
    return;
  }
  const res = await fetch(`${BARK_SERVER}/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_key: BARK_KEY, ...payload }),
  });
  if (!res.ok) throw new Error(`bark ${res.status}`);
  console.log(`${payload.title} / ${payload.subtitle}`);
}

async function main() {
  console.log(`watching ${SOCKET} every ${POLL_MS}ms${BARK_KEY ? "" : " (dry run, set BARK_KEY to push)"}`);
  const seen = new Map();
  for (;;) {
    try {
      for (const agent of transitions(seen, await agents())) {
        const text = await screen(agent.pane_id).catch(() => "");
        if (text) sample(agent, text);
        await push(describe(agent, brief(text))).catch((err) => console.error("push failed:", err.message));
      }
    } catch (err) {
      console.error("herdr unreachable:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function selftest() {
  const at = (pane_id, agent_status) => ({ pane_id, agent_status });
  const seen = new Map();
  const ids = (list) => list.map((a) => a.pane_id);

  assert.deepEqual(ids(transitions(seen, [at("p1", "working"), at("p2", "idle")])), [], "first poll seeds silently");
  assert.deepEqual(ids(transitions(seen, [at("p1", "blocked"), at("p2", "idle")])), ["p1"], "working -> blocked fires");
  assert.deepEqual(ids(transitions(seen, [at("p1", "blocked"), at("p2", "idle")])), [], "unchanged status stays quiet");
  assert.deepEqual(ids(transitions(seen, [at("p1", "idle")])), [], "leaving blocked is quiet, closed pane forgotten");
  assert.deepEqual(ids(transitions(seen, [at("p1", "idle"), at("p3", "done")])), ["p3"], "new pane arriving done fires");

  assert.equal(brief("  keep me  \n\n   \n  and me"), "keep me\n\nand me", "blank-only lines collapse, the paragraph break stays");
  assert.equal(brief(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")).split("\n").length, BRIEF_LINES, "tail capped by line count");
  assert.ok(brief("好".repeat(2000)).length <= BRIEF_CHARS, "tail capped by char count");
  assert.equal(
    brief("要不要清掉 18 支分支？\n──────────── 寶咪 V1 ──\n❯\n────────────────────────\n  Opus 5 │ 30% │ main\n  weekly ●○○○ 17%"),
    "要不要清掉 18 支分支？",
    "status bar below the last rule is cut",
  );
  assert.equal(brief("no rules here\njust text"), "no rules here\njust text", "an agent without rules keeps its tail");
  assert.equal(brief("    two spaces everywhere\n    on every line"), "two spaces everywhere\non every line", "shared margin dropped");
  assert.equal(brief("  option\n     its blurb"), "option\n   its blurb", "indentation that distinguishes is kept");
  assert.equal(brief("a\n\n\n\nb"), "a\n\nb", "blank runs collapse to one");
  assert.equal(brief(`done.${" ".repeat(80)}hint`), "done. hint", "right-aligned padding collapses");
  assert.equal(brief("  2. option\n     its blurb"), "2. option\n   its blurb", "leading indent is not touched");

  const wrapped = cleanScreen("一二三四五六七八九十壹貳參肆伍陸柒捌玖拾，收尾。", { cols: 28 });
  assert.ok(
    wrapped.split("\n").every((line) => displayWidth(line) <= 28),
    "nothing exceeds the column budget",
  );
  assert.ok(
    wrapped.split("\n").every((line) => !/^[，。]/.test(line)),
    "and no line opens with closing punctuation",
  );
  assert.equal(
    cleanScreen("aaaa bbbb cccc dddd eeee ffff gggg", { cols: 12 }),
    "aaaa bbbb\ncccc dddd\neeee ffff\ngggg",
    "latin words stay whole",
  );
  assert.equal(cleanScreen("abc", { cols: 0 }), "abc", "cols 0 leaves the text alone");
  assert.ok(
    cleanScreen(`⎿ Wrote 36 lines to ../herdr-watch/herdr.js`, { cols: 28 }).includes("\n"),
    "a token merely starting with a dot still breaks",
  );
  assert.equal(
    cleanScreen(`a${"\u00A0".repeat(40)}b`, { cols: 28 }),
    "a b",
    "non-breaking padding collapses like any other",
  );

  // Real captures, not invented ones. A blocked screen puts the question between
  // two rules and an idle one puts the input box below the content, so the same
  // cut has to serve both — which is exactly what guessing got wrong before.
  const fixture = (name) =>
    cleanScreen(fs.readFileSync(new URL(`./test/samples/${name}.txt`, import.meta.url), "utf8"));

  const blocked = fixture("blocked-askuserquestion");
  assert.match(blocked, /推播要怎麼調/, "the question survives");
  assert.match(blocked, /1\. 只推 blocked/, "so do its options");
  assert.doesNotMatch(blocked, /Enter to select/, "the keyboard hint does not");
  assert.doesNotMatch(blocked, /─{10}/, "nor any rule");

  const idle = fixture("done-idle");
  assert.doesNotMatch(idle, /weekly\s+[●○]/, "the quota bar is gone");
  assert.doesNotMatch(idle, /bypass permissions/, "so is the mode hint");
  assert.ok(idle.length > 200, "and the conversation above it is not");

  const card = describe({ agent_status: "blocked", cwd: "/a/pluto", terminal_title_stripped: "寶咪 V1" }, "要不要清掉 18 支分支？");
  assert.equal(card.title, "⏸ 寶咪 V1");
  assert.equal(card.subtitle, "pluto · 等你回覆");
  assert.equal(card.body, "要不要清掉 18 支分支？");
  assert.equal(describe({ agent_status: "done", cwd: "/a/x" }).body, "完成", "empty brief falls back");
  console.log("ok");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === "--selftest") selftest();
  else main();
}
