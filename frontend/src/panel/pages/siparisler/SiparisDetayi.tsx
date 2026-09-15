// Sipariş detayı — eski OrdersPanel satır bilgileri ve aksiyonları (kargola / teslim / iade)
// AntD + panel tema düzeninde. Veri tekil yönetim ucundan (useAdminOrder); FSM otoritesi backend.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Flex, Table, Tag, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { basligaOlcumStiliEkle } from "@/panel/components/ListePage";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { IadePenceresi, KargoPenceresi } from "@/panel/pages/siparisler/SiparisDetayPencereleri";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { deliverOrder, refundOrder, shipOrder } from "@/api/store";
import { useAdminOrder, useInvalidateAdminStore } from "@/hooks/useStore";
import { formatDateTime } from "@/lib/datetime";
import { PREF_LABELS } from "@/lib/deliveryPref";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { MISSING_ITEMS_TEXT } from "@/lib/orderItems";
import { orderPaymentLabel } from "@/lib/orderPayment";
import { orderPaymentTone, orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { ROUTES } from "@/lib/routes";
import type { OrderItemOut, OrderOut } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

const TON_RENK: Record<ReturnType<typeof orderStatusTone>, string> = {
  neutral: "default",
  info: "blue",
  success: "success",
  warning: "warning",
  danger: "error",
};
const IADE_DURUMU: Record<string, string> = { PENDING: "İnceleniyor", APPROVED: "Onaylandı", REJECTED: "Reddedildi" };
const KIND: Record<string, string> = { PHYSICAL: "Fiziksel", DIGITAL: "Dijital" };

const zaman = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : "—");
const metin = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const satirTutari = (k: OrderItemOut) => formatTL(Number(k.unit_price) * k.quantity);

/** URL kimliği yalnız düz pozitif tam sayı: "abc", "-1", "1e3", "0x10", "42.0", boşluk ve güvenli aralık dışı reddedilir. */
export function siparisKimligi(ham: string | undefined): number | null {
  if (!ham || !/^\d+$/.test(ham)) return null;
  const sayi = Number(ham);
  return Number.isSafeInteger(sayi) && sayi > 0 ? sayi : null;
}

