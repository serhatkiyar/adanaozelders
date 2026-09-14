// Diploma Doğrulama ekranının inceleme penceresi: bir belgenin KARAR yüzeyi.
//
// Neden ayrı pencere: kuyruk satırında TCKN, barkod, belge adı ve kısa ömürlü imzalı belge adresi SÜREKLİ açık
// duruyordu (eski `EducationVerifyCard`). Hassas alanlar artık yalnız yönetici bir kaydı incelemek için pencereyi
// açtığında DOM'a girer; pencere kapanınca gövde tamamen unmount edilir ve değerler DOM'dan kalkar.
//
// Belge adresi `private/` anahtarının imzalı adresidir: yalnız kullanıcı tıklayınca yeni sekmede açılır. Metin,
// öznitelik (`title`/`aria-label`), log ya da telemetri olarak basılmaz — kopyalama/paylaşma özelliği de yoktur.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Drawer, Flex, Input, Typography, theme } from "antd";
import type { InputRef } from "antd";
import { VarlikDugmesi } from "@/panel/components/varlikKilidi";
import { kirliOnayi, useAlanHatalari, type Hatalar } from "@/panel/components/pencereAlanlari";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import type { AdminEducation, DocumentType } from "@/types";

/** Eski ekranla birebir aynı belge türü metinleri. */
export const BELGE_TURU_ETIKETI: Record<DocumentType, string> = {
  DIPLOMA: "Diploma",
  DENKLIK: "Denklik Belgesi",
  OGRENCI_BELGESI: "Öğrenci Belgesi",
};
/** e-Devlet belge doğrulama sayfası — barkodun sahihliği burada teyit edilir. */
export const EDEVLET_ADRESI = "https://www.turkiye.gov.tr/belge-dogrulama";
/** Backend `note` alanı isteğe bağlı, en fazla 500 karakter (EducationVerifyIn). Alt sınır YOKTUR. */
export const NOT_MAX = 500;
const RED_SIRA = ["note"] as const;
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** Yalnız üst sınır: backend notu zorunlu tutmaz, minimum karakter de istemez. */
export function notHatasi(ham: string): string | undefined {
  return ham.length > NOT_MAX ? `En fazla ${NOT_MAX} karakter yazılabilir.` : undefined;
}
/** Boş/boşluk not gönderilmez: sözleşme `note: string | null`. */
export function notPayloadi(ham: string): string | undefined {
  return ham.trim() || undefined;
}
/** Backend: barkod da belge de yoksa doğrulama 409 döner. Reddetme bu önkoşula BAĞLI DEĞİLDİR. */
export function dogrulanabilirMi(kayit: Pick<AdminEducation, "document_url" | "verification_code">): boolean {
  return Boolean(kayit.document_url || kayit.verification_code);
}
export const DOGRULAMA_ENGELI = "Bu eğitime henüz belge ya da barkod eklenmemiş; doğrulanamaz.";
/** Onay penceresi açıkken karar yüzeyi kilitlenir; neden düğmede görünür. */
export const ONAY_ACIK_NEDENI = "Doğrulama onayı açık; önce onayı sonuçlandırın.";
/**
 * Onayda hangi kontrolün beklendiği KAYDIN MATERYALİNE göre yazılır: yalnız barkodu olan bir kayıtta
 * "yüklenen belge", yalnız belgesi olan bir kayıtta "e-Devlet barkodu" denmesi yanlış olurdu.
 * Önkoşul ve backend sözleşmesi bu metinden bağımsızdır (`dogrulanabilirMi`).
 */
