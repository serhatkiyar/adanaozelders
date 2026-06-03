import { Helmet } from "react-helmet-async";

type Json = Record<string, unknown>;

// schema.org yapısal verisini <script type="application/ld+json"> olarak head'e
// enjekte eder. `<` kaçışıyla XSS/script-break önlenir.
export function JsonLd({ data }: { data: Json | Json[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <Helmet>
      <script type="application/ld+json">{json}</script>
    </Helmet>
  );
}