export function SiparisDetayi() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams();
  const orderId = siparisKimligi(id);
  const gecerli = orderId !== null;
  const { canView, canManage } = useAdminAreaAccess("orders");
  const sorgu = useAdminOrder(orderId ?? 0, canView && gecerli);
  const invalidate = useInvalidateAdminStore();

  const [kargoAcik, setKargoAcik] = useState(false);
  const [kargoHatasi, setKargoHatasi] = useState<string | null>(null);
  const [iadeAcik, setIadeAcik] = useState(false);
  const [iadeHatasi, setIadeHatasi] = useState<string | null>(null);
  // Senkron kilitler: ikinci ship/deliver/refund isteği çıkmaz. Kilit BAŞARIDA
  // BIRAKILMAZ — mutasyon çözülür çözülmez serbest kalsaydı, pencereyi kapatan
  // render'dan önce düşen ikinci bir tık aynı sipariş için ikinci istek açardı
  // (CI'da tam olarak bu görüldü). Serbest bırakma yalnız iki yerde: hata yolunda
  // (aynı pencerede yeniden deneme) ve pencere yeniden açılırken (yeni oturum).
  const kargoRef = useRef(false);
  const teslimRef = useRef(false);
  // Uçuştaki teslim isteği: aynı tick'te ikinci onay yeni istek açmaz, aynı sonucu bekler.
  const teslimSozuRef = useRef<Promise<unknown> | null>(null);
  const iadeRef = useRef(false);

  // Dönen OrderOut detay önbelleğine anında yazılır, ardından mevcut invalidation sözleşmesi korunur.
  const detayiGuncelle = (o: OrderOut) => {
    qc.setQueryData(["store", "admin", "orders", "detail", o.id], o);
    invalidate();
  };

  const kargola = useMutation({
    mutationFn: (takipNo: string | null) => shipOrder(orderId as number, takipNo),
    onSuccess: (o) => {
      message.success("Kargoya verildi.");
      setKargoAcik(false);
      detayiGuncelle(o);
    },
    onError: (e) => {
      setKargoHatasi(getErrorDetail(e, "Kargoya verilemedi."));
      // Yalnız hata yolunda serbest: kullanıcı aynı pencerede yeniden deneyebilsin.
      kargoRef.current = false;
    },
  });
  const teslim = useMutation({
    mutationFn: () => deliverOrder(orderId as number),
    onSuccess: (o) => {
      message.success("Sipariş teslim edildi olarak işaretlendi.");
      detayiGuncelle(o);
    },
    onSettled: () => {
      teslimRef.current = false;
      teslimSozuRef.current = null;
    },
  });
  const iade = useMutation({
    mutationFn: (gerekce: string) => refundOrder(orderId as number, gerekce),
    onSuccess: (o) => {
      message.success("İade edildi.");
      setIadeAcik(false);
      detayiGuncelle(o);
    },
    onError: (e) => {
      setIadeHatasi(getErrorDetail(e, "İade başarısız."));
      iadeRef.current = false;
    },
  });

  const kargolaGonder = (takipNo: string | null) => {
    if (kargoRef.current || kargola.isPending) return;
    kargoRef.current = true;
    setKargoHatasi(null);
    kargola.mutate(takipNo);
  };
  const iadeGonder = (gerekce: string) => {
    if (iadeRef.current || iade.isPending) return;
    iadeRef.current = true;
    setIadeHatasi(null);
    iade.mutate(gerekce);
  };

  const kolonlar = useMemo<TableProps<OrderItemOut>["columns"]>(
    () =>
      basligaOlcumStiliEkle<OrderItemOut>([
        {
          title: "Ürün",
          key: "urun",
          render: (_, k) => (
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>{k.title?.trim() || "Başlıksız ürün"}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {KIND[k.kind] ?? k.kind}
                {k.product_id ? ` · Ürün #${k.product_id}` : ""}
              </Typography.Text>
            </span>
          ),
        },
        { title: "Adet", key: "adet", align: "right", render: (_, k) => k.quantity },
        { title: "Birim fiyat", key: "birim", align: "right", render: (_, k) => formatTL(k.unit_price) },
        { title: "Tutar", key: "tutar", align: "right", render: (_, k) => <strong>{satirTutari(k)}</strong> },
      ]),
    [],
  );

  if (!canView) return <AccessDenied area="Siparişler" />;
  const listeyeDon = <Button size="small" onClick={() => navigate(ROUTES.adminNewOrders)}>Listeye dön</Button>;
  if (!gecerli) return <HataDurumu hata="Geçersiz sipariş bağlantısı." hataAksiyon={listeyeDon} />;
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Sipariş yükleniyor…" />;
  if (sorgu.isError) {
    const durum = (sorgu.error as { response?: { status?: number } })?.response?.status;
    if (durum === 404) return <HataDurumu hata="Sipariş bulunamadı" hataAksiyon={listeyeDon} />;
    return (
      <HataDurumu
        hata={getErrorDetail(sorgu.error, "Sipariş yüklenemedi.")}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
      />
    );
  }

  const o = sorgu.data;
  const kart = { background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 24 };
  const etiketStil = { fontWeight: 500, color: token.colorTextTertiary, display: "block" as const };
  // Eski panelin gerçek yetenekleri; nihai FSM kontrolü backend'de.
  const kargolanabilir = canManage && o.has_physical && o.payment_status === "PAID" && o.status === "PAID";
  const teslimEdilebilir = canManage && o.status === "SHIPPED";
  const iadeEdilebilir = canManage && o.payment_status === "PAID";

  // Kapanış `onayAc`ın denetiminde: hata yolunda pencere açık kalır, AntD'ye söz gitmez.
  const teslimOnayi = () => {
    if (teslimRef.current || teslim.isPending) return;
    onayAc(modal, {
      title: "Siparişi teslim edildi işaretle",
      content: `${o.order_no} siparişi teslim edilmiş sayılacak ve teslimat akışı kapanacak.`,
      okText: "Teslim edildi olarak işaretle",
      cancelText: "Vazgeç",
      mesgulMu: () => teslimRef.current && teslim.isPending,
      calistir: () => {
        // Aynı tick ikinci onay: uçuştaki söz paylaşılır, ikinci istek çıkmaz.
        if (teslimRef.current && teslimSozuRef.current) return teslimSozuRef.current;
        teslimRef.current = true;
        const soz = teslim.mutateAsync().catch((e: unknown) => {
          message.error(getErrorDetail(e, "İşlem başarısız."));
          throw e;
        });
        teslimSozuRef.current = soz;
        return soz;
      },
    });
  };

  const ozet: [string, ReactNode][] = [
    ["Sipariş no", o.order_no],
    ["Tarih", zaman(o.created_at)],
    ["Müşteri", o.ship_recipient ?? <Typography.Text type="secondary">Dijital sipariş</Typography.Text>],
    ["Ödeme", <Tag color={TON_RENK[orderPaymentTone(o.payment_status)]} style={{ marginInlineEnd: 0 }}>{orderPaymentLabel(o.payment_status)}</Tag>],
    ["Toplam", <strong>{formatTL(o.total)}</strong>],
  ];
  const odeme: [string, ReactNode][] = [
    ["Ara toplam", formatTL(o.subtotal)],
    ["Kargo ücreti", formatTL(o.shipping_fee)],
    ...(o.discount && Number(o.discount) > 0 ? [["İndirim", `-${formatTL(o.discount)}`] as [string, ReactNode]] : []),
    ...(o.coupon_code ? [["Kupon", o.coupon_code] as [string, ReactNode]] : []),
    ["Toplam", <strong>{formatTL(o.total)}</strong>],
    ["Para birimi", o.currency],
    [
      "İade talebi",
      o.return_status ? (
        <span>
          {IADE_DURUMU[o.return_status] ?? o.return_status} · <Link to={ROUTES.adminNewReturns}>İade taleplerine git</Link>
        </span>
      ) : (
        "—"
      ),
    ],
    ...(o.return_deadline ? [["Son iade tarihi", zaman(o.return_deadline)] as [string, ReactNode]] : []),
  ];
  const kargo: [string, ReactNode][] = [
    ["Alıcı", metin(o.ship_recipient)],
    ["Telefon", metin(o.ship_phone)],
    ["Adres", metin(o.ship_address)],
    ["İlçe / İl", [o.ship_district, o.ship_city].filter(Boolean).join(" / ") || "—"],
    ["Bölge", o.ship_in_zone === true ? "Cıncık bölgesi (kendi filo)" : o.ship_in_zone === false ? "Dış kargo" : "—"],
    ["Söz verilen teslim", zaman(o.promised_delivery_date)],
    ["Teslimat tercihi", o.delivery_pref ? `${PREF_LABELS[o.delivery_pref] ?? o.delivery_pref}${o.delivery_pref_note ? ` · ${o.delivery_pref_note}` : ""}` : "—"],
    ["Erteleme", String(o.postpone_count ?? 0)],
    ["Takip no", metin(o.tracking_no)],
    ["Takip sayfası", o.track_token ? <a href={ROUTES.cargoTracking(o.track_token)} target="_blank" rel="noreferrer">Kargo takibini aç</a> : "—"],
    ["Teslim tarihi", zaman(o.delivered_at)],
  ];

  const alanlar = (satirlar: [string, ReactNode][]) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
      {satirlar.map(([k, v]) => (
        <div key={k}>
          <Typography.Text style={etiketStil}>{k}</Typography.Text>
          <Typography.Text>{v}</Typography.Text>
        </div>
      ))}
    </div>
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Flex align="center" gap={12}>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={() => navigate(ROUTES.adminNewOrders)} />
          <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>{o.order_no}</Typography.Title>
          <Tag color={TON_RENK[orderStatusTone(o.status)]}>{orderStatusLabel(o.status)}</Tag>
        </Flex>
        <Flex gap={8} wrap>
          {iadeEdilebilir ? <Button danger onClick={() => { iadeRef.current = false; setIadeHatasi(null); setIadeAcik(true); }}>İade et</Button> : null}
          {teslimEdilebilir ? <Button loading={teslim.isPending} onClick={teslimOnayi}>Teslim edildi</Button> : null}
          {kargolanabilir ? <Button type="primary" onClick={() => { kargoRef.current = false; setKargoHatasi(null); setKargoAcik(true); }}>Kargoya ver</Button> : null}
        </Flex>
      </Flex>

      {!canManage ? <Alert type="info" showIcon message="Salt okunur görünüm: rolünüz bu bölümde değişiklik yapma izni içermiyor." /> : null}

      <section aria-label="Sipariş özeti" style={kart}>{alanlar(ozet)}</section>

      <section aria-label="Sipariş kalemleri" style={kart}>
        <Typography.Text style={{ ...etiketStil, marginBottom: 12 }}>Kalemler</Typography.Text>
        <Table<OrderItemOut>
          columns={kolonlar}
          dataSource={o.items ?? []}
          rowKey={(k) => k.id}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: MISSING_ITEMS_TEXT }}
        />
      </section>

      <section aria-label="Ödeme" style={kart}>
        <Typography.Text style={{ ...etiketStil, marginBottom: 12 }}>Ödeme</Typography.Text>
        {alanlar(odeme)}
      </section>

      <section aria-label="Kargo ve teslimat" style={kart}>
        <Typography.Text style={{ ...etiketStil, marginBottom: 12 }}>Kargo ve teslimat</Typography.Text>
        {o.has_physical ? alanlar(kargo) : <Typography.Text type="secondary">Dijital sipariş; kargo ve teslimat adımı yok.</Typography.Text>}
      </section>

      <KargoPenceresi acik={kargoAcik} kapat={() => setKargoAcik(false)} kaydediyor={kargola.isPending} hata={kargoHatasi} kilitliMi={() => kargoRef.current} onayla={kargolaGonder} />
      <IadePenceresi acik={iadeAcik} kapat={() => setIadeAcik(false)} kaydediyor={iade.isPending} hata={iadeHatasi} kilitliMi={() => iadeRef.current} onayla={iadeGonder} />
    </Flex>
  );
}
