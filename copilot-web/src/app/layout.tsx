import type { Metadata, Viewport } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "../../package.json";
import { ACCENTS } from "@/lib/accents";
import "./globals.css";

/** public prefix (CodePods proxy strips it): <head> hrefs must carry it */
const PUBLIC_PREFIX = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Copilot Web",
  description: "Interfaz web para GitHub Copilot CLI",
  // AppRouter file-based icon would emit href="/icon.svg" without the prefix
  // (404 tras proxy) → lo servimos desde public/ prefijado y versionado
  icons: {
    icon: [{ url: `${PUBLIC_PREFIX}/favicon.svg?v=${pkg.version}`, type: "image/svg+xml" }],
  },
};

/** language comes by env at runtime (--lang from the launcher) → no static prerender */
export const dynamic = "force-dynamic";

/** mobile: 100% of the real height (browser bar shows/hides) and
 * viewport que encoge con el teclado (el composer nunca queda tapado). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

/** dynamic favicon: same path as the public SVG, tinted with the user
 * accent (light 500 / dark 400) as a data-URL, no server, no cookies.
 * The static link's `?v=` remains as fallback if the script fails. */
const FAVICON_D =
  readFileSync(resolve(process.cwd(), "public/favicon.svg"), "utf8").match(
    / d="([^"]+)"/
  )?.[1] ?? "";
const ACCENT_HEX = JSON.stringify(
  Object.fromEntries(ACCENTS.map((a) => [a.id, { l: a.light, d: a.dark }]))
);

const themeInit = `
(function(){
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var ACC = ${ACCENT_HEX};
  var D = ${JSON.stringify(FAVICON_D)};
  var MYID = 'cw-fav-dyn';
  var setFav = function(dark, accent){
    if (!D) return;
    var c = ACC[accent || 'emerald'] || ACC.emerald;
    var col = dark ? c.d : c.l;
    try {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 55 55"><path fill="'+col+'" style="stroke-width:0.0601584" d="'+D+'"/></svg>';
      var l = document.getElementById(MYID);
      if (!l) {
        l = document.createElement('link');
        l.id = MYID; l.rel = 'icon'; l.type = 'image/svg+xml';
      }
      // append at the end: the last link[rel=icon] wins; Next hydration
      // restores the static link href and could re-insert it afterwards
      document.head.appendChild(l);
      l.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch(e){}
  };
  // Next puede reinsertar/restaurar sus iconos al hidratar o navegar:
  // ours always stays last (document order wins)
  if (window.MutationObserver) {
    var mo = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var ad = muts[i].addedNodes || [];
        for (var j = 0; j < ad.length; j++) {
          var n = ad[j];
          if (n && n.nodeType === 1 && n.tagName === 'LINK' && n.id !== MYID &&
              /(^|\s)icon(\s|$)/.test(n.rel || '')) {
            var mine = document.getElementById(MYID);
            if (mine) document.head.appendChild(mine);
          }
        }
      }
    });
    mo.observe(document.head, { childList: true });
  }
  var apply = function(){
    var t = 'auto';
    try { t = localStorage.getItem('theme') || 'auto'; } catch(e){}
    var dark = t === 'dark' || (t === 'auto' && mq.matches);
    document.documentElement.classList.toggle('dark', dark);
    var a = '';
    try { a = localStorage.getItem('accent') || ''; } catch(e){}
    if (/^[a-z]{3,12}$/.test(a)) document.documentElement.dataset.accent = a;
    setFav(dark, a);
  };
  apply();
  // Config (page/SettingsModal) avisa de cambios de tema y acento
  window.__cwApplyTheme = apply;
  // auto reacts live to system changes; an explicit choice
  // (light/dark) chosen in localStorage is re-applied just as consistently
  if (mq.addEventListener) mq.addEventListener('change', apply);
})();
`;

/** flag de idioma del launcher (--lang): disponible en cliente en runtime,
 * BEFORE hydration (not a build env). */
const langInit = process.env.COPILOT_WEB_LANG
  ? `window.__WEB_LANG=${JSON.stringify(process.env.COPILOT_WEB_LANG)};`
  : "";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {langInit && <script dangerouslySetInnerHTML={{ __html: langInit }} />}
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}