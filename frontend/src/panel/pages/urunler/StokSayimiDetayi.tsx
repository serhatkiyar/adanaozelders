// Stok sayımı oturum detayı — eski CountSessionDetailPage'in FSM/izin/idempotency mantığı,
// AntD + panel tema düzeninde. İş kuralları lib/inventory'den, veri hook'lardan.
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, App, Button, Flex, InputNumber, Table, Tag, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { basligaOlcumStiliEkle } from "@/panel/components/ListePage";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { GerekcePenceresi, UygulaPenceresi } from "@/panel/pages/urunler/StokSayimiPencereleri";
import { UrunSecici } from "@/panel/pages/urunler/UrunSecici";
import {
  useAddCountProducts,
  useApplyCountSession,
  useCancelCountSession,
  useCountSession,
  useCountSessionAction,
  useResolveCountLine,
  useSetLineCount,
} from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { formatDateTime } from "@/lib/datetime";
import {
  allowedCountActions,
  applyBlockers,
  bucketLabel,
  expectedPhysical,
  formatCountedQty,
  formatDifference,
  inventoryErrorMessage,
  lineDifference,
  lineStatusBadge,
  newIdempotencyKey,
  productDisplayName,
  productDisplaySku,
  reservedDisplay,
  sessionStatusBadge,
  staleReasonLabel,
  type CountScope,
} from "@/lib/inventory";
import { ROUTES } from "@/lib/routes";
import type { CountLineOut } from "@/api/inventory";

const TON_RENK: Record<string, string> = { neutral: "default", info: "processing", success: "success", warning: "warning", danger: "error" };
const KAPSAM: Record<CountScope, string> = { ALL: "Tüm ürünler", CATEGORY: "Kategori", MANUAL: "Seçili ürünler" };
const zaman = (iso: string | null) => (iso ? formatDateTime(iso) : "—");
const kisi = (id: number | null, iso: string | null) => (id ? `#${id} · ${zaman(iso)}` : "—");

// Sayılan miktar hücresi: satır başına yerel değer; düğme geçerlilikle kapanmaz, hata alanda.
function SayimHucresi({ satir, kaydediliyor, onSay }: { satir: CountLineOut; kaydediliyor: boolean; onSay: (qty: number) => void }) {
  const [deger, setDeger] = useState<number | null>(satir.counted_qty);
  const [hata, setHata] = useState<string | null>(null);
  const kaydet = () => {
    if (deger === null || deger === undefined) return setHata("Sayılan miktarı yazın.");
    if (!Number.isInteger(deger)) return setHata("Miktar tam sayı olmalı.");
    if (deger < 0) return setHata("Miktar negatif olamaz.");
    setHata(null);
    onSay(deger);
  };
  return (
    <Flex vertical align="flex-end" gap={4}>
      <Flex gap={6}>
        <InputNumber
          aria-label={`Sayılan miktar: ${bucketLabel(satir.bucket)} (ürün #${satir.product_id})`}
          value={deger}
          onChange={(v) => setDeger(v)}
          style={{ width: 96 }}
          controls={false}
        />
        <Button loading={kaydediliyor} onClick={kaydet}>Kaydet</Button>
      </Flex>
      {hata ? <Typography.Text type="danger" style={{ fontSize: 12 }}>{hata}</Typography.Text> : null}
    </Flex>
  );
}

