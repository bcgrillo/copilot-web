"use client";

import { useState, type ReactNode } from "react";
import {
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { SessionSummary } from "@/lib/types";
import Logo from "@/components/Logo";
import { useT } from "@/lib/i18n";

type Props = {
  sessions: SessionSummary[];
  activeId: string | null;
  runningIds: Record<string, boolean>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  className?: string; // control de visibilidad (drawer en mobile)
  onClose?: () => void;
  footer?: ReactNode;
};

export default function Sidebar({
  sessions,
  activeId,
  runningIds,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  className = "",
  onClose,
  footer,
}: Props) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  // el servidor ya ordena por última actividad (updatedAt); nada que reordenar
  const sorted = sessions;

  function startRename(s: SessionSummary) {
    setEditingId(s.id);
    setDraft(s.name);
    setMenuId(null);
  }

  function commitRename() {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  }

  return (
    <aside
      className={`h-full w-72 shrink-0 flex-col border-r border-border bg-card/50 ${className}`}
    >
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
            <Logo className="h-5 w-5 text-white" />
          </span>
          Copilot Web
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground md:hidden"
              title={t("sidebar.close")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onCreate}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("sidebar.newSession")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {sorted.length === 0 && (
          <p className="px-3 py-6 text-xs text-muted-foreground">
            {t("sidebar.empty")}
          </p>
        )}
        {sorted.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {runningIds[s.id] ? (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}

              {editingId === s.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded-md border border-input bg-background px-1.5 py-0.5 text-sm outline-none"
                />
              ) : (
                <span className="flex-1 truncate">{s.name}</span>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId(menuId === s.id ? null : s.id);
                }}
                className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 [.group:hover_&]:opacity-100 max-md:opacity-100 ${
                  menuId === s.id
                    ? "bg-background text-foreground opacity-100"
                    : ""
                }`}
                title={t("sidebar.options")}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>

              {menuId === s.id && (
                <div
                  className="absolute right-2 top-9 z-20 w-36 rounded-lg border border-border bg-card p-1 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => startRename(s)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                  >
                    <Pencil className="h-3 w-3" /> {t("sidebar.rename")}
                  </button>
                  <button
                    onClick={() => {
                      setMenuId(null);
                      onDelete(s.id);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-muted"
                  >
                    <Trash2 className="h-3 w-3" /> {t("sidebar.delete")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {footer && (
        <div className="mt-auto border-t border-border px-3 py-2.5">{footer}</div>
      )}
    </aside>
  );
}