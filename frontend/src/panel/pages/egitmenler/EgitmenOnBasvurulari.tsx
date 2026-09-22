// Eğitmen Yönetimi → Ön Başvurular — eski `AdminTutorApplicationsPage` panel düzeninde. `/egitmen-on-basvuru`
// formundan gelen lead kayıtları; süreç telefonla yürür: yeni kayıt önce ARANIR, sonra sonuçlanır, yanlış tık
// "Geri aç" ile telafi edilir. Backend geçişte gerekçe/not ALMAZ — gerekçe penceresi ya da uydurma alan yok.
//
// Belgeler ve fotoğraf `private/` anahtarlarının kısa ömürlü imzalı adresleridir: yalnız kullanıcı tıklayınca
// yeni sekmede açılır; URL metin olarak basılmaz, log'a ya da telemetriye kopyalanmaz.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App, Avatar, Button, Flex, Segmented, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { VarlikDugmesi, useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { useAdminTutorPreApplications, useUpdateTutorPreApplicationStatus } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import type { AdminTutorPreApplication, PreApplicationStatus } from "@/api/admin";

/** URL beyaz listesi: dört gerçek durum + "hepsi". Bunun dışındaki değer sunucuya GİTMEZ. */
export const DURUM_DEGERLERI = ["NEW", "CONTACTED", "CONVERTED", "REJECTED", "hepsi"] as const;
export type DurumSecimi = (typeof DURUM_DEGERLERI)[number];
/** Operasyonel varsayılan: ekran "aranacaklar" listesi olarak açılır. */
export const VARSAYILAN_DURUM: DurumSecimi = "NEW";
/** Uç `limit`/`offset` ile gerçek sayfalama yapar; TOPLAM döndürmez, bu yüzden "1–25 / N" gibi sayı uydurulmaz. */
export const SAYFA_BOYUTU = 25;

/**
 * `?sayfa=` yalnız düz pozitif güvenli tam sayı; aksi hâlde 1 (geçersiz değer sunucuya gitmez). Üst sınır
 * derin `offset` taramasını engeller — uçta `offset` için sınır yok.
 */
export const EN_BUYUK_SAYFA = 10_000;
export function sayfaCoz(ham: string | null): number {
  if (ham == null || !/^\d+$/.test(ham)) return 1;
  const n = Number(ham);
  return Number.isSafeInteger(n) && n > 0 && n <= EN_BUYUK_SAYFA ? n : 1;
}
export function sayfaOfseti(sayfa: number): number {
  return (sayfa - 1) * SAYFA_BOYUTU;
}

/** Filtre sırası eski ekranla birebir: Yeni · Arandı · Tümü · Kazanıldı · Olumsuz. */
export const FILTRELER: { value: DurumSecimi; label: string }[] = [
  { value: "NEW", label: "Yeni" },
  { value: "CONTACTED", label: "Arandı" },
  { value: "hepsi", label: "Tümü" },
  { value: "CONVERTED", label: "Kazanıldı" },
  { value: "REJECTED", label: "Olumsuz" },
];
export const DURUM_ETIKETI: Record<PreApplicationStatus, string> = {
  NEW: "Yeni",
  CONTACTED: "Arandı",
  CONVERTED: "Kazanıldı",
  REJECTED: "Olumsuz",
};
const DURUM_RENGI: Record<PreApplicationStatus, string | undefined> = {
  NEW: "warning",
  CONTACTED: undefined,
  CONVERTED: "success",
  REJECTED: "error",
};
const DENEYIM_ETIKETI: Record<string, string> = {
  "universite-ogrencisi": "Üniversite öğrencisi",
  "0-2": "0–2 yıl",
  "3-5": "3–5 yıl",
  "5+": "5+ yıl",
};
const BICIM_ETIKETI: Record<string, string> = {
  ONLINE: "Online",
  IN_PERSON: "Yüz yüze",
  BOTH: "Online + yüz yüze",
};
const TARIH = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const KVKK_TARIHI = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };

/** URL değeri beyaz listede değilse varsayılana düşer (geçersiz değer sunucuya gitmez). */
export function durumCoz(ham: string | null): DurumSecimi {
  return (DURUM_DEGERLERI as readonly string[]).includes(ham ?? "") ? (ham as DurumSecimi) : VARSAYILAN_DURUM;
}
/** "hepsi" seçiliyken API'ye `status` GÖNDERİLMEZ. */
export function apiDurumu(secim: DurumSecimi): PreApplicationStatus | undefined {
  return secim === "hepsi" ? undefined : secim;
}
/**
 * Durumdan sonraki anlamlı geçişler — eski sözleşme birebir: NEW → Arandı; CONTACTED → Kazanıldı/Olumsuz;
 * sonuçlanmış kayıt Geri aç ile CONTACTED'a döner (yanlış tık telafisi).
 */
