// Kategori ekleme/düzenleme çekmecesi — eski CategoriesPanel'in ekleme satırı ve
// satır içi KDV düzenlemesinin AntD karşılığı; aynı uçlar (createCategory/updateCategory).
// Ayrı dosya: pencere durumu listeyle aynı dosyada yaşasaydı uiBaseline::modalDurumu kırılırdı.
import { useState } from "react";
import { Alert, App, Flex, Form, Input, Select } from "antd";
import { useMutation } from "@tanstack/react-query";
import { YanPencere } from "@/panel/components/YanPencere";
import { createCategory, updateCategory } from "@/api/store";
import { useCategories, useInvalidateAdminStore } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { orandanYuzde, yuzdedenOran } from "@/lib/tax";
import type { ProductCategory, ProductCategoryWrite } from "@/types";

type Degerler = { ad: string; ust?: number; kdv: string };

// Sunucu 422 alanı → form alanı.
const SUNUCU_ALANI: Record<string, keyof Degerler> = { name: "ad", parent_id: "ust", default_tax_rate: "kdv" };

// 422 alan hatalarını ilgili alana dağıtır; eşleşmeyenleri genel mesaj olarak döndürür.
function sunucuHatasiniDagit(e: unknown, varsayilan: string, alanaYaz: (alan: keyof Degerler, mesaj: string) => void): string | null {
  const yanit = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) return getErrorDetail(e, varsayilan);
  const kalanlar: string[] = [];
  let alanaYazildi = 0;
  for (const oge of detay as { loc?: unknown; msg?: unknown }[]) {
    const mesaj = typeof oge?.msg === "string" && oge.msg.trim() ? oge.msg : "Bu alan geçersiz.";
    const parcalar = Array.isArray(oge?.loc) ? oge.loc.filter((p): p is string => typeof p === "string") : [];
    const ham = parcalar.filter((p) => !["body", "query", "path", "header", "cookie"].includes(p)).at(-1);
    const alan = ham ? SUNUCU_ALANI[ham] : undefined;
    if (alan) {
      alanaYaz(alan, mesaj);
      alanaYazildi += 1;
    } else kalanlar.push(mesaj);
  }
  if (!kalanlar.length) return alanaYazildi ? null : "Gönderilen bilgi geçersiz.";
  return kalanlar.join(" ");
}

/** Kategorinin kendisi ve alt ağacı üst kategori olarak seçilemez (döngü). */
function altAgac(kok: number, kategoriler: ProductCategory[]): Set<number> {
  const sonuc = new Set<number>([kok]);
  let buyudu = true;
  while (buyudu) {
    buyudu = false;
    for (const k of kategoriler) {
      if (k.parent_id && sonuc.has(k.parent_id) && !sonuc.has(k.id)) {
        sonuc.add(k.id);
        buyudu = true;
      }
    }
  }
  return sonuc;
}

export function KategoriCekmecesi({
  acik = false,
  kapat,
  kategori,
}: {
  acik?: boolean;
  kapat?: () => void;
  /** Verilirse düzenleme, verilmezse yeni kategori. */
  kategori?: ProductCategory | null;
}) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<Degerler>();
  const yenile = useInvalidateAdminStore();
  const kategoriler = useCategories();
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);

  const kaydet = useMutation({
    mutationFn: (gonderi: ProductCategoryWrite) =>
      kategori ? updateCategory(kategori.id, gonderi) : createCategory(gonderi),
  });

  const kapatVeSifirla = () => {
    form.resetFields();
    setSunucuHatasi(null);
    kapat?.();
  };

  // Kirli koruma: form değişmemişse doğrudan kapanır; değişmişse onay ister.
  const kapatIstegi = () => {
    if (!form.isFieldsTouched()) return kapatVeSifirla();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız girdikleriniz silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: kapatVeSifirla,
    });
  };

  // İlk hatalı alan görünür olsun: kaydır + odakla (çekmece odak kilidinden sonra).
  const odakla = (alan?: keyof Degerler) => {
    if (!alan) return;
    setTimeout(() => {
      try {
        form.scrollToField(alan, { block: "center" });
        form.getFieldInstance(alan)?.focus?.();
      } catch {
        /* jsdom/kapalı alan */
      }
    }, 0);
  };

  // Gönder düğmesi geçerlilikle kapanmaz; eksik/hatalı alan formda gösterilir.
  const gonder = async () => {
    let d: Degerler;
    try {
      d = await form.validateFields();
    } catch (hata) {
      const ilk = (hata as { errorFields?: { name: (string | number)[] }[] })?.errorFields?.[0]?.name?.[0];
      odakla(typeof ilk === "string" ? (ilk as keyof Degerler) : undefined);
      return;
    }
    setSunucuHatasi(null);
    const kdv = d.kdv?.trim();
    const gonderi: ProductCategoryWrite = {
      name: d.ad.trim(),
      parent_id: d.ust ?? null,
      // Boş bırakmak varsayılanı TEMİZLER (üst kategoriden devralınır).
      default_tax_rate: kdv ? yuzdedenOran(kdv).oran : null,
      ...(kategori ? {} : { is_active: true }),
    };
    kaydet.mutate(gonderi, {
      onSuccess: () => {
        message.success(kategori ? "Kategori güncellendi." : "Kategori eklendi.");
        yenile();
        kapatVeSifirla();
      },
      // Sunucu hatasında pencere açık kalır, girdiler korunur.
      onError: (e) => {
        let ilk: keyof Degerler | null = null;
        const genel = sunucuHatasiniDagit(e, kategori ? "Kategori güncellenemedi." : "Kategori eklenemedi.", (alan, mesaj) => {
          form.setFields([{ name: alan, errors: [mesaj] }]);
          ilk ??= alan;
        });
        setSunucuHatasi(genel);
        if (ilk) odakla(ilk);
      },
    });
  };

  const yasak = kategori ? altAgac(kategori.id, kategoriler.data ?? []) : new Set<number>();
  const ustSecenekleri = (kategoriler.data ?? [])
    .filter((k) => k.is_active && !yasak.has(k.id))
    .map((k) => ({ value: k.id, label: `${k.parent_id ? "↳ " : ""}${k.name}` }));

  return (
    <YanPencere
      acik={acik}
      baslik={kategori ? "Kategoriyi düzenle" : "Yeni kategori"}
      kapat={kapatIstegi}
      kaydet={() => void gonder()}
      kaydediyor={kaydet.isPending}
    >
      <Flex vertical gap={16}>
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <Form
          key={kategori?.id ?? "yeni"}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{
            ad: kategori?.name ?? "",
            ust: kategori?.parent_id ?? undefined,
            kdv: orandanYuzde(kategori?.default_tax_rate),
          }}
        >
          <Form.Item name="ad" label="Kategori adı" rules={[{ required: true, whitespace: true, message: "Kategori adı zorunlu." }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="ust" label="Üst kategori">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Ana kategori"
              loading={kategoriler.isPending}
              options={ustSecenekleri}
            />
          </Form.Item>
          <Form.Item
            name="kdv"
            label="Varsayılan KDV (%)"
            extra="Boş bırakılırsa üst kategorinin oranı devralınır."
            rules={[
              {
                validator: (_, v: string) => {
                  if (!v?.trim()) return Promise.resolve();
                  const oran = yuzdedenOran(v);
                  return oran.ok ? Promise.resolve() : Promise.reject(new Error(oran.hata ?? "KDV oranı geçersiz"));
                },
              },
            ]}
          >
            <Input inputMode="decimal" suffix="%" style={{ maxWidth: 160 }} />
          </Form.Item>
        </Form>
      </Flex>
    </YanPencere>
  );
}
