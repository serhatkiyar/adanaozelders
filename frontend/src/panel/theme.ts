import type { ThemeConfig } from "antd";

/** Panelin TEK renk/ölçü kaynağı. Başka dosyada renk sabiti yazılmaz. */
export const panelTheme: ThemeConfig = {
  token: {
    colorPrimary: "#C2410C",
    borderRadius: 8,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: { siderBg: "#111827", headerBg: "#ffffff" },
    Menu: { darkItemBg: "#111827", darkItemSelectedBg: "#1f2937" },
  },
};
