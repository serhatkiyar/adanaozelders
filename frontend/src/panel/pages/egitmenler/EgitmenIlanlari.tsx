// Eğitmen Yönetimi → Eğitmen İlanları — eski `AdminHome`'un ListingManagement/ListingRow bölümü panel düzeninde.
// Onay bekleyenler operasyon kuyruğudur ve listenin BAŞINDA durur; kuyruk başlığı yalnız iş VARKEN basılır (boş bir
// "0 başvuru" bölümü gerçek kuyruğu görünmez kılardı). Yazma yüzeyleri yalnız tutors.manage; sunucu sayfalaması ya da
// toplam uydurulmaz — liste sunucudan geldiği gibi, yalnız durum önceliğiyle sıralanır.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { App, Avatar, Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { VarlikDugmesi, useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { sunucuHatasiniDagit } from "@/panel/components/pencereAlanlari";
import { RedPenceresi } from "@/panel/pages/egitmenler/EgitmenIlanPencereleri";
import { useActivateTutor, useAdminTutors, useApproveTutor, useDeleteTutor, useRejectTutor, useSuspendTutor } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import { formatRate } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { TutorStatus } from "@/types";
import type { TutorOut } from "@/types";

/** Onay bekleyenler kuyruktur: listenin BAŞINDA durur (eski sözleşme). */
export const DURUM_SIRASI: Record<TutorStatus, number> = {
  [TutorStatus.PENDING_APPROVAL]: 0,
  [TutorStatus.APPROVED]: 1,
  [TutorStatus.SUSPENDED]: 2,
  [TutorStatus.REJECTED]: 3,
  [TutorStatus.DRAFT]: 4,
};
/** Etiket metinleri eski ekranla birebir; renk yalnız semantik (bekleyen/yayında/reddedildi). */
export const DURUM_ETIKETI: Record<TutorStatus, string> = {
  [TutorStatus.DRAFT]: "Taslak",
  [TutorStatus.PENDING_APPROVAL]: "Onay Bekliyor",
  [TutorStatus.APPROVED]: "Yayında",
  [TutorStatus.REJECTED]: "Reddedildi",
  [TutorStatus.SUSPENDED]: "Pasif",
};
const DURUM_RENGI: Record<TutorStatus, string | undefined> = {
  [TutorStatus.DRAFT]: undefined,
  [TutorStatus.PENDING_APPROVAL]: "warning",
  [TutorStatus.APPROVED]: "success",
  [TutorStatus.REJECTED]: "error",
  [TutorStatus.SUSPENDED]: undefined,
};
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };

/** Durum önceliğine göre sıralar (sunucu sırası eşitlikte korunur — `sort` kararlıdır). */
export function ilanlariSirala(liste: TutorOut[]): TutorOut[] {
  return [...liste].sort((a, b) => (DURUM_SIRASI[a.status] ?? 9) - (DURUM_SIRASI[b.status] ?? 9));
}

