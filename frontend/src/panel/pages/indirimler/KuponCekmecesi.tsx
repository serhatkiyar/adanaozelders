// Yeni kupon çekmecesi — eski CouponsPanel "Yeni kupon" formunun AntD karşılığı.
// Kurallar `lib/storeCouponForm` (zod şeması + gövde) tek kaynağından gelir; burada kural yazılmaz.
import { useRef, useState } from "react";
import { Alert, App, Flex, Form, Input, Select } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { useCreateCoupon } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { BOS_KUPON, kuponFormSemasi, kuponGovdesi, type KuponFormDegerleri } from "@/lib/storeCouponForm";
import type { CouponDiscountType } from "@/types";

type Alan = keyof KuponFormDegerleri;

const TUR_SECENEKLERI: { value: CouponDiscountType; label: string }[] = [
  { value: "PERCENT", label: "Yüzde %" },
  { value: "FIXED", label: "Sabit TL" },
];

/** Alanların görsel sırası; "ilk hatalı alan" bu sıradan okunur. */
const GORSEL_SIRA: Alan[] = ["kod", "indirimTuru", "indirimDegeri", "minSepet", "maksKullanim", "kisiBasi"];

/** Sunucu 422 alanı → form alanı. */
const SUNUCU_ALANI: Record<string, Alan> = {
  code: "kod",
  discount_type: "indirimTuru",
  discount_value: "indirimDegeri",
  min_subtotal: "minSepet",
  max_uses: "maksKullanim",
  per_user_limit: "kisiBasi",
};

// 422 alan hatalarını ilgili alana dağıtır; eşleşmeyenleri genel mesaj olarak döndürür.
function sunucuHatasiniDagit(e: unknown, varsayilan: string, alanaYaz: (alan: Alan, mesaj: string) => void): string | null {
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
    const alan = ham && Object.prototype.hasOwnProperty.call(SUNUCU_ALANI, ham) ? SUNUCU_ALANI[ham] : undefined;
    if (alan) {
      alanaYaz(alan, mesaj);
      alanaYazildi += 1;
    } else kalanlar.push(mesaj);
  }
  if (!kalanlar.length) return alanaYazildi ? null : "Gönderilen bilgi geçersiz.";
  return kalanlar.join(" ");
}

export function KuponCekmecesi({ acik, kapat }: { acik?: boolean; kapat?: () => void }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<KuponFormDegerleri>();
  const olustur = useCreateCoupon();
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const gonderiliyorRef = useRef(false);
  const indirimTuru = Form.useWatch("indirimTuru", form) ?? "PERCENT";

  const kapatVeSifirla = () => {
    form.resetFields();
    setSunucuHatasi(null);
    kapat?.();
  };

  // Bütün kapatma yolları buradan: pending iken kapanmaz; kirliyse onay ister.
  const kapatIstegi = () => {
    // Senkron kilit de sayılır: gönderimle aynı tick'te kapatma isteği yutulur.
    if (gonderiliyorRef.current || olustur.isPending) return;
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
  const odakla = (alan?: Alan) => {
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

  // Zod şemasını çalıştırır, sorunları alanlara dağıtır; geçerliyse değerleri döndürür.
  const dogrula = (): KuponFormDegerleri | null => {
    const degerler = form.getFieldsValue(true) as KuponFormDegerleri;
    const sonuc = kuponFormSemasi.safeParse(degerler);
    form.setFields(GORSEL_SIRA.map((alan) => ({ name: alan, errors: [] })));
    if (sonuc.success) return degerler;
    // Alan başına yalnız ilk sorun gösterilir (boş kod için "zorunlu" yeter, "boşluk" beklemez).
    const hatalar = new Map<Alan, string[]>();
    for (const sorun of sonuc.error.issues) {
      const alan = sorun.path[0];
      if (typeof alan === "string" && GORSEL_SIRA.includes(alan as Alan) && !hatalar.has(alan as Alan)) {
        hatalar.set(alan as Alan, [sorun.message]);
      }
    }
    form.setFields([...hatalar].map(([name, errors]) => ({ name, errors })));
    odakla(GORSEL_SIRA.find((a) => hatalar.has(a)));
    return null;
  };

  // Gönder düğmesi geçerlilikle kapanmaz; senkron kilit aynı tick'te ikinci POST'u keser.
  const gonder = () => {
    if (gonderiliyorRef.current || olustur.isPending) return;
    gonderiliyorRef.current = true;
    const d = dogrula();
    if (!d) {
      gonderiliyorRef.current = false;
      return;
    }
    setSunucuHatasi(null);
    olustur.mutate(kuponGovdesi(d), {
      onSuccess: () => {
        message.success("Kupon oluşturuldu.");
        kapatVeSifirla();
      },
      // Sunucu hatasında pencere açık kalır, girdiler korunur.
      onError: (e) => {
        let ilk: Alan | null = null;
        const genel = sunucuHatasiniDagit(e, "Kupon oluşturulamadı.", (alan, mesaj) => {
          form.setFields([{ name: alan, errors: [mesaj] }]);
          ilk ??= alan;
        });
        setSunucuHatasi(genel);
        if (ilk) odakla(ilk);
      },
      onSettled: () => {
        gonderiliyorRef.current = false;
      },
    });
  };

  return (
    <YanPencere acik={Boolean(acik)} baslik="Yeni kupon" kapat={kapatIstegi} kaydet={gonder} kaydediyor={olustur.isPending} kaydetMetni="Kupon oluştur">
      <Flex vertical gap={16}>
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <Form
          form={form}
          layout="vertical"
          initialValues={BOS_KUPON}
          requiredMark={false}
          // Değişen alanın eski hatası silinir; yeniden doğrulama gönderimde yapılır.
          onValuesChange={(degisen: Partial<KuponFormDegerleri>) => form.setFields((Object.keys(degisen) as Alan[]).map((name) => ({ name, errors: [] })))}
        >
          <Form.Item name="kod" label="Kod" extra="Kaydedilirken büyük harfe çevrilir.">
            <Input maxLength={40} style={{ textTransform: "uppercase" }} />
          </Form.Item>
          <Form.Item name="indirimTuru" label="İndirim türü">
            <Select options={TUR_SECENEKLERI} />
          </Form.Item>
          <Form.Item name="indirimDegeri" label="Değer">
            <Input type="number" inputMode="decimal" suffix={indirimTuru === "PERCENT" ? "%" : "TL"} />
          </Form.Item>
          <Form.Item name="minSepet" label="Minimum sepet" extra="Boş bırakılırsa 0 sayılır.">
            <Input type="number" inputMode="decimal" suffix="TL" />
          </Form.Item>
          <Form.Item name="maksKullanim" label="Maksimum kullanım (isteğe bağlı)">
            <Input type="number" inputMode="numeric" />
          </Form.Item>
          <Form.Item name="kisiBasi" label="Kişi başı limit (isteğe bağlı)">
            <Input type="number" inputMode="numeric" />
          </Form.Item>
        </Form>
      </Flex>
    </YanPencere>
  );
}
