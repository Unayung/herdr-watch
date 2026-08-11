#!/usr/bin/env node
// Point Claude Code's hooks at the bridge.
//
//   node setup-hooks.js            # install
//   node setup-hooks.js --remove   # take them back out
//
// Only PermissionRequest and Stop are wired. PostToolUse would fire hundreds of
// times an hour across a herdr full of agents, and /screen already answers "what
// is this pane doing" on demand. Entries belonging to other tools are preserved —
// the file is shared with whatever else you have hooked in.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SETTINGS = process.env.CLAUDE_SETTINGS || path.join(os.homedir(), ".claude/settings.json");
const TOKEN_FILE = path.join(os.homedir(), ".local/state/herdr-watch/token");
const PORT = Number(process.env.PORT || 7860);
const EVENTS = ["PermissionRequest", "Stop"];
const MARK = "/hook?token=";

const remove = process.argv.includes("--remove");
const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
const hooks = settings.hooks ?? {};
const url = `http://127.0.0.1:${PORT}/hook?token=${fs.readFileSync(TOKEN_FILE, "utf8").trim()}`;

const mine = (entry) => (entry.hooks ?? []).some((h) => String(h.url ?? "").includes(MARK));

for (const event of EVENTS) {
  const kept = (hooks[event] ?? []).filter((entry) => !mine(entry));
  if (!remove) kept.push({ matcher: "", hooks: [{ type: "http", url, timeout: 5 }] });
  if (kept.length) hooks[event] = kept;
  else delete hooks[event];
}

if (Object.keys(hooks).length) settings.hooks = hooks;
else delete settings.hooks;

const backup = `${SETTINGS}.bak`;
fs.copyFileSync(SETTINGS, backup);
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
console.log(`${remove ? "removed from" : "installed into"} ${SETTINGS} (backup: ${backup})`);
for (const event of EVENTS) console.log(`  ${event}: ${(settings.hooks?.[event] ?? []).length} entries`);
