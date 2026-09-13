// Kuryeler ekranının pencereleri: kurye profili (ekle/düzenle), giriş hesabı oluşturma ve şifre sıfırlama.
// Pencere açık/kapalı durumu, hedef kimlikler, kilitler ve mutasyonlar ekranda; gövde, doğrulama, kirli/pending
// kapatma kuralları burada. Şifre alanları type=password + autoComplete=new-password; hiçbir zaman ön doldurulmaz,
// başarı/kapanışta temizlenir. Doğrulama eski CourierManager ile AYNI zod nesneleridir (`kuryeSemalari`):
// ad ≥2 (trim), telefon serbest (gönderimde trim → boşsa null), hesapta ad/soyad zorunlu, zod e-posta (trim +
// lowercase), şifre ≥8. Sunucu 422 alan hataları pencere içinde kopyalanır ve kullanıcı O alanı değiştirince silinir.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import type { InputRef } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { getErrorDetail } from "@/lib/errors";
import {
  HESAP_AD_MAX,
  HESAP_EPOSTA_MAX,
  HESAP_SIFRE_MAX,
  KURYE_AD_MAX,
  KURYE_TELEFON_MAX,
  hesapSemasi,
  kuryeSemasi,
  sifreSemasi,
  zodAlanHatalari,
} from "@/components/admin/kuryeSemalari";

/** 422 alan hatalarını YALNIZ kendi alanlarına (hasOwnProperty) dağıtır; kalanlar genel hata metnidir. */
export function sunucuHatasiniDagit<A extends string>(e: unknown, varsayilan: string, alanlar: readonly A[]): { alan: Partial<Record<A, string>>; genel: string | null } {
  const yanit = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) return { alan: {}, genel: getErrorDetail(e, varsayilan) };
  const izinli: Record<string, true> = Object.fromEntries(alanlar.map((a) => [a, true]));
  const alan: Partial<Record<A, string>> = {};
  const kalanlar: string[] = [];
  for (const oge of detay as { loc?: unknown; msg?: unknown }[]) {
    const mesaj = typeof oge?.msg === "string" && oge.msg.trim() ? oge.msg : "Bu alan geçersiz.";
    const parcalar = Array.isArray(oge?.loc) ? oge.loc.filter((p): p is string => typeof p === "string") : [];
    const ham = parcalar.filter((p) => !["body", "query", "path", "header", "cookie"].includes(p)).at(-1);
    if (ham && Object.prototype.hasOwnProperty.call(izinli, ham)) alan[ham as A] = mesaj;
    else kalanlar.push(mesaj);
  }
  const alanVar = Object.keys(alan).length > 0;
  return { alan, genel: kalanlar.length ? kalanlar.join(" ") : alanVar ? null : "Gönderilen bilgi geçersiz." };
}

