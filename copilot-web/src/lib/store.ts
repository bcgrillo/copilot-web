/**
 * RAM overlay for zero-turn sessions created by the web: the CLI's
 * session/list does not publish them (no turns), so they live here until
 * their first prompt (afterwards the CLI lists them and the overlay stops
 * contributing). No files: if the server dies before the first turn the
 * session only exists in the CLI (not visible in the web) — accepted.
 * ALL content flows through the ACP channel (see lib/materialize.ts);
 * here ONLY minimal metadata.
 */
import crypto from "crypto";
import type { SessionSummary } from "./types";

const g = globalThis as unknown as {
  __webZeroTurn?: Map<string, SessionSummary>;
};
const zeroTurn = (g.__webZeroTurn ??= new Map<string, SessionSummary>());

/** Zero-turn overlay: {id, name, createdAt} of what the CLI does not publish yet. */
export function listZeroTurn(): SessionSummary[] {
  return [...zeroTurn.values()];
}

export const sortByActivity = (list: SessionSummary[]) =>
  [...list].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
  );

/** Creates the zero-turn overlay for a new session (the id comes from session/new). */
export function create(
  name: string | undefined,
  id: string,
  cwd?: string
): SessionSummary {
  const meta: SessionSummary = {
    id,
    name: name?.trim() || `Session ${zeroTurn.size + 1}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd,
  };
  zeroTurn.set(id, meta);
  return meta;
}

/** Overlay only (zero-turn). Sessions with turns live in the CLI: findSession. */
export function get(id: string): SessionSummary | undefined {
  return zeroTurn.get(id);
}

/** Renames ONLY zero-turn overlay (with turns the CLI owns the title). */
export function rename(id: string, name: string): SessionSummary | undefined {
  const s = get(id);
  if (s && name.trim()) s.name = name.trim();
  return s;
}

/** Stamps overlay activity (with turns the CLI already brings its updatedAt). */
export function touch(id: string) {
  const s = get(id);
  if (s) s.updatedAt = new Date().toISOString();
}

export function remove(id: string): boolean {
  return zeroTurn.delete(id);
}
