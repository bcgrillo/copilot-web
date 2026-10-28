// BASE resolution:
// - NEXT_PUBLIC_API_URL: absolute base for split deployments (front and
//   backend in different containers), e.g. "http://localhost:3100".
// - NEXT_PUBLIC_BASE_PATH: relative prefix when served under a proxy that
//   does NOT strip it (CodePods strips /api/proxy/... so BASE stays empty).
export const BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_BASE_PATH ?? ""
).replace(/\/+$/, "");

export const apiUrl = (p: string) => `${BASE}${p}/`;

// ------------------------- bearer authentication (localStorage tokens) ------
const ACCESS_KEY = "cw.access";
const REFRESH_KEY = "cw.refresh";
const ROTATING_KEY = "cw.rotating"; // cross-tab refresh mutex (8s TTL)

export const getAccessToken = () => localStorage.getItem(ACCESS_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);
export function saveTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let refreshInFlight: Promise<boolean> | null = null;

/** Exchange the refresh token for a fresh pair (single-flight). Refresh
 * tokens are single-use, so two tabs rotating the same token would look
 * like a replay and kill the chain: the rotating tab advertises itself in
 * localStorage and sibling tabs wait and adopt the new tokens instead. */
async function refreshTokens(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  // another tab may already be rotating
  const claim = localStorage.getItem(ROTATING_KEY);
  if (claim && Date.now() - Number(claim) < 8000) {
    await sleep(1200);
    return !!getAccessToken(); // adopt the pair rotated by the sibling tab
  }
  const myAccess = getAccessToken();
  localStorage.setItem(ROTATING_KEY, String(Date.now()));
  try {
    const res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { authorization: `Bearer ${refresh}` },
    });
    if (!res.ok) return false;
    const p = await res.json();
    if (typeof p?.access !== "string" || typeof p?.refresh !== "string") return false;
    saveTokens(p.access, p.refresh);
    return true;
  } catch {
    return getAccessToken() !== myAccess; // a sibling won the race
  }
}

/** fetch() with the bearer access token; on 401 it rotates one single-flight
 * refresh and retries once, then gives up (fires the "cw-unauth" event that
 * the UI turn into a login overlay). */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const tok = getAccessToken();
  if (tok) headers.set("authorization", `Bearer ${tok}`);
  let res = await fetch(url, { ...init, headers, credentials: "include" });
  if (res.status !== 401) return res;
  // refresh + single retry
  if (!refreshInFlight) refreshInFlight = refreshTokens().finally(() => (refreshInFlight = null));
  const ok = await refreshInFlight;
  if (ok) {
    const newTok = getAccessToken();
    if (newTok) headers.set("authorization", `Bearer ${newTok}`);
    res = await fetch(url, { ...init, headers, credentials: "include" });
    if (res.status !== 401) return res;
  }
  clearTokens();
  window.dispatchEvent(new CustomEvent("cw-unauth"));
  return res;
}