type Hatalar = Record<string, string | undefined>;
type OrtakProps = {
  acik?: boolean;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucu 422 alan hataları (ekran dağıtır) ve kalan genel hata. Genel hata yeni gönderimde ekran tarafından silinir. */
  alanHatalari?: Hatalar;
  hata?: string | null;
  /** Ekrandaki senkron kilit: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
};

const kirliOnayi = (modal: ReturnType<typeof App.useApp>["modal"], onOk: () => void) =>
  modal.confirm({
    title: "Kaydedilmemiş değişiklikler var",
    content: "Pencereyi kapatırsanız yazdıklarınız silinecek.",
    okText: "Değişiklikleri sil",
    okButtonProps: { danger: true },
    cancelText: "Düzenlemeye devam et",
    onOk,
  });

/** İlk hatalı alana kaydır ve odakla (hata dalında elle odak). */
function ilkHatayaOdaklan(sira: readonly string[], hatalar: Hatalar, refler: Record<string, InputRef | null>) {
  const alan = sira.find((a) => hatalar[a]);
  if (!alan) return;
  const ref = refler[alan];
  ref?.input?.scrollIntoView?.({ block: "center" });
  ref?.focus();
}

/**
 * Yerel doğrulama + sunucu alan hataları tek çatı altında. Sunucu hataları prop'tan KOPYALANIR: kullanıcı bir
 * alanı değiştirince yalnız o alanın (yerel + sunucu) hatası silinir, ebeveyndeki bayat 422 geri sızmaz.
 */
function useAlanHatalari(acik: boolean | undefined, alanHatalari: Hatalar | undefined, sira: readonly string[], refler: React.MutableRefObject<Record<string, InputRef | null>>) {
  const [yerel, setYerel] = useState<Hatalar>({});
  const [sunucu, setSunucu] = useState<Hatalar>({});
  useEffect(() => {
    if (acik) setYerel({});
  }, [acik]);
  useEffect(() => {
    const gelen = alanHatalari ?? {};
    setSunucu(gelen);
    if (Object.values(gelen).some(Boolean)) ilkHatayaOdaklan(sira, gelen, refler.current);
    // `sira`/`refler` sabit kimliklidir; yalnız sunucu hatası değişince çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alanHatalari]);
  const temizle = (alan: string) => {
    setYerel((h) => (h[alan] ? { ...h, [alan]: undefined } : h));
    setSunucu((h) => (h[alan] ? { ...h, [alan]: undefined } : h));
  };
  const gosterilen = (alan: string) => yerel[alan] ?? sunucu[alan];
  /** Yerel doğrulama sonucunu yazar; hata varsa ilk hatalıya odaklar ve true döner. */
  const yerelHatalariUygula = (hatalar: Hatalar) => {
    setYerel(hatalar);
    const hataVar = Object.values(hatalar).some(Boolean);
    if (hataVar) ilkHatayaOdaklan(sira, hatalar, refler.current);
    return hataVar;
  };
  return { gosterilen, temizle, yerelHatalariUygula };
}

/* ── Kurye profili: ekle / düzenle ── */
export type KuryeDegerleri = { name: string; phone: string | null };
export type KuryePenceresiProps = OrtakProps & {
  mod?: "ekle" | "duzenle";
  baslangic?: { name: string; phone: string | null };
  onayla?: (deger: KuryeDegerleri) => void;
};
const KURYE_SIRA = ["name", "phone"] as const;

export function KuryePenceresi({ acik, kapat, kaydediyor, alanHatalari, hata, kilitliMi, mod = "ekle", baslangic, onayla }: KuryePenceresiProps) {
  const { modal } = App.useApp();
  const [ad, setAd] = useState("");
  const [telefon, setTelefon] = useState("");
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, KURYE_SIRA, refler);
  useEffect(() => {
    if (acik) {
      setAd(baslangic?.name ?? "");
      setTelefon(baslangic?.phone ?? "");
    }
    // Yalnız açılışta doldurulur; arka plan tazelemesi yazılanı ezmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const kirli = ad !== (baslangic?.name ?? "") || telefon !== (baslangic?.phone ?? "");
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!kirli) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const sonuc = kuryeSemasi.safeParse({ name: ad, phone: telefon });
    if (yerelHatalariUygula(zodAlanHatalari(sonuc)) || !sonuc.success) return;
    // Eski satır içi formla aynı sözleşme: ad trim, telefon trim → boşsa null.
    onayla?.({ name: sonuc.data.name, phone: sonuc.data.phone.trim() || null });
  };
  return (
    <YanPencere acik={Boolean(acik)} baslik={mod === "ekle" ? "Kurye ekle" : "Kuryeyi düzenle"} kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni={mod === "ekle" ? "Ekle" : "Kaydet"}>
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Müşteri takip sayfasında kimlik (isim, fotoğraf) olarak görünür. Plaka Araçlar ekranına aittir.
        </Typography.Paragraph>
        <label htmlFor="kurye-ad">
          <Typography.Text type="secondary">Kurye adı</Typography.Text>
          <Input ref={(r) => { refler.current.name = r; }} id="kurye-ad" value={ad} onChange={(e) => { setAd(e.target.value); temizle("name"); }} maxLength={KURYE_AD_MAX} status={gosterilen("name") ? "error" : undefined} style={{ marginTop: 4 }} />
        </label>
        {gosterilen("name") ? <Typography.Text type="danger" role="alert">{gosterilen("name")}</Typography.Text> : null}
        <label htmlFor="kurye-telefon">
          <Typography.Text type="secondary">Telefon (isteğe bağlı)</Typography.Text>
          <Input ref={(r) => { refler.current.phone = r; }} id="kurye-telefon" value={telefon} onChange={(e) => { setTelefon(e.target.value); temizle("phone"); }} maxLength={KURYE_TELEFON_MAX} inputMode="tel" status={gosterilen("phone") ? "error" : undefined} style={{ marginTop: 4 }} />
        </label>
        {gosterilen("phone") ? <Typography.Text type="danger" role="alert">{gosterilen("phone")}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}

/* ── Giriş hesabı oluşturma ── */
export type HesapDegerleri = { first_name: string; last_name: string; email: string; password: string };
export type HesapPenceresiProps = OrtakProps & {
  kuryeAdi?: string;
  onayla?: (deger: HesapDegerleri) => void;
};
const HESAP_SIRA = ["first_name", "last_name", "email", "password"] as const;
const BOS_HESAP: HesapDegerleri = { first_name: "", last_name: "", email: "", password: "" };

/** Ad/soyad kurye adından türetilir (eski sözleşme): son parça soyad, kalanı ad. */
export function adSoyadBol(kuryeAdi: string): { first_name: string; last_name: string } {
  const parcalar = kuryeAdi.trim().split(/\s+/).filter(Boolean);
  return { first_name: parcalar.slice(0, -1).join(" ") || kuryeAdi.trim(), last_name: parcalar.length > 1 ? parcalar[parcalar.length - 1] : "" };
}

export function HesapPenceresi({ acik, kapat, kaydediyor, alanHatalari, hata, kilitliMi, kuryeAdi = "", onayla }: HesapPenceresiProps) {
  const { modal } = App.useApp();
  const [deger, setDeger] = useState<HesapDegerleri>(BOS_HESAP);
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, HESAP_SIRA, refler);
  useEffect(() => {
    // Açılışta ad/soyad türetilir; kapanışta şifre dahil her şey bellekten temizlenir.
    setDeger(acik ? { ...adSoyadBol(kuryeAdi), email: "", password: "" } : BOS_HESAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const baslangic = adSoyadBol(kuryeAdi);
  const kirli = deger.email !== "" || deger.password !== "" || deger.first_name !== baslangic.first_name || deger.last_name !== baslangic.last_name;
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!kirli) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const yaz = (alan: keyof HesapDegerleri, v: string) => {
    setDeger((d) => ({ ...d, [alan]: v }));
    temizle(alan);
  };
  const gonder = () => {
    if (mesgul()) return;
    const sonuc = hesapSemasi.safeParse(deger);
    if (yerelHatalariUygula(zodAlanHatalari(sonuc)) || !sonuc.success) return;
    // Eski sözleşme: ad/soyad/e-posta trim (zod), e-posta lowercase; şifre olduğu gibi.
    onayla?.({ ...sonuc.data, email: sonuc.data.email.toLowerCase() });
  };
  const alan = (id: keyof HesapDegerleri, etiket: string, ek: Record<string, unknown> = {}) => (
    <>
      <label htmlFor={`hesap-${id}`}>
        <Typography.Text type="secondary">{etiket}</Typography.Text>
        <Input ref={(r) => { refler.current[id] = r; }} id={`hesap-${id}`} value={deger[id]} onChange={(e) => yaz(id, e.target.value)} status={gosterilen(id) ? "error" : undefined} style={{ marginTop: 4 }} {...ek} />
      </label>
      {gosterilen(id) ? <Typography.Text type="danger" role="alert">{gosterilen(id)}</Typography.Text> : null}
    </>
  );
  return (
    <YanPencere acik={Boolean(acik)} baslik="Giriş hesabı oluştur" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="Hesap oluştur">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {kuryeAdi} saha ekranına kendi hesabıyla girsin diye giriş hesabı açılır. Şifre yalnız bu pencerede yazılır; kayıt sonrası gösterilmez.
        </Typography.Paragraph>
        {alan("first_name", "Ad", { maxLength: HESAP_AD_MAX, autoComplete: "off" })}
        {alan("last_name", "Soyad", { maxLength: HESAP_AD_MAX, autoComplete: "off" })}
        {alan("email", "E-posta", { type: "email", maxLength: HESAP_EPOSTA_MAX, autoComplete: "off", inputMode: "email" })}
        <label htmlFor="hesap-password">
          <Typography.Text type="secondary">Şifre</Typography.Text>
          <Input.Password ref={(r) => { refler.current.password = r; }} id="hesap-password" value={deger.password} onChange={(e) => yaz("password", e.target.value)} maxLength={HESAP_SIFRE_MAX} autoComplete="new-password" status={gosterilen("password") ? "error" : undefined} style={{ marginTop: 4 }} />
        </label>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>En az 8 karakter.</Typography.Text>
        {gosterilen("password") ? <Typography.Text type="danger" role="alert">{gosterilen("password")}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}

/* ── Şifre sıfırlama ── */
export type SifrePenceresiProps = OrtakProps & { kuryeAdi?: string; onayla?: (yeniSifre: string) => void };
const SIFRE_SIRA = ["password"] as const;

export function SifrePenceresi({ acik, kapat, kaydediyor, alanHatalari, hata, kilitliMi, kuryeAdi = "", onayla }: SifrePenceresiProps) {
  const { modal } = App.useApp();
  const [sifre, setSifre] = useState("");
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, SIFRE_SIRA, refler);
  useEffect(() => {
    // Açılışta ve kapanışta temiz: şifre asla ön doldurulmaz, bellekte kalmaz.
    setSifre("");
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!sifre) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const sonuc = sifreSemasi.safeParse({ password: sifre });
    if (yerelHatalariUygula(zodAlanHatalari(sonuc)) || !sonuc.success) return;
    onayla?.(sonuc.data.password);
  };
  return (
    <YanPencere acik={Boolean(acik)} baslik="Şifre sıfırla" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="Şifreyi kaydet">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{kuryeAdi} için yeni giriş şifresi belirlenir; eski şifre geçersiz olur.</Typography.Paragraph>
        <label htmlFor="sifre-yeni">
          <Typography.Text type="secondary">Yeni şifre</Typography.Text>
          <Input.Password ref={(r) => { refler.current.password = r; }} id="sifre-yeni" value={sifre} onChange={(e) => { setSifre(e.target.value); temizle("password"); }} maxLength={HESAP_SIFRE_MAX} autoComplete="new-password" status={gosterilen("password") ? "error" : undefined} style={{ marginTop: 4 }} />
        </label>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>En az 8 karakter.</Typography.Text>
        {gosterilen("password") ? <Typography.Text type="danger" role="alert">{gosterilen("password")}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
