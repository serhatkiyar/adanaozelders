// Eğitmen Yönetimi → Video Onayı — yüklenmiş tanıtım videolarının ön-moderasyon kuyruğu.
//
// Uç (`GET /admin/tutor-videos/pending`) sayfalamasızdır ve bekleyen kuyruğun tamamını `updated_at ASC`
// döndürür. Karar penceresi `DiplomaDogrulamaPenceresi` deseninin kopyasıdır: kilit (`useVarlikKilidi`),
// onay penceresi (`onayAc`) ve pencere kabuğu (gövde yalnız açıkken mount edilir).
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { onayAc } from "@/panel/components/onayPenceresi";
import { usePendingTutorVideos, useReviewTutorVideo } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { sureBiciminde } from "@/lib/tanitimVideo";
import type { AdminTutorIntroVideo } from "@/types";
import { VideoOnayPenceresi } from "./VideoOnayPenceresi";

const SAR: React.CSSProperties = { overflowWrap: "anywhere" };
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

export function EgitmenVideoOnayi() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("tutors");
  const { canView: kullaniciGorebilir } = useAdminAreaAccess("users");

  const sorgu = usePendingTutorVideos(canView);
  const incele = useReviewTutorVideo();

  const [seciliId, setSeciliId] = useState<number | null>(null);
  const anlikRef = useRef<AdminTutorIntroVideo | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const onayAcikRef = useRef(false);
  const [onayAcik, setOnayAcik] = useState(false);
  const { kilitle, kilitli, surenIslem, onayIsi } = useVarlikKilidi(message);

  const liste = useMemo(() => (Array.isArray(sorgu.data) ? sorgu.data : []), [sorgu.data]);
  const veriHazir = Array.isArray(sorgu.data);
  const tazelemeHatasi = sorgu.isError && veriHazir;
  const secili = seciliId == null ? undefined : liste.find((v) => v.id === seciliId) ?? anlikRef.current ?? undefined;

  const ac = (kayit: AdminTutorIntroVideo) => {
    anlikRef.current = kayit;
    setHata(null);
    setSeciliId(kayit.id);
  };
  const kapat = () => {
    setSeciliId(null);
    anlikRef.current = null;
    setHata(null);
  };

  const onaylaOnayi = (kayit: AdminTutorIntroVideo) => {
    const hedefId = kayit.id;
    const ad = kayit.tutor_name ?? `Öğretmen #${kayit.tutor_id}`;
    const varlik = `tutor-video:${hedefId}`;
    if (kilitli(varlik) || onayAcikRef.current) return;
    onayAcikRef.current = true;
    setOnayAcik(true);
    const serbestBirak = () => {
      onayAcikRef.current = false;
      setOnayAcik(false);
    };
    onayAc(modal, {
      title: "Videoyu yayınla",
      content: `${ad}: video profilde hemen yayına girecek; önceki video ya da bağlantı kaldırılacak.`,
      okText: "Onayla ve yayınla",
      cancelText: "Vazgeç",
      kapanista: serbestBirak,
      ...onayIsi(varlik, "approve", () =>
        incele
          .mutateAsync({ id: hedefId, action: "approve" })
          .then(() => {
            message.success("Video yayına alındı.");
            serbestBirak();
            kapat();
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "İşlem başarısız."));
            throw e;
          })
      ),
    });
  };

  const reddet = (kayit: AdminTutorIntroVideo, note: string | undefined) => {
    const hedefId = kayit.id;
    void kilitle(`tutor-video:${hedefId}`, "reject", () => {
      setHata(null);
      return incele
        .mutateAsync({ id: hedefId, action: "reject", note })
        .then(() => {
          message.success("Video reddedildi; eğitmene bildirildi.");
          kapat();
        })
        .catch((e: unknown) => {
          setHata(getErrorDetail(e, "İşlem başarısız."));
        });
    });
  };

  if (!canView) return <AccessDenied area="Video onayı" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };

  const satir = (kayit: AdminTutorIntroVideo, i: number, dizi: AdminTutorIntroVideo[]) => {
    const ad = kayit.tutor_name ?? `Öğretmen #${kayit.tutor_id}`;
    const ozet = [sureBiciminde(kayit.duration_seconds), kayit.width && kayit.height ? `${kayit.width}×${kayit.height}` : null]
      .filter(Boolean)
      .join(" · ");
    return (
      <div
        key={kayit.id}
        data-testid={`tutor-video-${kayit.id}`}
        style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}
      >
        <Flex align="center" justify="space-between" gap={12} wrap>
          <Flex align="center" gap={12} style={{ minWidth: 0, flex: "1 1 260px" }}>
            {kayit.poster_url ? (
              <img
                src={kayit.poster_url}
                alt=""
                style={{ width: 96, height: 54, objectFit: "cover", borderRadius: 4, background: "#000", flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: 96, height: 54, borderRadius: 4, background: token.colorFillSecondary, flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              {kullaniciGorebilir ? (
                <Link id={`tutor-video-ad-${kayit.id}`} to={ROUTES.adminNewCustomer("tutor", kayit.tutor_id)} style={{ fontWeight: 500, ...SAR }}>
                  {ad}
                </Link>
              ) : (
                <Typography.Text id={`tutor-video-ad-${kayit.id}`} style={{ fontWeight: 500, ...SAR }}>
                  {ad}
                </Typography.Text>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAYI }}>
                {ozet || "İşlenmiş MP4"}
              </Typography.Text>
            </div>
          </Flex>
          <Button
            id={`tutor-video-incele-${kayit.id}`}
            aria-labelledby={`tutor-video-ad-${kayit.id} tutor-video-incele-${kayit.id}`}
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
      hata={getErrorDetail(sorgu.error, "Video kuyruğu yüklenemedi.")}
      hataAksiyon={
        <Button size="small" onClick={() => void sorgu.refetch()}>
          Tekrar dene
        </Button>
      }
    />
  ) : !veriHazir ? (
    <YukleniyorDurumu etiket="Video kuyruğu yükleniyor…" />
  ) : liste.length === 0 ? (
    <BosDurumu baslik="Onay bekleyen video yok" aciklama="Öğretmen yeni bir tanıtım videosu yükleyip işleme bitince burada listelenir." />
  ) : (
    liste.map(satir)
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>
          Video Onayı
        </Typography.Title>
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">
          Salt okunur görünüm: video onaylamak ya da reddetmek için tutors.manage izni gerekir.
        </Typography.Text>
      ) : null}
      <section aria-label="Onay bekleyen videolar" style={kart}>
        <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <div style={{ minWidth: 0 }}>
            <Typography.Text style={{ fontSize: 18, fontWeight: 500, display: "block" }}>Onay bekleyen videolar</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Onaylanan video profilde hemen yayına girer; reddedilen eğitmene gerekçesiyle bildirilir.
            </Typography.Text>
          </div>
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
      <VideoOnayPenceresi
        acik={Boolean(secili)}
        kayit={secili}
        canManage={canManage}
        kapat={kapat}
        mesgulIslem={secili ? surenIslem(`tutor-video:${secili.id}`) : undefined}
        kilitliMi={() => (secili ? kilitli(`tutor-video:${secili.id}`) : false)}
        onayAcik={onayAcik}
        onOnayla={() => secili && onaylaOnayi(secili)}
        onReddet={(note) => secili && reddet(secili, note)}
        hata={hata}
      />
    </Flex>
  );
}
