// Paketleme istasyonu / paket detayı — eski PackingStationPage panel düzeninde.
// Kalem listesi ekranın merkezidir; adetler YALNIZ sunucunun döndürdüğü paketten gelir (yerel sayaç yok).
// Tarama reddi de 200 döner: `result` her zaman okunur, bilinmeyen sonuç hata sayılır (lib/packing fail-closed).
// İdempotency anahtarları mantıksal işlem başına sabittir: tarama koda, satır işlemleri satıra bağlı;
// ağ hatasında korunur, sunucu sonucu kesinleşince yenilenir.
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, App, Button, Flex, Input, Tag, Typography, theme } from "antd";
import type { InputRef } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { AccessDenied } from "@/components/admin/AccessState";
import { PackageLabelButton } from "@/components/admin/packing/PackageLabel";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { BolmePenceresi, GerekcePenceresi } from "@/panel/pages/paketleme/PaketlemePencereleri";
import { usePaketlemeErisimi } from "@/panel/pages/paketleme/usePaketlemeErisimi";
import {
  useCompletePackage,
  usePackage,
  useScanPackageItem,
  useSplitPackage,
  useUndoPackageScan,
  useVoidPackage,
} from "@/hooks/usePacking";
import { getErrorDetail } from "@/lib/errors";
import {
  PACKAGE_STATUS_LABEL,
  completeBlockers,
  newIdempotencyKey,
  packageProgress,
  scanResultMessage,
  scanResultTone,
  type ScanTone,
} from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import type { PackageItem, PackageSplitLine, PackageStatus, ScanResult } from "@/types/packing";

/** URL kimliği yalnız düz pozitif tam sayı: "abc", "-1", "1e3", "0x10", "42.0", boşluk ve güvenli aralık dışı reddedilir. */
export function paketKimligi(ham: string | undefined): number | null {
  if (!ham || !/^\d+$/.test(ham)) return null;
  const sayi = Number(ham);
  return Number.isSafeInteger(sayi) && sayi > 0 ? sayi : null;
}

const DURUM_RENGI: Record<PackageStatus, string> = {
  OPEN: "blue",
  PACKED: "success",
  HANDED_OVER: "blue",
  RETURN_PENDING: "warning",
  RETURNED: "default",
  DELIVERED: "success",
  VOID: "error",
};

/** Sonucun kısa başlığı; uzun cümle `scanResultMessage`'da. Renk tek başına sonucu anlatmaz. */
const SONUC_BASLIGI: Record<ScanResult, string> = {
  OK: "Okutuldu",
  OK_MANUAL: "Elle doğrulandı",
  WRONG_SKU: "Yanlış ürün",
  OVER_QTY: "Fazla adet",
  ALREADY_COMPLETE: "Paket zaten tamam",
  UNSCANNABLE: "Okutulamaz satır",
};
export function sonucBasligi(result: string): string {
  // Bilinmeyen kod onaylanmaz (`scanResultTone` fail-closed ile aynı).
  return (SONUC_BASLIGI as Record<string, string | undefined>)[result] ?? "Kabul edilmedi";
}

/** `services/packing_rules.PACKAGE_ACTIONS["void"]` ile aynı küme; kesin karar sunucuda. */
const VAZGECILEBILIR: readonly string[] = ["OPEN", "PACKED", "RETURNED"];
/** Bölme yalnız AÇIK pakette (`packing_service.SPLITTABLE_STATUSES`). */
const BOLUNEBILIR: readonly string[] = ["OPEN"];

/**
 * Vazgeçme yetkisi duruma bağlıdır (`api/routers/packing.py`): uç `packing.pack` ister;
 * OPEN dışı paketlerde ayrıca `packing.manage`. Her iki izin de bağımsızdır.
 */
export function vazgecebilir(status: string, canPack: boolean, canManage: boolean): boolean {
  if (!VAZGECILEBILIR.includes(status)) return false;
  if (!canPack) return false;
  return status === "OPEN" || canManage;
}

type Bildirim = { tone: ScanTone; title: string; message: string };
const TON_TIPI: Record<ScanTone, "success" | "warning" | "error"> = { success: "success", warning: "warning", error: "error" };

