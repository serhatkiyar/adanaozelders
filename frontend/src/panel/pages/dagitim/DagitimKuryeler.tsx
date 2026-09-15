// Dağıtım → Kuryeler — eski DeliveryCouriersPage (CourierManager + ClosedDays + DeliveryConfig) panel düzeninde.
// Üç bölüm: kurye profilleri (rol-5 giriş hesabı yaşam döngüsüyle), teslimat takvimi (kapalı günler) ve salt
// okunur teslimat yapılandırması. Yazma yüzeyleri yalnız delivery.manage; hesap sorgusu yalnız manage + satır
// hesap yüzeyi açıkken (satır başına otomatik istek yok). Şifre hiçbir zaman ön doldurulmaz, URL/loga taşınmaz.
//
// Kilit modeli VARLIK bazlıdır (küresel kilit yok): `kurye:{id}` (düzenle/aktif/sil/foto/hesap oluştur),
// `kurye:yeni` (ekle), `hesap:{accountId}` (şifre/kapat), `gun:yeni`, `gun:{id}`, `takvim:tatil`. Aynı varlıkta
// aynı işlem yeniden istenirse uçuştaki söz paylaşılır (aynı tick çift tık → tek istek); farklı işlem istenirse
// istek çıkmaz ve neden görünür. Pending işlemin düğmesi loading, aynı varlığın diğer yazma düğmeleri kapalıdır.
import { useRef, useState } from "react";
import { App, Avatar, Button, Flex, Input, Tag, Typography, theme } from "antd";
import { VarlikDugmesi, useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { HesapPenceresi, KuryePenceresi, SifrePenceresi, sunucuHatasiniDagit, type HesapDegerleri, type KuryeDegerleri } from "@/panel/pages/dagitim/KuryePencereleri";
import {
  useAddClosedDay,
  useCapacityOverview,
  useCloseCourierAccount,
  useClosedDays,
  useCourierAccount,
  useCouriers,
  useCreateCourier,
  useCreateCourierAccount,
  useDeleteCourier,
  useDeliveryInfo,
  useRemoveClosedDay,
  useResetCourierPassword,
  useSeedHolidays,
  useUpdateCourier,
  useUploadCourierPhoto,
} from "@/hooks/useDelivery";
import { getErrorDetail } from "@/lib/errors";
import type { ClosedDay, Courier } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

const GUN_BICIMI = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });
/** Kapalı gün satır açıklaması: etiket varsa o; `holiday` kaynağında "Resmî tatil", diğerinde "Kapalı". */
export function kapaliGunAciklamasi(d: ClosedDay): string {
  return d.label ?? (d.source === "holiday" ? "Resmî tatil" : "Kapalı");
}
/** Kapasite metni: 0 → sınırsız. */
export function kapasiteMetni(cap: number): string {
  return cap > 0 ? `${cap} sipariş` : "sınırsız";
}
/** Backend `ClosedDayIn.label` üst sınırı. */
export const ACIKLAMA_MAX = 120;
export { MESGUL_NEDENI } from "@/panel/components/varlikKilidi";

type Hata = { alan: Record<string, string | undefined>; genel: string | null };
const TEMIZ_HATA: Hata = { alan: {}, genel: null };

function KuryeAvatar({ c }: { c: Courier }) {
  return c.photo_url ? <Avatar src={c.photo_url} alt={c.name} size={40} /> : <Avatar size={40}>{c.name.charAt(0).toLocaleUpperCase("tr")}</Avatar>;
}

