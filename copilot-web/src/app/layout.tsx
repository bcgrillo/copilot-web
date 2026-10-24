import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copilot Web · Beta",
  description: "Interfaz web para GitHub Copilot CLI",
};

/** el idioma llega por env en runtime (--lang del launcher) → sin prerender estático */
export const dynamic = "force-dynamic";

/** móvil: 100% del alto real (barra de dirección aparece/desaparece) y
 * viewport que encoge con el teclado (el composer nunca queda tapado). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

const themeInit = `
(function(){
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var apply = function(){
    var t = 'auto';
    try { t = localStorage.getItem('theme') || 'auto'; } catch(e){}
    document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'auto' && mq.matches));
  };
  apply();
  // auto reacciona en vivo a cambios del sistema; una elección explícita
  // (light/dark) persistida en localStorage se re-aplica igual de consistente
  if (mq.addEventListener) mq.addEventListener('change', apply);
})();
`;

/** flag de idioma del launcher (--lang): disponible en cliente en runtime,
 * ANTES de la hidratación (no es env de build). */
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