export function onayKontrolMetni(kayit: Pick<AdminEducation, "document_url" | "verification_code">): string {
  const belge = Boolean(kayit.document_url);
  const barkod = Boolean(kayit.verification_code);
  if (belge && barkod) return "yüklenen belgedeki adı hesap adıyla karşılaştırdıysanız ve barkodu e-Devlet'te doğruladıysanız";
  if (belge) return "yüklenen belgedeki adı hesap adıyla karşılaştırdıysanız";
  if (barkod) return "barkodu e-Devlet'te doğruladıysanız";
  return "belgeyi kontrol ettiyseniz";
}
/** Derece ve bölüm tek satırda; ikisi de yoksa dürüst yer tutucu (satır ve pencere aynı metni kullanır). */
export function derecemetni(kayit: Pick<AdminEducation, "degree" | "field_of_study">, bos = "Belirtilmemiş"): string {
  return [kayit.degree, kayit.field_of_study].filter(Boolean).join(" · ") || bos;
}

export type IncelemePenceresiProps = {
  acik?: boolean;
  /** Açılış anında sabitlenen hedef kayıt (liste tazelense de pencere hedefi değişmez). */
  kayit?: AdminEducation;
  /** `tutors.manage` — yoksa karar yüzeyi HİÇ çizilmez. */
  canManage?: boolean;
  kapat?: () => void;
  /** Kilit üzerindeki süren işlem adı: "verify" | "reject" | undefined. */
  mesgulIslem?: string;
  /** Ekrandaki senkron kilit: true iken kapatma ve gönderim yutulur. */
  kilitliMi?: () => boolean;
  /** Doğrulama onayı açık (mutasyon henüz başlamamış olabilir): çekmece kapanmaz, başka karara geçilmez. */
  onayAcik?: boolean;
  /** Red modu değişti: ekran yalnız red hata state'ini temizler (yazılan not korunur). */
  onRedModu?: (acik: boolean) => void;
  /** Onay penceresini ekran açar (mutasyon ve kilit orada). */
  onDogrula?: () => void;
  onReddet?: (note: string | undefined) => void;
  /** Sunucu 422 alan hataları ve kalan genel hata (ekran dağıtır). */
  alanHatalari?: Hatalar;
  hata?: string | null;
};

