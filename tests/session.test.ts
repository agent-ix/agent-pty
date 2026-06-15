import { describe, it, expect } from "vitest";
import { hasTmux, startSession } from "../src/index.js";

const tmuxAvailable = await hasTmux();
const d = tmuxAvailable ? describe : describe.skip;

d("AgentSession (requires tmux)", () => {
  it("spawns a bash session, types, captures, and exits", async () => {
    const s = await startSession({
      bin: "bash",
      args: ["--norc", "--noprofile"],
      cols: 80,
      rows: 24,
    });
    try {
      await s.type("echo hello-from-pty");
      await s.enter();
      const screen = await s.waitFor("hello-from-pty", { timeoutMs: 5000 });
      expect(screen).toMatch(/hello-from-pty/);
      await s.type("exit");
      await s.enter();
      await s.waitExit({ timeoutMs: 5000 });
    } finally {
      await s.kill();
    }
  });

  it("waitIdle returns once output stabilizes", async () => {
    const s = await startSession({
      bin: "bash",
      args: ["--norc", "--noprofile"],
    });
    try {
      await s.type("printf done");
      await s.enter();
      const screen = await s.waitIdle({
        timeoutMs: 5000,
        stableMs: 500,
      });
      expect(screen).toMatch(/done/);
    } finally {
      await s.kill();
    }
  });
});
