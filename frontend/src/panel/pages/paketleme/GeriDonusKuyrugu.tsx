// Geri dönüş kuyruğu — eski ReturnQueuePage panel düzeninde: kuryeden dönmesi beklenen kutular,
// sunucu sırasıyla (en uzun bekleyen önce) ve sunucu sayfalamasıyla. Görünürlük aracıdır; depoya kabul
// yalnız packing.manage ile (görev ayrılığı; kesin karar backend'de). Kabul yeniden paketleme YAPMAZ.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { App, Button, Flex, Pagination, Tag, Typography, theme } from "antd";
import { AccessDenied } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { DepoyaAlPenceresi } from "@/panel/pages/paketleme/DepoyaAlPenceresi";
import { usePaketlemeErisimi } from "@/panel/pages/paketleme/usePaketlemeErisimi";
import { useReturnInPackage, useReturnQueue } from "@/hooks/usePacking";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import type { PackageReturnInPayload, ReturnQueueRow } from "@/types/packing";

/** Bekleme süresi kaç günden sonra "takip edilmeli" sayılır. */
export const GECIKME_ESIGI = 3;
/** Sunucu tavanı 200; kardeş ekranlarla aynı sayfa boyu. */
const LIMIT = 50;

/** Geçersiz/negatif/bilimsel/safe-integer dışı/boş sayfa 1'e düşer. */
export function sayfaNo(ham: string | null): number {
  if (!ham || !/^\d+$/.test(ham)) return 1;
  const n = Number(ham);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

// 422 `note` → alan hatası; eşleşmeyenler genel hata. Miras adlar ("constructor") alan sayılmaz.
export function kabulHatasiniDagit(e: unknown, varsayilan: string): { alan: string | null; genel: string | null } {
  const yanit = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) return { alan: null, genel: getErrorDetail(e, varsayilan) };
  const alan: string[] = [];
  const genel: string[] = [];
  for (const oge of detay as { loc?: unknown; msg?: unknown }[]) {
    const mesaj = typeof oge?.msg === "string" && oge.msg.trim() ? oge.msg : "Bu alan geçersiz.";
    const parcalar = Array.isArray(oge?.loc) ? oge.loc.filter((p): p is string => typeof p === "string") : [];
    const ham = parcalar.filter((p) => !["body", "query", "path", "header", "cookie"].includes(p)).at(-1);
    if (ham === "note") alan.push(mesaj);
    else genel.push(mesaj);
  }
  return { alan: alan.length ? alan.join(" ") : null, genel: genel.length ? genel.join(" ") : alan.length ? null : "Gönderilen bilgi geçersiz." };
}

