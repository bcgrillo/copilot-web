"use client";

import AboutContent from "@/components/About";
import { LangProvider } from "@/lib/i18n";

export default function AboutPage() {
  return (
    <LangProvider>
      <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-lg">
          <AboutContent />
        </div>
      </div>
    </LangProvider>
  );
}
