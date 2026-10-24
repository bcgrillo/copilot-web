// El proxy de CodePods strippea el prefijo público (/api/proxy/...), así que
// el app corre en raíz: BASE queda vacío. apiUrl() existe por si se usa un
// basePath en otros despliegues (NEXT_PUBLIC_BASE_PATH).
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const apiUrl = (p: string) => `${BASE}${p}/`;