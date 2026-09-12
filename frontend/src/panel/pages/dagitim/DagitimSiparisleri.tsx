// Dağıtım → Siparişler — eski DeliveryOrdersPage panel düzeninde: sipariş havuzu, üç kuyruk URL'de
// (?kuyruk=hazirlik|hazir|dis-kargo). Paketlenecek SALT OKUNUR (hazırlama paketleme istasyonundadır);
// Tura hazır → bugünün açık turuna ekleme (delivery.manage); Dış kargo → shipOrder ile kargolama (orders.manage).
// Eski kaldırılmış Hazırla / Tümünü hazırla / Geri al davranışları geri getirilmez.
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Flex, Input, Segmented, Select, Tag, Tooltip, Typography, theme } from "antd";
import type { InputRef } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ItemLines } from "@/components/admin/delivery/ItemLines";
import { PromiseChip, todayIso } from "@/components/admin/delivery/bits";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { shipOrder } from "@/api/store";
import { useAddStops, useDeliveryRuns, useEligibleOrders, useOutsourcedOrders, usePrepQueue } from "@/hooks/useDelivery";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { DeliveryEligibleOrder, DeliveryRun } from "@/types";

export type Kuyruk = "hazirlik" | "hazir" | "dis-kargo";
const KUYRUKLAR: { value: Kuyruk; label: string }[] = [
  { value: "hazirlik", label: "Paketlenecek" },
  { value: "hazir", label: "Tura hazır" },
  { value: "dis-kargo", label: "Dış kargo" },
];

/** `?kuyruk=` beyaz listesi; geçersiz/boş değer varsayılan `hazirlik` (sunucu davranışı değişmez). */
export function kuyrukNo(ham: string | null): Kuyruk {
  return ham === "hazir" || ham === "dis-kargo" ? ham : "hazirlik";
}

/** Bugünün açık (PLANNED/ACTIVE) turları — "Tura ekle" hedefleri. */
export function acikTurlar(runs: DeliveryRun[] | undefined): DeliveryRun[] {
  return (Array.isArray(runs) ? runs : []).filter((r) => r.status === "PLANNED" || r.status === "ACTIVE");
}

type Sorgu = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

/** Kuyruk adedi: veri varsa sayı; yükleniyor/hata sahte 0 değil, ayrı işaret. */
function adetEtiketi(s: Sorgu & { data?: unknown }): string {
  if (Array.isArray(s.data)) return String(s.data.length);
  if (s.isError) return "!";
  return "…";
}

