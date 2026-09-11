import type { ThemeConfig } from "antd";

/** Sider/Menu koyu zemini — panel genelinde bu sabit üzerinden kullanılır. */
export const PANEL_SIDER_BG = "#111827";

/** Panelin TEK renk/ölçü kaynağı. Başka dosyada renk sabiti yazılmaz. */
export const panelTheme: ThemeConfig = {
  token: {
    colorPrimary: "#C2410C",
    borderRadius: 8,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: { siderBg: PANEL_SIDER_BG, headerBg: "#ffffff" },
    Menu: { darkItemBg: PANEL_SIDER_BG, darkItemSelectedBg: "#1f2937" },
  },
};
