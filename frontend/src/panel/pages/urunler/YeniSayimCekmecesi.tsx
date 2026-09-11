// Yeni sayım oturumu çekmecesi — eski CountSessionsPage "Yeni sayım" penceresinin
// AntD karşılığı; aynı uç (useCreateCountSession) ve aynı doğrulama kuralları.
// Ayrı dosya: pencere durumu listeyle aynı dosyada yaşasaydı uiBaseline::modalDurumu kırılırdı.
import { useState } from "react";
import { Alert, App, Flex, Form, Input, Select } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { useCreateCountSession } from "@/hooks/useInventory";
import { useAdminProducts, useCategories } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
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
  const [urunArama, setUrunArama] = useState("");
  const gecikmisArama = useDebounce(urunArama);
  const scope = Form.useWatch("scope", form) ?? "MANUAL";
  const kategoriler = useCategories();
  // Ürün adayları yalnız arama yazılınca çekilir (eski ProductPicker ile aynı).
  const urunler = useAdminProducts({ q: gecikmisArama, limit: 20 }, gecikmisArama.length > 0);

  const kapatVeSifirla = () => {
    form.resetFields();
    setSunucuHatasi(null);
    setUrunArama("");
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
              <Select
                mode="multiple"
                showSearch
                filterOption={false}
                placeholder="Başlık, yazar, yayınevi, ISBN veya SKU"
                searchValue={urunArama}
                onSearch={setUrunArama}
                loading={urunler.isFetching}
                notFoundContent={gecikmisArama ? "Eşleşen ürün yok" : "Aramak için yazın"}
                options={(urunler.data?.items ?? []).map((u) => ({ value: u.id, label: u.title }))}
                optionLabelProp="label"
              />
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
