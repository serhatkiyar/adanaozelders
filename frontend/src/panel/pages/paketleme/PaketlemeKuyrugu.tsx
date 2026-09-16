// Paketleme kuyruğu — eski PackingQueuePage panel düzeninde. Eylemi SUNUCU söyler
// (`next_action`), ekran çıkarmaz; bilinmeyen/eksik değer fail-closed: yazma eylemi yok.
// Devam et / Paketi gör / açılan paket yeni paket detayına (ROUTES.adminNewPackingPackage) gider.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Flex, Pagination, Tag, Typography, theme } from "antd";
import { AccessDenied } from "@/components/admin/AccessState";
import { ItemLines } from "@/components/admin/delivery/ItemLines";
import { PromiseChip } from "@/components/admin/delivery/bits";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { usePaketlemeErisimi } from "@/panel/pages/paketleme/usePaketlemeErisimi";
import { useOpenPackage, usePackingQueue, useRepackPackage } from "@/hooks/usePacking";
import { getErrorDetail } from "@/lib/errors";
import { PACKAGE_STATUS_LABEL } from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import type { PackingQueueRow } from "@/types/packing";

/** Sunucu tavanı 200; 50 satır bir vardiyanın bakabileceği en büyük öbek. */
const LIMIT = 50;

/** Geçersiz/negatif/boş sayfa 1'e düşer. */
export function sayfaNo(ham: string | null): number {
  if (!ham || !/^\d+$/.test(ham)) return 1;
  const n = Number(ham);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

export function PaketlemeKuyrugu() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { canView, canPack, canManage } = usePaketlemeErisimi();
  const [params, setParams] = useSearchParams();
  const sayfa = sayfaNo(params.get("sayfa"));
  const sorgu = usePackingQueue({ limit: LIMIT, offset: (sayfa - 1) * LIMIT }, canView);
  const paketAc = useOpenPackage();
  const yenidenPaketle = useRepackPackage();
  // İşlem bazlı senkron kilit: "ac:<orderId>" / "repack:<packageId>"; başka satırlar serbest.
  const bekleyenRef = useRef(new Set<string>());
  const [bekleyenler, setBekleyenler] = useState<string[]>([]);

  const satirlar = sorgu.data?.items ?? [];
  const toplam = sorgu.data?.total ?? 0;
  const sonSayfa = Math.max(1, Math.ceil(toplam / LIMIT));

  const sayfaGit = (yeni: number, replace = false) =>
    setParams(yeni <= 1 ? {} : { sayfa: String(yeni) }, { replace });

  // Veri azalınca etkin sayfa son geçerli sayfaya çekilir; yanlış boş ekran oluşmaz.
  useEffect(() => {
    if (sorgu.data && sayfa > sonSayfa) sayfaGit(sonSayfa, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorgu.data, sayfa, sonSayfa]);

  const kilitle = (anahtar: string) => {
    if (bekleyenRef.current.has(anahtar)) return false;
    bekleyenRef.current.add(anahtar);
    setBekleyenler((o) => [...o, anahtar]);
    return true;
  };
  const birak = (anahtar: string) => {
    bekleyenRef.current.delete(anahtar);
    setBekleyenler((o) => o.filter((a) => a !== anahtar));
  };

  // Hedef orderId tıklama anında sabit; istasyona SUNUCUNUN döndürdüğü paketle gidilir.
  const paketAcVeGit = async (orderId: number) => {
    const anahtar = `ac:${orderId}`;
    if (!kilitle(anahtar)) return;
    try {
      const paket = await paketAc.mutateAsync(orderId);
      navigate(ROUTES.adminNewPackingPackage(paket.id));
    } catch (e) {
      message.error(getErrorDetail(e, "Paket açılamadı."));
    } finally {
      birak(anahtar);
    }
  };
  const yenidenPaketleVeBildir = async (packageId: number) => {
    const anahtar = `repack:${packageId}`;
    if (!kilitle(anahtar)) return;
    try {
      await yenidenPaketle.mutateAsync(packageId);
      message.success("Paket yeniden dağıtıma hazır.");
    } catch (e) {
      message.error(getErrorDetail(e, "Paket yeniden dağıtıma verilemedi."));
    } finally {
      birak(anahtar);
    }
  };

  /** Satırın önerdiği TEK eylem. Bilinmeyen değerde yazma sunulmaz; paket varsa yalnız okuma bağlantısı. */
  const satirAksiyonu = (row: PackingQueueRow) => {
    const paketId = row.package?.id ?? null;
    if (row.next_action === "OPEN_NEW_PACKAGE" && canPack) {
      const anahtar = `ac:${row.order_id}`;
      return (
        <Button type="primary" loading={bekleyenler.includes(anahtar)} onClick={() => void paketAcVeGit(row.order_id)}>
          Paketlemeye başla
        </Button>
      );
    }
    if (row.next_action === "CONTINUE_PACKING" && canPack && paketId != null) {
      return <Link to={ROUTES.adminNewPackingPackage(paketId)} style={{ fontWeight: 500 }}>Paketlemeye devam et</Link>;
    }
    if (row.next_action === "REPACK_RETURNED" && paketId != null) {
      if (!canManage) {
        return (
          <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 220, display: "block" }}>
            Depoya dönen bu paketi yeniden dağıtıma vermek için paket yönetimi izni gerekir.
          </Typography.Text>
        );
      }
      const anahtar = `repack:${paketId}`;
      return (
        <Button loading={bekleyenler.includes(anahtar)} onClick={() => void yenidenPaketleVeBildir(paketId)}>
          Yeniden paketle
        </Button>
      );
    }
    if (paketId != null) return <Link to={ROUTES.adminNewPackingPackage(paketId)}>Paketi gör →</Link>;
    return null;
  };

  if (!canView) return <AccessDenied area="Paketleme" />;

  const govde = sorgu.isError ? (
    <div style={{ padding: "16px 0" }}>
      <HataDurumu hata={getErrorDetail(sorgu.error, "Kuyruk yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />
    </div>
  ) : sorgu.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Kuyruk yükleniyor…" /></div>
  ) : satirlar.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Paketlenecek sipariş yok" aciklama="Yeni fiziksel siparişler ödendikçe burada belirir." /></div>
  ) : (
    satirlar.map((row, i, dizi) => (
      <Flex key={row.order_id} align="flex-start" justify="space-between" gap={12} wrap style={{ padding: "16px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${token.colorBorderSecondary}` }}>
        <div style={{ minWidth: 0, flex: "1 1 256px" }}>
          <Flex align="baseline" gap={8} wrap>
            <Typography.Text style={{ fontWeight: 500 }}>{row.recipient ?? "Alıcı bilgisi girilmemiş"}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>#{row.order_id}</Typography.Text>
          </Flex>
          <Flex align="center" gap={6} wrap style={{ marginTop: 2 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{row.address ?? "Adres yok"}</Typography.Text>
            <PromiseChip date={row.promised_delivery_date} />
          </Flex>
          {/* Operatör NE toplayacağını görmeden rafa gitmez: "N parça" özeti kalem listesinin yerine geçmez. */}
          <ItemLines items={row.items} className="mt-1.5" />
        </div>
        <Flex align="center" justify="flex-end" gap={8} wrap style={{ flexShrink: 0 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{row.item_count} parça</Typography.Text>
          {row.package ? (
            <Tag style={{ marginInlineEnd: 0 }}>{row.package.code} · {PACKAGE_STATUS_LABEL[row.package.status] ?? row.package.status}</Tag>
          ) : null}
          {satirAksiyonu(row)}
        </Flex>
      </Flex>
    ))
  );

  return (
    <Flex vertical gap={24}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Paketleme kuyruğu</Typography.Title>
        {toplam > 0 ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>{toplam} sipariş</Tag> : null}
      </Flex>
      {!canPack && !canManage ? (
        <Typography.Text type="secondary">Bu alanda yalnız görüntüleme yetkiniz var; paket açmak için packing.pack, yeniden paketlemek için packing.manage izni gerekir.</Typography.Text>
      ) : null}
      <section aria-label="Paketleme kuyruğu" style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4 }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Typography.Text type="secondary">Ödenmiş fiziksel siparişler, söz gününe göre sıralı. Sıradaki işi buradan başlatın; kalemler istasyonda tek tek okutulur.</Typography.Text>
        </div>
        <div style={{ padding: "0 24px" }}>{govde}</div>
        {toplam > LIMIT ? (
          <Flex justify="flex-end" align="center" style={{ padding: "16px 24px", borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <Pagination
              size="small"
              current={Math.min(sayfa, sonSayfa)}
              pageSize={LIMIT}
              total={toplam}
              showSizeChanger={false}
              onChange={(s) => sayfaGit(s)}
              showTotal={(t, [bas, son]) => `${bas} - ${son} / ${t} sipariş`}
            />
          </Flex>
        ) : null}
      </section>
    </Flex>
  );
}
