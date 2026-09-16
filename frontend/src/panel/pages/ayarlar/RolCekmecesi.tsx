// Yönetici rolü oluştur/düzenle çekmecesi — eski AdminAccessPage rol penceresinin AntD karşılığı;
// aynı uçlar (useCreateAdminRole / useUpdateAdminRole) ve aynı doğrulama kuralları.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Checkbox, Flex, Form, Input, Typography, theme } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { useCreateAdminRole, useUpdateAdminRole } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import type { AdminPermissionOut, AdminRoleOut } from "@/types";

type Degerler = { kod: string; ad: string; aciklama: string; izinler: string[] };
type Alan = keyof Degerler;

const KOD_DESENI = /^[A-Z][A-Z0-9_]*$/;
const GORSEL_SIRA: Alan[] = ["kod", "ad", "aciklama", "izinler"];
/** Sunucu 422 alanı → form alanı. */
const SUNUCU_ALANI: Record<string, Alan> = { code: "kod", name: "ad", description: "aciklama", permission_codes: "izinler" };

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

/** Yazılırken büyük harfe çevrilir, A-Z/0-9/_ dışı silinir (eski ekran davranışı). */
export const kodTemizle = (v: string) => v.toUpperCase().replace(/[^A-Z0-9_]/g, "");

export function RolCekmecesi({
  acik,
  kapat,
  rol,
  izinler,
}: {
  acik?: boolean;
  kapat?: () => void;
  /** Verilirse düzenleme (kod değişmez), verilmezse yeni rol. */
  rol?: AdminRoleOut | null;
  izinler?: AdminPermissionOut[];
}) {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm<Degerler>();
  const olustur = useCreateAdminRole();
  const guncelle = useUpdateAdminRole();
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const gonderiliyorRef = useRef(false);
  const kaydediyor = olustur.isPending || guncelle.isPending;
  const acikMi = Boolean(acik);
  const duzenleme = Boolean(rol);

  // Açılış/kapanışta taze form; açıkken arka plan refetch'i forma dokunmaz.
  useEffect(() => {
    form.resetFields();
    setSunucuHatasi(null);
  }, [acikMi, rol?.id, form]);

  const gruplar = useMemo(() => {
    const m = new Map<string, AdminPermissionOut[]>();
    for (const izin of izinler ?? []) m.set(izin.group, [...(m.get(izin.group) ?? []), izin]);
    return [...m.entries()];
  }, [izinler]);

  const mesgul = () => gonderiliyorRef.current || kaydediyor;

  // Bütün kapatma yolları buradan: pending/kilit iken kapanmaz; kirliyse onay ister.
  const kapatIstegi = () => {
    if (mesgul()) return;
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

  // İlk hatalı alan görünür olsun: kaydır + odakla.
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

  // Kaydet geçerlilikle kapanmaz; senkron kilit aynı tick'te ikinci isteği keser.
  const gonder = async () => {
    if (mesgul()) return;
    gonderiliyorRef.current = true;
    let d: Degerler;
    try {
      d = await form.validateFields();
    } catch (hata) {
      gonderiliyorRef.current = false;
      const ilk = (hata as { errorFields?: { name: (string | number)[] }[] })?.errorFields?.[0]?.name?.[0];
      odakla(GORSEL_SIRA.find((a) => a === ilk));
      return;
    }
    setSunucuHatasi(null);
    // Gövde eski sözleşmeyle birebir: name, description|null, permission_codes (+ code yalnız yeni rolde).
    const govde = { name: d.ad.trim(), description: d.aciklama.trim() || null, permission_codes: d.izinler ?? [] };
    const secenekler = {
      onSuccess: () => {
        message.success(duzenleme ? "Yönetici rolü güncellendi." : "Yönetici rolü oluşturuldu.");
        kapat?.();
      },
      // Sunucu hatasında çekmece açık kalır, girdiler korunur.
      onError: (e: unknown) => {
        let ilk: Alan | null = null;
        const genel = sunucuHatasiniDagit(e, "Rol kaydedilemedi.", (alan, mesaj) => {
          form.setFields([{ name: alan, errors: [mesaj] }]);
          ilk ??= alan;
        });
        setSunucuHatasi(genel);
        if (ilk) odakla(ilk);
      },
      onSettled: () => {
        gonderiliyorRef.current = false;
      },
    };
    if (rol) guncelle.mutate({ id: rol.id, payload: govde }, secenekler);
    else olustur.mutate({ ...govde, code: d.kod.trim().toUpperCase() }, secenekler);
  };

  return (
    <YanPencere
      acik={acikMi}
      baslik={duzenleme ? "Yönetici rolünü düzenle" : "Yeni yönetici rolü"}
      kapat={kapatIstegi}
      kaydet={() => void gonder()}
      kaydediyor={kaydediyor}
    >
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>İzinler en az yetki ilkesine göre seçilmelidir.</Typography.Paragraph>
        {sunucuHatasi ? <Alert type="error" showIcon message={sunucuHatasi} /> : null}
        <Form
          key={rol?.id ?? "yeni"}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ kod: rol?.code ?? "", ad: rol?.name ?? "", aciklama: rol?.description ?? "", izinler: rol?.permission_codes ?? [] }}
          onValuesChange={(degisen: Partial<Degerler>) => form.setFields((Object.keys(degisen) as Alan[]).map((name) => ({ name, errors: [] })))}
        >
          {!duzenleme ? (
            <Form.Item
              name="kod"
              label="Rol kodu"
              extra="Oluşturulduktan sonra değiştirilemez."
              normalize={kodTemizle}
              rules={[
                { validator: (_, v: string) => ((v ?? "").trim().length >= 3 ? Promise.resolve() : Promise.reject(new Error("Rol kodu en az 3 karakter olmalı."))) },
                { max: 50, message: "Rol kodu en fazla 50 karakter olabilir." },
                { pattern: KOD_DESENI, message: "Rol kodu büyük harfle başlamalı; yalnız A-Z, 0-9 ve _ içerebilir." },
              ]}
            >
              <Input maxLength={50} placeholder="ICERIK_EDITORU" style={{ fontFamily: "monospace" }} />
            </Form.Item>
          ) : null}
          <Form.Item
            name="ad"
            label="Rol adı"
            rules={[
              { validator: (_, v: string) => ((v ?? "").trim().length >= 2 ? Promise.resolve() : Promise.reject(new Error("Rol adı en az 2 karakter olmalı."))) },
              { max: 100, message: "Rol adı en fazla 100 karakter olabilir." },
            ]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="aciklama" label="Açıklama (isteğe bağlı)" rules={[{ max: 500, message: "Açıklama en fazla 500 karakter olabilir." }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Form.Item name="izinler" label="İzinler">
            <Checkbox.Group style={{ width: "100%" }}>
              <Flex vertical gap={12}>
                {gruplar.map(([grup, liste]) => (
                  <fieldset key={grup} style={{ border: 0, margin: 0, padding: 0 }}>
                    <legend style={{ fontSize: 14, fontWeight: 500, padding: 0, marginBottom: 6 }}>{grup}</legend>
                    <Flex vertical gap={4}>
                      {liste.map((izin) => (
                        <Checkbox key={izin.code} value={izin.code}>
                          <span style={{ display: "inline-flex", flexDirection: "column" }}>
                            <span>{izin.name}</span>
                            <Typography.Text style={{ fontFamily: "monospace", fontSize: 11, color: token.colorTextTertiary }}>{izin.code}</Typography.Text>
                          </span>
                        </Checkbox>
                      ))}
                    </Flex>
                  </fieldset>
                ))}
              </Flex>
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Flex>
    </YanPencere>
  );
}
