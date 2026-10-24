"use client";

/** Config: idioma, modo claro/oscuro/auto, color del acento y estado/restart
 * del daemon ACP (útil en beta si el backend se queda colgado). */
import { useCallback, useEffect, useState } from "react";
import { BellRing, Moon, RotateCw, Sun, SunMoon } from "lucide-react";
import ModalShell from "@/components/ModalShell";
import { apiUrl } from "@/lib/api";
import { ACCENTS, accentColor } from "@/lib/accents";
import { syncThemeAndFavicon } from "@/lib/cw";
import {
  setLangChoice,
  getLangChoice,
  useLang,
  useT,
  type Lang,
  type LangChoice,
} from "@/lib/i18n";

type Daemon = {
  alive: boolean;
  port?: number;
  pid?: number;
  model?: string;
};

function Chip({
  active,
  onClick,
  children,
  title,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-emerald bg-emerald/10 text-emerald"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function SettingsModal({
  theme,
  setTheme,
  onClose,
}: {
  theme: "auto" | "light" | "dark";
  setTheme: (updater: (t: "auto" | "light" | "dark") => "auto" | "light" | "dark") => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();

  // notificaciones de sistema (opt-in): el permiso se pide al activar.
  // notifAvailable en state (no en render): "Notification" no existe en SSR
  const [notifAvailable, setNotifAvailable] = useState(false);
  const [notifOn, setNotifOn] = useState(false);
  useEffect(() => {
    try {
      setNotifAvailable("Notification" in window);
      setNotifOn(
        "Notification" in window &&
          Notification.permission === "granted" &&
          localStorage.getItem("cwNotify") === "1",
      );
    } catch {}
  }, []);

  const toggleNotif = useCallback(async () => {
    if (!notifAvailable) return;
    try {
      if (notifOn) {
        localStorage.removeItem("cwNotify");
        setNotifOn(false);
        return;
      }
      const p = await Notification.requestPermission();
      if (p === "granted") {
        localStorage.setItem("cwNotify", "1");
        setNotifOn(true);
      }
    } catch {}
  }, [notifAvailable, notifOn]);

  /* color del acento ("" = emerald por defecto) */
  const [accent, setAccentState] = useState("");
  useEffect(() => {
    try {
      const v = localStorage.getItem("accent");
      if (v && /^[a-z]{3,12}$/.test(v)) setAccentState(v);
    } catch {}
  }, []);
  const setAccent = (id: string) => {
    const v = id === "emerald" ? "" : id;
    setAccentState(v);
    try {
      if (v) localStorage.setItem("accent", v);
      else localStorage.removeItem("accent");
    } catch {}
    if (v) document.documentElement.dataset.accent = v;
    else delete document.documentElement.dataset.accent;
    syncThemeAndFavicon();
  };

  /* modo efectivo para la vista previa de los swatches (incluye auto) */
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const calc = () => {
      const t2 = localStorage.getItem("theme") || "auto";
      setDark(t2 === "dark" || (t2 === "auto" && m.matches));
    };
    calc();
    m.addEventListener?.("change", calc);
    return () => m.removeEventListener?.("change", calc);
  }, []);

  /* idioma: elección persistida (auto/en/es) */
  const [langChoice, setLangChoiceState] = useState<LangChoice>("auto");
  useEffect(() => setLangChoiceState(getLangChoice()), []);

  /* daemon */
  const [daemon, setDaemon] = useState<Daemon | null>(null);
  const [daemonFail, setDaemonFail] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const refreshDaemon = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/daemon"), { cache: "no-store" });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as Daemon;
      setDaemon(j);
      setDaemonFail(false);
    } catch {
      setDaemon({ alive: false });
      setDaemonFail(true);
    }
  }, []);
  useEffect(() => {
    refreshDaemon();
    const iv = setInterval(refreshDaemon, 4000);
    return () => clearInterval(iv);
  }, [refreshDaemon]);

  const restartDaemon = async () => {
    setRestarting(true);
    try {
      const r = await fetch(apiUrl("/api/daemon"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      if (!r.ok) throw new Error();
      await refreshDaemon();
    } catch {
      setDaemon({ alive: false });
      setDaemonFail(true);
    } finally {
      setRestarting(false);
    }
  };

  const langVal = (c: Lang) => (langChoice === c ? "" : lang === c ? ` (${lang})` : "");

  return (
    <ModalShell onClose={onClose} label={t("config.title")}>
      <h2 className="text-lg font-semibold">{t("config.title")}</h2>

      {/* Idioma */}
      <section className="mt-6">
        <h3 className="text-sm font-medium">{t("config.language")}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip
            active={langChoice === "auto"}
            onClick={() => {
              setLangChoice("auto");
              setLangChoiceState("auto");
            }}
          >
            {t("config.langAuto")}{langVal("en")}
          </Chip>
          <Chip
            active={langChoice === "en"}
            onClick={() => {
              setLangChoice("en");
              setLangChoiceState("en");
            }}
          >
            English
          </Chip>
          <Chip
            active={langChoice === "es"}
            onClick={() => {
              setLangChoice("es");
              setLangChoiceState("es");
            }}
          >
            Español
          </Chip>
        </div>
      </section>

      {/* Modo */}
      <section className="mt-6">
        <h3 className="text-sm font-medium">{t("config.appearance")}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip active={theme === "auto"} onClick={() => setTheme(() => "auto")}>
            <SunMoon className="h-3.5 w-3.5" />
            {t("config.modeAuto")}
          </Chip>
          <Chip active={theme === "light"} onClick={() => setTheme(() => "light")}>
            <Sun className="h-3.5 w-3.5" />
            {t("config.modeLight")}
          </Chip>
          <Chip active={theme === "dark"} onClick={() => setTheme(() => "dark")}>
            <Moon className="h-3.5 w-3.5" />
            {t("config.modeDark")}
          </Chip>
        </div>
      </section>

      {/* Color */}
      <section className="mt-6">
        <h3 className="text-sm font-medium">{t("config.color")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("config.colorHint")}</p>
        <div className="mt-3 grid w-fit grid-cols-8 gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccent(a.id)}
              title={a.id}
              className={`h-7 w-7 rounded-full transition-all ${
                accent === a.id || (a.id === "emerald" && !accent)
                  ? "ring-2 ring-emerald ring-offset-2 ring-offset-card"
                  : "hover:scale-110"
              }`}
            >
              <span
                className="block h-full w-full rounded-full"
                style={{ backgroundColor: accentColor(a.id, dark) }}
              />
            </button>
          ))}
        </div>
      </section>

      {/* Notificaciones de sistema */}
      <section className="mt-6">
        <h3 className="text-sm font-medium">{t("config.notif")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("config.notifHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={notifOn} onClick={toggleNotif} disabled={!notifAvailable}>
            <BellRing className="h-3.5 w-3.5" />
            {notifOn ? t("config.notifOn") : t("config.notifOff")}
          </Chip>
        </div>
      </section>

      {/* Daemon */}
      <section className="mt-6">
        <h3 className="text-sm font-medium">{t("config.backend")}</h3>
        <div className="mt-2 rounded-xl border border-border px-3 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                restarting
                  ? "animate-pulse bg-amber-500"
                  : daemon?.alive
                    ? "bg-emerald"
                    : "bg-red-500"
              }`}
            />
            <span className="font-medium">
              {restarting
                ? t("config.restartBusy")
                : daemonFail && daemon?.alive === false
                  ? t("config.failed")
                  : daemon?.alive
                    ? t("config.daemonRunning")
                    : t("config.daemonStopped")}
            </span>
            {daemon?.alive && daemon.pid != null && (
              <span className="text-xs text-muted-foreground">
                · {t("config.daemonPid")} {daemon.pid}
              </span>
            )}
            {daemon?.alive && daemon.port != null && (
              <span className="text-xs text-muted-foreground">
                · {t("config.daemonPort")} {daemon.port}
              </span>
            )}
            {daemon?.alive && daemon.model && (
              <span className="truncate text-xs text-muted-foreground">
                · {t("config.daemonModel")} {daemon.model}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              onClick={restartDaemon}
              disabled={restarting}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald px-3 py-1.5 text-sm font-medium text-emerald transition-colors hover:bg-emerald/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCw className={`h-3.5 w-3.5 ${restarting ? "animate-spin" : ""}`} />
              {restarting ? t("config.restartBusy") : t("config.restart")}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("config.restartWarn")}</p>
        </div>
      </section>
    </ModalShell>
  );
}