export function StokSayimiDetayi() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const sessionId = Number(id);
  const { canCount, canApply } = useInventoryAccess();
  const sorgu = useCountSession(sessionId);
  const oturum = sorgu.data;

  const say = useSetLineCount(sessionId);
  const acikla = useResolveCountLine(sessionId);
  const aksiyon = useCountSessionAction(sessionId);
  const uygula = useApplyCountSession(sessionId);
  const iptal = useCancelCountSession(sessionId);
  const urunEkle = useAddCountProducts(sessionId);

  const [uygulaAcik, setUygulaAcik] = useState(false);
  const [iptalAcik, setIptalAcik] = useState(false);
  const [aciklanacakSatir, setAciklanacakSatir] = useState<number | null>(null);
  const [uygulaHatasi, setUygulaHatasi] = useState<string | null>(null);
  const [eklenecekUrunler, setEklenecekUrunler] = useState<number[]>([]);
  const [ekleHatasi, setEkleHatasi] = useState<string | null>(null);
  const anahtarRef = useRef(newIdempotencyKey());
  const gonderildiRef = useRef(false);

  const eylemler = useMemo(() => (oturum ? allowedCountActions(oturum.status) : []), [oturum]);
  const engeller = useMemo(() => (oturum ? applyBlockers(oturum.lines) : []), [oturum]);
  const sayilabilir = canCount && eylemler.includes("count");

  const kolonlar = useMemo<TableProps<CountLineOut>["columns"]>(
    () =>
      basligaOlcumStiliEkle<CountLineOut>([
        {
          title: "Ürün",
          key: "urun",
          render: (_, s) => (
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>{productDisplayName(s)}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace", userSelect: "all" }}>{productDisplaySku(s)}</Typography.Text>
            </span>
          ),
        },
        { title: "Kova", key: "kova", render: (_, s) => bucketLabel(s.bucket) },
        { title: "Sistem", key: "sistem", align: "right", render: (_, s) => s.system_qty_snapshot },
        { title: "Rezerve", key: "rezerve", align: "right", render: (_, s) => reservedDisplay(s) },
        { title: "Beklenen fiziksel", key: "beklenen", align: "right", render: (_, s) => <strong>{expectedPhysical(s)}</strong> },
        {
          title: "Sayılan",
          key: "sayilan",
          align: "right",
          render: (_, s) =>
            sayilabilir ? (
              <SayimHucresi
                key={`${s.id}-${s.counted_at ?? ""}`}
                satir={s}
                kaydediliyor={say.isPending}
                onSay={(qty) =>
                  say.mutate(
                    { lineId: s.id, countedQty: qty },
                    {
                      onSuccess: () => message.success("Sayım kaydedildi."),
                      onError: (e) => message.error(inventoryErrorMessage(e, "Sayım kaydedilemedi.")),
                    },
                  )
                }
              />
            ) : (
              formatCountedQty(s)
            ),
        },
        {
          title: "Fark",
          key: "fark",
          align: "right",
          render: (_, s) => (
            <span style={{ fontWeight: 500, color: (lineDifference(s) ?? 0) === 0 ? token.colorTextSecondary : token.colorError }}>
              {formatDifference(s)}
            </span>
          ),
        },
        {
          title: "Durum",
          key: "durum",
          render: (_, s) => {
            const r = lineStatusBadge(s.status);
            return (
              <Flex vertical gap={4} align="flex-start">
                <Tag color={TON_RENK[r.tone]} style={{ marginInlineEnd: 0 }}>{r.label}</Tag>
                {s.stale_reason ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{staleReasonLabel(s.stale_reason)}</Typography.Text> : null}
                {s.resolution_note ? (
                  <Typography.Text type="secondary" italic style={{ fontSize: 12 }}>#{s.resolved_by_admin_id}: {s.resolution_note}</Typography.Text>
                ) : null}
              </Flex>
            );
          },
        },
        {
          title: "Son sayan",
          key: "sayan",
          render: (_, s) => (
            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              {s.counted_by_admin_id ? `#${s.counted_by_admin_id}` : "—"}
              <br />
              {zaman(s.counted_at)}
            </Typography.Text>
          ),
        },
        ...(sayilabilir
          ? [
              {
                title: "",
                key: "eylem",
                render: (_: unknown, s: CountLineOut) =>
                  s.status === "STALE" || s.status === "RESOLVED" ? (
                    <Button type="link" style={{ padding: 0 }} onClick={() => setAciklanacakSatir(s.id)}>Açıklama ekle</Button>
                  ) : null,
              },
            ]
          : []),
      ]),
    [sayilabilir, say, message, token],
  );

  if (sorgu.isError) {
    return (
      <HataDurumu
        hata={inventoryErrorMessage(sorgu.error, "Sayım oturumu yüklenemedi.")}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
      />
    );
  }
  if (sorgu.isPending || !oturum) return <YukleniyorDurumu etiket="Sayım oturumu yükleniyor…" />;

  const rozet = sessionStatusBadge(oturum.status);
  const kart = { background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 24 };
  const hataToast = (varsayilan: string) => (e: unknown) => message.error(inventoryErrorMessage(e, varsayilan));

  const uygulaGonder = () => {
    if (gonderildiRef.current) return;
    gonderildiRef.current = true;
    setUygulaHatasi(null);
    uygula.mutate(anahtarRef.current, {
      onSuccess: () => {
        message.success("Sayım farkları uygulandı.");
        anahtarRef.current = newIdempotencyKey();
        gonderildiRef.current = false;
        setUygulaAcik(false);
      },
      // Hata cevabında kilit AÇILMAZ ve anahtar değişmez (eski ekranla aynı).
      onError: (e) => setUygulaHatasi(inventoryErrorMessage(e, "Farklar uygulanamadı.")),
    });
  };

  const urunleriEkle = () => {
    if (eklenecekUrunler.length === 0) return setEkleHatasi("En az bir ürün seçin.");
    setEkleHatasi(null);
    urunEkle.mutate(eklenecekUrunler, {
      onSuccess: () => {
        setEklenecekUrunler([]);
        message.success("Ürünler oturuma eklendi.");
      },
      onError: (e) => setEkleHatasi(inventoryErrorMessage(e, "Ürün eklenemedi.")),
    });
  };

  const ozet: [string, string][] = [
    ["Kapsam", KAPSAM[oturum.scope] ?? oturum.scope],
    ["Açan", kisi(oturum.created_by_admin_id, oturum.created_at)],
    ["Sayım başlangıcı", zaman(oturum.started_at)],
    ["İncelemeye gönderen", kisi(oturum.reviewed_by_admin_id, oturum.reviewed_at)],
    ["Uygulayan", kisi(oturum.applied_by_admin_id, oturum.applied_at)],
  ];

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Flex align="center" gap={12}>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={() => navigate(ROUTES.adminNewStockCounts)} />
          <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>{oturum.code}</Typography.Title>
          <Tag color={TON_RENK[rozet.tone]}>{rozet.label}</Tag>
        </Flex>
        <Flex gap={8} wrap>
          {canCount && eylemler.includes("cancel") ? <Button danger onClick={() => setIptalAcik(true)}>Oturumu iptal et</Button> : null}
          {canApply && eylemler.includes("reopen") ? (
            <Button loading={aksiyon.isPending} onClick={() => aksiyon.mutate("reopen", { onError: hataToast("İnceleme geri alınamadı.") })}>İncelemeyi geri al</Button>
          ) : null}
          {canCount && eylemler.includes("start") ? (
            <Button type="primary" loading={aksiyon.isPending} onClick={() => aksiyon.mutate("start", { onError: hataToast("Sayım başlatılamadı.") })}>Sayımı başlat</Button>
          ) : null}
          {canCount && eylemler.includes("submit") ? (
            <Button type="primary" loading={aksiyon.isPending} onClick={() => aksiyon.mutate("submit", { onError: hataToast("Oturum gönderilemedi.") })}>İncelemeye gönder</Button>
          ) : null}
          {canApply && eylemler.includes("apply") ? (
            // Engel varken düğme kapalı: sebepleri hemen altındaki uyarı listeler (görünen önkoşul).
            <Button type="primary" disabled={engeller.length > 0} onClick={() => { setUygulaHatasi(null); setUygulaAcik(true); }}>Farkları uygula</Button>
          ) : null}
        </Flex>
      </Flex>

      <section aria-label="Oturum özeti" style={kart}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
          {ozet.map(([k, v]) => (
            <div key={k}>
              <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary, display: "block" }}>{k}</Typography.Text>
              <Typography.Text>{v}</Typography.Text>
            </div>
          ))}
        </div>
        {oturum.note ? <Typography.Paragraph type="secondary" style={{ margin: "16px 0 0" }}>Not: {oturum.note}</Typography.Paragraph> : null}
        {oturum.cancel_reason ? <Typography.Paragraph type="secondary" style={{ margin: "16px 0 0" }}>İptal gerekçesi: {oturum.cancel_reason}</Typography.Paragraph> : null}
      </section>

      {engeller.length > 0 && canApply && eylemler.includes("apply") ? (
        <Alert type="warning" showIcon role="status" message="Farklar henüz uygulanamaz" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{engeller.map((e) => <li key={e}>{e}</li>)}</ul>} />
      ) : null}

      <section aria-label="Sayım satırları" style={kart}>
        {canCount && eylemler.includes("products") ? (
          <Flex vertical gap={4} style={{ marginBottom: 16 }}>
            <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary }}>Ürün ekle</Typography.Text>
            <Flex gap={8} wrap align="flex-start">
              <div style={{ flex: "1 1 320px", maxWidth: 480 }}>
                <UrunSecici value={eklenecekUrunler} onChange={setEklenecekUrunler} />
              </div>
              <Button loading={urunEkle.isPending} onClick={urunleriEkle}>Ekle</Button>
            </Flex>
            {ekleHatasi ? <Typography.Text type="danger" role="alert" style={{ fontSize: 12 }}>{ekleHatasi}</Typography.Text> : null}
          </Flex>
        ) : null}
        <Table<CountLineOut>
          columns={kolonlar}
          dataSource={oturum.lines}
          rowKey={(s) => s.id}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "Oturumda henüz ürün yok." + (canCount && eylemler.includes("products") ? " Yukarıdan ürün ekleyin." : "") }}
        />
      </section>

      <UygulaPenceresi acik={uygulaAcik} kapat={() => setUygulaAcik(false)} satirlar={oturum.lines} kaydediyor={uygula.isPending} hata={uygulaHatasi} onayla={uygulaGonder} />
      <GerekcePenceresi
        acik={iptalAcik}
        kapat={() => setIptalAcik(false)}
        baslik="Sayım oturumunu iptal et"
        aciklama="İptal geri alınamaz; oturum salt okunur olur ve hiçbir stok hareketi yazılmaz."
        etiket="İptal gerekçesi"
        onayMetni="Oturumu iptal et"
        kaydediyor={iptal.isPending}
        onayla={(reason) =>
          iptal.mutate(reason, {
            onSuccess: () => { message.success("Oturum iptal edildi."); setIptalAcik(false); },
            onError: hataToast("Oturum iptal edilemedi."),
          })
        }
      />
      <GerekcePenceresi
        acik={aciklanacakSatir !== null}
        kapat={() => setAciklanacakSatir(null)}
        baslik="Belirsizliği açıkla"
        aciklama="Açıklama kayda geçer ama satırı UYGULANABİLİR YAPMAZ. Farkın uygulanabilmesi için satır yeniden sayılmalıdır."
        etiket="Açıklama"
        onayMetni="Açıklamayı kaydet"
        kaydediyor={acikla.isPending}
        onayla={(note) =>
          acikla.mutate(
            { lineId: aciklanacakSatir as number, note },
            {
              onSuccess: () => { message.success("Açıklama kaydedildi. Satır hâlâ yeniden sayılmalı."); setAciklanacakSatir(null); },
              onError: hataToast("Açıklama kaydedilemedi."),
            },
          )
        }
      />
    </Flex>
  );
}