/** Kuryenin giriş hesabı yüzeyi — yalnız açıkken mount edilir, sorgu yalnız burada atılır. */
function KuryeHesapPaneli({ c, canManage, ayrac, kuryeIslemi, hesapIslemi, sifreAc, hesapOlusturAc, hesabiKapat }: {
  c: Courier;
  canManage: boolean;
  ayrac: string;
  /** Kurye varlığında süren işlem (hesap oluşturma bu varlığa bağlıdır). */
  kuryeIslemi: string | undefined;
  hesapIslemi: (accountId: number) => string | undefined;
  sifreAc: (accountId: number) => void;
  hesapOlusturAc: () => void;
  hesabiKapat: (accountId: number) => void;
}) {
  const hesap = useCourierAccount(c.id, canManage);
  if (hesap.isError) {
    return <HataDurumu hata={getErrorDetail(hesap.error, "Giriş hesabı bilgisi alınamadı.")} hataAksiyon={<Button size="small" onClick={() => void hesap.refetch()}>Tekrar dene</Button>} />;
  }
  if (hesap.isPending) return <Typography.Text type="secondary">Giriş hesabı sorgulanıyor…</Typography.Text>;
  const account = hesap.data;
  if (account?.is_active) {
    const mesgul = hesapIslemi(account.id);
    return (
      <Flex align="center" gap={12} wrap style={{ paddingTop: 12, borderTop: `1px solid ${ayrac}` }}>
        <Typography.Text type="secondary"><Typography.Text style={{ fontWeight: 500 }}>Giriş hesabı:</Typography.Text> {account.email}</Typography.Text>
        <VarlikDugmesi islem="sifre" mesgulIslem={mesgul} onClick={() => sifreAc(account.id)}>Şifre sıfırla</VarlikDugmesi>
        <VarlikDugmesi islem="hesapKapat" mesgulIslem={mesgul} danger onClick={() => hesabiKapat(account.id)}>Hesabı kapat</VarlikDugmesi>
      </Flex>
    );
  }
  return (
    <Flex align="center" gap={12} wrap style={{ paddingTop: 12, borderTop: `1px solid ${ayrac}` }}>
      <Typography.Text type="secondary">Giriş hesabı yok: kurye saha ekranına kendi hesabıyla girsin diye oluşturun.</Typography.Text>
      <VarlikDugmesi islem="hesap" mesgulIslem={kuryeIslemi} onClick={hesapOlusturAc}>Hesap oluştur</VarlikDugmesi>
    </Flex>
  );
}