export function sonrakiAdimlar(status: PreApplicationStatus): { label: string; to: PreApplicationStatus }[] {
  switch (status) {
    case "NEW":
      return [{ label: "Arandı", to: "CONTACTED" }];
    case "CONTACTED":
      return [
        { label: "Kazanıldı", to: "CONVERTED" },
        { label: "Olumsuz", to: "REJECTED" },
      ];
    default:
      return [{ label: "Geri aç", to: "CONTACTED" }];
  }
}
/**
 * Ayrıntıdaki İSTEĞE BAĞLI alanlar — yalnız dolu olanlar. KVKK kabulü buraya girmez: backend'de her kayıtta
 * dolu olduğu için listeye katılsaydı "aday isteğe bağlı bölümleri doldurmadı" mesajı hiç görünmezdi.
 */
export function detaySatirlari(b: AdminTutorPreApplication): { etiket: string; deger: string }[] {
  return [
    { etiket: "Başlık", deger: b.headline },
    { etiket: "Ders biçimi", deger: b.teaching_mode ? BICIM_ETIKETI[b.teaching_mode] ?? b.teaching_mode : null },
    { etiket: "Saatlik ücret", deger: b.hourly_rate ? `${b.hourly_rate} ₺` : null },
    { etiket: "Eğitim", deger: b.education_note },
    { etiket: "Müsaitlik", deger: b.availability_note },
  ].filter((s): s is { etiket: string; deger: string } => Boolean(s.deger));
}
/** KVKK kabul tarihi (backend'den gelir; yeni veri istenmez). */
export function kvkkMetni(b: AdminTutorPreApplication): string | null {
  return b.kvkk_accepted_at ? KVKK_TARIHI.format(new Date(b.kvkk_accepted_at)) : null;
}

