// Eğitmen Yönetimi → Diploma Doğrulama — eski `AdminHome` içindeki `DiplomaVerificationSection` panel düzeninde.
//
// Uç (`GET /admin/educations/pending`) sayfalamasızdır ve TÜM bekleyen kuyruğu `created_at ASC` döndürür: sayı
// gerçektir, sunucu sırası korunur. İstemci sıralaması, arama, filtre ya da sahte sayfalama EKLENMEZ.
//
// Kuyruk satırı hassas alan TAŞIMAZ: TCKN, barkod değeri, belge adı ve kısa ömürlü imzalı belge adresi yalnız
// inceleme penceresi açıkken DOM'a girer (bkz. `DiplomaDogrulamaPenceresi`). Eski ekran bunların hepsini listede
// açıkta bırakıyordu.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { sunucuHatasiniDagit, type Hatalar } from "@/panel/components/pencereAlanlari";
import { usePendingEducations, useVerifyEducation } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { BELGE_TURU_ETIKETI, IncelemePenceresi, derecemetni, dogrulanabilirMi, onayKontrolMetni } from "./DiplomaDogrulamaPenceresi";
import type { AdminEducation } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

const SAR: React.CSSProperties = { overflowWrap: "anywhere" };
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
/** 422 dağıtımında tanınan tek alan: backend `note` dışında alan almaz. */
const RED_ALANLARI = ["note"] as const;

