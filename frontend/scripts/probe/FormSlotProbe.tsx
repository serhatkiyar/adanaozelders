/**
 * İP-A2 · Tek slot piksel sondası (gerçek tarayıcı için).
 *
 * jsdom düzen hesaplamaz: `offsetHeight` her zaman 0'dır, dolayısıyla
 * "yerleşim zıplamıyor" iddiası Vitest'te KANITLANAMAZ (form.test.tsx → M5
 * yalnız mekanizmayı doğrular). Bu sayfa gerçek Chrome'da açılır ve alanın
 * kabının yüksekliği hint → hata geçişinde ölçülür.
 *
 * Yalnız ölçüm içindir; hiçbir route'a bağlı değildir ve üretim paketine
 * girmez (`form-probe.html` ayrı bir Vite girişidir).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Form } from "@/components/admin/ui2/form";
import "@/index.css";

const sema = z.object({ ad: z.string().min(1, "Ad zorunlu.") });

function Sonda() {
  const form = useForm<z.infer<typeof sema>>({
    resolver: zodResolver(sema),
    defaultValues: { ad: "" },
    mode: "onChange",
  });
  return (
    <div style={{ width: 480, padding: 24 }}>
      <div id="olculen">
        <Form.Field
          control={form.control}
          name="ad"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Ad</Form.Label>
              <Form.Control>
                <input id="giris" className="input" {...field} />
              </Form.Control>
              <Form.Hint>Kimliğinizdeki ad.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>
      <p id="alt-komsu">Bu satırın Y konumu kaymamalı.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Sonda />);
