import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The CLI is a standalone script (bin/users.ts, run by the launcher with
// --experimental-strip-types): exercised here as a subprocess against an
// isolated auth store.

let dir: string;
const BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "bin",
  "users.ts",
);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cw-users-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (args: string[]) =>
  spawnSync(process.execPath, ["--experimental-strip-types", BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, COPILOT_WEB_AUTH_FILE: path.join(dir, "auth.json") },
  });

const store = () =>
  JSON.parse(readFileSync(path.join(dir, "auth.json"), "utf8")) as {
    secret: string;
    users: Record<string, unknown>;
  };

describe("bin/users.ts (subprocess CLI)", () => {
  it("adds a user (never printing the password) and lists it", () => {
    const add = run(["--add-user", "admin", "--password", "s3cret-horse"]);
    expect(add.status).toBe(0);
    expect(add.stdout).toContain("created");
    expect(add.stdout + add.stderr).not.toContain("s3cret");
    const f = store();
    expect(Object.keys(f.users)).toEqual(["admin"]);
    expect(JSON.stringify(f.users)).not.toContain("s3cret");
    const list = run(["--list-users"]);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("admin");
    expect(list.stdout).not.toContain("s3cret");
  });

  it("warns but accepts weak passwords", () => {
    const add = run(["--add-user", "weak", "--password", "123"]);
    expect(add.status).toBe(0);
    expect(add.stderr).toContain("weak password");
  });

  it("fails with exit 1 when adding an already-existing user", () => {
    expect(run(["--add-user", "admin", "--password", "pw-1234567"]).status).toBe(0);
    const dup = run(["--add-user", "admin", "--password", "pw-other12"]);
    expect(dup.status).toBe(1);
    expect(dup.stderr).toContain("already exists");
  });

  it("set-password rotates the version; unknown user exits 1", () => {
    run(["--add-user", "admin", "--password", "pw-1234567"]);
    const ok = run(["--set-password", "admin", "--password", "new-password1"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("revoked");
    const f = store();
    expect((f.users as { admin: { ver: number } }).admin.ver).toBe(2);
    const miss = run(["--set-password", "ghost", "--password", "whatever1"]);
    expect(miss.status).toBe(1);
    expect(miss.stderr).toContain("no such user");
  });

  it("del-user is idempotent; revoke of a missing user exits 1", () => {
    run(["--add-user", "admin", "--password", "pw-1234567"]);
    const gone = run(["--del-user", "admin"]);
    expect(gone.status).toBe(0);
    expect(gone.stdout).toContain("deleted");
    const gone2 = run(["--del-user", "admin"]);
    expect(gone2.status).toBe(0);
    const miss = run(["--revoke", "ghost"]);
    expect(miss.status).toBe(1);
    expect(miss.stderr).toContain("no such user");
    const ok = run(["--revoke-all"]);
    expect(ok.status).toBe(0);
  });

  it("helper-token needs a user first; then prints a token", () => {
    const none = run(["--helper-token"]);
    expect(none.status).toBe(1);
    run(["--add-user", "admin", "--password", "pw-1234567"]);
    const tok = run(["--helper-token"]);
    expect(tok.status).toBe(0);
    const token = tok.stdout.trim();
    expect(token.length).toBeGreaterThan(20);
    expect(token).not.toContain("pw-1234567");
  });

  it("unknown flags and missing actions exit 2 with help", () => {
    expect(run(["--banana"]).status).toBe(2);
    const help = run([]);
    expect(help.status).toBe(2);
    expect(help.stdout).toContain("user management");
  });
});