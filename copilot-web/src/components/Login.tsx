"use client";

/** Login screen (authentication ON). Mirrors the About card styling. */
import { useState } from "react";
import { LogIn } from "lucide-react";
import Logo from "@/components/Logo";
import pkg from "../../package.json";
import { apiUrl } from "@/lib/api";
import { saveTokens } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: user.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(
          res.status === 401
            ? t("login.error")
            : (d.error as string) || t("login.netError")
        );
        return;
      }
      const p = await res.json();
      if (typeof p?.access !== "string" || typeof p?.refresh !== "string") {
        setError(t("login.netError"));
        return;
      }
      saveTokens(p.access, p.refresh);
      onDone(); // reload: the shell re-probe with the fresh tokens
    } catch {
      setError(t("login.netError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 p-4">
      {/* brand OUTSIDE the card */}
      <div className="flex flex-col items-center gap-2">
        <Logo className="h-14 w-14 text-emerald" />
        <h1 className="text-2xl font-bold tracking-tight">{t("login.brand")}</h1>
      </div>
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg"
      >
        {/* title + instruction INSIDE the card */}
        <h2 className="text-lg font-bold">{t("login.title")}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t("login.hint")} {t("login.signup")}{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.72rem] text-foreground/80">
            copilot-web --help
          </code>{" "}
          {t("login.signupTail")}
        </p>
        <div className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cw-login-user" className="text-sm font-semibold">
              {t("login.user")}
            </label>
            <input
              id="cw-login-user"
              name="username"
              autoFocus
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cw-login-password" className="text-sm font-semibold">
              {t("login.password")}
            </label>
            <input
              id="cw-login-password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !user.trim() || !password}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>{busy ? t("login.busy") : t("login.submit")}</span>
          </button>
        </div>
      </form>
      {/* subtle version BELOW the card */}
      <p className="text-xs text-muted-foreground/60">v{pkg.version}</p>
    </div>
  );
}