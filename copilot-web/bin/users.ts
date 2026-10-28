#!/usr/bin/env node
// User management CLI for copilot-web authentication.
//
// Run by the launcher (node --experimental-strip-types) or directly:
//   node --experimental-strip-types bin/users.ts --add-user admin --password s3cret
//
// Passwords are never displayed back (only a weak-password warning).
// The auth store lives at ~/.copilot-web/auth.json (override with
// COPILOT_WEB_AUTH_FILE) — its access secret doubles as the HMAC pepper,
// so deleting the file revokes every login.
import { createInterface } from "node:readline/promises";
import {
  addUser,
  deleteUser,
  helperToken,
  listUsers,
  readAuthFile,
  revokeAllUsers,
  revokeUser,
  setPassword,
} from "../src/lib/auth.ts";

type Action =
  | { kind: "add"; user: string }
  | { kind: "set-password"; user: string }
  | { kind: "del-user"; user: string }
  | { kind: "revoke"; user: string }
  | { kind: "revoke-all" }
  | { kind: "list-users" }
  | { kind: "helper-token" };

function help(): void {
  console.log(`copilot-web user management

Usage (via the launcher or node --experimental-strip-types):
  copilot-web --add-user admin --password <pw>   create a user
  copilot-web --set-password admin --password <pw>  change password (revokes sessions)
  copilot-web --del-user admin                   remove a user and its sessions
  copilot-web --list-users                       list usernames
  copilot-web --revoke admin                     revoke admin's passwords/tokens
  copilot-web --revoke-all                       revoke every user's sessions
  copilot-web --helper-token                     print the MCP helper token

Options:
  --password <pw>   password for add/set-password (prompted if omitted)
`);
}

function parseArgs(argv: string[]): { action: Action | null; password?: string } {
  const flags = argv.slice(2);
  let action: Action | null = null;
  let password: string | undefined;
  const userOf = (i: number): string => {
    const v = flags[i + 1];
    if (!v || v.startsWith("--")) {
      console.error(`flag ${flags[i]} expects a value`);
      process.exit(2);
    }
    return v;
  };
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "--add-user") action = { kind: "add", user: userOf(i++) };
    else if (f === "--set-password") action = { kind: "set-password", user: userOf(i++) };
    else if (f === "--del-user") action = { kind: "del-user", user: userOf(i++) };
    else if (f === "--revoke") action = { kind: "revoke", user: userOf(i++) };
    else if (f === "--revoke-all") action = { kind: "revoke-all" };
    else if (f === "--list-users") action = { kind: "list-users" };
    else if (f === "--helper-token") action = { kind: "helper-token" };
    else if (f === "--password") password = userOf(i++);
    else if (f === "-h" || f === "--help") {
      help();
      process.exit(0);
    } else {
      console.error(`unknown flag: ${f}`);
      process.exit(2);
    }
  }
  return { action, password };
}

async function askPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = (await rl.question("password: ")).trim();
  const again = (await rl.question("repeat:   ")).trim();
  rl.close();
  if (pw !== again) {
    console.error("passwords do not match");
    process.exit(1);
  }
  return pw;
}

const { action, password } = parseArgs(process.argv);
if (!action) {
  help();
  process.exit(2);
}

async function main(a: Action): Promise<number> {
  switch (a.kind) {
    case "add": {
      const pw = password ?? (await askPassword());
      try {
        const r = addUser(a.user, pw);
        console.log(`user '${a.user}' created`);
        if (r.weak)
          console.warn("WARNING: weak password (< 8 chars) — allowed but not recommended");
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
      return 0;
    }
    case "set-password": {
      const pw = password ?? (await askPassword());
      try {
        const r = setPassword(a.user, pw);
        console.log(`password updated for '${a.user}' (active sessions revoked)`);
        if (r.weak)
          console.warn("WARNING: weak password (< 8 chars) — allowed but not recommended");
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
      return 0;
    }
    case "del-user":
      try {
        deleteUser(a.user);
      } catch {
        /* idempotent: deleting a missing user is fine */
      }
      console.log(`user '${a.user}' deleted (or did not exist)`);
      return 0;
    case "revoke":
      try {
        revokeUser(a.user);
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
      console.log(`sessions revoked for '${a.user}'`);
      return 0;
    case "revoke-all":
      console.log(`sessions revoked for ${revokeAllUsers()} user(s)`);
      return 0;
    case "list-users": {
      const users = listUsers();
      if (users.length === 0) console.log("(no users)");
      for (const u of users) console.log(`${u.name}\t${u.created}`);
      return 0;
    }
    case "helper-token": {
      const f = readAuthFile();
      if (!f) {
        console.error("no auth store yet — create a user first (--add-user)");
        return 1;
      }
      console.log(helperToken(f.secret));
      return 0;
    }
  }
}

process.exit(await main(action));