export function DagitimKuryeler() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("delivery");

  const kuryeler = useCouriers(canView);
  const takvim = useClosedDays(canView);
  const bilgi = useDeliveryInfo(canView);
  const kapasite = useCapacityOverview(14, canView);

  const kuryeOlustur = useCreateCourier();
  const kuryeGuncelle = useUpdateCourier();
  const kuryeSil = useDeleteCourier();
  const fotoYukle = useUploadCourierPhoto();
  const hesapOlustur = useCreateCourierAccount();
  const hesapKapat = useCloseCourierAccount();
  const sifreSifirla = useResetCourierPassword();
  const gunEkle = useAddClosedDay();
  const gunAc = useRemoveClosedDay();
  const tatilYukle = useSeedHolidays();

  // Pencereler: hedef kimlik açılışta sabitlenir; her pencerenin sunucu hatası kendine aittir (başkasına taşınmaz).
  const [kuryePenceresi, setKuryePenceresi] = useState<{ mod: "ekle" } | { mod: "duzenle"; kurye: Courier } | null>(null);
  const [hesapPenceresi, setHesapPenceresi] = useState<{ kurye: Courier } | null>(null);
  const [sifrePenceresi, setSifrePenceresi] = useState<{ accountId: number; kuryeAdi: string } | null>(null);
  const [kuryeHatasi, setKuryeHatasi] = useState<Hata>(TEMIZ_HATA);
  const [hesapHatasi, setHesapHatasi] = useState<Hata>(TEMIZ_HATA);
  const [sifreHatasi, setSifreHatasi] = useState<Hata>(TEMIZ_HATA);
  const [acikHesaplar, setAcikHesaplar] = useState<number[]>([]);
  // Takvim satır içi formu.
  const [gun, setGun] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [gunHatalari, setGunHatalari] = useState<Record<string, string | undefined>>({});
  const [takvimHatasi, setTakvimHatasi] = useState<string | null>(null);
  const gunRef = useRef<import("antd").InputRef>(null);
  const aciklamaRef = useRef<import("antd").InputRef>(null);
  const fotoInputlar = useRef<Record<number, HTMLInputElement | null>>({});

  const { kilitle, kilitli, surenIslem, onayIsi } = useVarlikKilidi(message);

  const kuryeListesi: Courier[] = Array.isArray(kuryeler.data) ? kuryeler.data : [];
  const gunler: ClosedDay[] = Array.isArray(takvim.data) ? takvim.data : [];
  const yil = new Date().getFullYear();
  const kuryeVarligi = (hedef: { mod: "ekle" } | { mod: "duzenle"; kurye: Courier }) => (hedef.mod === "ekle" ? "kurye:yeni" : `kurye:${hedef.kurye.id}`);

  /* ── Kurye profili ── */
  const kuryeEkleAc = () => { setKuryeHatasi(TEMIZ_HATA); setKuryePenceresi({ mod: "ekle" }); };
  const kuryeKaydet = (deger: KuryeDegerleri) => {
    const hedef = kuryePenceresi;
    if (!hedef) return;
    void kilitle(kuryeVarligi(hedef), hedef.mod, () => {
      // Genel hata yalnız gerçekten yeni gönderim başlarken silinir.
      setKuryeHatasi(TEMIZ_HATA);
      // Ekleme payload'ı bilinçli olarak `{ name, phone }`: backend CourierCreate.phone destekler; eski satır içi form yalnız ad alıyordu.
      return (hedef.mod === "ekle" ? kuryeOlustur.mutateAsync({ name: deger.name, phone: deger.phone }) : kuryeGuncelle.mutateAsync({ courierId: hedef.kurye.id, payload: { name: deger.name, phone: deger.phone } }))
        .then(() => {
          setKuryePenceresi(null);
          message.success(hedef.mod === "ekle" ? "Kurye eklendi." : "Kurye güncellendi.");
        })
        .catch((e: unknown) => setKuryeHatasi(sunucuHatasiniDagit(e, hedef.mod === "ekle" ? "Kurye eklenemedi." : "Kurye güncellenemedi.", ["name", "phone"])));
    });
  };
  const aktiflikDegistir = (c: Courier) => {
    const hedefId = c.id;
    const yeni = !c.is_active;
    void kilitle(`kurye:${hedefId}`, "aktif", () =>
      kuryeGuncelle
        .mutateAsync({ courierId: hedefId, payload: { is_active: yeni } })
        .then(() => {
          message.success(yeni ? "Kurye aktifleştirildi." : "Kurye pasifleştirildi.");
        })
        // `message.error` thenable'ı zincire DÖNDÜRÜLMEZ: kilit mesaj kapanışını beklemesin.
        .catch((e: unknown) => {
          message.error(getErrorDetail(e, "Güncellenemedi."));
        }),
    );
  };
  const silOnayi = (c: Courier) => {
    const hedefId = c.id;
    const varlik = `kurye:${hedefId}`;
    if (kilitli(varlik)) return;
    onayAc(modal, {
      title: "Kurye profilini sil",
      content: `${c.name} kurye profili silinecek.`,
      okText: "Kuryeyi sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      ...onayIsi(varlik, "sil", () =>
        kuryeSil
          .mutateAsync(hedefId)
          .then(() => {
            message.success("Kurye silindi.");
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "Silinemedi."));
            throw e;
          }),
      ),
    });
  };
  const fotoAc = (c: Courier) => {
    // Kilitliyken dosya seçici açılmaz.
    if (kilitli(`kurye:${c.id}`)) return;
    fotoInputlar.current[c.id]?.click();
  };
  const fotoSec = (c: Courier, dosya: File | undefined) => {
    if (!dosya) return;
    const hedefId = c.id;
    void kilitle(`kurye:${hedefId}`, "foto", () =>
      fotoYukle
        .mutateAsync({ courierId: hedefId, file: dosya })
        .then(() => {
          message.success("Fotoğraf güncellendi.");
        })
        .catch((e: unknown) => {
          message.error(getErrorDetail(e, "Fotoğraf yüklenemedi."));
        }),
    );
  };

  /* ── Giriş hesabı ── */
  const hesapOlusturGonder = (deger: HesapDegerleri) => {
    const hedef = hesapPenceresi;
    if (!hedef) return;
    void kilitle(`kurye:${hedef.kurye.id}`, "hesap", () => {
      setHesapHatasi(TEMIZ_HATA);
      return hesapOlustur
        .mutateAsync({ courierId: hedef.kurye.id, ...deger })
        .then(() => {
          setHesapPenceresi(null);
          message.success("Giriş hesabı oluşturuldu.");
        })
        .catch((e: unknown) => setHesapHatasi(sunucuHatasiniDagit(e, "Hesap oluşturulamadı.", ["first_name", "last_name", "email", "password"])))
        // Şifre taşıyan mutation: hata yerel state'e aktarıldıktan sonra observer/cache kopyası silinir.
        .finally(() => hesapOlustur.reset());
    });
  };
  const sifreGonder = (yeniSifre: string) => {
    const hedef = sifrePenceresi;
    if (!hedef) return;
    void kilitle(`hesap:${hedef.accountId}`, "sifre", () => {
      setSifreHatasi(TEMIZ_HATA);
      return sifreSifirla
        .mutateAsync({ accountId: hedef.accountId, newPassword: yeniSifre })
        .then(() => {
          setSifrePenceresi(null);
          message.success("Şifre güncellendi.");
        })
        .catch((e: unknown) => setSifreHatasi(sunucuHatasiniDagit(e, "Şifre güncellenemedi.", ["password"])))
        .finally(() => sifreSifirla.reset());
    });
  };
  const hesabiKapatOnayi = (c: Courier, accountId: number) => {
    const varlik = `hesap:${accountId}`;
    if (kilitli(varlik)) return;
    onayAc(modal, {
      title: "Kurye giriş hesabını kapat",
      content: `${c.name} için açık oturumlar anında sonlandırılacak.`,
      okText: "Hesabı kapat",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      ...onayIsi(varlik, "hesapKapat", () =>
        hesapKapat
          .mutateAsync(accountId)
          .then(() => {
            message.success("Hesap kapatıldı: oturumları sonlandırıldı.");
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "Hesap kapatılamadı."));
            throw e;
          }),
      ),
    });
  };

  /* ── Takvim ── */
  const gunuKapat = () => {
    if (kilitli("gun:yeni")) return;
    const hatalar: Record<string, string | undefined> = {};
    const temizAciklama = aciklama.trim();
    if (!gun) hatalar.day = "Kapatılacak günü seçin.";
    if (temizAciklama.length > ACIKLAMA_MAX) hatalar.label = `Açıklama en fazla ${ACIKLAMA_MAX} karakter olabilir.`;
    setGunHatalari(hatalar);
    if (hatalar.day) return gunRef.current?.focus();
    if (hatalar.label) return aciklamaRef.current?.focus();
    setTakvimHatasi(null);
    const hedefGun = gun;
    void kilitle("gun:yeni", "gunEkle", () =>
      gunEkle
        .mutateAsync({ day: hedefGun, label: temizAciklama || undefined })
        .then(() => {
          message.success("Gün teslimata kapatıldı.");
          setGun("");
          setAciklama("");
        })
        .catch((e: unknown) => {
          const { alan, genel } = sunucuHatasiniDagit(e, "Eklenemedi.", ["day", "label"]);
          setGunHatalari(alan);
          setTakvimHatasi(genel);
          if (alan.day) gunRef.current?.focus();
          else if (alan.label) aciklamaRef.current?.focus();
        }),
    );
  };
  const gunuAcOnayi = (d: ClosedDay) => {
    const hedefId = d.id;
    const varlik = `gun:${hedefId}`;
    if (kilitli(varlik)) return;
    onayAc(modal, {
      title: "Günü yeniden aç",
      content: `${GUN_BICIMI.format(new Date(`${d.day}T00:00:00`))} teslimata yeniden açılacak; söz motoru bu güne yine söz verebilir.`,
      okText: "Yeniden aç",
      cancelText: "Vazgeç",
      ...onayIsi(varlik, "gunAc", () =>
        gunAc
          .mutateAsync(hedefId)
          .then(() => {
            message.success("Gün yeniden açıldı.");
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "Açılamadı."));
            throw e;
          }),
      ),
    });
  };
  const tatilYukleOnayi = () => {
    if (kilitli("takvim:tatil")) return;
    const hedefYil = yil;
    onayAc(modal, {
      title: `${hedefYil} resmî tatillerini yükle`,
      content: "Yılın resmî tatilleri teslimata kapalı olarak işaretlenir (yinelenenler atlanır). İstemediğiniz günü listeden açabilirsiniz. Not: tatil verisi şimdilik yalnız 2026 için tanımlı.",
      okText: "Yükle",
      cancelText: "Vazgeç",
      ...onayIsi("takvim:tatil", "tatil", () =>
        tatilYukle
          .mutateAsync(hedefYil)
          .then((r) => {
            message.success(r.length > 0 ? `${r.length} resmî tatil yüklendi.` : "Bu yıl için tatil verisi yok.");
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "Yüklenemedi."));
            throw e;
          }),
      ),
    });
  };

  if (!canView) return <AccessDenied area="Dağıtım" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };
  const bolumBasligi = (baslik: string, aciklamaMetni: string, sag?: React.ReactNode) => (
    <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
      <div>
        <Typography.Text style={{ fontWeight: 500, display: "block" }}>{baslik}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{aciklamaMetni}</Typography.Text>
      </div>
      {sag}
    </Flex>
  );

  const kuryeGovdesi = kuryeler.isError ? (
    <div style={{ padding: "16px 0" }}><HataDurumu hata={getErrorDetail(kuryeler.error, "Kuryeler yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void kuryeler.refetch()}>Tekrar dene</Button>} /></div>
  ) : kuryeler.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Kuryeler yükleniyor…" /></div>
  ) : kuryeListesi.length === 0 ? (
    // Boş listede tek aksiyon: yalnız boş durumun kendisinde (başlıktaki düğme dolu listeye aittir).
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Henüz kurye yok" aciklama="Takip sayfasında kimlik göstermek için kurye ekleyin." aksiyon={canManage ? <Button type="primary" onClick={kuryeEkleAc}>Kurye ekle</Button> : undefined} /></div>
  ) : (
    kuryeListesi.map((c, i, dizi) => {
      const hesapAcik = acikHesaplar.includes(c.id);
      const mesgul = surenIslem(`kurye:${c.id}`);
      return (
        <div key={c.id} data-testid={`kurye-${c.id}`} style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
          <Flex align="center" justify="space-between" gap={12} wrap>
            <Flex align="center" gap={12} style={{ minWidth: 0, flex: "1 1 220px" }}>
              <KuryeAvatar c={c} />
              <div style={{ minWidth: 0 }}>
                <Flex align="baseline" gap={8} wrap>
                  <Typography.Text style={{ fontWeight: 500 }}>{c.name}</Typography.Text>
                  {!c.is_active ? <Tag style={{ marginInlineEnd: 0 }}>pasif</Tag> : null}
                </Flex>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>{c.phone || "-"}</Typography.Text>
              </div>
            </Flex>
            {canManage ? (
              <Flex align="center" gap={8} wrap>
                {/* Fotoğraf: görünür düğme klavye/ekran okuyucu için; gizli dosya alanı adlı gerçek kontrol. */}
                <VarlikDugmesi islem="foto" mesgulIslem={mesgul} onClick={() => fotoAc(c)}>Fotoğraf</VarlikDugmesi>
                <input
                  ref={(r) => { fotoInputlar.current[c.id] = r; }}
                  type="file"
                  accept="image/*"
                  aria-label={`${c.name} için vesikalık dosyası`}
                  style={{ display: "none" }}
                  onChange={(e) => { fotoSec(c, e.target.files?.[0]); e.target.value = ""; }}
                />
                {/* Hesap yüzeyini açmak okuma işlemidir; kilide bağlı değil. */}
                <Button aria-expanded={hesapAcik} onClick={() => setAcikHesaplar((o) => (o.includes(c.id) ? o.filter((x) => x !== c.id) : [...o, c.id]))}>Hesap</Button>
                <VarlikDugmesi islem="duzenle" mesgulIslem={mesgul} onClick={() => { setKuryeHatasi(TEMIZ_HATA); setKuryePenceresi({ mod: "duzenle", kurye: c }); }}>Düzenle</VarlikDugmesi>
                <VarlikDugmesi islem="aktif" mesgulIslem={mesgul} onClick={() => aktiflikDegistir(c)}>{c.is_active ? "Pasifleştir" : "Aktifleştir"}</VarlikDugmesi>
                <VarlikDugmesi islem="sil" mesgulIslem={mesgul} danger onClick={() => silOnayi(c)}>Sil</VarlikDugmesi>
              </Flex>
            ) : null}
          </Flex>
          {canManage && hesapAcik ? (
            <div style={{ marginTop: 12 }}>
              <KuryeHesapPaneli
                c={c}
                canManage={canManage}
                ayrac={ayrac}
                kuryeIslemi={mesgul}
                hesapIslemi={(accountId) => surenIslem(`hesap:${accountId}`)}
                sifreAc={(accountId) => { setSifreHatasi(TEMIZ_HATA); setSifrePenceresi({ accountId, kuryeAdi: c.name }); }}
                hesapOlusturAc={() => { setHesapHatasi(TEMIZ_HATA); setHesapPenceresi({ kurye: c }); }}
                hesabiKapat={(accountId) => hesabiKapatOnayi(c, accountId)}
              />
            </div>
          ) : null}
        </div>
      );
    })
  );

  const takvimGovdesi = takvim.isError ? (
    <div style={{ padding: "16px 0" }}><HataDurumu hata={getErrorDetail(takvim.error, "Takvim yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void takvim.refetch()}>Tekrar dene</Button>} /></div>
  ) : takvim.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Takvim yükleniyor…" /></div>
  ) : gunler.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Yaklaşan kapalı gün yok" aciklama="Teslimat her gün açık. Resmî tatilleri yükleyebilir ya da elle gün kapatabilirsiniz." /></div>
  ) : (
    gunler.map((d, i, dizi) => (
      <Flex key={d.id} data-testid={`gun-${d.id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <Typography.Text style={{ fontWeight: 500, display: "block" }}>{GUN_BICIMI.format(new Date(`${d.day}T00:00:00`))}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{kapaliGunAciklamasi(d)}</Typography.Text>
        </div>
        {canManage ? <Button loading={surenIslem(`gun:${d.id}`) === "gunAc"} aria-label={`${GUN_BICIMI.format(new Date(`${d.day}T00:00:00`))} gününü yeniden aç`} onClick={() => gunuAcOnayi(d)}>Yeniden aç</Button> : null}
      </Flex>
    ))
  );

  const cap = Array.isArray(kapasite.data) ? kapasite.data[0]?.capacity : undefined;
  const yapilandirmaGovdesi = bilgi.isError ? (
    <div style={{ padding: "16px 0" }}><HataDurumu hata={getErrorDetail(bilgi.error, "Teslimat bilgisi alınamadı.")} hataAksiyon={<Button size="small" onClick={() => void bilgi.refetch()}>Tekrar dene</Button>} /></div>
  ) : bilgi.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Yapılandırma yükleniyor…" /></div>
  ) : (
    <div>
      {(
        [
          ["Aynı gün teslim eşiği", `${String(bilgi.data.cutoff_hour).padStart(2, "0")}:00`, "bu saatten önce ödenen bölge içi sipariş aynı gün söz alır"],
          ["Teslimat bölgesi", bilgi.data.districts.join(", "), "pin varsa depo yarıçapı önceliklidir"],
        ] as [string, string, string][]
      ).map(([etiket, deger, ipucu], i) => (
        <Flex key={etiket} align="baseline" gap={12} wrap style={{ padding: "12px 0", borderBottom: `1px solid ${ayrac}` }} data-testid={`yapilandirma-${i}`}>
          <Typography.Text type="secondary" style={{ width: 176, flexShrink: 0 }}>{etiket}</Typography.Text>
          <Typography.Text style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{deger}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ipucu}</Typography.Text>
        </Flex>
      ))}
      <Flex align="baseline" gap={12} wrap style={{ padding: "12px 0" }} data-testid="yapilandirma-kapasite">
        <Typography.Text type="secondary" style={{ width: 176, flexShrink: 0 }}>Günlük söz kapasitesi</Typography.Text>
        {kapasite.isError ? (
          <HataDurumu hata={getErrorDetail(kapasite.error, "Kapasite alınamadı.")} hataAksiyon={<Button size="small" onClick={() => void kapasite.refetch()}>Tekrar dene</Button>} />
        ) : kapasite.isPending ? (
          <Typography.Text type="secondary">Yükleniyor…</Typography.Text>
        ) : cap == null ? (
          <Typography.Text type="secondary">Kapasite verisi yok.</Typography.Text>
        ) : (
          <>
            <Typography.Text style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{kapasiteMetni(cap)}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{cap > 0 ? "dolan güne söz verilmez, sonraki güne kayar" : "kapasite kontrolü kapalı"}</Typography.Text>
          </>
        )}
      </Flex>
    </div>
  );

  const kuryeVarlik = kuryePenceresi ? kuryeVarligi(kuryePenceresi) : null;
  const hesapVarlik = hesapPenceresi ? `kurye:${hesapPenceresi.kurye.id}` : null;
  const sifreVarlik = sifrePenceresi ? `hesap:${sifrePenceresi.accountId}` : null;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Kuryeler</Typography.Title>
        {/* Başlıktaki düğme yalnız dolu listede; boş durumda tek düğme boş durumun kendisinde. */}
        {canManage && kuryeListesi.length > 0 ? <Button type="primary" onClick={kuryeEkleAc}>Kurye ekle</Button> : null}
      </Flex>
      {!canManage ? <Typography.Text type="secondary">Salt okunur görünüm: kurye, giriş hesabı ve takvim değişiklikleri için delivery.manage izni gerekir.</Typography.Text> : null}

      <section aria-label="Kurye profilleri" style={kart}>
        {bolumBasligi("Kurye profilleri", "Müşteri takip kimliği (isim, fotoğraf) ve saha ekranı giriş hesabı. Plaka Araçlar ekranında tanımlanır.")}
        <div style={{ padding: "0 24px" }}>{kuryeGovdesi}</div>
      </section>

      <section aria-label="Teslimat takvimi" style={kart}>
        {bolumBasligi("Teslimat takvimi", "Kapalı günler: söz motoru bu tarihlere teslimat sözü vermez. Hafta 7 gün açık.", canManage ? <Button loading={surenIslem("takvim:tatil") === "tatil"} onClick={tatilYukleOnayi}>Resmî tatilleri yükle</Button> : undefined)}
        {canManage ? (
          <div style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
            <Flex align="flex-start" gap={12} wrap>
              {/* Alan hataları ilgili kontrolün hemen altında; kullanıcı alanı değiştirince yalnız o alanın hatası silinir. */}
              <div style={{ flex: "0 1 200px" }}>
                <label htmlFor="kapali-gun">
                  <Typography.Text type="secondary">Kapatılacak gün</Typography.Text>
                  <Input ref={gunRef} id="kapali-gun" type="date" value={gun} onChange={(e) => { setGun(e.target.value); setGunHatalari((h) => ({ ...h, day: undefined })); }} status={gunHatalari.day ? "error" : undefined} style={{ marginTop: 4, height: 40 }} />
                </label>
                {gunHatalari.day ? <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 4 }}>{gunHatalari.day}</Typography.Text> : null}
              </div>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <label htmlFor="kapali-aciklama">
                  <Typography.Text type="secondary">Açıklama (isteğe bağlı)</Typography.Text>
                  <Input ref={aciklamaRef} id="kapali-aciklama" value={aciklama} onChange={(e) => { setAciklama(e.target.value); setGunHatalari((h) => ({ ...h, label: undefined })); }} maxLength={ACIKLAMA_MAX} placeholder="ör. Kurban Bayramı, yıllık bakım…" status={gunHatalari.label ? "error" : undefined} style={{ marginTop: 4 }} />
                </label>
                {gunHatalari.label ? <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 4 }}>{gunHatalari.label}</Typography.Text> : null}
              </div>
              {/* Düğme geçerlilikle kapanmaz: basınca hata alanda çıkar ve odak oraya gider. Etiket satırı hizası için üst boşluk. */}
              <Button loading={surenIslem("gun:yeni") === "gunEkle"} onClick={gunuKapat} style={{ marginTop: 26 }}>Günü kapat</Button>
            </Flex>
            {takvimHatasi ? <HataDurumu hata={takvimHatasi} /> : null}
          </div>
        ) : null}
        <div style={{ padding: "0 24px" }}>{takvimGovdesi}</div>
      </section>

      <section aria-label="Teslimat yapılandırması" style={kart}>
        {bolumBasligi("Teslimat yapılandırması", "Salt okunur: bu kurallar sunucu yapılandırmasında (.env) tanımlıdır, değişiklik dağıtım gerektirir.")}
        <div style={{ padding: "0 24px" }}>{yapilandirmaGovdesi}</div>
      </section>

      <KuryePenceresi
        acik={kuryePenceresi !== null}
        mod={kuryePenceresi?.mod ?? "ekle"}
        baslangic={kuryePenceresi?.mod === "duzenle" ? { name: kuryePenceresi.kurye.name, phone: kuryePenceresi.kurye.phone ?? null } : undefined}
        kapat={() => setKuryePenceresi(null)}
        kaydediyor={kuryeVarlik !== null && surenIslem(kuryeVarlik) === kuryePenceresi?.mod}
        alanHatalari={kuryeHatasi.alan}
        hata={kuryeHatasi.genel}
        kilitliMi={() => kuryeVarlik !== null && kilitli(kuryeVarlik)}
        onayla={kuryeKaydet}
      />
      <HesapPenceresi
        acik={hesapPenceresi !== null}
        kuryeAdi={hesapPenceresi?.kurye.name ?? ""}
        kapat={() => setHesapPenceresi(null)}
        kaydediyor={hesapVarlik !== null && surenIslem(hesapVarlik) === "hesap"}
        alanHatalari={hesapHatasi.alan}
        hata={hesapHatasi.genel}
        kilitliMi={() => hesapVarlik !== null && kilitli(hesapVarlik)}
        onayla={hesapOlusturGonder}
      />
      <SifrePenceresi
        acik={sifrePenceresi !== null}
        kuryeAdi={sifrePenceresi?.kuryeAdi ?? ""}
        kapat={() => setSifrePenceresi(null)}
        kaydediyor={sifreVarlik !== null && surenIslem(sifreVarlik) === "sifre"}
        alanHatalari={sifreHatasi.alan}
        hata={sifreHatasi.genel}
        kilitliMi={() => sifreVarlik !== null && kilitli(sifreVarlik)}
        onayla={sifreGonder}
      />
    </Flex>
  );
}
