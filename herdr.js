import net from "node:net";
import os from "node:os";
import path from "node:path";

export const SOCKET = process.env.HERDR_SOCKET_PATH || path.join(os.homedir(), ".config/herdr/herdr.sock");

/** One request per connection: send a line, read a line, close. */
export function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET);
    let buf = "";
    sock.on("connect", () => sock.write(JSON.stringify({ id: "herdr-watch", method, params }) + "\n"));
    sock.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      sock.end();
      try {
        resolve(JSON.parse(buf.slice(0, nl)));
      } catch (err) {
        reject(err);
      }
    });
    sock.on("error", reject);
  });
}

export async function agents() {
  const res = await call("agent.list");
  return res?.result?.agents ?? [];
}

export async function agentAt(paneId) {
  return (await agents()).find((a) => a.pane_id === paneId) ?? null;
}

export async function sendKeys(paneId, keys) {
  return call("pane.send_keys", { pane_id: paneId, keys });
}

/** Submits text plus Enter atomically, honouring bracketed paste. */
export async function promptAgent(paneId, text) {
  return call("agent.prompt", { target: paneId, text });
}

export async function screen(paneId) {
  const res = await call("pane.read", { pane_id: paneId, source: "detection" });
  return res?.result?.read?.text ?? "";
}

const RULE = /─{10,}/;

/**
 * A pane's screen with the agent's own furniture taken off.
 *
 * Everything below the last full-width rule is chrome — the status bar, the
 * keyboard hints. Checked against captured screens in both states: on an idle one
 * that rule is the input box, and on a blocked one it is the bottom of the question
 * box, so the question and its options sit above it and survive.
 *
 * ponytail: no version-specific matching beyond the rule. Raw captures live in
 * ~/.local/state/herdr-watch/samples — retune from those, not from guesses.
 */
export function cleanScreen(text, { lines = 60, chars = 2000 } = {}) {
  const raw = (text || "").split("\n").map((line) => line.replace(/\s+$/, ""));

  let end = raw.length;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (RULE.test(raw[i])) {
      end = i;
      break;
    }
  }

  const kept = raw
    .slice(0, end)
    .filter((line) => !RULE.test(line))
    .filter((line) => line === "" || /[\p{L}\p{N}]/u.test(line));

  // The terminal's own left margin costs width a wrist does not have. Drop what
  // every line shares, keep the indentation that tells options from their blurbs.
  const indents = kept.filter((line) => line !== "").map((line) => line.match(/^ */)[0].length);
  const margin = indents.length ? Math.min(...indents) : 0;
  const flush = margin > 0 ? kept.map((line) => line.slice(margin)) : kept;

  // One blank line separates a thought; three are the terminal breathing.
  const tight = flush.filter((line, i) => line !== "" || flush[i - 1] !== "");

  return tight.slice(-lines).join("\n").slice(-chars).trim();
}
