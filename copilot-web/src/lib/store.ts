/**
 * Overlay en RAM para sesiones 0-turn creadas por la web: session/list del
 * CLI no las publica (sin turnos), así que vivimos aquí hasta su primer
 * prompt (después las lista el CLI y el overlay deja de aportar). Sin
 * ficheros: si el server muere antes del primer turno la sesión queda solo
 * en el CLI (no visible en la web) — aceptado. TODO el contenido va por
 * canal ACP (ver lib/materialize.ts); aquí SOLO metadatos mínimos.
 */
import crypto from "crypto";
import type { SessionSummary } from "./types";

const g = globalThis as unknown as {
  __webZeroTurn?: Map<string, SessionSummary>;
};
const zeroTurn = (g.__webZeroTurn ??= new Map<string, SessionSummary>());

/** Overlay 0-turn: {id, name, createdAt} de lo aún no publicado por el CLI. */
export function listZeroTurn(): SessionSummary[] {
  return [...zeroTurn.values()];
}

export const sortByActivity = (list: SessionSummary[]) =>
  [...list].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
  );

/** Crea el overlay 0-turn de una sesión nueva (el id ya viene de session/new). */
export function create(
  name: string | undefined,
  id: string,
  cwd?: string
): SessionSummary {
  const meta: SessionSummary = {
    id,
    name: name?.trim() || `Sesión ${zeroTurn.size + 1}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd,
  };
  zeroTurn.set(id, meta);
  return meta;
}

/** Solo overlay (0-turn). Sesiones con turnos viven en el CLI: findSession. */
export function get(id: string): SessionSummary | undefined {
  return zeroTurn.get(id);
}

/** Renombra SOLO overlay 0-turn (con turnos el título manda el CLI). */
export function rename(id: string, name: string): SessionSummary | undefined {
  const s = get(id);
  if (s && name.trim()) s.name = name.trim();
  return s;
}

/** Marca actividad del overlay (con turnos el CLI ya trae su updatedAt). */
export function touch(id: string) {
  const s = get(id);
  if (s) s.updatedAt = new Date().toISOString();
}

export function remove(id: string): boolean {
  return zeroTurn.delete(id);
}
