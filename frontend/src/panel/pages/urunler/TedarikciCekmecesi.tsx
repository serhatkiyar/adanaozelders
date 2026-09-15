// Tedarikçi ekranının çekmeceleri: ayarlar, ürüne bağlama, bağ çözme.
// Açık/kapalı durumu TedarikciListesi'nde yaşar; gövdeler burada (uiBaseline::modalDurumu).
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Form, Input, InputNumber, Select, Switch, Typography, theme } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { useLinkSupplierProduct, useUnlinkSupplierProduct, useUpdateSupplier } from "@/hooks/useSuppliers";
import { useAdminProducts } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorDetail } from "@/lib/errors";
import type { SupplierOut, SupplierProductOut, SupplierSettingsIn } from "@/types/supplier";

// Sunucudaki alt/üst sınırlar (`models/supplier.py`).
const ENAZ_STOK_SANIYE = 30;
const ENAZ_FIYAT_SAAT = 1;
const TOKEN_ENUZUN = 4000;
const GEREKCE_ENUZUN = 500;

const gerekceKurali = [
  { validator: (_: unknown, v: string) => (v?.trim().length >= 3 ? Promise.resolve() : Promise.reject(new Error("Gerekçe en az 3 karakter olmalı."))) },
  { max: GEREKCE_ENUZUN, message: `En fazla ${GEREKCE_ENUZUN} karakter yazılabilir.` },
];

// 422 alan hatalarını ilgili alana dağıtır; eşleşmeyenleri genel mesaj olarak döndürür.
function sunucuHatasiniDagit<A extends string>(e: unknown, varsayilan: string, alanlar: Record<string, A>, alanaYaz: (alan: A, mesaj: string) => void): string | null {
  const yanit = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) return getErrorDetail(e, varsayilan);
  const kalanlar: string[] = [];
  let alanaYazildi = 0;
  for (const oge of detay as { loc?: unknown; msg?: unknown }[]) {
    const mesaj = typeof oge?.msg === "string" && oge.msg.trim() ? oge.msg : "Bu alan geçersiz.";
    const parcalar = Array.isArray(oge?.loc) ? oge.loc.filter((p): p is string => typeof p === "string") : [];
    const ham = parcalar.filter((p) => !["body", "query", "path", "header", "cookie"].includes(p)).at(-1);
    // Yalnız kendi anahtarları: "constructor" gibi miras adlar alan sayılmaz.
    const alan = ham && Object.prototype.hasOwnProperty.call(alanlar, ham) ? alanlar[ham] : undefined;
    if (alan) {
      alanaYaz(alan, mesaj);
      alanaYazildi += 1;
    } else kalanlar.push(mesaj);
  }
  if (!kalanlar.length) return alanaYazildi ? null : "Gönderilen bilgi geçersiz.";
  return kalanlar.join(" ");
}

// İlk hatalı alan görünür olsun: kaydır + odakla (çekmece odak kilidinden sonra).
function odakla(form: { scrollToField: (a: string, o?: object) => void; getFieldInstance: (a: string) => { focus?: () => void } | undefined }, alan?: string) {
  if (!alan) return;
  setTimeout(() => {
    try {
      form.scrollToField(alan, { block: "center" });
      form.getFieldInstance(alan)?.focus?.();
    } catch {
      /* jsdom/kapalı alan */
    }
  }, 0);
}

const ilkHataliAlan = (hata: unknown) => {
  const ilk = (hata as { errorFields?: { name: (string | number)[] }[] })?.errorFields?.[0]?.name?.[0];
  return typeof ilk === "string" ? ilk : undefined;
};

type AyarDegerleri = { aktif: boolean; stokSaniye: number; fiyatSaat: number; token: string; gerekce: string };
const AYAR_SUNUCU_ALANI: Record<string, keyof AyarDegerleri> = {
  is_enabled: "aktif",
  stock_interval_seconds: "stokSaniye",
  price_interval_seconds: "fiyatSaat",
  api_token: "token",
  reason: "gerekce",
};

function baslangic(t: SupplierOut): AyarDegerleri {
  // Token ASLA ön-doldurulmaz; gerekçe her kayıtta yeniden yazılır.
  return { aktif: t.is_enabled, stokSaniye: t.stock_interval_seconds, fiyatSaat: t.price_interval_seconds / 3600, token: "", gerekce: "" };
}

