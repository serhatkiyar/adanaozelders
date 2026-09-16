// Genel ayarlar — eski AdminSettingsPage (ödeme kolları + özellik bayrakları) panel düzeninde.
// Veri useFeatureFlags/usePaymentBranches; değişiklik useUpdateFeatureFlag (gerekçe zorunlu, backend audit).
import { useRef, useState, type ReactNode } from "react";
import { Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { BayrakGerekcePenceresi } from "@/panel/pages/ayarlar/BayrakGerekcePenceresi";
import { useFeatureFlags, usePaymentBranches, useUpdateFeatureFlag } from "@/hooks/useFeatureFlags";
import { getErrorDetail } from "@/lib/errors";
import { formatDateTime } from "@/lib/datetime";
import type { FeatureFlagOut } from "@/api/featureFlags";

/** Engelleyici kodları → operatörün anlayacağı tek satır (eski ekranla aynı). */
const ENGEL_METNI: Record<string, string> = {
  flag_disabled: "Bu koldaki ödeme bayrağı kapalı.",
  provider_marketplace_support:
    "Ödeme sağlayıcısı alt üye işyeri (pazaryeri) modelini desteklemiyor: iyzico Pazaryeri entegrasyonu tamamlanmadan bu kol açılamaz.",
  check_failed: "Durum okunamadı; kol güvenli tarafta kalmak için kapalı sayılıyor.",
};

// 422 `note` → gerekçe alanı; eşleşmeyenler genel hata. Miras adlar alan sayılmaz.
function sunucuHatasiniDagit(e: unknown, varsayilan: string): { alan: string | null; genel: string | null } {
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

// Canlı ikas ayar bölümü: beyaz, 0.8px #EEF2F6 çizgi, radius 4; başlık 18/500 + ince ayraç.
function Bolum({ baslik, aciklama, children }: { baslik: string; aciklama?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section aria-label={baslik} style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4 }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Typography.Text style={{ fontSize: 18, fontWeight: 500, lineHeight: "28px", display: "block" }}>{baslik}</Typography.Text>
        {aciklama ? <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>{aciklama}</Typography.Text> : null}
      </div>
      <div style={{ padding: "8px 24px" }}>{children}</div>
    </section>
  );
}

export function GenelAyarlar() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("settings");
  const kollar = usePaymentBranches(canView);
  const bayraklar = useFeatureFlags(canView);
  const guncelle = useUpdateFeatureFlag();
  const [secili, setSecili] = useState<FeatureFlagOut | null>(null);
  const [alanHatasi, setAlanHatasi] = useState<string | null>(null);
  const [genelHata, setGenelHata] = useState<string | null>(null);
  // Senkron kilit: aynı tick'te ikinci PUT çıkmaz.
  const gonderiliyorRef = useRef(false);

  const gonder = (gerekce: string) => {
    if (!secili || gonderiliyorRef.current || guncelle.isPending) return;
    gonderiliyorRef.current = true;
    setAlanHatasi(null);
    setGenelHata(null);
    const hedef = secili;
    const yeni = !hedef.enabled;
    // Gövde eski ekranla birebir: { key, enabled, note }.
    guncelle.mutate(
      { key: hedef.key, enabled: yeni, note: gerekce },
      {
        onSuccess: () => setSecili(null),
        onError: (e) => {
          const { alan, genel } = sunucuHatasiniDagit(e, "Bayrak değiştirilemedi.");
          setAlanHatasi(alan);
          setGenelHata(genel);
        },
        onSettled: () => {
          gonderiliyorRef.current = false;
        },
      },
    );
  };

  const satirStil = { padding: "16px 0", borderBottom: `1px solid ${token.colorBorderSecondary}` };
  const kodStil = { fontFamily: "monospace", fontSize: 12, color: token.colorTextTertiary, display: "block" as const, marginTop: 2 };

  if (!canView) return <AccessDenied area="Genel ayarlar" />;

  const kollarGovdesi = kollar.isPending ? (
    <YukleniyorDurumu etiket="Ödeme kolları yükleniyor…" />
  ) : kollar.isError ? (
    <HataDurumu hata={getErrorDetail(kollar.error, "Ödeme kolu durumu alınamadı.")} hataAksiyon={<Button size="small" onClick={() => void kollar.refetch()}>Tekrar dene</Button>} />
  ) : (kollar.data ?? []).length === 0 ? (
    <BosDurumu baslik="Ödeme kolu bulunamadı" aciklama="Sunucu hiçbir kol bildirmedi; bu beklenmeyen bir durumdur." />
  ) : (
    (kollar.data ?? []).map((kol, i, dizi) => (
      <div key={kol.branch} style={{ ...satirStil, borderBottom: i === dizi.length - 1 ? "none" : satirStil.borderBottom }}>
        <Flex align="center" gap={8} wrap>
          <Typography.Text style={{ fontWeight: 500 }}>{kol.label ?? kol.branch}</Typography.Text>
          {kol.open ? <Tag color="success" style={{ marginInlineEnd: 0 }}>Açık</Tag> : <Tag color="warning" style={{ marginInlineEnd: 0 }}>Kapalı</Tag>}
        </Flex>
        <Typography.Text style={kodStil}>{kol.branch}</Typography.Text>
        {!kol.open && (kol.blockers ?? []).length > 0 ? (
          <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
            {(kol.blockers ?? []).map((kod) => (
              <li key={kod}><Typography.Text type="secondary">{ENGEL_METNI[kod] ?? kod}</Typography.Text></li>
            ))}
          </ul>
        ) : null}
      </div>
    ))
  );

  const bayraklarGovdesi = bayraklar.isPending ? (
    <YukleniyorDurumu etiket="Bayraklar yükleniyor…" />
  ) : bayraklar.isError ? (
    <HataDurumu hata={getErrorDetail(bayraklar.error, "Bayraklar alınamadı.")} hataAksiyon={<Button size="small" onClick={() => void bayraklar.refetch()}>Tekrar dene</Button>} />
  ) : (bayraklar.data ?? []).length === 0 ? (
    <BosDurumu baslik="Bayrak yok" aciklama="Katalogda tanımlı bayrak bulunmuyor." />
  ) : (
    (bayraklar.data ?? []).map((bayrak, i, dizi) => (
      <Flex key={bayrak.key} align="flex-start" gap={16} wrap style={{ ...satirStil, borderBottom: i === dizi.length - 1 ? "none" : satirStil.borderBottom }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Flex align="center" gap={8} wrap>
            <Typography.Text style={{ fontWeight: 500 }}>{bayrak.label}</Typography.Text>
            {bayrak.enabled ? <Tag color="success" style={{ marginInlineEnd: 0 }}>Açık</Tag> : <Tag style={{ marginInlineEnd: 0 }}>Kapalı</Tag>}
            {bayrak.locked_reason ? <Tag color="error" style={{ marginInlineEnd: 0 }}>Üretimde kilitli</Tag> : null}
            {!bayrak.enforced ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>Bağlanmadı</Tag> : null}
          </Flex>
          <Typography.Text style={kodStil}>{bayrak.key}</Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>{bayrak.description}</Typography.Text>
          {!bayrak.enforced ? (
            <Typography.Text type="warning" style={{ display: "block", marginTop: 8 }}>
              Bu bayrak henüz hiçbir kontrolde okunmuyor: açmak veya kapatmak davranışı değiştirmez.
            </Typography.Text>
          ) : null}
          {bayrak.locked_reason ? <Typography.Text type="danger" style={{ display: "block", marginTop: 8 }}>{bayrak.locked_reason}</Typography.Text> : null}
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
            Varsayılan: {bayrak.default ? "açık" : "kapalı"}
            {bayrak.updated_at ? ` · Son değişiklik ${formatDateTime(bayrak.updated_at)}` : " · hiç değiştirilmedi"}
            {bayrak.note ? ` · “${bayrak.note}”` : ""}
          </Typography.Text>
        </div>
        {canManage ? (
          <Button
            type={bayrak.enabled ? "default" : "primary"}
            // Kilitli kapalı bayrak açılamaz; sebep satırdaki kilit metninde yazar.
            disabled={!!bayrak.locked_reason && !bayrak.enabled}
            aria-label={`${bayrak.label} bayrağını ${bayrak.enabled ? "kapat" : "aç"}`}
            onClick={() => {
              setAlanHatasi(null);
              setGenelHata(null);
              setSecili(bayrak);
            }}
          >
            {bayrak.enabled ? "Kapat" : "Aç"}
          </Button>
        ) : null}
      </Flex>
    ))
  );

  return (
    <Flex vertical gap={24}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Genel Ayarlar</Typography.Title>
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">Bu alanda yalnız görüntüleme yetkiniz var; bayrak değiştirmek için settings.manage izni gerekir.</Typography.Text>
      ) : null}
      <Bolum baslik="Ödeme kolları" aciklama="Her kol bağımsızdır: birinin eksiği diğerini kapatmaz. Bir kolun açık olması için hem bayrağı açık hem de ödeme sağlayıcısı gerekli yeteneği sunuyor olmalı.">
        {kollarGovdesi}
      </Bolum>
      <Bolum baslik="Özellik bayrakları" aciklama="Her değişiklik gerekçesiyle denetim kayıtlarına yazılır; tüm sunucu süreçlerinde en fazla 10 saniye içinde etkili olur.">
        {bayraklarGovdesi}
      </Bolum>
      <BayrakGerekcePenceresi
        acik={secili !== null}
        bayrak={secili}
        kapat={() => setSecili(null)}
        kaydediyor={guncelle.isPending}
        alanHatasi={alanHatasi}
        hata={genelHata}
        kilitliMi={() => gonderiliyorRef.current}
        onayla={gonder}
      />
    </Flex>
  );
}
