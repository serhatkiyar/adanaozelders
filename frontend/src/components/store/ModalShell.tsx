import type { ReactNode } from "react";

import { Modal } from "@/components/ui/Modal";

/**
 * Mağaza modallarının kabuğu — artık ortak `Modal` bileşenine delege eder.
 *
 * Eskiden kendi portal + Esc mantığını taşıyordu ama odak tuzağı yoktu:
 * modal açıkken Tab arkadaki sayfaya kaçıyordu. Ad ve imza korunuyor ki
 * çağrı yerleri değişmesin.
 */
export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal open onClose={onClose} title={title}>
      {children}
    </Modal>
  );
}
