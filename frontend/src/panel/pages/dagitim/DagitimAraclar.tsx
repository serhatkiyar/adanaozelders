// Dağıtım → Araçlar — eski DeliveryVehiclesPage (filo + başlangıç noktası) panel düzeninde. İki bağımsız bölüm:
// araçlar (oluştur/düzenle/aktif-pasif/sil) ve başlangıç noktaları (yalnız aktif BASE; ekle/düzenle — API'de silme
// ya da pasifleştirme ucu ekranda yok, uydurulmadı). Yazma yüzeyleri yalnız delivery.manage; view yoksa AccessDenied
// ve hiçbir sorgu çıkmaz. Kilit modeli varlık bazlı (`vehicle:{id}`, `vehicle:yeni`, `point:{id}`, `point:yeni`).
import { useState } from "react";
import { App, Alert, Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { VarlikDugmesi, useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { sunucuHatasiniDagit } from "@/panel/components/pencereAlanlari";
import { AracPenceresi, NoktaPenceresi, type AracGovdesi, type NoktaGovdesi } from "@/panel/pages/dagitim/AracPencereleri";
import { ARAC_SIRA, NOKTA_SIRA, shiftText } from "@/components/admin/aracSemalari";
import { useCreatePickupPoint, useCreateVehicle, useDeleteVehicle, usePickupPoints, useUpdatePickupPoint, useUpdateVehicle, useVehicles } from "@/hooks/useDelivery";
import { getErrorDetail } from "@/lib/errors";
import type { PickupPoint, Vehicle } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

/** Backend alan adları (422 beyaz listesi) — form alanlarıyla eşleme. */
const ARAC_SUNUCU_ALANLARI = ["label", "code", "plate", "max_stops", "shift_start", "shift_end", "fixed_cost", "sort_order"] as const;
const ARAC_ALAN_ESLEME: Record<(typeof ARAC_SUNUCU_ALANLARI)[number], (typeof ARAC_SIRA)[number]> = {
  label: "label", code: "code", plate: "plate", max_stops: "maxStops", shift_start: "shiftStart", shift_end: "shiftEnd", fixed_cost: "fixedCost", sort_order: "sortOrder",
};
const NOKTA_SUNUCU_ALANLARI = ["name", "address", "lat", "lng", "sort_order"] as const;
const NOKTA_ALAN_ESLEME: Record<(typeof NOKTA_SUNUCU_ALANLARI)[number], (typeof NOKTA_SIRA)[number]> = { name: "name", address: "address", lat: "lat", lng: "lng", sort_order: "sortOrder" };

type Hata = { alan: Record<string, string | undefined>; genel: string | null };
const TEMIZ_HATA: Hata = { alan: {}, genel: null };
/** Sunucu alan adlarını (snake_case) form alanlarına çevirerek dağıtır; beyaz liste dışı kalanlar genel hataya gider. */
function hataDagit<S extends string>(e: unknown, varsayilan: string, sunucuAlanlari: readonly S[], esleme: Record<S, string>): Hata {
  const { alan, genel } = sunucuHatasiniDagit(e, varsayilan, sunucuAlanlari);
  const cevrilmis: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(alan) as [S, string][]) cevrilmis[esleme[k]] = v;
  return { alan: cevrilmis, genel };
}

const MONO: React.CSSProperties = { fontFamily: "monospace" };
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/**
 * Satır özeti: durak tavanı, vardiya, sabit maliyet. `max_stops = null` backend sözleşmesinde "kısıt yok" DEĞİL,
 * sunucu varsayılanı (`DELIVERY_MAX_STOPS_PER_RUN`; bkz. `types/index.ts::Vehicle`, denetim B-2) — "sınırsız" yazılmaz.
 */
export function aracOzeti(v: Vehicle): string[] {
  return [
    v.max_stops != null ? `${v.max_stops} durak` : "varsayılan durak tavanı",
    shiftText(v) ? `vardiya ${shiftText(v)}` : "vardiya tanımsız",
    `₺${v.fixed_cost}/gün sabit`,
  ];
}
/** Nokta konumu: adres varsa adres, yoksa 5 basamaklı enlem/boylam. */
export function noktaKonumu(p: PickupPoint): string {
  return p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}
/** Yalnız aktif BASE noktaları, sunucu sırasıyla; ilki varsayılan. */
export function baseNoktalari(points: PickupPoint[]): PickupPoint[] {
  return points.filter((p) => p.kind === "BASE" && p.is_active);
}

export function DagitimAraclar() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("delivery");

  const araclar = useVehicles(canView);
  const noktalar = usePickupPoints(canView);
  const aracOlustur = useCreateVehicle();
  const aracGuncelle = useUpdateVehicle();
  const aracSil = useDeleteVehicle();
  const noktaOlustur = useCreatePickupPoint();
  const noktaGuncelle = useUpdatePickupPoint();

  // Pencereler: hedef kimlik açılışta sabitlenir; her pencerenin sunucu hatası kendine aittir.
  const [aracPenceresi, setAracPenceresi] = useState<{ mod: "ekle" } | { mod: "duzenle"; arac: Vehicle } | null>(null);
  const [noktaPenceresi, setNoktaPenceresi] = useState<{ mod: "ekle" } | { mod: "duzenle"; nokta: PickupPoint } | null>(null);
  const [aracHatasi, setAracHatasi] = useState<Hata>(TEMIZ_HATA);
  const [noktaHatasi, setNoktaHatasi] = useState<Hata>(TEMIZ_HATA);
  const { kilitle, kilitli, surenIslem, onayIsi } = useVarlikKilidi(message);

  const aracListesi: Vehicle[] = Array.isArray(araclar.data) ? araclar.data : [];
  const baseListesi = baseNoktalari(Array.isArray(noktalar.data) ? noktalar.data : []);
  const aracVarligi = (h: { mod: "ekle" } | { mod: "duzenle"; arac: Vehicle }) => (h.mod === "ekle" ? "vehicle:yeni" : `vehicle:${h.arac.id}`);
  const noktaVarligi = (h: { mod: "ekle" } | { mod: "duzenle"; nokta: PickupPoint }) => (h.mod === "ekle" ? "point:yeni" : `point:${h.nokta.id}`);

  /* ── Araçlar ── */
  const aracEkleAc = () => { setAracHatasi(TEMIZ_HATA); setAracPenceresi({ mod: "ekle" }); };
  const aracKaydet = (deger: { code?: string; govde: AracGovdesi }) => {
    const hedef = aracPenceresi;
    if (!hedef) return;
    void kilitle(aracVarligi(hedef), hedef.mod, () => {
      setAracHatasi(TEMIZ_HATA);
      // Eski payload'lar birebir: POST `{ code, ...govde }`, PATCH yalnız govde (kod yok).
      return (hedef.mod === "ekle" ? aracOlustur.mutateAsync({ code: deger.code ?? "", ...deger.govde }) : aracGuncelle.mutateAsync({ vehicleId: hedef.arac.id, payload: deger.govde }))
        .then(() => {
          setAracPenceresi(null);
          message.success(hedef.mod === "ekle" ? "Araç eklendi." : "Araç güncellendi.");
        })
        .catch((e: unknown) => setAracHatasi(hataDagit(e, hedef.mod === "ekle" ? "Araç eklenemedi." : "Araç güncellenemedi.", ARAC_SUNUCU_ALANLARI, ARAC_ALAN_ESLEME)));
    });
  };
  const aktiflikDegistir = (v: Vehicle) => {
    const hedefId = v.id;
    const yeni = !v.is_active;
    void kilitle(`vehicle:${hedefId}`, "aktif", () =>
      aracGuncelle
        .mutateAsync({ vehicleId: hedefId, payload: { is_active: yeni } })
        .then(() => {
          message.success(yeni ? "Araç aktifleştirildi." : "Araç pasifleştirildi.");
        })
        // `message.error` thenable'ı zincire DÖNDÜRÜLMEZ: kilit mesaj kapanışını beklemesin.
        .catch((e: unknown) => {
          message.error(getErrorDetail(e, "Güncellenemedi."));
        }),
    );
  };
  const silOnayi = (v: Vehicle) => {
    const hedefId = v.id;
    const varlik = `vehicle:${hedefId}`;
    if (kilitli(varlik)) return;
    const aciklama = `${v.label} filodan kaldırılacak. Geçmiş turların kaydı bozulmaz.`;
    const onay = onayAc(modal, {
      title: "Aracı sil",
      content: aciklama,
      okText: "Aracı sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      ...onayIsi(varlik, "sil", () =>
        aracSil
          .mutateAsync(hedefId)
          .then(() => {
            message.success("Araç silindi.");
          })
          .catch((e: unknown) => {
            // 409: açık (PLANNED/ACTIVE) turu olan araç silinemez — mesaj onay içinde görünür, pencere açık kalır.
            const durum = (e as { response?: { status?: number } })?.response?.status;
            const metin = getErrorDetail(e, durum === 409 ? "Aracın açık turu var: önce turları kapatın veya iptal edin." : "Araç silinemedi.");
            onay.update({ content: <Flex vertical gap={12}><span>{aciklama}</span><Alert type="error" showIcon message={metin} /></Flex> });
            throw e;
          }),
      ),
    });
  };

  /* ── Başlangıç noktaları ── */
  const noktaEkleAc = () => { setNoktaHatasi(TEMIZ_HATA); setNoktaPenceresi({ mod: "ekle" }); };
  const noktaKaydet = (govde: NoktaGovdesi) => {
    const hedef = noktaPenceresi;
    if (!hedef) return;
    void kilitle(noktaVarligi(hedef), hedef.mod, () => {
      setNoktaHatasi(TEMIZ_HATA);
      // Eski payload'lar birebir: POST `{ kind: "BASE", ...govde }`, PATCH yalnız govde.
      return (hedef.mod === "ekle" ? noktaOlustur.mutateAsync({ kind: "BASE", ...govde }) : noktaGuncelle.mutateAsync({ pointId: hedef.nokta.id, payload: govde }))
        .then(() => {
          setNoktaPenceresi(null);
          message.success(hedef.mod === "ekle" ? "Başlangıç noktası eklendi." : "Başlangıç noktası güncellendi.");
        })
        .catch((e: unknown) => setNoktaHatasi(hataDagit(e, hedef.mod === "ekle" ? "Nokta eklenemedi." : "Nokta güncellenemedi.", NOKTA_SUNUCU_ALANLARI, NOKTA_ALAN_ESLEME)));
    });
  };

  if (!canView) return <AccessDenied area="Dağıtım" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };
  const bolumBasligi = (baslik: string, aciklamaMetni: string, sag?: React.ReactNode) => (
    <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
      <div>
        <Typography.Text style={{ fontWeight: 500, display: "block" }}>{baslik}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{aciklamaMetni}</Typography.Text>
      </div>
      {sag}
    </Flex>
  );
  const saltOkunur = !canManage ? <Typography.Text type="secondary">Salt okunur görünüm: araç ve başlangıç noktası değişiklikleri için delivery.manage izni gerekir.</Typography.Text> : null;

  const aracGovdesi = araclar.isError ? (
    <div style={{ padding: "16px 0" }}><HataDurumu hata={getErrorDetail(araclar.error, "Araçlar yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void araclar.refetch()}>Tekrar dene</Button>} /></div>
  ) : araclar.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Araçlar yükleniyor…" /></div>
  ) : aracListesi.length === 0 ? (
    // Boş listede tek aksiyon: yalnız boş durumun kendisinde (başlıktaki düğme dolu listeye aittir).
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Filoda araç yok" aciklama="Tur kurabilmek için en az bir araç ekleyin." aksiyon={canManage ? <Button type="primary" onClick={aracEkleAc}>Araç ekle</Button> : undefined} /></div>
  ) : (
    aracListesi.map((v, i, dizi) => {
      const mesgul = surenIslem(`vehicle:${v.id}`);
      return (
        <Flex key={v.id} data-testid={`arac-${v.id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            <Flex align="baseline" gap={8} wrap>
              {/* Kesintisiz uzun ad/kod 400px'te kutuyu aşmasın: her yerden sarılır. */}
              <Typography.Text style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{v.label}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, overflowWrap: "anywhere", ...MONO }}>{v.code}</Typography.Text>
              {v.plate ? <Typography.Text style={{ fontSize: 12, ...MONO }}>{v.plate}</Typography.Text> : <Typography.Text type="secondary" style={{ fontSize: 12 }}>plaka yok</Typography.Text>}
              {!v.is_active ? <Tag style={{ marginInlineEnd: 0 }}>pasif</Tag> : null}
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAYI }}>{aracOzeti(v).join(" · ")}</Typography.Text>
          </div>
          {canManage ? (
            <Flex align="center" gap={8} wrap>
              {/* Ekran okuyucu bağlamı: hangi araca ait olduğu adda yazar. */}
              <VarlikDugmesi islem="duzenle" mesgulIslem={mesgul} aria-label={`${v.label} · Düzenle`} onClick={() => { setAracHatasi(TEMIZ_HATA); setAracPenceresi({ mod: "duzenle", arac: v }); }}>Düzenle</VarlikDugmesi>
              <VarlikDugmesi islem="aktif" mesgulIslem={mesgul} aria-label={`${v.label} · ${v.is_active ? "Pasifleştir" : "Aktifleştir"}`} onClick={() => aktiflikDegistir(v)}>{v.is_active ? "Pasifleştir" : "Aktifleştir"}</VarlikDugmesi>
              <VarlikDugmesi islem="sil" mesgulIslem={mesgul} danger aria-label={`${v.label} · Sil`} onClick={() => silOnayi(v)}>Sil</VarlikDugmesi>
            </Flex>
          ) : null}
        </Flex>
      );
    })
  );

  const noktaGovdesi = noktalar.isError ? (
    <div style={{ padding: "16px 0" }}><HataDurumu hata={getErrorDetail(noktalar.error, "Başlangıç noktaları yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void noktalar.refetch()}>Tekrar dene</Button>} /></div>
  ) : noktalar.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Başlangıç noktaları yükleniyor…" /></div>
  ) : baseListesi.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Tanımlı başlangıç noktası yok" aciklama="Rota optimizasyonu için bir nokta ekleyin." aksiyon={canManage ? <Button type="primary" onClick={noktaEkleAc}>Nokta ekle</Button> : undefined} /></div>
  ) : (
    baseListesi.map((p, i, dizi) => {
      const mesgul = surenIslem(`point:${p.id}`);
      return (
        <Flex key={p.id} data-testid={`nokta-${p.id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            <Flex align="baseline" gap={8} wrap>
              <Typography.Text style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{p.name}</Typography.Text>
              {/* Durum rozeti: "pasif" ile aynı nötr dil (sabit palet yok). */}
              {i === 0 ? <Tag style={{ marginInlineEnd: 0 }}>varsayılan</Tag> : null}
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", overflowWrap: "anywhere", ...SAYI }}>{noktaKonumu(p)}</Typography.Text>
          </div>
          <Flex align="center" gap={12} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>sıra {p.sort_order}</Typography.Text>
            {canManage ? <VarlikDugmesi islem="duzenle" mesgulIslem={mesgul} aria-label={`${p.name} · Düzenle`} onClick={() => { setNoktaHatasi(TEMIZ_HATA); setNoktaPenceresi({ mod: "duzenle", nokta: p }); }}>Düzenle</VarlikDugmesi> : null}
          </Flex>
        </Flex>
      );
    })
  );

  const aracVarlik = aracPenceresi ? aracVarligi(aracPenceresi) : null;
  const noktaVarlik = noktaPenceresi ? noktaVarligi(noktaPenceresi) : null;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Araçlar</Typography.Title>
      </Flex>
      {saltOkunur}

      <section aria-label="Araçlar" style={kart}>
        {bolumBasligi("Araçlar", "Tur kurma ve Günü Optimize Et bu filoyu kullanır: durak tavanı ve vardiya rota planına girer.", canManage && aracListesi.length > 0 ? <Button type="primary" onClick={aracEkleAc}>Araç ekle</Button> : undefined)}
        <div style={{ padding: "0 24px" }}>{aracGovdesi}</div>
      </section>

      <section aria-label="Başlangıç noktaları" style={kart}>
        {bolumBasligi("Başlangıç noktaları", "Turlar buradan yola çıkar; rota ve ETA'lar bu noktaya göre hesaplanır. Sırası en küçük aktif nokta varsayılandır.", canManage && baseListesi.length > 0 ? <Button type="primary" onClick={noktaEkleAc}>Nokta ekle</Button> : undefined)}
        <div style={{ padding: "0 24px" }}>{noktaGovdesi}</div>
      </section>

      <AracPenceresi
        acik={aracPenceresi !== null}
        mod={aracPenceresi?.mod ?? "ekle"}
        arac={aracPenceresi?.mod === "duzenle" ? aracPenceresi.arac : undefined}
        kapat={() => setAracPenceresi(null)}
        kaydediyor={aracVarlik !== null && surenIslem(aracVarlik) === aracPenceresi?.mod}
        alanHatalari={aracHatasi.alan}
        hata={aracHatasi.genel}
        kilitliMi={() => aracVarlik !== null && kilitli(aracVarlik)}
        onayla={aracKaydet}
      />
      <NoktaPenceresi
        acik={noktaPenceresi !== null}
        mod={noktaPenceresi?.mod ?? "ekle"}
        nokta={noktaPenceresi?.mod === "duzenle" ? noktaPenceresi.nokta : undefined}
        kapat={() => setNoktaPenceresi(null)}
        kaydediyor={noktaVarlik !== null && surenIslem(noktaVarlik) === noktaPenceresi?.mod}
        alanHatalari={noktaHatasi.alan}
        hata={noktaHatasi.genel}
        kilitliMi={() => noktaVarlik !== null && kilitli(noktaVarlik)}
        onayla={noktaKaydet}
      />
    </Flex>
  );
}
