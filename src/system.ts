import { execFile, spawn } from "node:child_process";

/** Open a URL in the system browser. Resolves false if no launcher worked. */
export function openBrowser(url: string): Promise<boolean> {
  // Testing hook: skip launching a browser entirely.
  if (process.env.CHATGPT_CLI_NO_BROWSER) return Promise.resolve(false);
  const candidates: Array<[string, string[]]> =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]]
        : [["xdg-open", [url]], ["sensible-browser", [url]], ["x-www-browser", [url]]];

  return new Promise((resolve) => {
    const tryNext = (i: number) => {
      if (i >= candidates.length) return resolve(false);
      const [cmd, args] = candidates[i]!;
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => tryNext(i + 1));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    };
    tryNext(0);
  });
}

/** Copy text to the system clipboard. Resolves false if no clipboard tool is available. */
export function copyToClipboard(text: string): Promise<boolean> {
  const candidates: Array<[string, string[]]> =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];

  return new Promise((resolve) => {
    const tryNext = (i: number) => {
      if (i >= candidates.length) return resolve(false);
      const [cmd, args] = candidates[i]!;
      let failed = false;
      const child = execFile(cmd, args, (err) => {
        if (err && !failed) {
          failed = true;
          tryNext(i + 1);
        } else if (!err) {
          resolve(true);
        }
      });
      child.on("error", () => {
        if (!failed) {
          failed = true;
          tryNext(i + 1);
        }
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(text);
    };
    tryNext(0);
  });
}
