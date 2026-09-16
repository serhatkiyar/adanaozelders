// Denetim kayıtları (salt okunur) — eski AdminAuditLogsPage'in filtre/sıralama/ayrıntı
// davranışı, ListePage üzerinde. Adres anahtarları eski ekranla aynıdır.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Flex, Input, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ListePage } from "@/panel/components/ListePage";
import { aktorEtiketi, DenetimKaydiPenceresi, hedefEtiketi } from "@/panel/pages/ayarlar/DenetimKaydiPenceresi";
import { useAdminAuditLogs } from "@/hooks/useAdmin";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDateTime } from "@/lib/datetime";
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZES, parseAdminAuditQuery, type AdminAuditSort } from "@/lib/adminOperationsQuery";
import type { AuditLogOut } from "@/types";

// Adres anahtarları (beyaz liste); dışındakiler okunmaz ve yazılmaz.
const ANAHTARLAR = ["q", "action", "target", "actor", "rid", "sort", "order", "page", "limit"] as const;
type Anahtar = (typeof ANAHTARLAR)[number];
// Doğrulayıcı ile tek kaynak: seçici yalnız parser'ın kabul ettiği boyutları sunar.
const SAYFA_BOYUTLARI = [...ADMIN_PAGE_SIZES];
const VARSAYILAN_BOYUT = ADMIN_DEFAULT_PAGE_SIZE;
const SIRALANABILIR: Record<string, AdminAuditSort> = { action: "action", target_type: "target_type", actor_id: "actor_id", created_at: "created_at" };

