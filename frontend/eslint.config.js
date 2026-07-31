import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Amaç: ERİŞİLEBİLİRLİK REGRESYONUNU önlemek — genel stil denetimi değil.
 *
 * Kod tabanında 178 `<label>` vardı ve `htmlFor` kullanımı SIFIRDI; yani her
 * form alanı görsel olarak etiketliyken ekran okuyucu için adsızdı. Bu tür
 * hatalar gözle fark edilmez, ancak bir kural onları yakalar.
 *
 * Kural seti bilinçli olarak DAR (ruff.toml'daki backend yaklaşımıyla aynı
 * gerekçe): tüm önerilen setler bu kod tabanında yüzlerce uyarı üretir ve
 * sürekli kırmızı bir CI kimsenin okumadığı bir gürültüye dönüşür. Aşağıdaki
 * kurallar gerçek kullanılabilirlik hatalarını tutar.
 *
 * Kural eklerken mevcut ihlalleri de temizleyin.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "*.config.js", "*.config.ts"],
  },
  {
    // react-hooks kuralları bilinçli olarak kapalı; koddaki mevcut
    // `eslint-disable react-hooks/…` yorumları "kullanılmıyor" diye
    // raporlanmasın (plugin ileride açılırsa yine gerekli olacaklar).
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    // react-hooks yalnız KAYITLI olsun diye eklenir: kod tabanında
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` yorumları var;
    // plugin tanımlı değilken ESLint bunları "bilinmeyen kural" hatası sayıyordu.
    // Kuralların kendisi kapalı — bu yapılandırmanın amacı a11y.
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
      // Yalnız a11y kuralları açık; JS/TS stil kuralları tsc'ye bırakılır.
      ...Object.fromEntries(
        Object.keys(js.configs.recommended.rules ?? {}).map((rule) => [rule, "off"])
      ),

      // Her form alanının erişilebilir bir adı olmalı (htmlFor / sarmalayan
      // label / aria-label). Bu kod tabanındaki asıl boşluk buydu.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { assert: "either", depth: 3 },
      ],
      // Görsellerin alt metni; dekoratifse alt="" yeterlidir.
      "jsx-a11y/alt-text": "error",
      // Yazım hatalı/uydurma ARIA nitelikleri sessizce hiçbir şey yapmaz.
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      // Tıklanabilir <div> klavyeye kapalıdır; buton kullanılmalı.
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      // Otomatik odak, ekran okuyucu kullanıcısını bağlamdan koparır.
      "jsx-a11y/no-autofocus": "warn",
    },
  }
);
