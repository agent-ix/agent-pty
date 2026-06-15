import { createHash } from "node:crypto";

const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*",
    "(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join(""),
  "g",
);

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

export function frameHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export type Matcher = RegExp | string | ((screen: string) => boolean);

export function matches(screen: string, m: Matcher): boolean {
  if (typeof m === "string") return screen.includes(m);
  if (m instanceof RegExp) return m.test(screen);
  return m(screen);
}
