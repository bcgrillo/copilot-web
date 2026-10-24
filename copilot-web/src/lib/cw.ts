/** Re-applies theme (dark class) + favicon after Config UI changes.
 * themeInit (layout.tsx) defines window.__cwApplyTheme at boot. */
export function syncThemeAndFavicon(): void {
  (window as unknown as { __cwApplyTheme?: () => void }).__cwApplyTheme?.();
}