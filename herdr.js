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

// CJK, kana, hangul and fullwidth punctuation occupy two columns in a terminal
// and read as one character to someone holding up a wrist.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** Columns a string occupies, counting fullwidth characters as two. */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

// Bullets, numbers and the markers an agent prints down its left edge. A line
// starting with one of these begins something; it never continues the line above.
const STARTS_SOMETHING = /^\s*([-*•●○✻※☐☑❯>⎿]|\d+[.)])\s/;

/**
 * Undo the agent's own line breaks so a paragraph arrives as a paragraph.
 *
 * A line reaching the terminal's right edge was broken there, not ended there.
 * Where that edge falls is measured from the buffer rather than hardcoded, so
 * this follows whatever width the agent was actually running at.
 */
function unwrap(lines) {
  const edge = Math.max(0, ...lines.map(displayWidth));
  if (edge < 40) return lines;
  const out = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    const continues =
      previous !== undefined &&
      previous !== "" &&
      line !== "" &&
      displayWidth(previous) >= edge - 2 &&
      !STARTS_SOMETHING.test(line);
    if (continues) out[out.length - 1] = previous + line.trimStart();
    else out.push(line);
  }
  return out;
}

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
  // Agents pad with non-breaking spaces, which look identical and match none of
  // the space rules below — that is how a line escapes every collapse and still
  // arrives sixty columns wide.
  const raw = (text || "")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));

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

  // A terminal right-aligns by padding, so a hint in the far corner arrives as
  // ninety spaces — five blank lines dropped into a sentence once something narrow
  // renders it. Leading indent survives up to a point, because it is the only thing
  // telling an option from its blurb; past five columns it is alignment, not
  // structure, and keeping it would leave no room to put anything beside it.
  const MAX_INDENT = 5;
  const unpadded = tight.map((line) => {
    const indent = line.match(/^ */)[0];
    return " ".repeat(Math.min(indent.length, MAX_INDENT)) + line.slice(indent.length).replace(/ {2,}/g, " ");
  });

  // Only unwrapped, never re-wrapped. Whatever renders this already breaks lines
  // at its own width, and folding to a guess at that width first meant every
  // paragraph got broken twice.
  const joined = unwrap(unpadded);

  return joined.slice(-lines).join("\n").slice(-chars).trim();
}
