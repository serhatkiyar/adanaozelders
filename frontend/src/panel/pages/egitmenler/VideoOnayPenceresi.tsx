// Video Onayı ekranının inceleme penceresi: bir yüklenmiş tanıtım videosunun KARAR yüzeyi.
//
// Gövde yalnız açıkken mount edilir (pencere kabuğu deseni: `DiplomaDogrulamaPenceresi`). Video yerel
// HTML5 `<video controls preload="metadata">` ile oynatılır; otomatik oynatma yok.
import { useEffect, useState } from "react";
import { Alert, App, Button, Drawer, Flex, Input, Typography, theme } from "antd";
import { VarlikDugmesi } from "@/panel/components/varlikKilidi";
import { kirliOnayi } from "@/panel/components/pencereAlanlari";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { sureBiciminde } from "@/lib/tanitimVideo";
import type { AdminTutorIntroVideo } from "@/types";

/** Backend `note` alanı: isteğe bağlı, en fazla 500 karakter (TutorVideoReviewIn). */
export const NOT_MAX = 500;
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };

export function notHatasi(ham: string): string | undefined {
  return ham.length > NOT_MAX ? `En fazla ${NOT_MAX} karakter yazılabilir.` : undefined;
}
export function notPayloadi(ham: string): string | undefined {
  return ham.trim() || undefined;
}

export type VideoOnayPenceresiProps = {
  acik?: boolean;
  kayit?: AdminTutorIntroVideo;
  canManage?: boolean;
  kapat?: () => void;
  mesgulIslem?: string;
  kilitliMi?: () => boolean;
  onayAcik?: boolean;
  onOnayla?: () => void;
  onReddet?: (note: string | undefined) => void;
  hata?: string | null;
};

export function VideoOnayPenceresi({
  acik,
  kayit,
  canManage,
  kapat,
  mesgulIslem,
  kilitliMi,
  onayAcik,
  onOnayla,
  onReddet,
  hata,
}: VideoOnayPenceresiProps) {
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const mobil = useMobil();
  const [redModu, setRedModu] = useState(false);
  const [not, setNot] = useState("");
  const [notHata, setNotHata] = useState<string | undefined>();
  useEffect(() => {
    if (acik) {
      setRedModu(false);
      setNot("");
      setNotHata(undefined);
    }
  }, [acik, kayit?.id]);

  const mesgul = () => Boolean(mesgulIslem || onayAcik || kilitliMi?.());
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (not) return void kirliOnayi(modal, () => kapat?.());
    kapat?.();
  };
  const reddet = () => {
    if (mesgul()) return;
    const h = notHatasi(not);
    setNotHata(h);
    if (h) return;
    onReddet?.(notPayloadi(not));
  };

  const altBilgi = !kayit ? null : !canManage ? (
    <Flex justify="flex-end">
      <Button onClick={kapatIstegi}>Kapat</Button>
    </Flex>
  ) : redModu ? (
    <Flex justify="flex-end" gap={8}>
      <Button onClick={() => setRedModu(false)} disabled={mesgul()}>
        Geri
      </Button>
      <VarlikDugmesi danger type="primary" islem="reject" mesgulIslem={mesgulIslem} disabled={Boolean(onayAcik)} onClick={reddet}>
        Videoyu reddet
      </VarlikDugmesi>
    </Flex>
  ) : (
    <Flex justify="flex-end" gap={8}>
      <Button onClick={kapatIstegi} disabled={mesgul()}>
        Kapat
      </Button>
      <VarlikDugmesi danger islem="reject" mesgulIslem={mesgulIslem} disabled={Boolean(onayAcik)} onClick={() => setRedModu(true)}>
        Reddet
      </VarlikDugmesi>
      <VarlikDugmesi type="primary" islem="approve" mesgulIslem={mesgulIslem} disabled={Boolean(onayAcik)} onClick={() => onOnayla?.()}>
        Onayla ve yayınla
      </VarlikDugmesi>
    </Flex>
  );

  return (
    <Drawer
      open={Boolean(acik)}
      title="Videoyu incele"
      onClose={kapatIstegi}
      placement="right"
      width={mobil ? "100%" : 560}
      keyboard={!mesgul()}
      maskClosable={!mesgul()}
      footer={altBilgi}
    >
      {acik && kayit ? (
        <Flex vertical gap={12}>
          <div>
            <Typography.Text style={{ fontSize: 16, fontWeight: 500, display: "block", ...SAR }}>
              {kayit.tutor_name ?? `Öğretmen #${kayit.tutor_id}`}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[sureBiciminde(kayit.duration_seconds), kayit.width && kayit.height ? `${kayit.width}×${kayit.height}` : null]
                .filter(Boolean)
                .join(" · ") || "İşlenmiş MP4"}
            </Typography.Text>
          </div>
          {!canManage ? (
            <Typography.Text type="secondary">
              Salt okunur görünüm: video onaylamak ya da reddetmek için tutors.manage izni gerekir.
            </Typography.Text>
          ) : null}

          {kayit.mp4_url ? (
            <div style={{ background: "#000", borderRadius: 8, overflow: "hidden" }}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- inceleme; altyazı üretilmiyor. */}
              <video
                controls
                playsInline
                preload="metadata"
                poster={kayit.poster_url ?? undefined}
                aria-label={`${kayit.tutor_name ?? "Öğretmen"} tanıtım videosu`}
                style={{ width: "100%", maxHeight: "60vh", display: "block" }}
              >
                <source src={kayit.mp4_url} type="video/mp4" />
              </video>
            </div>
          ) : (
            <Alert type="warning" showIcon message="Bu kaydın işlenmiş dosyası yok." />
          )}

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Kontrol: eğitmenin kendisi görünmeli; iletişim bilgisi, soyad, logo/bağlantı, başka kişi ya da
            uygunsuz içerik olmamalı. Onaylanınca video profilde yayına girer, önceki video/bağlantı düşer.
          </Typography.Text>

          {canManage && redModu ? (
            <Flex vertical gap={6} style={{ paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              {hata ? <Alert type="error" showIcon message={hata} /> : null}
              <label htmlFor="video-red-notu">
                <Typography.Text type="secondary">Red gerekçesi (eğitmene gösterilir)</Typography.Text>
                <Input.TextArea
                  id="video-red-notu"
                  value={not}
                  onChange={(e) => {
                    setNot(e.target.value);
                    setNotHata(undefined);
                  }}
                  rows={3}
                  maxLength={NOT_MAX}
                  placeholder="Örn. Videoda telefon numarası söyleniyor."
                  status={notHata ? "error" : undefined}
                  aria-describedby={notHata ? "video-red-hata video-red-yardim" : "video-red-yardim"}
                  style={{ marginTop: 4 }}
                />
              </label>
              <Typography.Text id="video-red-yardim" type="secondary" style={{ fontSize: 12 }}>
                {`Boş bırakılabilir (${not.length}/${NOT_MAX}).`}
              </Typography.Text>
              {notHata ? (
                <Typography.Text id="video-red-hata" type="danger" role="alert">
                  {notHata}
                </Typography.Text>
              ) : null}
            </Flex>
          ) : hata ? (
            <Alert type="error" showIcon message={hata} />
          ) : null}
        </Flex>
      ) : null}
    </Drawer>
  );
}
