/** Paleta del modal de Config: sin infinito de colores; el hue lo elige el
 * usuario y el brillo (500 claro / 400 oscuro) se deriva solo en CSS. */
export type Accent = {
  id: string;
  light: string;
  dark: string;
};

export const ACCENTS: Accent[] = [
  { id: "emerald", light: "#10b981", dark: "#34d399" },
  { id: "green", light: "#22c55e", dark: "#4ade80" },
  { id: "lime", light: "#84cc16", dark: "#a3e635" },
  { id: "teal", light: "#14b8a6", dark: "#2dd4bf" },
  { id: "cyan", light: "#06b6d4", dark: "#22d3ee" },
  { id: "sky", light: "#0ea5e9", dark: "#38bdf8" },
  { id: "blue", light: "#3b82f6", dark: "#60a5fa" },
  { id: "indigo", light: "#6366f1", dark: "#818cf8" },
  { id: "violet", light: "#8b5cf6", dark: "#a78bfa" },
  { id: "purple", light: "#a855f7", dark: "#c084fc" },
  { id: "fuchsia", light: "#d946ef", dark: "#e879f9" },
  { id: "rose", light: "#f43f5e", dark: "#fb7185" },
  { id: "red", light: "#ef4444", dark: "#f87171" },
  { id: "orange", light: "#f97316", dark: "#fb923c" },
  { id: "amber", light: "#f59e0b", dark: "#fbbf24" },
  { id: "yellow", light: "#eab308", dark: "#facc15" },
];

/** color de vista previa del swatch según el modo efectivo */
export function accentColor(id: string, dark: boolean): string {
  const a = ACCENTS.find((x) => x.id === id);
  return dark ? a?.dark ?? "#34d399" : a?.light ?? "#10b981";
}