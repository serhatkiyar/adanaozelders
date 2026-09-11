import { App, ConfigProvider } from "antd";
import trTR from "antd/locale/tr_TR";
import { StyleProvider } from "@ant-design/cssinjs";
import type { ReactNode } from "react";
import { panelTheme } from "@/panel/theme";

/**
 * Panelin kökü. `hashPriority="high"` AntD stillerinin Tailwind
 * preflight'ına yenilmemesi için gereklidir (spec §6).
 *
 * En içte AntD `App` bileşeni: statik `message`/`notification`/`Modal`
 * API'leri tema/locale context'ini ALMAZ ve konsola uyarı basar — modüller
 * bunun yerine `App.useApp()` ile context'e bağlı örneği kullanmalı.
 */
export function PanelProvider({ children }: { children: ReactNode }) {
  return (
    <StyleProvider hashPriority="high">
      <ConfigProvider locale={trTR} theme={panelTheme}>
        <App>{children}</App>
      </ConfigProvider>
    </StyleProvider>
  );
}
