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

export async function screen(paneId) {
  const res = await call("pane.read", { pane_id: paneId, source: "detection" });
  return res?.result?.read?.text ?? "";
}
