import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hasTmux, sessionExists, tmux } from "./tmux.js";
import { frameHash, matches, stripAnsi, type Matcher } from "./screen.js";

export interface StartSessionOptions {
  /** Binary to launch inside the tmux pane (e.g. "claude", "codex"). */
  bin: string;
  /** Arguments forwarded to bin. */
  args?: string[];
  /** Working directory for the tmux session. */
  cwd?: string;
  /** Environment overrides; merged onto process.env. */
  env?: NodeJS.ProcessEnv;
  /** Pane width in cells. Default 200. */
  cols?: number;
  /** Pane height in cells. Default 50. */
  rows?: number;
  /**
   * Tmux session name. Auto-generated if omitted. The harness uses this as
   * `tmux attach -t <name>` for debugging.
   */
  sessionName?: string;
  /**
   * Lines of scrollback to retain when capturing. Default 10000.
   */
  scrollback?: number;
}

export interface WaitForOptions {
  timeoutMs?: number;
  /** Polling interval. Default 250ms. */
  pollMs?: number;
}

export interface WaitIdleOptions extends WaitForOptions {
  /** How long the screen must be hash-stable before considered idle. Default 1500ms. */
  stableMs?: number;
}

export interface AttachInfo {
  tmuxTarget: string;
}

const POLL_DEFAULT_MS = 250;

export class AgentSession {
  private killed = false;
  private readonly scrollback: number;

  constructor(
    public readonly target: string,
    scrollback: number,
  ) {
    this.scrollback = scrollback;
  }

  attachInfo(): AttachInfo {
    return { tmuxTarget: this.target };
  }

  /**
   * Type literal text into the pane. Multi-line text is sent as-is; combine
   * with `.enter()` to submit.
   */
  async type(text: string): Promise<void> {
    this.assertAlive();
    await tmux(["send-keys", "-t", this.target, "-l", text]);
  }

  async enter(): Promise<void> {
    this.assertAlive();
    await tmux(["send-keys", "-t", this.target, "Enter"]);
  }

  /** Send a tmux key name (e.g. "C-c", "Escape", "Up"). */
  async sendKey(key: string): Promise<void> {
    this.assertAlive();
    await tmux(["send-keys", "-t", this.target, key]);
  }

  /** ANSI-stripped capture of the current pane (including scrollback). */
  async capture(): Promise<string> {
    return stripAnsi(await this.captureRaw());
  }

  async captureRaw(): Promise<string> {
    this.assertAlive();
    return await tmux([
      "capture-pane",
      "-t",
      this.target,
      "-p",
      "-S",
      `-${this.scrollback}`,
    ]);
  }

  /**
   * Poll until the matcher matches the captured screen or timeout.
   * Returns the matching screen on success.
   */
  async waitFor(matcher: Matcher, opts: WaitForOptions = {}): Promise<string> {
    const timeout = opts.timeoutMs ?? 60_000;
    const poll = opts.pollMs ?? POLL_DEFAULT_MS;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const screen = await this.capture();
      if (matches(screen, matcher)) return screen;
      await delay(poll);
    }
    throw new Error(
      `waitFor timed out after ${timeout}ms (tmuxTarget=${this.target})`,
    );
  }

  /**
   * Wait until the pane is hash-stable for `stableMs` (no new output).
   * Useful between sending a prompt and the next assertion to ensure the
   * agent has stopped rendering.
   */
  async waitIdle(opts: WaitIdleOptions = {}): Promise<string> {
    const timeout = opts.timeoutMs ?? 60_000;
    const stableMs = opts.stableMs ?? 1500;
    const poll = opts.pollMs ?? POLL_DEFAULT_MS;
    const deadline = Date.now() + timeout;
    let lastHash = "";
    let stableSince = 0;
    while (Date.now() < deadline) {
      const screen = await this.capture();
      const hash = frameHash(screen);
      const now = Date.now();
      if (hash === lastHash) {
        if (now - stableSince >= stableMs) return screen;
      } else {
        lastHash = hash;
        stableSince = now;
      }
      await delay(poll);
    }
    throw new Error(
      `waitIdle timed out after ${timeout}ms (tmuxTarget=${this.target})`,
    );
  }

  /**
   * Resolves when the underlying tmux session is gone (agent exited).
   * Polls; tmux does not provide a sync wait primitive for sessions.
   */
  async waitExit(opts: WaitForOptions = {}): Promise<void> {
    const timeout = opts.timeoutMs ?? 180_000;
    const poll = opts.pollMs ?? POLL_DEFAULT_MS;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!(await sessionExists(this.target))) {
        this.killed = true;
        return;
      }
      await delay(poll);
    }
    throw new Error(
      `waitExit timed out after ${timeout}ms (tmuxTarget=${this.target})`,
    );
  }

  async kill(): Promise<void> {
    if (this.killed) return;
    if (await sessionExists(this.target)) {
      await tmux(["kill-session", "-t", this.target]);
    }
    this.killed = true;
  }

  private assertAlive(): void {
    if (this.killed) {
      throw new Error(`session ${this.target} has been killed`);
    }
  }
}

export async function startSession(
  opts: StartSessionOptions,
): Promise<AgentSession> {
  if (!(await hasTmux())) {
    throw new Error(
      "tmux binary not found on PATH; agent-pty requires tmux >= 3.0",
    );
  }
  const target = opts.sessionName ?? `agent-pty-${randomUUID().slice(0, 8)}`;
  if (await sessionExists(target)) {
    throw new Error(`tmux session already exists: ${target}`);
  }
  const cols = opts.cols ?? 200;
  const rows = opts.rows ?? 50;
  const scrollback = opts.scrollback ?? 10_000;
  const env = { ...process.env, ...(opts.env ?? {}) };

  const args = [
    "new-session",
    "-d",
    "-s",
    target,
    "-x",
    String(cols),
    "-y",
    String(rows),
  ];
  if (opts.cwd) args.push("-c", opts.cwd);
  args.push(opts.bin, ...(opts.args ?? []));

  await runTmuxWithEnv(args, env);

  const session = new AgentSession(target, scrollback);
  registerCleanup(session);
  return session;
}

async function runTmuxWithEnv(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tmux", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`tmux new-session exited with ${code}: ${stderr.trim()}`),
        );
    });
  });
}

const liveSessions = new Set<AgentSession>();
let cleanupBound = false;

function registerCleanup(session: AgentSession): void {
  liveSessions.add(session);
  if (!cleanupBound) {
    const handler = (): void => {
      for (const s of liveSessions) {
        void s.kill().catch(() => {});
      }
    };
    process.on("exit", handler);
    process.on("SIGINT", () => {
      handler();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      handler();
      process.exit(143);
    });
    cleanupBound = true;
  }
}