/** Satırda YALNIZ varlık bilgisi: değerin kendisi (barkod/TCKN/dosya adı) listede gösterilmez. */
export function varlikIsaretleri(kayit: AdminEducation): string[] {
  const isaretler: string[] = [];
  if (kayit.document_url) isaretler.push("Belge var");
  if (kayit.verification_code) isaretler.push("Barkod var");
  if (kayit.verification_tckn) isaretler.push("TCKN var");
  return isaretler;
}
export function EgitmenDiplomaDogrulama() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("tutors");
  // Ad bağlantısının hedefi `MusteriDetayi`dir ve o ekran `users.view` ister: izin yoksa ölü bağlantı yerine düz metin.
  const { canView: kullaniciGorebilir } = useAdminAreaAccess("users");

  // Yetkisiz oturumda istek de 30 sn'lik yoklama da tamamen kapalı (hook `enabled`).
  const sorgu = usePendingEducations(canView);
  const dogrula = useVerifyEducation();

  // Hedef KİMLİK sabittir; kayıt gövdesi tazelenen listeden okunur (imzalı adres güncel kalsın).
  const [seciliId, setSeciliId] = useState<number | null>(null);
  // Kayıt listeden düşerse (başka yönetici sonuçlandırdı) pencere ani kaybolmasın: açılış anlık görüntüsü.
  const anlikRef = useRef<AdminEducation | null>(null);
  const [redHatasi, setRedHatasi] = useState<{ alan: Hatalar; genel: string | null }>({ alan: {}, genel: null });
  // Kilit ancak ONAY verilince alınır. `ref` aynı tick'te ikinci onayı keser (state henüz yazılmamış olur),
  // `state` ise çekmeceyi kilitleyen GÖRÜNÜR durumdur: onay açıkken alttaki hassas veri penceresi kapanmaz.
  const onayAcikRef = useRef(false);
  const [onayAcik, setOnayAcik] = useState(false);
  const { kilitle, kilitli, surenIslem, onayIsi } = useVarlikKilidi(message);

  const liste = useMemo(() => (Array.isArray(sorgu.data) ? sorgu.data : []), [sorgu.data]);
  const veriHazir = Array.isArray(sorgu.data);
  // Önbellekte veri varken arka plan tazeleme hatası listeyi ÇÖPE ATMAZ.
  const tazelemeHatasi = sorgu.isError && veriHazir;
  const secili = seciliId == null ? undefined : liste.find((e) => e.id === seciliId) ?? anlikRef.current ?? undefined;

  const ac = (kayit: AdminEducation) => {
    anlikRef.current = kayit;
    setRedHatasi({ alan: {}, genel: null });
    setSeciliId(kayit.id);
  };
  /** Red moduna giriş ve çıkış: bayat 422/genel hata taşınmaz. Yazılan nota DOKUNULMAZ. */
  const redModuDegisti = () => setRedHatasi({ alan: {}, genel: null });
  const kapat = () => {
    setSeciliId(null);
    anlikRef.current = null;
    setRedHatasi({ alan: {}, genel: null });
  };

  const dogrulaOnayi = (kayit: AdminEducation) => {
    // Hedef kimlik ve bağlam ONAY AÇILDIĞI anda sabitlenir; sonraki tazelemeler hedefi kaydırmaz.
    const hedefId = kayit.id;
    const ad = kayit.tutor_name ?? `Öğretmen #${kayit.tutor_id}`;
    const okul = kayit.school_name;
    const varlik = `education:${hedefId}`;
    if (kilitli(varlik) || onayAcikRef.current) return;
    onayAcikRef.current = true;
    setOnayAcik(true);
    // Kilit, onay HANGİ yoldan kapanırsa kapansın bırakılır. `afterClose` jsdom/animasyonsuz ortamda
    // gecikebildiği için Vazgeç ve başarı yolları da açıkça serbest bırakır (çift çağrı zararsızdır).
    const serbestBirak = () => {
      onayAcikRef.current = false;
      setOnayAcik(false);
    };
    onayAc(modal, {
      title: "Belgeyi doğrula",
      content: `${ad} · ${okul}: ${onayKontrolMetni(kayit)} doğrulayın; belge onaylanmış sayılacak.`,
      okText: "Doğrula",
      cancelText: "Vazgeç",
      // Pencere hangi yoldan kapanırsa kapansın onay kilidi kalkar. `afterClose` DEĞİL:
      // o kapanış animasyonuna bağlı ve jsdom'da hiç koşmaz (bkz. onayPenceresi notu).
      kapanista: serbestBirak,
      ...onayIsi(varlik, "verify", () =>
        dogrula
          .mutateAsync({ id: hedefId, action: "verify" })
          // `message.success` AntD'de thenable döner: zincirin DÖNÜŞ değeri yapılırsa kilit mesaj kapanana kadar tutulurdu.
          .then(() => {
            message.success("Diploma doğrulandı.");
            serbestBirak();
            kapat();
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "İşlem başarısız."));
            // Onay penceresi açık kalsın ve yeniden denenebilsin.
            throw e;
          })
      ),
    });
  };

  const reddet = (kayit: AdminEducation, note: string | undefined) => {
    const hedefId = kayit.id;
    void kilitle(`education:${hedefId}`, "reject", () => {
      setRedHatasi({ alan: {}, genel: null });
      return dogrula
        .mutateAsync({ id: hedefId, action: "reject", note })
        .then(() => {
          message.success("Belge reddedildi.");
          kapat();
        })
        .catch((e: unknown) => {
          // 422 yalnız `note` alanına dağılır; 409/500/ağ hataları pencere içinde Alert'te kalır.
          setRedHatasi(sunucuHatasiniDagit(e, "İşlem başarısız.", RED_ALANLARI));
        });
    });
  };

  if (!canView) return <AccessDenied area="Diploma doğrulama" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };

  const satir = (kayit: AdminEducation, i: number, dizi: AdminEducation[]) => {
    const ad = kayit.tutor_name ?? `Öğretmen #${kayit.tutor_id}`;
    const isaretler = varlikIsaretleri(kayit);
    return (
      <div
        key={kayit.id}
        data-testid={`diploma-${kayit.id}`}
        style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}
      >
        <Flex align="flex-start" justify="space-between" gap={12} wrap>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            <Flex align="baseline" gap={8} wrap>
              {kullaniciGorebilir ? (
                <Link id={`diploma-ad-${kayit.id}`} to={ROUTES.adminNewCustomer("tutor", kayit.tutor_id)} style={{ fontWeight: 500, ...SAR }}>
                  {ad}
                </Link>
              ) : (
                <Typography.Text id={`diploma-ad-${kayit.id}`} style={{ fontWeight: 500, ...SAR }}>
                  {ad}
                </Typography.Text>
              )}
              {kayit.document_type ? (
                <Tag style={{ marginInlineEnd: 0 }}>{BELGE_TURU_ETIKETI[kayit.document_type]}</Tag>
              ) : (
                <Tag style={{ marginInlineEnd: 0 }}>Belge türü yok</Tag>
              )}
            </Flex>
            <Typography.Text style={{ fontSize: 12, display: "block", marginTop: 2, ...SAR }}>{kayit.school_name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAR }}>
              {derecemetni(kayit, "Derece belirtilmemiş")}
            </Typography.Text>
            {/* Yalnız VARLIK bilgisi: barkod/TCKN değerleri ve dosya adı listede yok. */}
            <Flex gap={4} wrap style={{ marginTop: 6 }}>
              {isaretler.map((isaret) => (
                <Tag key={isaret} style={{ marginInlineEnd: 0 }}>
                  {isaret}
                </Tag>
              ))}
              {dogrulanabilirMi(kayit) ? null : (
                <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                  Belge ve barkod yok
                </Tag>
              )}
            </Flex>
          </div>
          <Button
            id={`diploma-incele-${kayit.id}`}
            aria-labelledby={`diploma-ad-${kayit.id} diploma-incele-${kayit.id}`}
            onClick={() => ac(kayit)}
          >
            İncele
          </Button>
        </Flex>
      </div>
    );
  };

  const doluListe = veriHazir && liste.length > 0;
  const govde = sorgu.isError && !veriHazir ? (
    <HataDurumu
      hata={getErrorDetail(sorgu.error, "Diploma kuyruğu yüklenemedi.")}
      hataAksiyon={
        <Button size="small" onClick={() => void sorgu.refetch()}>
          Tekrar dene
        </Button>
      }
    />
  ) : !veriHazir ? (
    <YukleniyorDurumu etiket="Diploma kuyruğu yükleniyor…" />
  ) : liste.length === 0 ? (
    <BosDurumu baslik="Teyit bekleyen belge yok" aciklama="Öğretmen yeni bir diploma ya da barkod gönderdiğinde burada listelenir." />
  ) : (
    liste.map(satir)
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>
          Diploma Doğrulama
        </Typography.Title>
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">
          Salt okunur görünüm: belge doğrulamak ya da reddetmek için tutors.manage izni gerekir.
        </Typography.Text>
      ) : null}
      <section aria-label="Teyit bekleyen belgeler" style={kart}>
        <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <div style={{ minWidth: 0 }}>
            <Typography.Text style={{ fontSize: 18, fontWeight: 500, display: "block" }}>Teyit bekleyen belgeler</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Belgedeki ad hesap adıyla aynı olmalı; barkod e-Devlet&apos;te doğrulanmalı.
            </Typography.Text>
          </div>
          {/* Uç tüm kuyruğu döndürür: bu sayı GERÇEK toplamdır. */}
          {doluListe ? <Tag style={{ marginInlineEnd: 0, ...SAYI }}>{liste.length}</Tag> : null}
        </Flex>
        {tazelemeHatasi ? (
          <div style={{ padding: "12px 24px 0" }}>
            <HataDurumu
              hata={getErrorDetail(sorgu.error, "Kuyruk güncellenemedi; gösterilen kayıtlar önceki yüklemeden.")}
              hataAksiyon={
                <Button size="small" onClick={() => void sorgu.refetch()}>
                  Tekrar dene
                </Button>
              }
            />
          </div>
        ) : null}
        <div style={{ padding: doluListe ? "0 24px" : "16px 24px" }}>{govde}</div>
      </section>
      <IncelemePenceresi
        acik={Boolean(secili)}
        kayit={secili}
        canManage={canManage}
        kapat={kapat}
        mesgulIslem={secili ? surenIslem(`education:${secili.id}`) : undefined}
        kilitliMi={() => (secili ? kilitli(`education:${secili.id}`) : false)}
        onayAcik={onayAcik}
        onRedModu={redModuDegisti}
        onDogrula={() => secili && dogrulaOnayi(secili)}
        onReddet={(note) => secili && reddet(secili, note)}
        alanHatalari={redHatasi.alan}
        hata={redHatasi.genel}
      />
    </Flex>
  );
}