export function GeriDonusKuyrugu() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canView, canManage } = usePaketlemeErisimi();
  const [params, setParams] = useSearchParams();
  const sayfa = sayfaNo(params.get("sayfa"));
  const sorgu = useReturnQueue({ limit: LIMIT, offset: (sayfa - 1) * LIMIT }, canView);
  const depoyaAl = useReturnInPackage();
  // Hedef pencere açılırken sabitlenir; sonraki liste tazelemesi hedefi değiştirmez.
  const [hedef, setHedef] = useState<ReturnQueueRow | null>(null);
  const [alanHatasi, setAlanHatasi] = useState<string | null>(null);
  const [genelHata, setGenelHata] = useState<string | null>(null);
  // Senkron kilit: aynı tick'te ikinci gönderim çıkmaz; pending'de pencere kapanmaz.
  const kilitRef = useRef(false);

  const satirlar = sorgu.data?.items ?? [];
  // `total` süzülmüş toplamdır, sayfanın uzunluğu değil.
  const toplam = sorgu.data?.total ?? 0;
  const sonSayfa = Math.max(1, Math.ceil(toplam / LIMIT));
  const sayfaGit = (yeni: number, replace = false) => setParams(yeni <= 1 ? {} : { sayfa: String(yeni) }, { replace });

  // Veri azalınca etkin sayfa son geçerli sayfaya çekilir; yanlış boş ekran oluşmaz.
  useEffect(() => {
    if (sorgu.data && sayfa > sonSayfa) sayfaGit(sonSayfa, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorgu.data, sayfa, sonSayfa]);

  const pencereyiAc = (satir: ReturnQueueRow) => {
    setAlanHatasi(null);
    setGenelHata(null);
    setHedef(satir);
  };
  const kabulEt = async (payload: PackageReturnInPayload) => {
    if (!hedef || kilitRef.current || depoyaAl.isPending) return;
    const hedefId = hedef.package_id;
    kilitRef.current = true;
    setAlanHatasi(null);
    setGenelHata(null);
    try {
      await depoyaAl.mutateAsync({ packageId: hedefId, payload });
      setHedef(null);
      message.success("Kutu depoya alındı.");
    } catch (e) {
      // Pencere ve not korunur; yeniden deneme mümkün.
      const { alan, genel } = kabulHatasiniDagit(e, "Kutu depoya alınamadı.");
      setAlanHatasi(alan);
      setGenelHata(genel);
    } finally {
      kilitRef.current = false;
    }
  };

  if (!canView) return <AccessDenied area="Paketleme" />;

  const govde = sorgu.isError ? (
    <div style={{ padding: "16px 0" }}>
      <HataDurumu hata={getErrorDetail(sorgu.error, "Geri dönüş kuyruğu yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />
    </div>
  ) : sorgu.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Kuyruk yükleniyor…" /></div>
  ) : satirlar.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Araçta bekleyen kutu bulunmuyor" aciklama="Teslim edilemeyen bir paket olduğunda kutusu burada listelenir." /></div>
  ) : (
    satirlar.map((satir, i, dizi) => {
      const gecikti = satir.waiting_days >= GECIKME_ESIGI;
      return (
        <Flex key={satir.package_id} data-testid={`satir-${satir.package_id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ minWidth: 0, flex: "1 1 224px" }}>
            <Flex align="baseline" gap={8} wrap>
              <Link to={ROUTES.adminNewPackingPackage(satir.package_id)} style={{ fontWeight: 500 }}>{satir.package_code}</Link>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                sipariş <Link to={ROUTES.adminNewOrder(satir.order_id)}>#{satir.order_id}</Link>
              </Typography.Text>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>{satir.courier_name ?? "Kurye kaydı bulunmuyor"}</Typography.Text>
          </div>
          <Flex align="center" gap={8} wrap>
            {/* Renk tek başına uyarı değildir: gün sayısı ve "takip edilmeli" metinde yazar. */}
            <Tag color={gecikti ? "warning" : "default"} style={{ marginInlineEnd: 0, fontVariantNumeric: "tabular-nums" }}>
              {satir.waiting_days} gündür araçta{gecikti ? " · takip edilmeli" : ""}
            </Tag>
            {canManage ? <Button onClick={() => pencereyiAc(satir)}>Depoya al</Button> : null}
          </Flex>
        </Flex>
      );
    })
  );

  return (
    <Flex vertical gap={24}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Geri dönüş</Typography.Title>
        {toplam > 0 ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>{toplam} kutu</Tag> : null}
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">Bu alanda yalnız görüntüleme yetkiniz var; kutuyu depoya almak için packing.manage izni gerekir.</Typography.Text>
      ) : null}
      <section aria-label="Geri dönüş kuyruğu" style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4 }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Typography.Text type="secondary">Kuryeden dönmesi beklenen kutular. Kutu depoya geldiğinde burada kabul edin; ancak ondan sonra yeniden dağıtıma verilebilir. En uzun süredir bekleyen en üstte.</Typography.Text>
        </div>
        <div style={{ padding: "0 24px" }}>{govde}</div>
        {toplam > LIMIT ? (
          <Flex justify="flex-end" align="center" style={{ padding: "16px 24px", borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <Pagination size="small" current={Math.min(sayfa, sonSayfa)} pageSize={LIMIT} total={toplam} showSizeChanger={false} onChange={(s) => sayfaGit(s)} showTotal={(t, [bas, son]) => `${bas} - ${son} / ${t} kutu`} />
          </Flex>
        ) : null}
      </section>
      <DepoyaAlPenceresi
        acik={hedef !== null}
        paketKodu={hedef?.package_code}
        kapat={() => setHedef(null)}
        kaydediyor={depoyaAl.isPending}
        alanHatasi={alanHatasi}
        hata={genelHata}
        kilitliMi={() => kilitRef.current}
        onayla={(payload) => void kabulEt(payload)}
      />
    </Flex>
  );
}
