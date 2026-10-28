import readline from "node:readline";

const tty = process.stdout.isTTY;
const color = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = color(1);
export const dim = color(2);
export const green = color(32);
export const yellow = color(33);
export const red = color(31);
export const cyan = color(36);

export const BANNER = String.raw`
  _  ___                       ____
 | |/ (_)_ __  _ __   ___ _ __|  _ \  _____   __
 | ' /| | '_ \| '_ \ / _ \ '__| | | |/ _ \ \ / /
 | . \| | |_) | |_) |  __/ |  | |_| |  __/\ V /
 |_|\_\_| .__/| .__/ \___|_|  |____/ \___| \_/
        |_|   |_|
`;

export function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

export function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (line) => { rl.close(); resolve(line); }));
}

/** Read a single keypress (lowercased). Falls back to line input when stdin is not a TTY. */
export function readKey(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: process.stdout });
    return new Promise((resolve) => rl.question("", (line) => { rl.close(); resolve(line.trim().toLowerCase()[0] ?? ""); }));
  }
  return new Promise((resolve) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (chunk: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      const ch = chunk.toString();
      // Ctrl+C in raw mode arrives as \x03; treat it as quit.
      resolve(ch === "\x03" ? "q" : ch.toLowerCase());
    });
  });
}

export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private timer: NodeJS.Timeout | undefined;

  private text: string;
  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    if (!tty) {
      process.stdout.write(this.text + "\n");
      return this;
    }
    this.timer = setInterval(() => {
      process.stdout.write(`\r${cyan(this.frames[this.i++ % this.frames.length]!)} ${this.text}`);
    }, 80);
    return this;
  }

  stop(finalLine?: string): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (tty) process.stdout.write("\r\x1b[2K");
    if (finalLine) process.stdout.write(finalLine + "\n");
  }
}

export function truncateToken(token: string, max = 72): string {
  return token.length > max ? token.slice(0, max) + "…[truncated]" : token;
}
