// Araçlar ekranının pencereleri: araç (ekle/düzenle) ve başlangıç noktası (ekle/düzenle). Açık/kapalı durumu, hedef
// kimlikler, kilitler ve mutasyonlar ekranda; gövde, doğrulama ve kirli/pending kapatma kuralları burada.
// Doğrulama ve form ↔ payload dönüşümleri eski DeliveryVehiclesPage ile AYNI nesnelerdir (`aracSemalari`):
// oluşturmada 8 alan (kod dahil), düzenlemede kod alanı hiç çizilmez ve payload'a girmez.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import type { InputRef } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { kirliOnayi, useAlanHatalari, type Hatalar } from "@/panel/components/pencereAlanlari";
import { zodAlanHatalari } from "@/components/admin/kuryeSemalari";
import {
  ARAC_SIRA,
  NOKTA_SIRA,
  aracSemasi,
  formFrom,
  noktaDegerleri,
  noktaGovdesi,
  noktaSemasi,
  payloadFrom,
  type NoktaFormDegerleri,
  type VehicleFormState,
} from "@/components/admin/aracSemalari";
import type { PickupPoint, Vehicle } from "@/types";

type OrtakProps = {
  acik?: boolean;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucu 422 alan hataları (ekran dağıtır) ve kalan genel hata. */
  alanHatalari?: Hatalar;
  hata?: string | null;
  /** Ekrandaki senkron kilit: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
};

const MONO: React.CSSProperties = { fontFamily: "monospace" };
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/* ── Araç: ekle / düzenle ── */
export type AracGovdesi = ReturnType<typeof payloadFrom>;
export type AracPenceresiProps = OrtakProps & {
  mod?: "ekle" | "duzenle";
  arac?: Vehicle;
  /** Ekleme: `{ code, ...govde }`; düzenleme: yalnız govde (kod payload'a girmez). */
  onayla?: (deger: { code?: string; govde: AracGovdesi }) => void;
};

export function AracPenceresi({ acik, kapat, kaydediyor, alanHatalari, hata, kilitliMi, mod = "ekle", arac, onayla }: AracPenceresiProps) {
  const { modal } = App.useApp();
  const [deger, setDeger] = useState<VehicleFormState>(formFrom());
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, ARAC_SIRA, refler);
  useEffect(() => {
    // Yalnız açılışta doldurulur; arka plan tazelemesi yazılanı ezmez.
    if (acik) setDeger(formFrom(mod === "duzenle" ? arac : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);
  const kodlu = mod === "ekle";
  const baslangic = formFrom(mod === "duzenle" ? arac : undefined);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const kirli = ARAC_SIRA.some((a) => deger[a] !== baslangic[a]);
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!kirli) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const yaz = (alan: keyof VehicleFormState, v: string) => {
    setDeger((d) => ({ ...d, [alan]: v }));
    temizle(alan);
  };
  const gonder = () => {
    if (mesgul()) return;
    const sonuc = aracSemasi(kodlu).safeParse(deger);
    if (yerelHatalariUygula(zodAlanHatalari(sonuc)) || !sonuc.success) return;
    // Eski satır içi formlarla aynı payload: ekleme `{ code: trim, ...payloadFrom }`, düzenleme yalnız payloadFrom.
    onayla?.(kodlu ? { code: sonuc.data.code.trim(), govde: payloadFrom(sonuc.data) } : { govde: payloadFrom(sonuc.data) });
  };
  const alan = (id: keyof VehicleFormState, etiket: string, ek: Record<string, unknown> = {}, onChange?: (v: string) => string) => (
    <div>
      <label htmlFor={`arac-${id}`}>
        <Typography.Text type="secondary">{etiket}</Typography.Text>
        <Input ref={(r) => { refler.current[id] = r; }} id={`arac-${id}`} value={deger[id]} onChange={(e) => yaz(id, onChange ? onChange(e.target.value) : e.target.value)} status={gosterilen(id) ? "error" : undefined} style={{ marginTop: 4 }} {...ek} />
      </label>
      {gosterilen(id) ? <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 4 }}>{gosterilen(id)}</Typography.Text> : null}
    </div>
  );
  return (
    <YanPencere acik={Boolean(acik)} baslik={kodlu ? "Araç ekle" : "Aracı düzenle"} kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni={kodlu ? "Ekle" : "Kaydet"}>
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Tur kurma ve Günü Optimize Et bu filoyu kullanır: durak tavanı ve vardiya rota planına girer.
        </Typography.Paragraph>
        {alan("label", "Araç adı", { placeholder: "Doblo", maxLength: 50 })}
        {kodlu ? alan("code", "Kod (değişmez)", { placeholder: "DOBLO", maxLength: 20, style: { marginTop: 4, ...MONO } }, (v) => v.toUpperCase().replace(/\s/g, "")) : null}
        {alan("plate", "Plaka (isteğe bağlı)", { placeholder: "01 ABC 123", maxLength: 20, style: { marginTop: 4, ...MONO } }, (v) => v.toLocaleUpperCase("tr"))}
        <Flex gap={12} wrap>
          <div style={{ flex: "1 1 140px" }}>{alan("maxStops", "Durak tavanı (isteğe bağlı)", { type: "number", min: 1, placeholder: "boş: varsayılan", inputMode: "numeric", style: { marginTop: 4, ...SAYI } })}</div>
          <div style={{ flex: "1 1 140px" }}>{alan("fixedCost", "Sabit maliyet (₺/gün)", { type: "number", min: 0, inputMode: "numeric", style: { marginTop: 4, ...SAYI } })}</div>
        </Flex>
        <Flex gap={12} wrap>
          <div style={{ flex: "1 1 140px" }}>{alan("shiftStart", "Vardiya başlangıç (isteğe bağlı)", { type: "time" })}</div>
          <div style={{ flex: "1 1 140px" }}>{alan("shiftEnd", "Vardiya bitiş (isteğe bağlı)", { type: "time" })}</div>
        </Flex>
        <div style={{ maxWidth: 160 }}>{alan("sortOrder", "Sıra", { type: "number", inputMode: "numeric", style: { marginTop: 4, ...SAYI } })}</div>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}

/* ── Başlangıç noktası: ekle / düzenle ── */
export type NoktaGovdesi = ReturnType<typeof noktaGovdesi>;
export type NoktaPenceresiProps = OrtakProps & {
  mod?: "ekle" | "duzenle";
  nokta?: PickupPoint;
  onayla?: (govde: NoktaGovdesi) => void;
};

export function NoktaPenceresi({ acik, kapat, kaydediyor, alanHatalari, hata, kilitliMi, mod = "ekle", nokta, onayla }: NoktaPenceresiProps) {
  const { modal } = App.useApp();
  const [deger, setDeger] = useState<NoktaFormDegerleri>(noktaDegerleri());
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, NOKTA_SIRA, refler);
  useEffect(() => {
    if (acik) setDeger(noktaDegerleri(mod === "duzenle" ? nokta : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);
  const baslangic = noktaDegerleri(mod === "duzenle" ? nokta : undefined);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const kirli = NOKTA_SIRA.some((a) => deger[a] !== baslangic[a]);
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!kirli) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const yaz = (alan: keyof NoktaFormDegerleri, v: string) => {
    setDeger((d) => ({ ...d, [alan]: v }));
    temizle(alan);
  };
  const gonder = () => {
    if (mesgul()) return;
    const sonuc = noktaSemasi.safeParse(deger);
    if (yerelHatalariUygula(zodAlanHatalari(sonuc)) || !sonuc.success) return;
    // Sayısal alanlar number gider; `kind: "BASE"` ekranda yalnız oluşturmaya eklenir.
    onayla?.(noktaGovdesi(sonuc.data));
  };
  const alan = (id: keyof NoktaFormDegerleri, etiket: string, ek: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`nokta-${id}`}>
        <Typography.Text type="secondary">{etiket}</Typography.Text>
        <Input ref={(r) => { refler.current[id] = r; }} id={`nokta-${id}`} value={deger[id]} onChange={(e) => yaz(id, e.target.value)} status={gosterilen(id) ? "error" : undefined} style={{ marginTop: 4 }} {...ek} />
      </label>
      {gosterilen(id) ? <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 4 }}>{gosterilen(id)}</Typography.Text> : null}
    </div>
  );
  return (
    <YanPencere acik={Boolean(acik)} baslik={mod === "ekle" ? "Başlangıç noktası ekle" : "Başlangıç noktasını düzenle"} kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni={mod === "ekle" ? "Ekle" : "Kaydet"}>
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Turlar buradan yola çıkar; rota ve ETA&apos;lar bu noktaya göre hesaplanır. Sırası en küçük aktif nokta varsayılandır.
        </Typography.Paragraph>
        {alan("name", "Nokta adı", { placeholder: "Depo: Seyhan", maxLength: 80 })}
        {alan("address", "Adres (isteğe bağlı)", { placeholder: "Cadde, mahalle…", maxLength: 2000 })}
        <Flex gap={12} wrap>
          <div style={{ flex: "1 1 140px" }}>{alan("lat", "Enlem", { inputMode: "decimal", placeholder: "36.98550", style: { marginTop: 4, ...SAYI } })}</div>
          <div style={{ flex: "1 1 140px" }}>{alan("lng", "Boylam", { inputMode: "decimal", placeholder: "35.32530", style: { marginTop: 4, ...SAYI } })}</div>
        </Flex>
        <div style={{ maxWidth: 160 }}>{alan("sortOrder", "Sıra", { type: "number", inputMode: "numeric", style: { marginTop: 4, ...SAYI } })}</div>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
