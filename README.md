# @agent-ix/agent-pty

Drive interactive coding-agent CLIs through a tmux pane.

Built to let a TypeScript test harness act as a human at the keyboard:
spawn `claude` (or `codex`) in a real tmux session, type prompts,
wait for screen content, capture the rendered terminal, and tear
everything down — all without depending on each agent's headless
mode.

```ts
import { startSession } from "@agent-ix/agent-pty";

const s = await startSession({
  bin: "claude",
  args: ["--add-dir", "./work"],
  cwd: "./work",
  cols: 200,
  rows: 50,
});

await s.type("Use the skill in ./skill to greet me.");
await s.enter();

await s.waitFor(/needs human ack/i, { timeoutMs: 60_000 });
await s.type("Please run ix-flow ack ...");
await s.enter();

await s.waitExit({ timeoutMs: 180_000 });
console.log(await s.capture());
```

While a session is alive, attach a real terminal with
`tmux attach -t <session.attachInfo().tmuxTarget>` to watch the
agent live.

## Requirements

- tmux >= 3.0 on PATH
- Node >= 20

## Status

Standalone Agent IX package extracted from the `ix-agent-skills` monorepo.
