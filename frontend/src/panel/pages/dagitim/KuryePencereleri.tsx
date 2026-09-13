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
import { kirliOnayi, sunucuHatasiniDagit, useAlanHatalari, type Hatalar } from "@/panel/components/pencereAlanlari";
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

export { sunucuHatasiniDagit };

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
