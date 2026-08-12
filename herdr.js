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
export function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

// Bullets, numbers and the markers an agent prints down its left edge. A line
// starting with one of these begins something; it never continues the line above.
const STARTS_SOMETHING = /^\s*([-*•●○✻※☐☑❯>⎿]|\d+[.)])\s/;

/**
 * Undo the agent's own line breaks so the text can be re-wrapped for a screen it
 * was never printed for.
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

// Punctuation that closes something. Chinese typesetting does not begin a line
// with it, so it hangs past the margin instead of falling to the next one.
const NEVER_STARTS_A_LINE = /[、。，．・：；？！」』）】》〉］｝〕”’,.;:!?)\]}]/;

// And the mirror: an opening mark left dangling at the end of a line reads as if
// the quote never opened. It goes down with the words it belongs to.
const NEVER_ENDS_A_LINE = /[「『（【《〈［｛〔“‘([{]/;

/**
 * Greedy wrap at a column budget.
 *
 * Latin runs stay whole because a word broken mid-way is unreadable; every
 * fullwidth character is its own piece because Chinese breaks anywhere, and
 * treating a whole clause as one unbreakable token strands short lines.
 */
function wrapLine(line, cols) {
  const indent = line.match(/^ */)[0];
  const budget = Math.max(cols - displayWidth(indent), 8);
  const out = [];
  let current = "";

  const push = () => {
    // The space that triggered the break rides along on the end of the line.
    const done = current.replace(/\s+$/, "");
    if (done !== "") out.push(indent + done);
    current = "";
  };

  const pieces = [];
  let latin = "";
  for (const ch of line.slice(indent.length)) {
    if (/\s/.test(ch) || WIDE.test(ch)) {
      if (latin !== "") pieces.push(latin);
      latin = "";
      pieces.push(ch);
    } else {
      latin += ch;
    }
  }
  if (latin !== "") pieces.push(latin);

  // A path or a url can be wider than the whole line. Keeping it whole only moves
  // the break to whatever renders it, so it breaks here where the budget is known.
  const fitted = pieces.flatMap((piece) =>
    displayWidth(piece) > budget ? (piece.match(new RegExp(`.{1,${budget}}`, "g")) ?? [piece]) : [piece],
  );

  for (const piece of fitted) {
    const blank = /^\s+$/.test(piece);
    if (blank && current === "") continue;
    const overflows = displayWidth(current) + displayWidth(piece) > budget;
    // The rule is about a lone mark falling to the next line, so it only applies
    // to a single character. Matched against a whole token it also catches the dot
    // that opens "../herdr.js" and refuses to ever break the line there.
    const hangs = piece.length === 1 && NEVER_STARTS_A_LINE.test(piece);
    if (overflows && current !== "" && !hangs) {
      const dangling = NEVER_ENDS_A_LINE.test(current.slice(-1)) ? current.slice(-1) : "";
      if (dangling !== "") current = current.slice(0, -1);
      push();
      current = dangling;
      if (blank) continue;
    }
    current += piece;
  }
  push();
  return out.length ? out : [line];
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
export function cleanScreen(text, { lines = 60, chars = 2000, cols = 28 } = {}) {
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

  // A terminal right-aligns by padding, so a hint sitting in the far corner
  // arrives as ninety spaces. At twenty characters wide that is five blank lines
  // in the middle of a sentence. Leading indent survives — it is the only thing
  // telling an option from its blurb.
  // Indent past this is right-alignment, not structure. Real nesting in these
  // outputs runs two to five columns; sixty is a hint parked in the far corner,
  // and keeping it would leave no room to put anything beside it.
  const MAX_INDENT = 5;
  const unpadded = tight.map((line) => {
    const indent = line.match(/^ */)[0];
    return " ".repeat(Math.min(indent.length, MAX_INDENT)) + line.slice(indent.length).replace(/ {2,}/g, " ");
  });

  // Re-wrap for the screen it is about to be read on. `cols` is in terminal
  // columns, so the default of 28 is fourteen Chinese characters a line.
  const wrapped = cols > 0 ? unwrap(unpadded).flatMap((line) => wrapLine(line, cols)) : unpadded;

  return wrapped.slice(-lines).join("\n").slice(-chars).trim();
}
