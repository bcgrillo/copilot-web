"use client";

import ModalShell from "@/components/ModalShell";
import AboutContent from "@/components/About";
import { useT } from "@/lib/i18n";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <ModalShell onClose={onClose} label={t("footer.helpTitle")}>
      <AboutContent onBack={onClose} />
    </ModalShell>
  );
}