function SiparisSatiri({ order, sonMu, ayrac, children }: { order: DeliveryEligibleOrder; sonMu: boolean; ayrac: string; children?: React.ReactNode }) {
  return (
    <Flex data-testid={`siparis-${order.order_id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: sonMu ? "none" : `1px solid ${ayrac}` }}>
      <div style={{ minWidth: 0, flex: "1 1 240px" }}>
        <Flex align="baseline" gap={8} wrap>
          <Typography.Text style={{ fontWeight: 500 }}>{order.recipient ?? "-"}</Typography.Text>
          <Link to={ROUTES.adminNewOrder(order.order_id)} style={{ fontSize: 12 }}>#{order.order_id}</Link>
          {order.lat == null ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>konumsuz</Tag> : null}
        </Flex>
        <Flex align="center" gap={6} wrap style={{ marginTop: 2 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{order.address ?? "Adres yok"}</Typography.Text>
          <PromiseChip date={order.promised_delivery_date} />
        </Flex>
        {/* Toplama listesi: operatör NE toplayacağını görmeden paket hazırlamaz; "N parça" özeti bunun yerine geçmez. */}
        <ItemLines items={order.items} className="mt-1.5" />
      </div>
      <Flex align="center" gap={8} wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {order.item_count} parça · {formatTL(order.total)}
        </Typography.Text>
        {children}
      </Flex>
    </Flex>
  );
}

function KuyrukKabugu({ sorgu, varsayilan, children }: { sorgu: Sorgu; varsayilan: string; children: React.ReactNode }) {
  if (sorgu.isError) {
    return (
      <div style={{ padding: "16px 0" }}>
        <HataDurumu hata={getErrorDetail(sorgu.error, varsayilan)} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />
      </div>
    );
  }
  if (sorgu.isPending) return <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Kuyruk yükleniyor…" /></div>;
  return <>{children}</>;
}

/* ── Paketlenecek: salt okunur; hazırlama paketleme istasyonunda ── */
function PaketlenecekKuyrugu({ sorgu, ayrac }: { sorgu: ReturnType<typeof usePrepQueue>; ayrac: string }) {
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  return (
    <KuyrukKabugu sorgu={sorgu} varsayilan="Paketlenecek kuyruğu yüklenemedi.">
      {liste.length === 0 ? (
        <div style={{ padding: "16px 0" }}><BosDurumu baslik="Paketlenecek sipariş yok" aciklama="Yeni fiziksel siparişler ödendikçe burada belirir." /></div>
      ) : (
        <>
          <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: `1px solid ${ayrac}` }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, flex: "1 1 240px" }}>
              Hazırlama paketleme istasyonunda yapılır: paketi aç, her kalemi okut, tamamla. Sipariş ancak bütün kalemler doğrulanınca tura hazır olur.
            </Typography.Text>
            <Link to={ROUTES.adminNewPacking} style={{ fontWeight: 500 }}>Paketleme istasyonunu aç →</Link>
          </Flex>
          {liste.map((o, i, d) => <SiparisSatiri key={o.order_id} order={o} sonMu={i === d.length - 1} ayrac={ayrac} />)}
        </>
      )}
    </KuyrukKabugu>
  );
}

/* ── Tura hazır: bugünün açık turuna ekle (delivery.manage) ── */
function TuraHazirKuyrugu({ sorgu, canManage, ayrac }: { sorgu: ReturnType<typeof useEligibleOrders>; canManage: boolean; ayrac: string }) {
  const { message } = App.useApp();
  const turlar = useDeliveryRuns(todayIso(), canManage);
  const duraklarEkle = useAddStops();
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  const acik = useMemo(() => acikTurlar(turlar.data), [turlar.data]);
  const [hedefSecimi, setHedefSecimi] = useState<number | null>(null);
  // Bayat seçim sunucuya gitmez: seçili tur artık açık değilse ilk açık tura düşülür.
  const hedef = hedefSecimi != null && acik.some((r) => r.id === hedefSecimi) ? hedefSecimi : acik[0]?.id ?? null;
  // Kilit SİPARİŞ bazlıdır: uçuştaki bir sipariş ne tek ne toplu istekle ikinci kez gönderilir;
  // farklı siparişler birbirini kilitlemez. Hata slotu işlem başına (tek: satır altında, toplu: liste üstünde).
  const ucustakilerRef = useRef(new Set<number>());
  const [ucustakiler, setUcustakiler] = useState<number[]>([]);
  const [hatalar, setHatalar] = useState<Record<string, string | undefined>>({});

  const ekle = async (anahtar: string, siparisIdleri: number[]) => {
    if (hedef == null) return;
    // Hedef tur ve sipariş ID'leri tıklama anında sabit; uçuştakiyle çakışan istek çıkmaz.
    const hedefTur = hedef;
    const idler = [...siparisIdleri];
    if (idler.some((id) => ucustakilerRef.current.has(id))) return;
    for (const id of idler) ucustakilerRef.current.add(id);
    setUcustakiler([...ucustakilerRef.current]);
    setHatalar((h) => ({ ...h, [anahtar]: undefined }));
    try {
      await duraklarEkle.mutateAsync({ runId: hedefTur, orderIds: idler });
      message.success(idler.length > 1 ? `${idler.length} sipariş tura eklendi.` : "Sipariş tura eklendi.");
    } catch (e) {
      setHatalar((h) => ({ ...h, [anahtar]: getErrorDetail(e, "Tura eklenemedi.") }));
    } finally {
      for (const id of idler) ucustakilerRef.current.delete(id);
      setUcustakiler([...ucustakilerRef.current]);
    }
  };
  const ucusta = (id: number) => ucustakiler.includes(id);

  return (
    <KuyrukKabugu sorgu={sorgu} varsayilan="Tura hazır kuyruğu yüklenemedi.">
      {liste.length === 0 ? (
        <div style={{ padding: "16px 0" }}><BosDurumu baslik="Tura hazır sipariş yok" aciklama="Paketleme istasyonunda tamamlanan paketler burada belirir." /></div>
      ) : (
        <>
          {canManage ? (
            <Flex align="center" justify="flex-end" gap={8} wrap style={{ padding: "12px 0", borderBottom: `1px solid ${ayrac}` }}>
              {turlar.isError ? (
                <HataDurumu hata={getErrorDetail(turlar.error, "Bugünün turları yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void turlar.refetch()}>Tekrar dene</Button>} />
              ) : turlar.isPending ? (
                <Typography.Text type="secondary">Bugünün turları yükleniyor…</Typography.Text>
              ) : acik.length > 0 ? (
                <>
                  <Typography.Text type="secondary">Hedef tur</Typography.Text>
                  <Select<number>
                    aria-label="Hedef tur"
                    value={hedef ?? undefined}
                    options={acik.map((r) => ({ value: r.id, label: `Tur #${r.id} · ${r.vehicle}` }))}
                    onChange={(v) => setHedefSecimi(v)}
                    style={{ width: 220 }}
                  />
                  {liste.length > 1 ? (
                    <Button loading={ucustakiler.length > 0} onClick={() => void ekle("hepsi", liste.map((o) => o.order_id))}>Tümünü ekle</Button>
                  ) : null}
                </>
              ) : (
                <Typography.Text type="secondary">
                  Bugün açık tur yok: <Link to={ROUTES.adminNewDelivery} style={{ fontWeight: 500 }}>Bugün ekranından</Link> tur oluşturun.
                </Typography.Text>
              )}
            </Flex>
          ) : null}
          {hatalar.hepsi ? <Alert type="error" showIcon message={hatalar.hepsi} style={{ marginTop: 12 }} /> : null}
          {liste.map((o, i, d) => (
            <SiparisSatiri key={o.order_id} order={o} sonMu={i === d.length - 1} ayrac={ayrac}>
              {canManage ? (
                hedef == null ? (
                  <Tooltip title="Önce bugün için bir tur oluşturun.">
                    <Button disabled={hedef == null}>Tura ekle</Button>
                  </Tooltip>
                ) : (
                  <div>
                    <Button loading={ucusta(o.order_id)} onClick={() => void ekle(`tek:${o.order_id}`, [o.order_id])}>Tura ekle</Button>
                    {hatalar[`tek:${o.order_id}`] ? (
                      <Typography.Text type="danger" role="alert" style={{ fontSize: 12, display: "block", marginTop: 4 }}>{hatalar[`tek:${o.order_id}`]}</Typography.Text>
                    ) : null}
                  </div>
                )
              ) : null}
            </SiparisSatiri>
          ))}
        </>
      )}
    </KuyrukKabugu>
  );
}