export function IncelemePenceresi({
  acik,
  kayit,
  canManage,
  kapat,
  mesgulIslem,
  kilitliMi,
  onayAcik,
  onRedModu,
  onDogrula,
  onReddet,
  alanHatalari,
  hata,
}: IncelemePenceresiProps) {
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const mobil = useMobil();
  const [redModu, setRedModu] = useState(false);
  const [not, setNot] = useState("");
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, RED_SIRA, refler);
  useEffect(() => {
    // Yalnız açılışta sıfırlanır: hata sonrası pencere açık kalır ve yazılan not korunur.
    if (acik) {
      setRedModu(false);
      setNot("");
    }
    // Kayıt değişirse (pencere açıkken başka kayda geçilirse) red modu ve not taşınmaz.
  }, [acik, kayit?.id]);
  useEffect(() => {
    // Not alanı uzun gövdenin altında doğar: odak oraya gider, tarayıcı da alanı görünür kılar.
    if (redModu) refler.current.note?.focus();
    // Moda girerken de çıkarken de bayat red hatası taşınmaz; NOT korunur.
    onRedModu?.(redModu);
    // `onRedModu` her render'da yeniden kurulur; tetikleyici yalnız mod değişimidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redModu]);

  // Onay penceresi açıkken de MEŞGUL sayılır: altta duran hassas veri çekmecesi kapanamaz ve başka karar
  // akışı başlatılamaz. Mutasyon başladıktan sonraki koruma (`mesgulIslem`/`kilitliMi`) aynen sürer.
  const mesgul = () => Boolean(mesgulIslem || onayAcik || kilitliMi?.());
  const kapatIstegi = () => {
    if (mesgul()) return;
    // Yazılmış not varsa (red modundan çıkılmış olsa bile) onay sorulur; temiz inceleme doğrudan kapanır.
    if (not) return void kirliOnayi(modal, () => kapat?.());
    kapat?.();
  };
  const reddet = () => {
    if (mesgul()) return;
    if (yerelHatalariUygula({ note: notHatasi(not) })) return;
    onReddet?.(notPayloadi(not));
  };

  const dogrulanabilir = kayit ? dogrulanabilirMi(kayit) : false;
  const altBilgi = !kayit ? null : !canManage ? (
    <Flex justify="flex-end">
      <Button onClick={kapatIstegi}>Kapat</Button>
    </Flex>
  ) : redModu ? (
    <Flex justify="flex-end" gap={8}>
      <Button onClick={() => setRedModu(false)} disabled={mesgul()} title={onayAcik ? ONAY_ACIK_NEDENI : undefined}>
        Geri
      </Button>
      <VarlikDugmesi
        danger
        type="primary"
        islem="reject"
        mesgulIslem={mesgulIslem}
        disabled={Boolean(onayAcik)}
        title={onayAcik ? ONAY_ACIK_NEDENI : undefined}
        onClick={reddet}
      >
        Belgeyi reddet
      </VarlikDugmesi>
    </Flex>
  ) : (
    <Flex justify="flex-end" gap={8}>
      <Button onClick={kapatIstegi} disabled={mesgul()} title={onayAcik ? ONAY_ACIK_NEDENI : undefined}>
        Kapat
      </Button>
      <VarlikDugmesi
        danger
        islem="reject"
        mesgulIslem={mesgulIslem}
        disabled={Boolean(onayAcik)}
        title={onayAcik ? ONAY_ACIK_NEDENI : undefined}
        onClick={() => setRedModu(true)}
      >
        Reddet
      </VarlikDugmesi>
      {/* Önkoşul: barkod da belge de yoksa sunucu 409 döner — düğme kapalı ve NEDEN görünür metinde yazılı. */}
      <VarlikDugmesi
        type="primary"
        islem="verify"
        mesgulIslem={mesgulIslem}
        disabled={!dogrulanabilir || Boolean(onayAcik)}
        title={onayAcik ? ONAY_ACIK_NEDENI : undefined}
        onClick={() => onDogrula?.()}
      >
        Doğrula
      </VarlikDugmesi>
    </Flex>
  );

  const satir = (etiket: string, deger: React.ReactNode) => (
    <Flex gap={12} wrap>
      <Typography.Text type="secondary" style={{ width: 120, flexShrink: 0, fontSize: 12 }}>
        {etiket}
      </Typography.Text>
      <div style={{ minWidth: 0, flex: "1 1 160px" }}>{deger}</div>
    </Flex>
  );

  return (
    <Drawer
      open={Boolean(acik)}
      title="Belgeyi incele"
      onClose={kapatIstegi}
      placement="right"
      width={mobil ? "100%" : 480}
      // Gönderim uçarken ESC ve maske kapatmaz: sonucu gizlemeden bitmesi beklenir.
      keyboard={!mesgul()}
      maskClosable={!mesgul()}
      footer={altBilgi}
    >
      {/* Gövde YALNIZ açıkken mount edilir: kapanınca TCKN, barkod, belge adı ve imzalı adres DOM'dan kalkar. */}
      {acik && kayit ? (
        <Flex vertical gap={12}>
          <div>
            <Typography.Text style={{ fontSize: 16, fontWeight: 500, display: "block", ...SAR }}>
              {kayit.tutor_name ?? `Eğitmen #${kayit.tutor_id}`}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, ...SAR }}>
              Hesap adı — belgedeki adla karşılaştırılacak isim budur.
            </Typography.Text>
          </div>
          {!canManage ? (
            <Typography.Text type="secondary">
              Salt okunur görünüm: belge doğrulamak ya da reddetmek için tutors.manage izni gerekir.
            </Typography.Text>
          ) : null}

          <Flex vertical gap={6}>
            {satir("Okul", <Typography.Text style={{ fontSize: 12, ...SAR }}>{kayit.school_name}</Typography.Text>)}
            {satir(
              "Derece / bölüm",
              <Typography.Text style={{ fontSize: 12, ...SAR }}>{derecemetni(kayit)}</Typography.Text>
            )}
            {satir(
              "Öğrenim yılları",
              <Typography.Text style={{ fontSize: 12, ...SAYI }}>
                {kayit.start_year || kayit.end_year
                  ? `${kayit.start_year ?? "?"} – ${kayit.end_year ?? "?"}`
                  : "Belirtilmemiş"}
              </Typography.Text>
            )}
            {satir(
              "Belge türü",
              <Typography.Text style={{ fontSize: 12 }}>
                {kayit.document_type ? BELGE_TURU_ETIKETI[kayit.document_type] : "Belirtilmemiş"}
              </Typography.Text>
            )}
            {satir(
              "Belge adı",
              kayit.document_name ? (
                <Typography.Text style={{ fontSize: 12, ...SAR }}>{kayit.document_name}</Typography.Text>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Dosya adı yok
                </Typography.Text>
              )
            )}
          </Flex>

          <Flex gap={12} wrap>
            {/* Kısa ömürlü imzalı adres: gerçek bağlantı, yeni sekme, `noopener noreferrer`. Adres metin olarak basılmaz. */}
            {kayit.document_url ? (
              <Typography.Link href={kayit.document_url} target="_blank" rel="noopener noreferrer">
                Belgeyi aç
              </Typography.Link>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Belge yüklenmemiş
              </Typography.Text>
            )}
            <Typography.Link href={EDEVLET_ADRESI} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: token.colorTextSecondary }}>
              e-Devlet&apos;te doğrula
            </Typography.Link>
          </Flex>

          <Flex vertical gap={6} style={{ padding: "12px 0", borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            {satir(
              "Barkod",
              kayit.verification_code ? (
                <Typography.Text style={{ fontFamily: "monospace", fontSize: 12, userSelect: "all", ...SAR }}>
                  {kayit.verification_code}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Barkod girilmemiş
                </Typography.Text>
              )
            )}
            {satir(
              "TCKN",
              kayit.verification_tckn ? (
                <Typography.Text style={{ fontFamily: "monospace", fontSize: 12, userSelect: "all", ...SAYI }}>
                  {kayit.verification_tckn}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  TCKN girilmemiş
                </Typography.Text>
              )
            )}
          </Flex>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Belgedeki ad hesap adıyla aynı olmalı; barkod e-Devlet&apos;te doğrulanmalı.
          </Typography.Text>
          {canManage && !dogrulanabilir ? (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              {DOGRULAMA_ENGELI}
            </Typography.Text>
          ) : null}

          {canManage && redModu ? (
            <Flex vertical gap={6} style={{ paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              {hata ? <Alert type="error" showIcon message={hata} /> : null}
              <label htmlFor="diploma-red-notu">
                <Typography.Text type="secondary">Red notu (isteğe bağlı)</Typography.Text>
                <Input.TextArea
                  ref={(r) => {
                    refler.current.note = r as unknown as InputRef | null;
                  }}
                  id="diploma-red-notu"
                  value={not}
                  onChange={(e) => {
                    setNot(e.target.value);
                    temizle("note");
                  }}
                  rows={3}
                  maxLength={NOT_MAX}
                  placeholder="Örn. Belgedeki ad hesap adıyla eşleşmiyor."
                  status={gosterilen("note") ? "error" : undefined}
                  aria-describedby={gosterilen("note") ? "diploma-red-hata diploma-red-yardim" : "diploma-red-yardim"}
                  style={{ marginTop: 4 }}
                />
              </label>
              <Typography.Text id="diploma-red-yardim" type="secondary" style={{ fontSize: 12 }}>
                {`Not eğitmene gösterilir; boş bırakılabilir (${not.length}/${NOT_MAX}).`}
              </Typography.Text>
              {gosterilen("note") ? (
                <Typography.Text id="diploma-red-hata" type="danger" role="alert">
                  {gosterilen("note")}
                </Typography.Text>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
      ) : null}
    </Drawer>
  );
}
