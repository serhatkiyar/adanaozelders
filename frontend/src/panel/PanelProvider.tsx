import { ConfigProvider } from "antd";
import trTR from "antd/locale/tr_TR";
import { StyleProvider } from "@ant-design/cssinjs";
import type { ReactNode } from "react";
import { panelTheme } from "@/panel/theme";

/**
 * Panelin kökü. `hashPriority="high"` AntD stillerinin Tailwind
 * preflight'ına yenilmemesi için gereklidir (spec §6).
 */
export function PanelProvider({ children }: { children: ReactNode }) {
  return (
    <StyleProvider hashPriority="high">
      <ConfigProvider locale={trTR} theme={panelTheme}>
        {children}
      </ConfigProvider>
    </StyleProvider>
  );
}