/* ── Dış kargo: bölge dışı ödenmiş siparişler — Kargola yerinde (orders.manage) ── */
function KargolaSatiri({ orderId, gonder, bekliyor, hata, hataTemizle }: { orderId: number; gonder: (takip: string) => void; bekliyor: boolean; hata: string | undefined; hataTemizle: () => void }) {
  const [deger, setDeger] = useState("");
  const [alanHatasi, setAlanHatasi] = useState<string | null>(null);
  const alanRef = useRef<InputRef>(null);
  const alanId = `kargo-takip-${orderId}`;
  const gosterilen = alanHatasi ?? hata ?? null;
  return (
    <div>
      <Flex align="center" gap={8}>
        <Input
          ref={alanRef}
          id={alanId}
          value={deger}
          onChange={(e) => {
            setDeger(e.target.value);
            setAlanHatasi(null);
            hataTemizle();
          }}
          placeholder="Takip no"
          aria-label={`#${orderId} kargo takip numarası`}
          aria-invalid={gosterilen ? true : undefined}
          status={gosterilen ? "error" : undefined}
          style={{ width: 160 }}
        />
        <Button
          loading={bekliyor}
          onClick={() => {
            const takip = deger.trim();
            if (!takip) {
              setAlanHatasi("Takip numarası girin.");
              alanRef.current?.focus();
              return;
            }
            gonder(takip);
          }}
        >
          Kargola
        </Button>
      </Flex>
      {gosterilen ? <Typography.Text type="danger" role="alert" style={{ fontSize: 12, display: "block", marginTop: 4 }}>{gosterilen}</Typography.Text> : null}
    </div>
  );
}

