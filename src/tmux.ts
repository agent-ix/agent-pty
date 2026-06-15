import { spawn, type ChildProcess } from "node:child_process";

export class TmuxError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
    this.name = "TmuxError";
  }
}

export async function tmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("tmux", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new TmuxError(
            `tmux ${args.join(" ")} exited with ${code}: ${stderr.trim()}`,
            stderr,
            code,
          ),
        );
    });
  });
}

export async function hasTmux(): Promise<boolean> {
  try {
    await tmux(["-V"]);
    return true;
  } catch {
    return false;
  }
}

export async function sessionExists(target: string): Promise<boolean> {
  try {
    await tmux(["has-session", "-t", target]);
    return true;
  } catch {
    return false;
  }
}