export function DenetimKayitlariListesi() {
  const { canView } = useAdminAreaAccess("audit");
  const [params, setParams] = useSearchParams();
  // Tek doğrulama kaynağı: enum beyaz listesi, sayı sınırları, uzunluk kesme.
  const durum = useMemo(() => parseAdminAuditQuery(params), [params]);
  // Arama kutusu URL'yi anında gösterir; yalnız API'ye giden metin gecikir.
  const gecikmisArama = useDebounce(durum.q, 300);

  const [filtreAcik, setFiltreAcik] = useState(false);
  const [secili, setSecili] = useState<AuditLogOut | null>(null);

  // Functional güncelleme: yalnız beyaz listedeki anahtarlar yazılır; sayfa istenmedikçe sıfırlanır.
  const yaz = (yama: Partial<Record<Anahtar, string>>, secenek: { replace?: boolean; sayfayiKoru?: boolean } = {}) => {
    setParams(
      (onceki) => {
        const sonraki = new URLSearchParams();
        for (const k of ANAHTARLAR) {
          const v = k in yama ? yama[k] : onceki.get(k);
          if (v) sonraki.set(k, v);
        }
        if (!secenek.sayfayiKoru && !("page" in yama)) sonraki.delete("page");
        return sonraki;
      },
      { replace: Boolean(secenek.replace) },
    );
  };
  const filtreleriTemizle = () => yaz({ q: "", action: "", target: "", actor: "", rid: "" });

  const liste = useAdminAuditLogs(
    {
      limit: durum.pageSize,
      offset: (durum.page - 1) * durum.pageSize,
      q: gecikmisArama || undefined,
      action: durum.action || undefined,
      target_type: durum.targetType || undefined,
      actor_id: durum.actorId,
      request_id: durum.requestId || undefined,
      sort: durum.sort,
      order: durum.order,
    },
    canView,
  );

  // Veri azalınca sayfa son geçerli sayfayı aşarsa adres güvenli biçimde son sayfaya çekilir.
  const toplam = liste.data?.total;
  useEffect(() => {
    if (toplam === undefined) return;
    const sonSayfa = Math.max(1, Math.ceil(toplam / durum.pageSize));
    if (durum.page > sonSayfa) yaz({ page: sonSayfa > 1 ? String(sonSayfa) : "" }, { replace: true, sayfayiKoru: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toplam, durum.page, durum.pageSize]);

  // Rozet yalnız yapılandırılmış filtreleri sayar; `q` boş durum kararına girer ama rozete girmez.
  const filtreSayisi = (durum.action ? 1 : 0) + (durum.targetType ? 1 : 0) + (durum.actorId ? 1 : 0) + (durum.requestId ? 1 : 0);
  const filtreliMi = filtreSayisi > 0 || Boolean(durum.q);
  const siraDegeri = (alan: AdminAuditSort) => (durum.sort === alan ? (durum.order === "asc" ? "ascend" : "descend") : null);

  const kolonlar: TableProps<AuditLogOut>["columns"] = [
    { title: "Aksiyon", key: "action", sorter: true, sortOrder: siraDegeri("action"), render: (_, k) => <Tag color="processing" style={{ marginInlineEnd: 0 }}>{k.action}</Tag> },
    { title: "Hedef", key: "target_type", sorter: true, sortOrder: siraDegeri("target_type"), render: (_, k) => <span style={{ fontWeight: 500 }}>{hedefEtiketi(k)}</span> },
    { title: "Aktör", key: "actor_id", sorter: true, sortOrder: siraDegeri("actor_id"), render: (_, k) => aktorEtiketi(k) },
    {
      title: "Gerekçe / Açıklama",
      key: "aciklama",
      render: (_, k) => {
        const metin = k.reason || k.details;
        return (
          <Typography.Text type="secondary" ellipsis={{ tooltip: metin ?? undefined }} style={{ fontSize: 12, maxWidth: 360, display: "block" }}>
            {metin || "-"}
          </Typography.Text>
        );
      },
    },
    { title: "Zaman", key: "created_at", sorter: true, sortOrder: siraDegeri("created_at"), render: (_, k) => <span style={{ whiteSpace: "nowrap", fontSize: 12 }}>{formatDateTime(k.created_at)}</span> },
    {
      title: "",
      key: "ayrinti",
      align: "right",
      render: (_, k) => (
        <Button type="link" size="small" style={{ padding: 0 }} aria-label={`${k.action}: denetim kaydı ayrıntısı`} onClick={() => setSecili(k)}>
          Ayrıntı
        </Button>
      ),
    },
  ];

  // Sıralama geçmişe girer (geri tuşu önceki sıralamaya döner).
  const tabloDegisti: TableProps<AuditLogOut>["onChange"] = (_, __, siralayici) => {
    const s = Array.isArray(siralayici) ? siralayici[0] : siralayici;
    const alan = s?.columnKey != null ? SIRALANABILIR[String(s.columnKey)] : undefined;
    if (!alan || !s?.order) return yaz({ sort: "", order: "" });
    yaz({ sort: alan === "created_at" ? "" : alan, order: s.order === "ascend" ? "asc" : "" });
  };

  if (!canView) return <AccessDenied area="Denetim kayıtları" />;

  return (
    <>
      <ListePage<AuditLogOut>
        baslik="Denetim Kayıtları"
        aciklama="Yönetici işlemleri yapıldıkça buraya yazılır; kayıtlar değiştirilemez."
        aramaDegeri={durum.q}
        aramaDegisti={(v) => yaz({ q: v.slice(0, 100) }, { replace: true })}
        filtreSayisi={filtreSayisi}
        filtreIcerigi={
          <Flex gap={8} wrap>
            <Input aria-label="Aksiyon" allowClear maxLength={50} placeholder="Aksiyon" value={durum.action} style={{ width: 200 }} onChange={(e) => yaz({ action: e.target.value }, { replace: true })} />
            <Input aria-label="Hedef türü" allowClear maxLength={30} placeholder="Hedef türü" value={durum.targetType} style={{ width: 180 }} onChange={(e) => yaz({ target: e.target.value }, { replace: true })} />
            <Input aria-label="Aktör ID" allowClear type="number" min={1} placeholder="Aktör ID" value={durum.actorId ?? ""} style={{ width: 120 }} onChange={(e) => yaz({ actor: e.target.value }, { replace: true })} />
            <Input aria-label="Request ID" allowClear maxLength={64} placeholder="Request ID" value={durum.requestId} style={{ width: 200 }} onChange={(e) => yaz({ rid: e.target.value }, { replace: true })} />
          </Flex>
        }
        filtreAcik={filtreAcik}
        filtreAcikDegisti={setFiltreAcik}
        birimEtiket="Kayıt"
        kolonlar={kolonlar}
        veri={liste.data?.items}
        yukleniyor={liste.isPending}
        hata={liste.isError ? "Denetim kayıtları yüklenemedi. Bağlantıyı kontrol edip yeniden deneyin." : null}
        hataAksiyon={<Button size="small" onClick={() => void liste.refetch()}>Tekrar dene</Button>}
        toplam={toplam}
        sayfa={durum.page}
        sayfaBoyutu={durum.pageSize}
        sayfaBoyutuSecenekleri={SAYFA_BOYUTLARI}
        sayfaDegisti={(s, b) => {
          if (b !== durum.pageSize) yaz({ limit: b === VARSAYILAN_BOYUT ? "" : String(b) });
          else yaz({ page: s > 1 ? String(s) : "" });
        }}
        tabloDegisti={tabloDegisti}
        bosBaslik={filtreliMi ? "Bu filtreyle kayıt bulunamadı" : "Denetim kaydı yok"}
        bosAciklama={
          filtreliMi
            ? "Aradığınız ölçütlere uyan bir denetim kaydı yok. Filtreleri temizleyip tüm geçmişe bakabilirsiniz."
            : "Yönetici işlemleri yapıldıkça buraya yazılır; kayıtlar değiştirilemez."
        }
        bosAksiyon={filtreliMi ? <Button onClick={filtreleriTemizle}>Filtreleri temizle</Button> : undefined}
        rowKey={(k) => k.id}
      />
      <DenetimKaydiPenceresi kayit={secili} kapat={() => setSecili(null)} />
    </>
  );
}
