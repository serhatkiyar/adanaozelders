// Hasar işlemi çekmecesi — eski DamageDialog'un AntD karşılığı; aynı uç (useCreateDamageEvent),
// aynı şema (damageFormSchema) ve aynı idempotency ömrü. Pencere durumu listede yaşar, gövde burada.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Checkbox, Flex, Form, Input, InputNumber, Select, Typography, theme } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { UrunSecici } from "@/panel/pages/urunler/UrunSecici";
import { useCreateDamageEvent } from "@/hooks/useInventory";
import {
  DAMAGE_KINDS,
  DAMAGE_REASON_OPTIONS,
  damageEffect,
  damageFormSchema,
  damageKindLabel,
  damageKindPastLabel,
  damagePayload,
  inventoryErrorMessage,
  newIdempotencyKey,
  requiresDamageNote,
  type Bucket,
  type DamageFormValues,
  type DamageKind,
  type DamageReason,
} from "@/lib/inventory";

type Degerler = { urunler: number[]; miktar: number | null; neden: string; aciklama: string; kova: string };

// Sunucu 422 alanı → form alanı (eski DamageDialog eşlemesi).
const SUNUCU_ALANI: Record<string, keyof Degerler> = { product_id: "urunler", qty: "miktar", reason_code: "neden", note: "aciklama", bucket: "kova" };

// 422 alan hatalarını ilgili alana dağıtır; alana eşleşmeyenleri genel mesaj olarak döndürür.
function sunucuHatasiniDagit(e: unknown, alanaYaz: (alan: keyof Degerler, mesaj: string) => void): string | null {
  const yanit = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) return inventoryErrorMessage(e, "İşlem tamamlanamadı.");
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

const BOS: Degerler = { urunler: [], miktar: null, neden: "", aciklama: "", kova: "" };

function semaDegerleri(d: Degerler): DamageFormValues {
  return {
    urunId: d.urunler[0] ?? null,
    miktar: d.miktar == null ? "" : String(d.miktar),
    neden: d.neden ?? "",
    aciklama: d.aciklama ?? "",
    kova: d.kova ?? "",
  };
}