export function EgitmenIlanlari() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("tutors");
  // Ad bağlantısının hedefi `MusteriDetayi`dir ve o ekran `users.view` ister: izin yoksa ölü bağlantı yerine düz metin.
  const { canView: kullaniciGorebilir } = useAdminAreaAccess("users");

  const sorgu = useAdminTutors(canView);
  const onayla = useApproveTutor();
  const reddet = useRejectTutor();
  const pasifeAl = useSuspendTutor();
  const etkinlestir = useActivateTutor();
  const sil = useDeleteTutor();

  // Red penceresi: hedef kimlik ve görünen ad AÇILIŞTA sabitlenir.
  const [redPenceresi, setRedPenceresi] = useState<{ id: number; adSoyad: string } | null>(null);
  const [redHatasi, setRedHatasi] = useState<{ alan: Record<string, string | undefined>; genel: string | null }>({ alan: {}, genel: null });
  const { kilitle, kilitli, surenIslem, kapatmaEngeli, onayla: kilitliOnay } = useVarlikKilidi(message);

  const liste = useMemo(() => ilanlariSirala(Array.isArray(sorgu.data) ? sorgu.data : []), [sorgu.data]);
  const bekleyenler = liste.filter((t) => t.status === TutorStatus.PENDING_APPROVAL);
  const digerleri = liste.filter((t) => t.status !== TutorStatus.PENDING_APPROVAL);

  /** Tek adımlı durum işlemleri: aynı eğitmen tek varlık kilidini paylaşır. */
  const durumIslemi = (t: TutorOut, islem: "onay" | "pasif" | "etkin") => {
    const hedefId = t.id;
    const ad = t.full_name;
    // `message.success` AntD'de thenable döner: zincirin DÖNÜŞ değeri yapılırsa kilit mesaj kapanana kadar tutulurdu.
    const calistir = () =>
      islem === "onay"
        ? onayla.mutateAsync(hedefId).then(() => { message.success(`${ad} onaylandı.`); })
        : islem === "pasif"
          ? pasifeAl.mutateAsync(hedefId).then(() => { message.success("İlan yayından kaldırıldı."); })
          : etkinlestir.mutateAsync(hedefId).then(() => { message.success("İlan yeniden yayında."); });
    const varsayilan = islem === "onay" ? "Onaylama başarısız." : "İşlem başarısız.";
    void kilitle(`tutor:${hedefId}`, islem, () =>
      calistir()
        // `message.error` thenable'ı zincire DÖNDÜRÜLMEZ: kilit mesaj kapanışını beklemesin.
        .catch((e: unknown) => {
          message.error(getErrorDetail(e, varsayilan));
        }),
    );
  };

  const silOnayi = (t: TutorOut) => {
    const hedefId = t.id;
    const ad = t.full_name;
    const varlik = `tutor:${hedefId}`;
    if (kilitli(varlik)) return;
    modal.confirm({
      title: "İlanı sil",
      content: `${ad} ilanı kalıcı olarak silinecek.`,
      okText: "İlanı sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      // ESC onayı pending'de kapatabilir ve onCancel dönüşünü yok sayar; klavye kapatması kapalı.
      keyboard: false,
      onCancel: kapatmaEngeli(varlik),
      onOk: kilitliOnay(varlik, "sil", () =>
        sil
          .mutateAsync(hedefId)
          .then(() => {
            message.success("İlan silindi.");
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "Silme başarısız."));
            throw e;
          }),
      ),
    });
  };

  const redAc = (t: TutorOut) => {
    // `silOnayi` ile simetrik senkron kapı: düğme kapalı olsa da ikinci koruma katmanı burada.
    if (kilitli(`tutor:${t.id}`)) return;
    setRedHatasi({ alan: {}, genel: null });
    setRedPenceresi({ id: t.id, adSoyad: t.full_name });
  };
  const redGonder = (gerekce: string) => {
    const hedef = redPenceresi;
    if (!hedef) return;
    void kilitle(`tutor:${hedef.id}`, "red", () => {
      setRedHatasi({ alan: {}, genel: null });
      return reddet
        .mutateAsync({ id: hedef.id, reason: gerekce })
        .then(() => {
          setRedPenceresi(null);
          message.success(`${hedef.adSoyad} reddedildi.`);
        })
        .catch((e: unknown) => setRedHatasi(sunucuHatasiniDagit(e, "Reddetme başarısız.", ["reason"])));
    });
  };

  if (!canView) return <AccessDenied area="Eğitmenler" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };
  const bolumBasligi = (baslik: string, aciklama: string, sag?: React.ReactNode) => (
    <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Text style={{ fontSize: 18, fontWeight: 500, display: "block" }}>{baslik}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{aciklama}</Typography.Text>
      </div>
      {sag}
    </Flex>
  );

  const satir = (t: TutorOut, i: number, dizi: TutorOut[]) => {
    const mesgul = surenIslem(`tutor:${t.id}`);
    return (
      <Flex key={t.id} data-testid={`ilan-${t.id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
        <Flex align="center" gap={12} style={{ minWidth: 0, flex: "1 1 260px" }}>
          {t.avatar_url ? <Avatar src={t.avatar_url} alt={t.full_name} size={40} style={{ flexShrink: 0 }} /> : <Avatar size={40} style={{ flexShrink: 0 }}>{t.full_name.charAt(0).toLocaleUpperCase("tr")}</Avatar>}
          <div style={{ minWidth: 0 }}>
            <Flex align="baseline" gap={8} wrap>
              {/* Gerçek bağlantı: Ctrl/orta tık çalışır, iç içe a/button yok. */}
              {kullaniciGorebilir ? (
                <Link to={ROUTES.adminNewCustomer("tutor", t.id)} style={{ fontWeight: 500, ...SAR }}>{t.full_name}</Link>
              ) : (
                <Typography.Text style={{ fontWeight: 500, ...SAR }}>{t.full_name}</Typography.Text>
              )}
              <Tag color={DURUM_RENGI[t.status]} style={{ marginInlineEnd: 0 }}>{DURUM_ETIKETI[t.status] ?? t.status}</Tag>
            </Flex>
            {t.headline ? <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAR }}>{t.headline}</Typography.Text> : null}
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAYI }}>{formatRate(t.hourly_rate)}</Typography.Text>
          </div>
        </Flex>
        {canManage ? (
          <Flex align="center" gap={8} wrap>
            {t.status === TutorStatus.PENDING_APPROVAL ? (
              <>
                <VarlikDugmesi islem="onay" mesgulIslem={mesgul} type="primary" aria-label={`${t.full_name} · Onayla`} onClick={() => durumIslemi(t, "onay")}>Onayla</VarlikDugmesi>
                <VarlikDugmesi islem="red" mesgulIslem={mesgul} aria-label={`${t.full_name} · Reddet`} onClick={() => redAc(t)}>Reddet</VarlikDugmesi>
              </>
            ) : null}
            {t.status === TutorStatus.APPROVED ? (
              <VarlikDugmesi islem="pasif" mesgulIslem={mesgul} aria-label={`${t.full_name} · Pasife al`} onClick={() => durumIslemi(t, "pasif")}>Pasife al</VarlikDugmesi>
            ) : null}
            {t.status === TutorStatus.SUSPENDED ? (
              <VarlikDugmesi islem="etkin" mesgulIslem={mesgul} aria-label={`${t.full_name} · Yayına al`} onClick={() => durumIslemi(t, "etkin")}>Yayına al</VarlikDugmesi>
            ) : null}
            <VarlikDugmesi islem="sil" mesgulIslem={mesgul} danger aria-label={`${t.full_name} · Sil`} onClick={() => silOnayi(t)}>Sil</VarlikDugmesi>
          </Flex>
        ) : null}
      </Flex>
    );
  };

  // Hata / yükleniyor / boş: üçü de aynı kart iskeletinde (veri gelince çerçeve birden belirmez).
  const tekBolum = (icerik: React.ReactNode) => (
    <section aria-label="Eğitmen ilanları" style={kart}>
      {bolumBasligi("Eğitmen ilanları", "Onay kuyruğu ve yayındaki ilanlar tek listede.")}
      <div style={{ padding: "16px 24px" }}>{icerik}</div>
    </section>
  );
  const govde = sorgu.isError ? (
    tekBolum(<HataDurumu hata={getErrorDetail(sorgu.error, "İlanlar yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />)
  ) : sorgu.isPending ? (
    tekBolum(<YukleniyorDurumu etiket="İlanlar yükleniyor…" />)
  ) : liste.length === 0 ? (
    // Oluşturma ucu yok: boş durumda aksiyon uydurulmaz.
    tekBolum(<BosDurumu baslik="Henüz ilan yok" aciklama="Eğitmen başvurusu geldikçe ilanlar burada listelenir." />)
  ) : (
    <>
      {/* Kuyruk başlığı yalnız iş VARKEN basılır. */}
      {bekleyenler.length > 0 ? (
        <section aria-label="Onay bekleyen eğitmenler" style={kart}>
          {bolumBasligi(
            "Onay bekleyen eğitmenler",
            "Bu başvurular incelemenizi bekliyor. Onay ilanı yayına alır; red gerekçesi denetim izine yazılır.",
            <Tag style={{ marginInlineEnd: 0, ...SAYI }}>{bekleyenler.length}</Tag>,
          )}
          <div style={{ padding: "0 24px" }}>{bekleyenler.map(satir)}</div>
        </section>
      ) : null}
      {digerleri.length > 0 ? (
        <section aria-label="Diğer ilanlar" style={kart}>
          {bolumBasligi(
            "Diğer ilanlar",
            // Sayı ALTTAKİ listeye aittir: toplam yazmak, kuyruk ayrıldıktan sonra sayıdan az satır göstermek olurdu.
            `${digerleri.length} ilan · yayındakileri pasife alabilir, pasifleri yayına alabilir veya silebilirsiniz.`,
          )}
          <div style={{ padding: "0 24px" }}>{digerleri.map(satir)}</div>
        </section>
      ) : null}
    </>
  );

  const redVarlik = redPenceresi ? `tutor:${redPenceresi.id}` : null;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Eğitmen ilanları</Typography.Title>
      </Flex>
      {!canManage ? <Typography.Text type="secondary">Salt okunur görünüm: onay, red, pasife alma ve silme için tutors.manage izni gerekir.</Typography.Text> : null}
      {govde}

      <RedPenceresi
        acik={redPenceresi !== null}
        adSoyad={redPenceresi?.adSoyad ?? ""}
        kapat={() => setRedPenceresi(null)}
        kaydediyor={redVarlik !== null && surenIslem(redVarlik) === "red"}
        alanHatalari={redHatasi.alan}
        hata={redHatasi.genel}
        kilitliMi={() => redVarlik !== null && kilitli(redVarlik)}
        onayla={redGonder}
      />
    </Flex>
  );
}