export function AyarlarCekmecesi({ acik, kapat, tedarikci }: { acik?: boolean; kapat?: () => void; tedarikci?: SupplierOut }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<AyarDegerleri>();
  const guncelle = useUpdateSupplier(tedarikci?.id);
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const gonderiliyorRef = useRef(false);
  const acikMi = Boolean(acik && tedarikci);
  // Arka plan refetch'i açık formu ezmez (setFieldsValue yok); kapanınca form sıfırlanır.
  const ilk = tedarikci ? baslangic(tedarikci) : undefined;

  // Açılış/kapanışta taze form; açıkken arka plan refetch'i forma dokunmaz.
  useEffect(() => {
    form.resetFields();
    setSunucuHatasi(null);
  }, [acikMi, form]);

  const kapatIstegi = () => {
    if (guncelle.isPending) return;
    if (!form.isFieldsTouched()) return kapat?.();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız girdikleriniz silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: () => kapat?.(),
    });
  };

  // Kısmi PATCH: yalnız dokunulan VE değişen alan gider; boş token hiç gönderilmez.
  const gonder = async () => {
    if (gonderiliyorRef.current || guncelle.isPending || !ilk) return;
    gonderiliyorRef.current = true;
    let d: AyarDegerleri;
    try {
      d = await form.validateFields();
    } catch (hata) {
      gonderiliyorRef.current = false;
      odakla(form, ilkHataliAlan(hata));
      return;
    }
    const govde: SupplierSettingsIn = { reason: d.gerekce.trim() };
    if (form.isFieldTouched("aktif") && d.aktif !== ilk.aktif) govde.is_enabled = d.aktif;
    if (form.isFieldTouched("stokSaniye") && d.stokSaniye !== ilk.stokSaniye) govde.stock_interval_seconds = d.stokSaniye;
    if (form.isFieldTouched("fiyatSaat") && d.fiyatSaat !== ilk.fiyatSaat) govde.price_interval_seconds = Math.round(d.fiyatSaat * 3600);
    if (d.token?.trim()) govde.api_token = d.token;
    setSunucuHatasi(null);
    guncelle.mutate(govde, {
      onSuccess: () => {
        message.success("Tedarikçi ayarları güncellendi.");
        kapat?.();
      },
      onError: (e) => {
        let ilkAlan: keyof AyarDegerleri | null = null;
        const genel = sunucuHatasiniDagit(e, "Ayarlar kaydedilemedi.", AYAR_SUNUCU_ALANI, (alan, mesaj) => {
          form.setFields([{ name: alan, errors: [mesaj] }]);
          ilkAlan ??= alan;
        });
        setSunucuHatasi(genel);
        if (ilkAlan) odakla(form, ilkAlan);
      },
      onSettled: () => {
        gonderiliyorRef.current = false;
      },
    });
  };

  return (
    <YanPencere acik={acikMi} baslik="Tedarikçi ayarları" kapat={kapatIstegi} kaydet={() => void gonder()} kaydediyor={guncelle.isPending}>
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Sıklıklar veritabanında yaşar; değişiklik yeniden başlatma istemez ve gerekçesiyle birlikte denetim kaydına yazılır.
        </Typography.Paragraph>
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <Form key={tedarikci?.id ?? "kapali"} form={form} layout="vertical" requiredMark={false} initialValues={ilk}>
          <Form.Item name="aktif" label="Senkron açık" valuePropName="checked" extra="Kapatıldığında döngü durur; tedarikçi stoğu vitrinde sayılmaz.">
            <Switch />
          </Form.Item>
          <Form.Item
            name="stokSaniye"
            label="Stok senkron aralığı (saniye)"
            extra={`En az ${ENAZ_STOK_SANIYE} saniye. Varsayılan 60.`}
            rules={[
              { required: true, message: "Saniye cinsinden bir tam sayı yazın." },
              { type: "integer", message: "Saniye cinsinden bir tam sayı yazın." },
              { type: "number", min: ENAZ_STOK_SANIYE, message: `Stok aralığı en az ${ENAZ_STOK_SANIYE} saniye olabilir.` },
              { type: "number", max: 86_400, message: "Stok aralığı en fazla 24 saat olabilir." },
            ]}
          >
            <InputNumber style={{ width: "100%" }} controls={false} />
          </Form.Item>
          <Form.Item
            name="fiyatSaat"
            label="Fiyat senkron aralığı (saat)"
            extra={`En az ${ENAZ_FIYAT_SAAT} saat. Varsayılan 6.`}
            rules={[
              { required: true, message: "Saat cinsinden bir sayı yazın." },
              { type: "number", min: ENAZ_FIYAT_SAAT, message: `Fiyat aralığı en az ${ENAZ_FIYAT_SAAT} saat olabilir.` },
              { type: "number", max: 168, message: "Fiyat aralığı en fazla 7 gün olabilir." },
            ]}
          >
            <InputNumber style={{ width: "100%" }} step={0.5} controls={false} />
          </Form.Item>
          <Form.Item
            name="token"
            label="API token (isteğe bağlı)"
            extra="Mevcut token güvenlik gereği burada gösterilmez. Boş bırakırsanız değişmez; yeni bir token yapıştırdığınızda eskisinin yerini alır."
            rules={[{ max: TOKEN_ENUZUN, message: "Token çok uzun." }]}
          >
            <Input.TextArea rows={3} maxLength={TOKEN_ENUZUN} spellCheck={false} autoComplete="off" placeholder="Yalnız değiştirecekseniz yapıştırın" style={{ fontFamily: "monospace", fontSize: 12 }} />
          </Form.Item>
          <Form.Item name="gerekce" label="Gerekçe" extra="Denetim kaydına yazılır; en az 3 karakter." rules={gerekceKurali}>
            <Input maxLength={GEREKCE_ENUZUN} placeholder="Ör. origin 502 veriyordu, aralık gevşetildi" />
          </Form.Item>
        </Form>
      </Flex>
    </YanPencere>
  );
}

