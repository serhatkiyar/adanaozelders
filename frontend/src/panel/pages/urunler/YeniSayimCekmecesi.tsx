// Yeni sayım oturumu çekmecesi — eski CountSessionsPage "Yeni sayım" penceresinin
// AntD karşılığı; aynı uç (useCreateCountSession) ve aynı doğrulama kuralları.
// Ayrı dosya: pencere durumu listeyle aynı dosyada yaşasaydı uiBaseline::modalDurumu kırılırdı.
import { useState } from "react";
import { Alert, App, Flex, Form, Input, Select } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { useCreateCountSession } from "@/hooks/useInventory";
import { useCategories } from "@/hooks/useStore";
import { UrunSecici } from "@/panel/pages/urunler/UrunSecici";
import { inventoryErrorMessage, type CountScope } from "@/lib/inventory";

const KAPSAM_SECENEKLERI: { value: CountScope; label: string }[] = [
  { value: "MANUAL", label: "Seçili ürünler" },
  { value: "CATEGORY", label: "Kategori" },
  { value: "ALL", label: "Tüm ürünler" },
];

type Degerler = { scope: CountScope; urunler: number[]; kategori?: number; not: string };

export function YeniSayimCekmecesi({ acik, kapat }: { acik: boolean; kapat: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Degerler>();
  const olustur = useCreateCountSession();
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const scope = Form.useWatch("scope", form) ?? "MANUAL";
  const kategoriler = useCategories();

  const kapatVeSifirla = () => {
    form.resetFields();
    setSunucuHatasi(null);
    kapat();
  };

  // Gönder düğmesi geçerlilikle kapanmaz; eksik alan formda gösterilir.
  const gonder = async () => {
    let d: Degerler;
    try {
      d = await form.validateFields();
    } catch {
      return;
    }
    setSunucuHatasi(null);
    olustur.mutate(
      {
        scope: d.scope,
        product_ids: d.scope === "MANUAL" ? d.urunler : undefined,
        category_id: d.scope === "CATEGORY" ? d.kategori : undefined,
        note: d.not?.trim() || null,
      },
      {
        onSuccess: () => {
          message.success("Sayım oturumu açıldı.");
          kapatVeSifirla();
        },
        onError: (e) => setSunucuHatasi(inventoryErrorMessage(e, "Sayım oturumu açılamadı.")),
      },
    );
  };

  return (
    <YanPencere
      acik={acik}
      baslik="Yeni sayım oturumu"
      kapat={kapatVeSifirla}
      kaydet={() => void gonder()}
      kaydediyor={olustur.isPending}
      kaydetMetni="Oturumu aç"
    >
      <Flex vertical gap={16}>
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <Form form={form} layout="vertical" initialValues={{ scope: "MANUAL", urunler: [], not: "" }} requiredMark={false}>
          <Form.Item name="scope" label="Kapsam" extra="Oturum taslak olarak açılır; sayıma başlamadan ürün ekleyebilirsiniz.">
            <Select options={KAPSAM_SECENEKLERI} />
          </Form.Item>
          {scope === "MANUAL" ? (
            <Form.Item
              name="urunler"
              label="Ürünler"
              rules={[{ validator: (_, v: number[]) => (v?.length ? Promise.resolve() : Promise.reject(new Error("En az bir ürün seçin."))) }]}
            >
              {/* Her açılışta yeniden mount: arama metni önceki açılıştan kalmaz. */}
              <UrunSecici key={acik ? "acik" : "kapali"} />
            </Form.Item>
          ) : null}
          {scope === "CATEGORY" ? (
            <Form.Item name="kategori" label="Kategori" rules={[{ required: true, message: "Bir kategori seçin." }]}>
              <Select
                showSearch
                optionFilterProp="label"
                loading={kategoriler.isPending}
                placeholder="Kategori seçin"
                options={(kategoriler.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="not" label="Not (isteğe bağlı)" rules={[{ max: 500, message: "Not en fazla 500 karakter olabilir." }]}>
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Flex>
    </YanPencere>
  );
}
