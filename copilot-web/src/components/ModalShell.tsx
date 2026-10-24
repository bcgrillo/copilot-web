"use client";

/** Base del modal (About / Config): backdrop translúcido según tema (claro →
 * velo claro, oscuro → velo oscuro) sobre el chat. Cierre con Esc o backdrop. */
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function ModalShell({
  onClose,
  children,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/80 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={label}
        className="relative w-full overflow-y-auto border-0 bg-card p-5 sm:max-h-[85dvh] sm:max-w-lg sm:rounded-2xl sm:border sm:border-border sm:p-8 sm:shadow-lg"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("sidebar.close")}
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}