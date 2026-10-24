/** Re-aplica tema (clase dark) + favicon tras cambios de UI en Config.
 * themeInit (layout.tsx) define window.__cwApplyTheme en el arranque. */
export function syncThemeAndFavicon(): void {
  (window as unknown as { __cwApplyTheme?: () => void }).__cwApplyTheme?.();
}