type BaglaDegerleri = { urunId?: number; gerekce: string };
const BAGLA_SUNUCU_ALANI: Record<string, keyof BaglaDegerleri> = { product_id: "urunId", reason: "gerekce" };

// Tek ürün seçici: adaylar yalnız arama yazılınca çekilir (UrunSecici ile aynı kaynak).
function TekUrunSecici({ value, onChange }: { value?: number; onChange?: (v?: number) => void }) {
  const [arama, setArama] = useState("");
  const gecikmis = useDebounce(arama);
  const urunler = useAdminProducts({ q: gecikmis, limit: 20 }, gecikmis.length > 0);
  return (
    <Select<number>
      showSearch
      allowClear
      filterOption={false}
      aria-label="Bağlanacak ürün"
      placeholder="Başlık, yazar, yayınevi, ISBN veya SKU"
      searchValue={arama}
      onSearch={setArama}
      loading={urunler.isFetching}
      notFoundContent={gecikmis ? "Eşleşen ürün yok" : "Aramak için yazın"}
      options={(urunler.data?.items ?? []).map((u) => ({ value: u.id, label: u.sku ? `${u.title} · ${u.sku}` : u.title }))}
      value={value}
      onChange={onChange}
      style={{ width: "100%" }}
    />
  );
}

type SatirPencereProps = {
  acik?: boolean;
  kapat?: () => void;
  /** Ekranda seçili tedarikçi. */
  supplierId?: number;
  satir?: SupplierProductOut | null;
  /** Satırın seçildiği tedarikçi; ekrandakiyle uyuşmazsa gönderim yapılmaz. */
  satirSupplierId?: number;
};

export function BaglamaCekmecesi({ acik, kapat, supplierId, satir, satirSupplierId }: SatirPencereProps) {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm<BaglaDegerleri>();
  const bagla = useLinkSupplierProduct(supplierId);
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  // Her kapanışta artar: bir sonraki açılışta form ve ürün seçici sıfırdan mount olur.
  const [nesil, setNesil] = useState(0);
  const gonderiliyorRef = useRef(false);
  // Satır, ekrandaki tedarikçiden seçilmiş olmalı; aksi hâlde pencere kapalı kalır.
  const acikMi = Boolean(acik && satir && supplierId !== undefined && satirSupplierId === supplierId);

  useEffect(() => {
    if (!acikMi) {
      form.resetFields();
      setSunucuHatasi(null);
      setNesil((n) => n + 1);
    }
  }, [acikMi, form]);

  const kapatIstegi = () => {
    if (bagla.isPending) return;
    if (!form.isFieldsTouched()) return kapat?.();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız girdikleriniz silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: () => kapat?.(),
    });
  };

  const gonder = async () => {
    if (gonderiliyorRef.current || bagla.isPending || !acikMi || !satir) return;
    gonderiliyorRef.current = true;
    let d: BaglaDegerleri;
    try {
      d = await form.validateFields();
    } catch (hata) {
      gonderiliyorRef.current = false;
      odakla(form, ilkHataliAlan(hata));
      return;
    }
    setSunucuHatasi(null);
    bagla.mutate(
      { spId: satir.id, product_id: d.urunId as number, reason: d.gerekce.trim() },
      {
        onSuccess: () => {
          message.success("Tedarikçi satırı ürüne bağlandı.");
          kapat?.();
        },
        onError: (e) => {
          let ilkAlan: keyof BaglaDegerleri | null = null;
          const genel = sunucuHatasiniDagit(e, "Bağ kurulamadı.", BAGLA_SUNUCU_ALANI, (alan, mesaj) => {
            form.setFields([{ name: alan, errors: [mesaj] }]);
            ilkAlan ??= alan;
          });
          setSunucuHatasi(genel);
          if (ilkAlan) odakla(form, ilkAlan);
        },
        onSettled: () => {
          gonderiliyorRef.current = false;
        },
      },
    );
  };

  const kunye: [string, string][] = satir
    ? [
        ["Tedarikçi kodu", satir.external_code],
        ["Barkod", satir.barcode ? `${satir.barcode}${satir.barcode_valid ? "" : " (geçersiz)"}` : "—"],
        ["Birim", satir.unit_name || "—"],
        ["Marka", satir.brand || "—"],
      ]
    : [];

  return (
    <YanPencere acik={acikMi} baslik="Ürüne bağla" kapat={kapatIstegi} kaydet={() => void gonder()} kaydediyor={bagla.isPending} kaydetMetni="Bağla">
      <Flex vertical gap={16}>
        {satir ? <Typography.Text type="secondary">{satir.external_code} · {satir.name}</Typography.Text> : null}
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 0", borderTop: `1px solid ${token.colorBorderSecondary}`, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          {kunye.map(([k, v]) => (
            <div key={k}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>{k}</Typography.Text>
              <Typography.Text style={{ fontWeight: 500 }}>{v}</Typography.Text>
            </div>
          ))}
        </div>
        <Form key={nesil} form={form} layout="vertical" requiredMark={false} initialValues={{ gerekce: "" }}>
          <Form.Item name="urunId" label="Bağlanacak ürünü ara" rules={[{ required: true, message: "Bağlanacak ürünü seçin." }]}>
            <TekUrunSecici />
          </Form.Item>
          <Form.Item name="gerekce" label="Bağlama gerekçesi" extra="Denetim kaydına yazılır; bağın neden elle kurulduğunu açıklayın." rules={gerekceKurali}>
            <Input.TextArea rows={3} maxLength={GEREKCE_ENUZUN} placeholder="Ör. barkod tedarikçide eksik, künye elle doğrulandı" />
          </Form.Item>
        </Form>
      </Flex>
    </YanPencere>
  );
}