function DisKargoKuyrugu({ sorgu, canShip, ayrac }: { sorgu: ReturnType<typeof useOutsourcedOrders>; canShip: boolean; ayrac: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  // Satır bazlı kilit/pending/hata: bir satır diğerini kilitlemez.
  const kilitRef = useRef(new Set<number>());
  const [bekleyenler, setBekleyenler] = useState<number[]>([]);
  const [hatalar, setHatalar] = useState<Record<number, string | undefined>>({});
  const kargola = useMutation({
    mutationFn: ({ id, takip }: { id: number; takip: string }) => shipOrder(id, takip),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["delivery"] }),
  });
  const gonder = async (id: number, takip: string) => {
    if (kilitRef.current.has(id)) return;
    kilitRef.current.add(id);
    setBekleyenler((o) => [...o, id]);
    setHatalar((s) => ({ ...s, [id]: undefined }));
    try {
      await kargola.mutateAsync({ id, takip });
      message.success(`#${id} kargolandı.`);
    } catch (e) {
      // Hata satırda kalır; takip değeri satır bileşeninde korunur, yeniden denenebilir.
      setHatalar((s) => ({ ...s, [id]: getErrorDetail(e, "Kargolanamadı.") }));
    } finally {
      kilitRef.current.delete(id);
      setBekleyenler((o) => o.filter((x) => x !== id));
    }
  };
  return (
    <KuyrukKabugu sorgu={sorgu} varsayilan="Dış kargo kuyruğu yüklenemedi.">
      {liste.length === 0 ? (
        <div style={{ padding: "16px 0" }}><BosDurumu baslik="Dış kargo bekleyen sipariş yok" aciklama="Adana Merkez dışına giden ödenmiş siparişler burada listelenir ve kargo firmasıyla gönderilir." /></div>
      ) : (
        liste.map((o, i, d) => (
          <SiparisSatiri key={o.order_id} order={o} sonMu={i === d.length - 1} ayrac={ayrac}>
            {o.district || o.city ? <Tag style={{ marginInlineEnd: 0 }}>{[o.district, o.city].filter(Boolean).join(" / ")}</Tag> : null}
            {canShip ? (
              <KargolaSatiri orderId={o.order_id} gonder={(t) => void gonder(o.order_id, t)} bekliyor={bekleyenler.includes(o.order_id)} hata={hatalar[o.order_id]} hataTemizle={() => setHatalar((s) => ({ ...s, [o.order_id]: undefined }))} />
            ) : (
              <Link to={ROUTES.adminNewOrder(o.order_id)}>Sipariş detayında aç →</Link>
            )}
          </SiparisSatiri>
        ))
      )}
    </KuyrukKabugu>
  );
}

export function DagitimSiparisleri() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("delivery");
  // Dış kargo yazma izni ayrıdır: delivery.manage orders.manage'i vermez.
  const { canManage: canShip } = useAdminAreaAccess("orders");
  const [params, setParams] = useSearchParams();
  const kuyruk = kuyrukNo(params.get("kuyruk"));
  const kuyrugaGit = (k: Kuyruk) => setParams(k === "hazirlik" ? {} : { kuyruk: k });

  const hazirlik = usePrepQueue(canView);
  const hazir = useEligibleOrders(canView);
  const disKargo = useOutsourcedOrders(canView);
  const adetler: Record<Kuyruk, string> = { hazirlik: adetEtiketi(hazirlik), hazir: adetEtiketi(hazir), "dis-kargo": adetEtiketi(disKargo) };

  if (!canView) return <AccessDenied area="Dağıtım" />;
  const ayrac = token.colorBorderSecondary;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Siparişler</Typography.Title>
        <Segmented<Kuyruk>
          aria-label="Sipariş kuyrukları"
          value={kuyruk}
          onChange={(v) => kuyrugaGit(v)}
          size="large"
          options={KUYRUKLAR.map((k) => ({ value: k.value, label: `${k.label} (${adetler[k.value]})` }))}
        />
      </Flex>
      {!canManage ? <Alert type="info" showIcon message="Salt okunur görünüm: tura ekleme için delivery.manage izni gerekir." /> : null}
      <section aria-label="Sipariş havuzu" style={{ background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <Typography.Text type="secondary">Ödenmiş sipariş → paket hazırla → tura ekle; bölge dışı → dış kargo.</Typography.Text>
        </div>
        <div style={{ padding: "0 24px" }}>
          {kuyruk === "hazirlik" ? (
            <PaketlenecekKuyrugu sorgu={hazirlik} ayrac={ayrac} />
          ) : kuyruk === "hazir" ? (
            <TuraHazirKuyrugu sorgu={hazir} canManage={canManage} ayrac={ayrac} />
          ) : (
            <DisKargoKuyrugu sorgu={disKargo} canShip={canShip} ayrac={ayrac} />
          )}
        </div>
      </section>
    </Flex>
  );
}