export function EgitmenOnBasvurulari() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("tutors");
  const [params, setParams] = useSearchParams();
  const secim = durumCoz(params.get("durum"));
  const sayfa = sayfaCoz(params.get("sayfa"));

  const sorgu = useAdminTutorPreApplications(apiDurumu(secim), canView, SAYFA_BOYUTU, sayfaOfseti(sayfa));
  const guncelle = useUpdateTutorPreApplicationStatus();

  const [acikId, setAcikId] = useState<number | null>(null);
  const [hatalar, setHatalar] = useState<Record<number, string | undefined>>({});
  const { kilitle, surenIslem } = useVarlikKilidi(message);

  /** Varsayılanlar URL'den silinir; ilgisiz parametreler korunur. Filtre replace, sayfa gezinmesi push. */
  const urlYaz = (yeniSecim: DurumSecimi, yeniSayfa: number, replace: boolean) => {
    const sonraki = new URLSearchParams(params);
    if (yeniSecim === VARSAYILAN_DURUM) sonraki.delete("durum");
    else sonraki.set("durum", yeniSecim);
    if (yeniSayfa <= 1) sonraki.delete("sayfa");
    else sonraki.set("sayfa", String(yeniSayfa));
    setParams(sonraki, { replace });
  };
  const secimiAyarla = (yeni: DurumSecimi) => {
    // Filtre değişince sayfa 1'e döner (2. sayfada dururken filtre değiştirmek boş liste gösterirdi).
    urlYaz(yeni, 1, true);
    // Liste değişir: açık ayrıntı ve satır hataları başka kayda kaymasın.
    setAcikId(null);
    setHatalar({});
  };
  const sayfayaGit = (hedef: number) => {
    urlYaz(secim, hedef, false);
    setAcikId(null);
    setHatalar({});
  };

  const liste: AdminTutorPreApplication[] = useMemo(() => (Array.isArray(sorgu.data) ? sorgu.data : []), [sorgu.data]);
  const veriHazir = Array.isArray(sorgu.data);
  // Sunucu toplam vermez: "daha eski" yalnız sayfa TAM doluyken vardır (son sayfada kayıt < boyut).
  const dahaEskiVar = veriHazir && liste.length === SAYFA_BOYUTU;
  const dahaYeniVar = sayfa > 1;
  // Bu sayfa bir kez doldu mu? Doluyken boşalma "veri azaldı" demektir (mutasyon/refetch) ve geri çekiliriz;
  // baştan boş açılan ileri sayfa ise arşivin sonudur ve terminal metni gösterilir.
  const sayfaDolduRef = useRef(false);
  useEffect(() => {
    // Geri/ileri ile sayfa değişiminde de yerel durum sıfırlanır (düğme yolları zaten sıfırlıyor).
    sayfaDolduRef.current = false;
    setAcikId(null);
    setHatalar({});
  }, [sayfa, secim]);
  useEffect(() => {
    if (!veriHazir) return;
    if (liste.length > 0) {
      sayfaDolduRef.current = true;
      return;
    }
    if (sayfa > 1 && sayfaDolduRef.current) {
      // Son erişilebilir önceki sayfaya REPLACE ile çekil: geri tuşu boş sayfaya dönmesin.
      urlYaz(secim, sayfa - 1, true);
      setAcikId(null);
      setHatalar({});
    }
    // `urlYaz` her render'da yeniden kurulur; bağımlılık listesi gerçek tetikleyicilerdir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veriHazir, liste.length, sayfa, secim]);
  // Önbellekte veri varken arka plan tazeleme hatası listeyi ÇÖPE ATMAZ: uyarı + yeniden dene.
  const tazelemeHatasi = sorgu.isError && veriHazir;

  const durumDegistir = (b: AdminTutorPreApplication, hedef: PreApplicationStatus, etiket: string) => {
    // Hedef başvuru kimliği ve hedef durum TIKLAMA anında sabitlenir.
    const hedefId = b.id;
    void kilitle(`basvuru:${hedefId}`, hedef, () => {
      setHatalar((h) => ({ ...h, [hedefId]: undefined }));
      return guncelle
        .mutateAsync({ id: hedefId, status: hedef })
        // `message.success` AntD'de thenable döner: zincirin dönüş değeri yapılırsa kilit mesaj kapanana kadar tutulurdu.
        .then(() => { message.success(`Başvuru "${etiket}" olarak işaretlendi.`); })
        // Hata YALNIZ kendi satırında; başka satırın hatası silinmez.
        .catch((e: unknown) => setHatalar((h) => ({ ...h, [hedefId]: getErrorDetail(e, "Durum güncellenemedi.") })));
    });
  };

  if (!canView) return <AccessDenied area="Öğretmen ön başvuruları" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };

  const bosDurum = sayfa > 1
    ? <BosDurumu baslik="Başvuru arşivinin sonu" aciklama="Bu sayfada kayıt yok; daha yeni başvurulara dönebilirsiniz." aksiyon={<Button onClick={() => sayfayaGit(sayfa - 1)}>← Daha yeni</Button>} />
    : secim === VARSAYILAN_DURUM
      ? <BosDurumu baslik="Aranacak yeni başvuru yok" aciklama="Yeni ön başvuru geldiğinde burada listelenir; hedef 24 saat içinde aramak." />
      : <BosDurumu baslik="Bu durumda ön başvuru yok" aciklama="Başka bir durumu seçebilir ya da yeni başvurulara dönebilirsiniz." aksiyon={<Button onClick={() => secimiAyarla(VARSAYILAN_DURUM)}>Yeni başvurulara dön</Button>} />;

  const satir = (b: AdminTutorPreApplication, i: number, dizi: AdminTutorPreApplication[]) => {
    const acik = acikId === b.id;
    const mesgul = surenIslem(`basvuru:${b.id}`);
    const ayrintilar = detaySatirlari(b);
    const bosAyrinti = ayrintilar.length === 0 && !b.bio && !b.intro_video_url;
    return (
      <div key={b.id} data-testid={`basvuru-${b.id}`} style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
        <Flex align="flex-start" justify="space-between" gap={12} wrap>
          <Flex align="flex-start" gap={12} style={{ minWidth: 0, flex: "1 1 260px" }}>
            {b.photo_url ? <Avatar src={b.photo_url} alt="" size={40} style={{ flexShrink: 0 }} /> : <Avatar size={40} style={{ flexShrink: 0 }}>{b.full_name.charAt(0).toLocaleUpperCase("tr")}</Avatar>}
            <div style={{ minWidth: 0 }}>
              <Flex align="baseline" gap={8} wrap>
                <Typography.Text id={`basvuru-ad-${b.id}`} style={{ fontWeight: 500, ...SAR }}>{b.full_name}</Typography.Text>
                <Tag color={DURUM_RENGI[b.status]} style={{ marginInlineEnd: 0 }}>{DURUM_ETIKETI[b.status] ?? b.status}</Tag>
              </Flex>
              <Flex align="baseline" gap={12} wrap style={{ marginTop: 2 }}>
                <Typography.Link href={`tel:${b.phone}`} style={{ fontWeight: 500, ...SAYI }}>{b.phone}</Typography.Link>
                {b.email ? <Typography.Link href={`mailto:${b.email}`} style={{ fontSize: 12, ...SAR }}>{b.email}</Typography.Link> : null}
              </Flex>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                {(b.district ?? "İlçe belirtilmedi") + " · " + (b.experience ? DENEYIM_ETIKETI[b.experience] ?? b.experience : "Deneyim belirtilmedi") + " · "}
                <span style={SAYI}>{TARIH.format(new Date(b.created_at))}</span>
              </Typography.Text>
              {/* Aday serbest metin yazar; eşlemeyi sunucu yapar. Ham metin de görünür: eşleşmenin neyden geldiği
                  görünmezse yanlış eşleşme fark edilmez. */}
              <Flex gap={4} wrap style={{ marginTop: 6 }}>
                {b.matched_subjects?.map((mm) => (
                  <Tag key={mm.id} color="success" title={`"${mm.source_text}" → ${mm.name}`} style={{ marginInlineEnd: 0 }}>{mm.name}</Tag>
                ))}
                {b.unmatched_subjects?.map((u) => (
                  // Nötr etiket: `warning` rengi satırda YALNIZ durum rozetine ayrılmıştır.
                  <Tag key={u} title="Katalogda karşılığı yok: eşanlamlı eklenebilir" style={{ marginInlineEnd: 0 }}>{u} · eşleşmedi</Tag>
                ))}
                {(b.matched_subjects?.length ?? 0) === 0 && (b.unmatched_subjects?.length ?? 0) === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, ...SAR }}>{b.subjects}</Typography.Text>
                ) : null}
              </Flex>
              {(b.documents?.length ?? 0) > 0 ? (
                <Flex gap={8} wrap style={{ marginTop: 6 }}>
                  {b.documents!.map((doc, di) => (
                    // Kısa ömürlü imzalı ADRES metin olarak basılmaz; dosya ADI görünür metinde durur (öznitelikte
                    // değil: `title`/`aria-label` telemetriye kopyalanabiliyor). Bağlantılar ikincil tonda ayrışır.
                    <Typography.Link
                      key={doc.url}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: token.colorTextSecondary, maxWidth: 180, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}
                    >
                      {doc.name || `Belge ${di + 1}`}
                    </Typography.Link>
                  ))}
                </Flex>
              ) : null}
              {b.note ? <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "6px 0 0", maxWidth: 320, ...SAR }}>{b.note}</Typography.Paragraph> : null}
            </div>
          </Flex>
          <Flex align="center" gap={8} wrap>
            {canManage
              ? sonrakiAdimlar(b.status).map((adim) => (
                  <VarlikDugmesi key={adim.to} islem={adim.to} mesgulIslem={mesgul} id={`basvuru-eylem-${b.id}-${adim.to}`} aria-labelledby={`basvuru-ad-${b.id} basvuru-eylem-${b.id}-${adim.to}`} onClick={() => durumDegistir(b, adim.to, adim.label)}>
                    {adim.label}
                  </VarlikDugmesi>
                ))
              : null}
            <Button aria-expanded={acik} aria-controls={`basvuru-detay-${b.id}`} id={`basvuru-detay-dugme-${b.id}`} aria-labelledby={`basvuru-ad-${b.id} basvuru-detay-dugme-${b.id}`} onClick={() => setAcikId(acik ? null : b.id)}>
              {acik ? "Kapat" : "Detay"}
            </Button>
          </Flex>
        </Flex>
        {hatalar[b.id] ? <div style={{ marginTop: 8 }}><HataDurumu hata={hatalar[b.id]!} /></div> : null}
        {acik ? (
          <div id={`basvuru-detay-${b.id}`} style={{ marginTop: 12, padding: "12px 16px", background: token.colorFillQuaternary, border: `1px solid ${ayrac}`, borderRadius: 4 }}>
            {bosAyrinti ? (
              <Typography.Text type="secondary" style={{ display: "block" }}>Aday isteğe bağlı bölümleri doldurmadı: bu bilgileri aramada sorabilirsiniz.</Typography.Text>
            ) : (
              <Flex gap={24} wrap align="flex-start">
                {ayrintilar.length > 0 ? (
                  <Flex vertical gap={6} style={{ flex: "1 1 240px", minWidth: 0 }}>
                    {ayrintilar.map((s) => (
                      <Flex key={s.etiket} gap={12} wrap>
                        <Typography.Text type="secondary" style={{ width: 120, flexShrink: 0, fontSize: 12 }}>{s.etiket}</Typography.Text>
                        <Typography.Text style={{ fontSize: 12, minWidth: 0, ...SAR }}>{s.deger}</Typography.Text>
                      </Flex>
                    ))}
                  </Flex>
                ) : null}
                {b.bio || b.intro_video_url ? (
                  <Flex vertical gap={8} style={{ flex: "1 1 240px", minWidth: 0 }}>
                    {b.bio ? <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-line", fontSize: 12, ...SAR }}>{b.bio}</Typography.Paragraph> : null}
                    {b.intro_video_url ? (
                      <Typography.Link href={b.intro_video_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>Tanıtım videosunu aç</Typography.Link>
                    ) : null}
                  </Flex>
                ) : null}
              </Flex>
            )}
            {kvkkMetni(b) ? (
              <Flex gap={12} wrap style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ayrac}` }}>
                <Typography.Text type="secondary" style={{ width: 120, flexShrink: 0, fontSize: 12 }}>KVKK kabulü</Typography.Text>
                <Typography.Text style={{ fontSize: 12, ...SAYI }}>{kvkkMetni(b)}</Typography.Text>
              </Flex>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  // Liste satırlarının kendi 12px dikey ritmi var; durum blokları kartın içinde nefes alsın diye ayrı dolgu.
  const doluListe = veriHazir && liste.length > 0;
  const govde = sorgu.isError && !veriHazir ? (
    <HataDurumu hata={getErrorDetail(sorgu.error, "Ön başvurular alınamadı.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />
  ) : !veriHazir ? (
    <YukleniyorDurumu etiket="Ön başvurular yükleniyor…" />
  ) : liste.length === 0 ? (
    bosDurum
  ) : (
    liste.map(satir)
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Ön başvurular</Typography.Title>
        <div role="group" aria-label="Durum filtresi" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented<DurumSecimi> value={secim} onChange={(v) => secimiAyarla(v)} options={FILTRELER.map((f) => ({ value: f.value, label: f.label }))} />
        </div>
      </Flex>
      {!canManage ? <Typography.Text type="secondary">Salt okunur görünüm: başvuru durumunu değiştirmek için tutors.manage izni gerekir.</Typography.Text> : null}
      <section aria-label="Ön başvurular" style={kart}>
        <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <div style={{ minWidth: 0 }}>
            <Typography.Text style={{ fontSize: 18, fontWeight: 500, display: "block" }}>Ön başvuru kuyruğu</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>/egitmen-on-basvuru formundan gelen kayıtlar. Hedef: yeni başvuruyu 24 saat içinde aramak.</Typography.Text>
          </div>
          {veriHazir && liste.length > 0 ? <Tag style={{ marginInlineEnd: 0, ...SAYI }}>{liste.length}</Tag> : null}
        </Flex>
        {/* D-7: tazeleme uyarısı listeye bitişik (kart içinde), sayfa başlığıyla liste arasında asılı kalmaz. */}
        {tazelemeHatasi ? <div style={{ padding: "12px 24px 0" }}><HataDurumu hata={getErrorDetail(sorgu.error, "Liste güncellenemedi; gösterilen kayıtlar önceki yüklemeden.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} /></div> : null}
        <div style={{ padding: doluListe ? "0 24px" : "16px 24px" }}>{govde}</div>
        {/* Sunucu toplam vermiyor: sayfa numarası ve yön düğmeleri var, uydurma "N kayıt" yok. */}
        {doluListe && (dahaYeniVar || dahaEskiVar) ? (
          <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 24px", borderTop: `1px solid ${ayrac}` }}>
            {dahaYeniVar ? <Button onClick={() => sayfayaGit(sayfa - 1)}>← Daha yeni</Button> : <span />}
            <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>{sayfa}. sayfa</Typography.Text>
            {dahaEskiVar ? <Button onClick={() => sayfayaGit(sayfa + 1)}>Daha eski →</Button> : <span />}
          </Flex>
        ) : null}
      </section>
    </Flex>
  );
}
