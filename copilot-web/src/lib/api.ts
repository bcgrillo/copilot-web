// The CodePods proxy strips the public prefix (/api/proxy/...), so the app
// runs at the root: BASE stays empty. apiUrl() exists in case a basePath is
// used in other deployments (NEXT_PUBLIC_BASE_PATH).
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const apiUrl = (p: string) => `${BASE}${p}/`;