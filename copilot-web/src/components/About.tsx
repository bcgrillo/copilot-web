"use client";

/** Contenido de About, compartido entre el popup (footer) y la ruta /about. */
import { CircleAlert, CircleHelp, ExternalLink, Github } from "lucide-react";
import pkg from "../../package.json";
import Logo from "@/components/Logo";
import { BASE } from "@/lib/api";
import { useT } from "@/lib/i18n";

const REPO = "https://github.com/bcgrillo/copilot-web";

export default function AboutContent({ onBack }: { onBack?: () => void }) {
  const t = useT();
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        {/* PRUEBA de logo (reversible): sin badge, logo directo al color de tema */}
        <Logo className="h-12 w-12 text-emerald" />
        <div>
          <h1 className="text-lg font-semibold">Copilot Web</h1>
          <p className="text-xs text-muted-foreground">
            v{pkg.version} · GPL-3.0
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t("about.line")}</p>

      {/* standard disclaimer for unofficial projects */}
      <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
        <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-xs text-muted-foreground">{t("about.disclaimer")}</p>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          <Github className="h-4 w-4" />
          <span className="flex-1">{t("about.repo")}</span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
        <a
          href={`${REPO}/issues/new/choose`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          <CircleHelp className="h-4 w-4" />
          <span className="flex-1">{t("about.issues")}</span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
      </div>

      {onBack ? (
        <button
          onClick={onBack}
          className="mt-5 block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← {t("about.back")}
        </button>
      ) : (
        <a
          href={`${BASE}/`}
          className="mt-5 block text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← {t("about.back")}
        </a>
      )}
    </>
  );
}