export function BagCozmeCekmecesi({ acik, kapat, supplierId, satir, satirSupplierId }: SatirPencereProps) {
  const { message, modal } = App.useApp();
  const coz = useUnlinkSupplierProduct(supplierId);
  const [gerekce, setGerekce] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const gonderiliyorRef = useRef(false);
  const acikMi = Boolean(acik && satir && supplierId !== undefined && satirSupplierId === supplierId);

  useEffect(() => {
    if (!acikMi) {
      setGerekce("");
      setHata(null);
    }
  }, [acikMi]);

  const kapatIstegi = () => {
    if (coz.isPending) return;
    if (!gerekce) return kapat?.();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız yazdıklarınız silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: () => kapat?.(),
    });
  };

  const gonder = () => {
    if (gonderiliyorRef.current || coz.isPending || !acikMi || !satir) return;
    if (gerekce.trim().length < 3) return setHata("Gerekçe en az 3 karakter olmalı.");
    if (gerekce.length > GEREKCE_ENUZUN) return setHata(`En fazla ${GEREKCE_ENUZUN} karakter yazılabilir.`);
    setHata(null);
    gonderiliyorRef.current = true;
    coz.mutate(
      { spId: satir.id, reason: gerekce.trim() },
      {
        onSuccess: () => {
          message.success("Bağ çözüldü.");
          kapat?.();
        },
        // 422 `reason` → gerekçe metni; diğer hatalar genel. Girdi korunur.
        onError: (e) => {
          let alanMesaji: string | null = null;
          const genel = sunucuHatasiniDagit(e, "Bağ çözülemedi.", { reason: "gerekce" }, (_alan, mesaj) => {
            alanMesaji = mesaj;
          });
          setHata(genel ?? alanMesaji);
        },
        onSettled: () => {
          gonderiliyorRef.current = false;
        },
      },
    );
  };

  return (
    <YanPencere acik={acikMi} baslik="Bağı çöz" kapat={kapatIstegi} kaydet={gonder} kaydediyor={coz.isPending} kaydetMetni="Bağı çöz">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {satir ? `${satir.product?.title ?? satir.name} ile tedarikçi satırı arasındaki bağ kaldırılacak. Ürünün kendi stoğu etkilenmez.` : ""}
        </Typography.Paragraph>
        <label htmlFor="bag-cozme-gerekcesi">
          <Typography.Text type="secondary">Çözme gerekçesi</Typography.Text>
          <Input.TextArea id="bag-cozme-gerekcesi" rows={4} maxLength={GEREKCE_ENUZUN} value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="Ör. yanlış barkod eşleşmesi" style={{ marginTop: 4 }} />
        </label>
        {hata ? <Typography.Text type="danger" role="alert">{hata}</Typography.Text> : null}
      </Flex>
    </YanPencere>
  );
}