export function HasarPenceresi({ kind, kapat }: { kind: DamageKind | null; kapat: () => void }) {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm<Degerler>();
  const olustur = useCreateDamageEvent();
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const [onaylandi, setOnaylandi] = useState(false);
  const [onayHatasi, setOnayHatasi] = useState(false);
  // Tek gönderim niyeti boyunca sabit; her açılışta ve başarıda yenilenir.
  const anahtarRef = useRef(newIdempotencyKey());

  useEffect(() => {
    if (kind) {
      form.resetFields();
      setSunucuHatasi(null);
      setOnaylandi(false);
      setOnayHatasi(false);
      anahtarRef.current = newIdempotencyKey();
    }
  }, [kind, form]);

  const miktar = Form.useWatch("miktar", form);
  const neden = Form.useWatch("neden", form);
  const kova = Form.useWatch("kova", form);
  const etki = kind ? damageEffect(kind, Number(miktar), (kova || null) as Bucket | null) : null;
  const onayGerekli = kind === "DISPOSAL";

  const kapatIstegi = () => {
    if (!form.isFieldsTouched() && !onaylandi) return kapat();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız girdikleriniz silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: kapat,
    });
  };

  // Gönder düğmesi geçerlilikle kapanmaz; şema hataları ilgili alana yazılır.
  const gonder = () => {
    if (!kind || olustur.isPending) return;
    const degerler = semaDegerleri(form.getFieldsValue(true) as Degerler);
    const sonuc = damageFormSchema(kind).safeParse(degerler);
    const alanAdi: Record<string, keyof Degerler> = { urunId: "urunler", miktar: "miktar", neden: "neden", aciklama: "aciklama", kova: "kova" };
    form.setFields((Object.keys(alanAdi) as (keyof typeof alanAdi)[]).map((a) => ({ name: alanAdi[a], errors: [] })));
    if (!sonuc.success) {
      form.setFields(sonuc.error.issues.map((h) => ({ name: alanAdi[String(h.path[0])], errors: [h.message] })));
      if (onayGerekli && !onaylandi) setOnayHatasi(true);
      odakla(alanAdi[String(sonuc.error.issues[0]?.path[0])]);
      return;
    }
    if (onayGerekli && !onaylandi) {
      setOnayHatasi(true);
      return;
    }
    setSunucuHatasi(null);
    const payload = damagePayload(kind, sonuc.data as DamageFormValues, anahtarRef.current);
    olustur.mutate(payload, {
      onSuccess: (r) => {
        if (r.replayed) message.info("Bu işlem zaten işlenmişti: aynı anahtarla ikinci kez uygulanmadı, stok değişmedi.");
        else message.success(`Hasar kaydı alındı: ${damageKindPastLabel(payload.kind)}, ürün #${payload.product_id}, ${payload.qty} adet.`);
        anahtarRef.current = newIdempotencyKey();
        kapat();
      },
      onError: (e) => {
        let ilk: keyof Degerler | null = null;
        const genel = sunucuHatasiniDagit(e, (alan, mesaj) => {
          form.setFields([{ name: alan, errors: [mesaj] }]);
          ilk ??= alan;
        });
        setSunucuHatasi(genel);
        if (ilk) odakla(ilk);
      },
    });
  };

  // İlk hatalı alan görünür olsun: kaydır + odakla (ürün seçici dahil).
  const odakla = (alan?: keyof Degerler) => {
    if (!alan) return;
    // Çekmecenin odak kilidi aynı karede odağı geri alabilir; bir sonraki kareye ertelenir.
    setTimeout(() => {
      try {
        form.scrollToField(alan, { block: "center" });
        form.getFieldInstance(alan)?.focus?.();
      } catch {
        /* jsdom/kapalı alan */
      }
    }, 0);
  };

  const acik = kind != null;
  const kindGuvenli = kind ?? "TRANSFER";

  return (
    <YanPencere
      acik={acik}
      baslik={damageKindLabel(kindGuvenli)}
      kapat={kapatIstegi}
      kaydet={gonder}
      kaydediyor={olustur.isPending}
      kaydetMetni={damageKindLabel(kindGuvenli)}
    >
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {DAMAGE_KINDS.find((k) => k.value === kindGuvenli)?.description}
        </Typography.Paragraph>
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <Form form={form} layout="vertical" initialValues={BOS} requiredMark={false}>
          {/* Tek ürün: son seçilen kalır. Her açılışta yeniden mount, arama metni kalmaz. */}
          <Form.Item name="urunler" label="Ürün" getValueFromEvent={(v: number[]) => v.slice(-1)}>
            <UrunSecici key={acik ? "acik" : "kapali"} />
          </Form.Item>
          <Form.Item name="miktar" label="Miktar">
            <InputNumber min={1} step={1} precision={0} style={{ width: 160 }} />
          </Form.Item>
          {kindGuvenli === "SUPPLIER_RETURN" ? (
            <Form.Item name="kova" label="Kaynak kova" extra="Adet yalnız seçtiğiniz raftan düşer; diğer rafa aktarılmaz.">
              <Select
                allowClear
                placeholder="Seçin…"
                options={[
                  { value: "SALEABLE", label: "Satılabilir" },
                  { value: "DAMAGED", label: "Hasarlı" },
                ]}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="neden" label="Neden">
            <Select allowClear placeholder="Seçin…" options={DAMAGE_REASON_OPTIONS} />
          </Form.Item>
          {requiresDamageNote((neden || null) as DamageReason | null) ? (
            <Form.Item name="aciklama" label="Açıklama">
              <Input placeholder="Ne olduğunu kısaca yazın" />
            </Form.Item>
          ) : null}
        </Form>
        <Typography.Text data-testid="hasar-etki" style={{ padding: "8px 12px", borderRadius: 4, background: token.colorFillTertiary }}>
          {etki?.text}
        </Typography.Text>
        {onayGerekli ? (
          <div>
            <Checkbox
              checked={onaylandi}
              aria-invalid={onayHatasi || undefined}
              onChange={(e) => {
                setOnaylandi(e.target.checked);
                if (e.target.checked) setOnayHatasi(false);
              }}
            >
              Bu işlem <strong>geri alınamaz</strong>: mal fiziksel olarak çıkar ve stoğa kendiliğinden dönmez. Onaylıyorum.
            </Checkbox>
            {onayHatasi ? (
              <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 4 }}>
                Devam etmek için bu kutuyu işaretleyin.
              </Typography.Text>
            ) : null}
          </div>
        ) : etki?.irreversible ? (
          <Alert type="warning" showIcon message="Bu işlem geri alınamaz: mal fiziksel olarak çıkar." />
        ) : null}
      </Flex>
    </YanPencere>
  );
}