/** Ekran durumu (pencereler, bildirim, anahtarlar) paket kimliğine bağlıdır: `:id` değişince sıfırdan kurulur. */
export function PaketlemeDetayi() {
  const { id } = useParams();
  return <PaketlemeDetayiIc key={id ?? ""} id={id} />;
}

function PaketlemeDetayiIc({ id }: { id: string | undefined }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const paketId = paketKimligi(id);
  const gecerli = paketId !== null;
  const { canView, canPack, canManage } = usePaketlemeErisimi();
  const sorgu = usePackage(paketId, canView && gecerli);

  const scan = useScanPackageItem();
  const undo = useUndoPackageScan();
  const complete = useCompletePackage();
  const voidPackage = useVoidPackage();
  const split = useSplitPackage();

  const [kod, setKod] = useState("");
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  const [tamamlaHatasi, setTamamlaHatasi] = useState<string | null>(null);
  const [manuelSatir, setManuelSatir] = useState<PackageItem | null>(null);
  const [manuelHatasi, setManuelHatasi] = useState<string | null>(null);
  // Elle doğrulama `scan` mutasyonunu paylaşır; pencerenin yükleniyor durumu kendi gönderimine bağlıdır.
  const [manuelGonderiliyor, setManuelGonderiliyor] = useState(false);
  const [geriAlSatir, setGeriAlSatir] = useState<PackageItem | null>(null);
  const [geriAlHatasi, setGeriAlHatasi] = useState<string | null>(null);
  const [vazgecAcik, setVazgecAcik] = useState(false);
  const [vazgecHatasi, setVazgecHatasi] = useState<string | null>(null);
  const [bolAcik, setBolAcik] = useState(false);
  const [bolHatasi, setBolHatasi] = useState<string | null>(null);
  const kutuRef = useRef<InputRef>(null);

  // Senkron kilitler: aynı tick'te (Enter basılı, çift tık) ikinci istek çıkmaz.
  const taramaRef = useRef(false);
  const manuelRef = useRef(false);
  const geriAlRef = useRef(false);
  const tamamlaRef = useRef(false);
  const vazgecRef = useRef(false);
  const bolRef = useRef(false);

  // İdempotency: tarama anahtarı KODA, satır anahtarları SATIRA bağlı; hata sonrası korunur.
  const taramaAnahtariRef = useRef<{ kod: string; anahtar: string } | null>(null);
  const manuelAnahtarRef = useRef<{ satirId: number; anahtar: string } | null>(null);
  const geriAlAnahtarRef = useRef<{ satirId: number; anahtar: string } | null>(null);
  const taramaAnahtari = (deger: string) => {
    if (taramaAnahtariRef.current?.kod !== deger) taramaAnahtariRef.current = { kod: deger, anahtar: newIdempotencyKey() };
    return taramaAnahtariRef.current.anahtar;
  };
  const satirAnahtari = (ref: typeof manuelAnahtarRef, satirId: number) => {
    if (ref.current?.satirId !== satirId) ref.current = { satirId, anahtar: newIdempotencyKey() };
    return ref.current.anahtar;
  };

  const paket = sorgu.data;

  /** Sunucu sonucunu tek yerden yazar; kod temizlenir ve odak barkod alanına döner. */
  const sonucuIsle = (result: string) => {
    setBildirim({ tone: scanResultTone(result), title: sonucBasligi(result), message: scanResultMessage(result) });
    setKod("");
    kutuRef.current?.focus();
  };
  const gonderimHatasi = (e: unknown, fallback: string) => {
    setBildirim({ tone: "error", title: "Gönderilemedi", message: getErrorDetail(e, fallback) });
    // İlk deneme sunucuda işlenmiş olabilir: adetler tazelenir ki operatör yeniden okutmadan gerçek sayıyı görsün.
    void sorgu.refetch();
    kutuRef.current?.focus();
  };

  const okut = async () => {
    const deger = kod.trim();
    if (!deger || !paket || taramaRef.current || scan.isPending) return;
    taramaRef.current = true;
    try {
      const sonuc = await scan.mutateAsync({ packageId: paket.id, payload: { code: deger, idempotency_key: taramaAnahtari(deger) } });
      // Sunucu yanıt verdi = işlem kesinleşti (red de bir sonuçtur). Sıradaki okutma yeni iştir.
      taramaAnahtariRef.current = null;
      sonucuIsle(sonuc.result);
    } catch (e) {
      // Ağ/sunucu hatası: kod ve anahtar korunur, aynı istek yeniden denenebilir.
      gonderimHatasi(e, "Okutma gönderilemedi.");
    } finally {
      taramaRef.current = false;
    }
  };

  const elleDogrula = async (gerekce: string) => {
    if (!paket || !manuelSatir || manuelRef.current || scan.isPending) return;
    const hedef = manuelSatir;
    manuelRef.current = true;
    setManuelHatasi(null);
    setManuelGonderiliyor(true);
    try {
      const sonuc = await scan.mutateAsync({
        packageId: paket.id,
        payload: { manual: true, manual_reason: gerekce, order_item_id: hedef.order_item_id, idempotency_key: satirAnahtari(manuelAnahtarRef, hedef.order_item_id) },
      });
      manuelAnahtarRef.current = null;
      setManuelSatir(null);
      sonucuIsle(sonuc.result);
    } catch (e) {
      // Pencere ve gerekçe açık kalır; anahtar korunur (yeniden deneme tek iş).
      setManuelHatasi(getErrorDetail(e, "Elle doğrulama gönderilemedi."));
      void sorgu.refetch();
    } finally {
      manuelRef.current = false;
      setManuelGonderiliyor(false);
    }
  };

  const geriAl = async (gerekce: string) => {
    if (!paket || !geriAlSatir || geriAlRef.current || undo.isPending) return;
    const hedef = geriAlSatir;
    geriAlRef.current = true;
    setGeriAlHatasi(null);
    try {
      // Geri alma durum-idempotan DEĞİL: anahtarsız ağ tekrarı adedi iki kez düşürür.
      await undo.mutateAsync({
        packageId: paket.id,
        payload: { order_item_id: hedef.order_item_id, reason: gerekce, idempotency_key: satirAnahtari(geriAlAnahtarRef, hedef.order_item_id) },
      });
      geriAlAnahtarRef.current = null;
      setGeriAlSatir(null);
      message.success("Okutma geri alındı.");
      kutuRef.current?.focus();
    } catch (e) {
      setGeriAlHatasi(getErrorDetail(e, "Geri alınamadı."));
      void sorgu.refetch();
    } finally {
      geriAlRef.current = false;
    }
  };

  const tamamla = async () => {
    if (!paket || tamamlaRef.current || complete.isPending) return;
    const hedefId = paket.id;
    const kodu = paket.code;
    tamamlaRef.current = true;
    setTamamlaHatasi(null);
    try {
      await complete.mutateAsync(hedefId);
      message.success(`${kodu} paketlendi.`);
    } catch (e) {
      // 409 STALE / eksik kalem yalnız metinle ayrılır; sebep ekranda KALIR.
      setTamamlaHatasi(getErrorDetail(e, "Paket kapatılamadı."));
      // STALE/eksik kalem: satır listesi tazelenir, hata metni ekranda kalır.
      void sorgu.refetch();
    } finally {
      tamamlaRef.current = false;
    }
  };

  const vazgec = async (gerekce: string) => {
    if (!paket || vazgecRef.current || voidPackage.isPending) return;
    const hedefId = paket.id;
    const kodu = paket.code;
    vazgecRef.current = true;
    setVazgecHatasi(null);
    try {
      await voidPackage.mutateAsync({ packageId: hedefId, reason: gerekce });
      setVazgecAcik(false);
      message.success(`${kodu} paketinden vazgeçildi.`);
    } catch (e) {
      setVazgecHatasi(getErrorDetail(e, "Paketten vazgeçilemedi."));
    } finally {
      vazgecRef.current = false;
    }
  };

  const bol = async (lines: PackageSplitLine[], promisedDate: string | null) => {
    if (!paket || bolRef.current || split.isPending) return;
    const hedefId = paket.id;
    bolRef.current = true;
    setBolHatasi(null);
    try {
      const yeni = await split.mutateAsync({ packageId: hedefId, payload: { lines, promised_date: promisedDate } });
      setBolAcik(false);
      message.success(`Kalan kalemler ${yeni.code} paketine ayrıldı (${yeni.package_no}. teslimat).`);
    } catch (e) {
      // Pencere AÇIK kalır: adetler duruyor, operatör düzeltip yeniden gönderebilir.
      setBolHatasi(getErrorDetail(e, "Bölme yapılamadı."));
      // Bölme ucunda idempotency anahtarı yok: ağ hatasında ilk istek işlenmiş olabilir; kaynak paket tazelenir ki
      // pencere gerçek adetleri göstersin ve yeniden gönderim üçüncü paket açmasın.
      void sorgu.refetch();
    } finally {
      bolRef.current = false;
    }
  };

  if (!canView) return <AccessDenied area="Paketleme" />;
  const listeyeDon = <Button size="small" onClick={() => navigate(ROUTES.adminNewPackingPackages)}>Paketler listesine dön</Button>;
  if (!gecerli) return <HataDurumu hata="Paket adresi geçersiz. Paketler listesinden yeniden açın." hataAksiyon={listeyeDon} />;
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Paket yükleniyor…" />;
  if (sorgu.isError) {
    const durum = (sorgu.error as { response?: { status?: number } })?.response?.status;
    if (durum === 404) return <HataDurumu hata="Paket bulunamadı" hataAksiyon={listeyeDon} />;
    return <HataDurumu hata={getErrorDetail(sorgu.error, "Paket yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />;
  }
  if (!paket) return <YukleniyorDurumu etiket="Paket yükleniyor…" />;

  const acik = paket.status === "OPEN";
  const okutabilir = acik && canPack;
  const ilerleme = packageProgress(paket.items);
  const engeller = completeBlockers(paket);
  // Tutarsızlık gizlenmez: eksik adet satır satır tavanlanmadan toplanır; fazla okutulmuş satır ayrıca yazılır.
  const eksikAdet = paket.items.reduce((n, s) => n + Math.max(s.expected_qty - s.scanned_qty, 0), 0);
  const fazlaSatirlar = paket.items.filter((s) => s.scanned_qty > s.expected_qty);
  const kart = { background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 24 };
  const bolunebilir = canPack && BOLUNEBILIR.includes(paket.status) && paket.items.length > 0;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Flex align="center" gap={12} wrap>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={() => navigate(ROUTES.adminNewPackingPackages)} />
          <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>{paket.code}</Typography.Title>
          <Tag color={DURUM_RENGI[paket.status] ?? "default"} style={{ marginInlineEnd: 0 }}>{PACKAGE_STATUS_LABEL[paket.status] ?? paket.status}</Tag>
          <Typography.Text style={{ fontVariantNumeric: "tabular-nums" }}>{ilerleme.scanned} / {ilerleme.expected} okutuldu</Typography.Text>
        </Flex>
        <Flex gap={8} wrap>
          {/* Etiket yalnız basılabilir durumda çıkar (`canPrintLabel`); alıcı/adres yalnız açılınca çekilir. */}
          <PackageLabelButton packageId={paket.id} code={paket.code} status={paket.status} />
          {bolunebilir ? <Button onClick={() => { setBolHatasi(null); setBolAcik(true); }}>Kalanı sonraya ayır</Button> : null}
          {vazgecebilir(paket.status, canPack, canManage) ? <Button danger onClick={() => { setVazgecHatasi(null); setVazgecAcik(true); }}>Paketten vazgeç</Button> : null}
        </Flex>
      </Flex>
      <Typography.Text type="secondary">
        Sipariş <Link to={`${ROUTES.adminNewPackingPackages}?siparis=${paket.order_id}`} style={{ fontWeight: 500 }}>#{paket.order_id}</Link> · {paket.package_no}. paket
      </Typography.Text>

      {!acik ? (
        <Alert type="info" showIcon message={`Bu paket "${PACKAGE_STATUS_LABEL[paket.status] ?? paket.status}" durumunda; okutma ve kapatma yalnız paketlenmekte olan pakette yapılır.`} />
      ) : !canPack ? (
        <Alert type="info" showIcon message="Salt okunur görünüm: okutma, elle doğrulama ve kapatma için packing.pack izni gerekir." />
      ) : null}

      {fazlaSatirlar.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message="Veri tutarsızlığı: beklenenden fazla okutulmuş satır var"
          description={
            <>
              <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
                {fazlaSatirlar.map((s) => (
                  <li key={s.order_item_id}>“{s.title}”: beklenen {s.expected_qty}, okutulan {s.scanned_qty}</li>
                ))}
              </ul>
              Kutuya fazladan ürün koymayın. Sayfayı yenileyin; sayı değişmiyorsa fazlalığı gerekçeyle geri alın ve yöneticinize bildirin.
            </>
          }
        />
      ) : null}

      {okutabilir ? (
        <section aria-label="Okutma" style={kart}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void okut();
            }}
          >
            <Flex align="flex-end" gap={12} wrap>
              <label htmlFor="paketleme-kod" style={{ flex: "1 1 256px", minWidth: 0 }}>
                <Typography.Text style={{ fontWeight: 500, display: "block", marginBottom: 4 }}>Barkod veya SKU okut</Typography.Text>
                <Input
                  ref={kutuRef}
                  id="paketleme-kod"
                  // Depo kullanımı: barkod tabancası "yaz + Enter" gönderir; odak kutuda değilse okutma kaybolur.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  autoComplete="off"
                  size="large"
                  value={kod}
                  onChange={(e) => setKod(e.target.value)}
                  placeholder="Tabancayla okutun ya da kodu yazıp Enter'a basın"
                  style={{ height: 40 }}
                />
              </label>
              <Button type="primary" htmlType="submit" loading={scan.isPending && !manuelGonderiliyor}>Okut</Button>
            </Flex>
          </form>
          {bildirim ? (
            <Alert type={TON_TIPI[bildirim.tone]} showIcon message={bildirim.title} description={bildirim.message} style={{ marginTop: 12 }} />
          ) : null}
        </section>
      ) : null}

      <section aria-label="Kutuya girecek kalemler" style={{ ...kart, padding: 0 }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Typography.Text style={{ fontWeight: 500, display: "block" }}>Kutuya girecek kalemler</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Her satır ürünün kendi kodundan doğrulanır; kodu okunamayan satır gerekçeyle elle kapatılır ve gerekçe kayda geçer.
          </Typography.Text>
        </div>
        <div style={{ padding: "0 24px" }}>
          {paket.items.length === 0 ? (
            <Typography.Text type="secondary" style={{ display: "block", padding: "16px 0" }}>Pakette hiç kalem yok.</Typography.Text>
          ) : (
            paket.items.map((satir, i, dizi) => {
              const kalan = satir.expected_qty - satir.scanned_qty;
              const tamam = kalan <= 0;
              return (
                <Flex
                  key={satir.order_item_id}
                  data-testid={`satir-${satir.order_item_id}`}
                  align="center"
                  justify="space-between"
                  gap={12}
                  wrap
                  style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${token.colorBorderSecondary}` }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                    <Typography.Text style={{ fontWeight: 500, display: "block", overflowWrap: "anywhere" }}>{satir.title}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace" }}>
                      {satir.sku ?? "SKU yok"}
                      {satir.barcode ? ` · ${satir.barcode}` : ""}
                    </Typography.Text>
                  </div>
                  <Flex align="center" gap={8} wrap>
                    {/* Renk tek başına durum göstermez: sayı ve "tamam" metni de yazılır. */}
                    <Typography.Text style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      <strong>{satir.scanned_qty}</strong> / {satir.expected_qty} adet{tamam ? " · tamam" : ""}
                    </Typography.Text>
                    {okutabilir ? (
                      <>
                        {satir.scanned_qty > 0 ? <Button onClick={() => { setGeriAlHatasi(null); setGeriAlSatir(satir); }}>Geri al</Button> : null}
                        {!tamam ? <Button onClick={() => { setManuelHatasi(null); setManuelSatir(satir); }}>Elle doğrula</Button> : null}
                      </>
                    ) : null}
                  </Flex>
                </Flex>
              );
            })
          )}
        </div>
      </section>

      {okutabilir ? (
        <section aria-label="Paketi tamamla" style={kart}>
          <Flex align="center" justify="space-between" gap={12} wrap>
            <div style={{ minWidth: 0, flex: "1 1 240px" }}>
              {/* Kapalı düğme sessiz kalmaz: operatör neden kapatamadığını görür; engelin varlığı `completeBlockers`tan. */}
              {engeller.length === 0 ? (
                <Typography.Text type="secondary">Bütün kalemler doğrulandı. Kutuyu kapatıp etiketini yapıştırın.</Typography.Text>
              ) : paket.items.length === 0 ? (
                <Typography.Text type="warning">{engeller[0]}</Typography.Text>
              ) : (
                <Typography.Text type="warning">Paketi kapatmak için {eksikAdet} adet daha okutulmalı. Eksik satırlar listede “okutulan / beklenen” sayısıyla görünür.</Typography.Text>
              )}
            </div>
            <Button type="primary" disabled={engeller.length > 0} loading={complete.isPending} onClick={() => void tamamla()}>
              Paketi tamamla
            </Button>
          </Flex>
          {tamamlaHatasi ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              message="Paket kapatılamadı"
              description={`${tamamlaHatasi} Kalem listesi değişmiş olabilir (sipariş güncellendi). Sayfayı yenileyip ekrandaki adetleri kutuyla yeniden karşılaştırın.`}
            />
          ) : null}
        </section>
      ) : null}

      <GerekcePenceresi
        kimlik="elle-dogrula-gerekce"
        acik={manuelSatir !== null}
        kapat={() => setManuelSatir(null)}
        kaydediyor={manuelGonderiliyor}
        hata={manuelHatasi}
        kilitliMi={() => manuelRef.current}
        baslik="Elle doğrula"
        aciklama={manuelSatir ? `“${manuelSatir.title}” satırı koddan okutulmadan kapatılacak. Gerekçe kayda geçer.` : ""}
        yerTutucu="Örn. ürün barkodu yırtılmış, rafta el yazısı etiket var"
        kaydetMetni="Elle doğrula"
        onayla={(g) => void elleDogrula(g)}
      />
      <GerekcePenceresi
        kimlik="geri-al-gerekce"
        acik={geriAlSatir !== null}
        kapat={() => setGeriAlSatir(null)}
        kaydediyor={undo.isPending}
        hata={geriAlHatasi}
        kilitliMi={() => geriAlRef.current}
        baslik="Okutmayı geri al"
        aciklama={geriAlSatir ? `“${geriAlSatir.title}” satırından bir adet düşülecek. Gerekçe kayda geçer.` : ""}
        yerTutucu="Örn. yanlış kutuya kondu, rafa geri götürüldü"
        kaydetMetni="Geri al"
        onayla={(g) => void geriAl(g)}
      />
      <GerekcePenceresi
        kimlik="vazgec-gerekce"
        acik={vazgecAcik}
        kapat={() => setVazgecAcik(false)}
        kaydediyor={voidPackage.isPending}
        hata={vazgecHatasi}
        kilitliMi={() => vazgecRef.current}
        baslik="Paketten vazgeç"
        aciklama="Kutu bozulur, içerik rafa döner ve sipariş yeniden paketlenmeyi bekler. Gerekçe kayda geçer."
        yerTutucu="Örn. sipariş iptal edildi, kutu hasar gördü"
        // Çekmece iptal düğmesi "Vazgeç" olduğundan onay düğmesi ayrı ad taşır (ekran okuyucu ayrımı).
        kaydetMetni="Paketten vazgeç"
        onayla={(g) => void vazgec(g)}
      />
      <BolmePenceresi
        acik={bolAcik}
        kapat={() => setBolAcik(false)}
        kaydediyor={split.isPending}
        hata={bolHatasi}
        kilitliMi={() => bolRef.current}
        code={paket.code}
        items={paket.items}
        onayla={(lines, tarih) => void bol(lines, tarih)}
      />
    </Flex>
  );
}
