/**
 * Ders içi sohbet — sitenin mesajlaşması (derste yazılan mesaj /mesajlar
 * sayfasında da durur), görünümü Preply sınıf sohbetinin aynısı
 * (spesifikasyon: `preply-sinif-sohbet.md` §3–§5).
 *
 * - Başlık 64px: karşı tarafın adı; öğretmende altında "{Öğrenci} için saat
 *   HH:mm" (Preply yalnız öğretmene gösterir); sağda X "Mesajları kapat".
 *   Geri düğmesi yok: panel o kişiye kilitli.
 * - Mesajlar BALONSUZ, kendi mesajın dahil hepsi sola hizalı düz satır:
 *   32px avatar, ad + saat, 16/24 metin; gruplama yok. Fare ile üstüne
 *   gelince açık gri + "…" (tepki emojileri, Yanıtla, Kopyala); telefonda
 *   uzun basınca alttan çekmece. Tarih hapı "Bugün" / "Dün" / "gün, ay".
 *   Son kendi mesajının altında "… tarafından görüldü" / "Gönderildi".
 * - Yazma alanı "Mesajın": 24→300px kendiliğinden büyür; masaüstünde Enter
 *   gönderir, Shift+Enter yeni satır; telefonda Enter yeni satır, gönderim
 *   düğmeyle. Telefonda emoji düğmesi yok. Taslak `sessionStorage`'da.
 * - Boş konuşmada boş durum metni yok (Preply). "yazıyor…" gönderilir ama
 *   gösterilmez (Preply sınıf sohbeti göstermez).
 *
 * Veri akışı öncekiyle aynı: yeni mesajlar sitenin `/ws` bağlantısıyla
 * gelir; "yazıyor" için Centrifugo YALNIZ panel açıkken; panel açıkken
 * gelen mesaj okundu sayılır. Kapalıyken görünen konuşma DONDURULUR ki o
 * sırada ilk kez oluşan konuşma sessizce okundu sayılmasın.
 *
 * Tepki emojileri sunucunun izin verdiği küme (`lib/emoji.ts`, sunucu
 * `ALLOWED_EMOJIS`); Preply'ın 👎 🔥 😂'si sunucuda yok.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as TusOlayi,
  type MouseEvent as FareOlayi,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { DisBaglantiUyarisi } from "@/components/mesaj/DisBaglantiUyarisi";
import { EmojiSecici } from "@/components/mesaj/EmojiSecici";
import { SablonPaneli } from "@/components/mesaj/SablonPaneli";
import { PlainButton } from "@/components/ui/PlainButton";
import {
  useMarkConversationRead,
  useMessages,
  useSendMessage,
  useToggleReaction,
} from "@/hooks/useMessages";
import { SIK_EMOJILER } from "@/lib/emoji";
import { getErrorMessage } from "@/lib/errors";
import { mesajParcala } from "@/lib/mesajBaglantisi";
import { useAuthStore } from "@/store/authStore";
import { useCentrifugoStore } from "@/store/centrifugoStore";
import { toast } from "@/store/toastStore";
import type { MessageOut } from "@/types";

import { AltCekmece } from "./AltCekmece";
import type { DersKonusmasi, DersSohbetBilgisi } from "./dersKonusmasi";

/** Sunucunun mesaj gövdesi sınırı (`MessageCreate.body` max_length). */
const KARAKTER_SINIRI = 4000;
/** Preply sayacı sınırdan 500 önce gösterir (9.500 / 10.000). */
const SAYAC_ESIGI = KARAKTER_SINIRI - 500;
/** Preply gönder düğmesi 1 sn debounce'lu. */
const GONDERIM_ARALIGI_MS = 1000;
const UZUN_BASMA_MS = 500;
const ALTA_YAKIN_PX = 40;
/** Eylem menüsünün yaklaşık yüksekliği (emoji kartı + Yanıtla/Kopyala). */
const MENU_YUKSEKLIGI = 180;
const TZ = "Europe/Istanbul";

const saatBicimi = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const gunAnahtariBicimi = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const gunBicimi = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const saat = (iso: string | number) => saatBicimi.format(new Date(iso));
const gunAnahtari = (iso: string | number) => gunAnahtariBicimi.format(new Date(iso));

function gunEtiketi(iso: string, t: (k: string) => string): string {
  const bugun = gunAnahtari(Date.now());
  const dun = gunAnahtari(Date.now() - 86_400_000);
  const gun = gunAnahtari(iso);
  if (gun === bugun) return t("chat.today");
  if (gun === dun) return t("chat.yesterday");
  // Preply: "{gün adı}, {gün} {ay}".
  const p = Object.fromEntries(
    gunBicimi.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.weekday}, ${p.day} ${p.month}`;
}

function oturumOku(anahtar: string): string {
  try {
    return window.sessionStorage.getItem(anahtar) ?? "";
  } catch {
    return "";
  }
}

function oturumYaz(anahtar: string, deger: string) {
  try {
    if (deger) window.sessionStorage.setItem(anahtar, deger);
    else window.sessionStorage.removeItem(anahtar);
  } catch {
    // Depolama kapalıysa taslak yalnız bellekte kalır.
  }
}

function Avatar({ ad, url }: { ad: string; url?: string | null }) {
  if (url) {
    return <img src={url} alt="" aria-hidden className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F4F4F8] text-sm font-semibold text-[#121117]"
    >
      {ad.trim().charAt(0).toLocaleUpperCase("tr-TR") || "?"}
    </span>
  );
}

export function DersSohbeti({
  acik,
  sohbet,
  konusma,
  telefon,
  dar,
  onKapat,
}: {
  acik: boolean;
  sohbet: DersSohbetBilgisi;
  konusma: DersKonusmasi;
  /** Telefon: Enter yeni satır, emoji yok, uzun basma, otomatik odak yok. */
  telefon: boolean;
  /** ≤880px ya da telefon: yazma alanı yalnız üst kenarlı tam genişlik şerit. */
  dar: boolean;
  onKapat: () => void;
}) {
  const { t } = useTranslation();
  const { konusmaId, okunmamis } = konusma;
  const [gorunenId, setGorunenId] = useState(konusmaId);
  if (acik && gorunenId !== konusmaId) setGorunenId(konusmaId);

  const ben = useAuthStore((s) => s.user);
  const benimAdim = ben?.full_name || ben?.first_name || "";
  const karsiAd = sohbet.karsiTarafAd;

  const { data: mesajlar } = useMessages(gorunenId);
  const markRead = useMarkConversationRead();
  const send = useSendMessage();
  const tepki = useToggleReaction(gorunenId);

  const baglan = useCentrifugoStore((s) => s.connect);
  const kopar = useCentrifugoStore((s) => s.disconnect);
  const yaziyorBildir = useCentrifugoStore((s) => s.notifyTyping);

  useEffect(() => {
    if (!acik) return;
    void baglan();
    return () => kopar();
  }, [acik, baglan, kopar]);

  // Açıkken gelen (ya da açılınca bekleyen) mesaj okundu sayılır.
  useEffect(() => {
    if (acik && konusmaId !== null && okunmamis > 0) markRead.mutate(konusmaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, konusmaId, okunmamis]);

  // ── Taslak: konuşma başına sessionStorage (Preply `${prefix}_${threadId}`) ──
  const taslakAnahtari = `ders-sohbeti_${sohbet.karsiTarafRol}_${sohbet.karsiTarafId}`;
  const [metin, setMetinDurumu] = useState(() => oturumOku(taslakAnahtari));
  const setMetin = (deger: string) => {
    setMetinDurumu(deger);
    oturumYaz(taslakAnahtari, deger);
  };
  const [yanit, setYanit] = useState<MessageOut | null>(null);
  const alan = useRef<HTMLTextAreaElement>(null);
  const sonGonderim = useRef(0);

  // Metin alanı 24px'ten 300px'e kendiliğinden büyür.
  useLayoutEffect(() => {
    const el = alan.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 300)}px`;
  }, [metin, acik]);

  // Masaüstünde açılınca yazma alanına odak; telefonda klavye açılmasın.
  useEffect(() => {
    if (!acik || telefon) return;
    const kare = requestAnimationFrame(() => alan.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(kare);
  }, [acik, telefon]);

  const bos = !metin.trim();
  const asildi = metin.length > KARAKTER_SINIRI;

  const gonder = () => {
    const body = metin.trim();
    if (!body || asildi || send.isPending) return;
    const simdi = Date.now();
    if (simdi - sonGonderim.current < GONDERIM_ARALIGI_MS) return;
    sonGonderim.current = simdi;
    send.mutate(
      {
        counterpartyId: sohbet.karsiTarafId,
        body,
        replyToId: yanit?.id ?? null,
        counterpartyRole: sohbet.karsiTarafRol,
      },
      {
        onSuccess: (mesaj) => {
          setMetin("");
          setYanit(null);
          konusma.gonderildi(mesaj);
        },
        onError: (err) => toast.error(getErrorMessage(err, t("chat.sendError"))),
      },
    );
  };

  const tusBasildi = (e: TusOlayi<HTMLTextAreaElement>) => {
    // Telefon/tablette Enter her zaman yeni satır (Preply `!mobile && !tablet`).
    if (!telefon && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      gonder();
    }
  };

  const emojiEkle = (emoji: string) => {
    const el = alan.current;
    if (!el) {
      setMetin(metin + emoji);
      return;
    }
    const bas = el.selectionStart ?? metin.length;
    const son = el.selectionEnd ?? metin.length;
    setMetin(metin.slice(0, bas) + emoji + metin.slice(son));
    requestAnimationFrame(() => {
      el.focus();
      const konum = bas + emoji.length;
      el.setSelectionRange(konum, konum);
    });
  };

  const yanitla = (m: MessageOut) => {
    setYanit(m);
    requestAnimationFrame(() => alan.current?.focus());
  };

  const kopyala = (m: MessageOut) => {
    void navigator.clipboard?.writeText(m.body).catch(() => undefined);
  };

  // ── Kaydırma: altta mıyız, yeni mesaj sayısı, kapanınca konum korunur ──
  const liste = useRef<HTMLDivElement>(null);
  const alttaRef = useRef(true);
  const [altta, setAltta] = useState(true);
  const [yeniSayi, setYeniSayi] = useState(0);
  const sonId = useRef<number | null>(null);
  const kayitliKonum = useRef<number | null>(null);
  // Gizlenince (display:none) scrollTop 0 okunur: son konum kaydırırken tutulur.
  const sonKonum = useRef(0);

  const benimMi = (m: MessageOut) => m.sender_role === sohbet.benimRolum;

  const altaIn = () => {
    const el = liste.current;
    if (el) el.scrollTop = el.scrollHeight;
    alttaRef.current = true;
    setAltta(true);
    setYeniSayi(0);
  };

  const kaydirildi = () => {
    const el = liste.current;
    if (!el || !acik) return;
    sonKonum.current = el.scrollTop;
    const alt = el.scrollHeight - el.scrollTop - el.clientHeight < ALTA_YAKIN_PX;
    alttaRef.current = alt;
    setAltta(alt);
    if (alt) setYeniSayi(0);
  };

  useLayoutEffect(() => {
    if (!mesajlar) return;
    const son = mesajlar.at(-1)?.id ?? null;
    const onceki = sonId.current;
    sonId.current = son;
    if (onceki === null || son === null) {
      if (acik) altaIn();
      return;
    }
    if (son === onceki) return;
    const yeniler = mesajlar.filter((m) => m.id > onceki);
    if (alttaRef.current || yeniler.some(benimMi)) {
      if (acik) altaIn();
      else kayitliKonum.current = null;
    } else {
      setYeniSayi((n) => n + yeniler.filter((m) => !benimMi(m)).length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesajlar]);

  // Kapanınca (display:none) konum saklanır; açılınca geri konur.
  useLayoutEffect(() => {
    const el = liste.current;
    if (!el) return;
    if (!acik) {
      kayitliKonum.current = alttaRef.current ? null : sonKonum.current;
      return;
    }
    if (kayitliKonum.current === null) altaIn();
    else el.scrollTop = kayitliKonum.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  // ── Görüldü / Gönderildi ──
  const { gorulenId, sonKendiId } = useMemo(() => {
    let gorulen: number | null = null;
    let sonKendi: number | null = null;
    const okuma = konusma.karsiOkuma ? new Date(konusma.karsiOkuma).getTime() : null;
    for (const m of mesajlar ?? []) {
      if (m.sender_role !== sohbet.benimRolum) continue;
      sonKendi = m.id;
      if (okuma !== null && new Date(m.created_at).getTime() <= okuma) gorulen = m.id;
    }
    return { gorulenId: gorulen, sonKendiId: sonKendi };
  }, [mesajlar, konusma.karsiOkuma, sohbet.benimRolum]);

  const [menuId, setMenuId] = useState<number | null>(null);
  const [cekmece, setCekmece] = useState<MessageOut | null>(null);
  const [disBaglanti, setDisBaglanti] = useState<string | null>(null);
  const siteHost = window.location.hostname;

  const adi = (rol: string) =>
    rol === sohbet.benimRolum ? benimAdim : rol === "SYSTEM" ? "Adana Özel Ders" : karsiAd;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white font-display text-[#121117]">
      <Baslik karsiAd={karsiAd} ogretmen={sohbet.benimRolum === "TUTOR"} onKapat={onKapat} />

      <div className="relative flex min-h-0 flex-[2] flex-col">
        <div
          ref={liste}
          onScroll={kaydirildi}
          data-sohbet-listesi
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
        >
          <ul className="list-none px-1 min-[700px]:px-3">
            {(mesajlar ?? []).map((m, i, dizi) => {
              const oncekiGun = i > 0 ? gunAnahtari(dizi[i - 1].created_at) : null;
              const yeniGun = gunAnahtari(m.created_at) !== oncekiGun;
              const benim = benimMi(m);
              return (
                <MesajSatiri
                  key={m.id}
                  m={m}
                  ad={adi(m.sender_role)}
                  avatar={benim ? ben?.avatar_url : m.sender_role === "SYSTEM" ? null : sohbet.karsiTarafAvatar}
                  yanitAdi={m.reply_preview ? adi(m.reply_preview.sender_role) : ""}
                  tarih={yeniGun ? gunEtiketi(m.created_at, t) : null}
                  durum={
                    m.id === gorulenId
                      ? t("chat.seenBy", { name: karsiAd })
                      : m.id === sonKendiId
                        ? t("chat.sent")
                        : null
                  }
                  telefon={telefon}
                  menuAcik={menuId === m.id}
                  onMenu={(ac) => setMenuId(ac ? m.id : null)}
                  onUzunBasma={() => setCekmece(m)}
                  onTepki={(emoji) => tepki.mutate({ messageId: m.id, emoji })}
                  onYanitla={() => yanitla(m)}
                  onKopyala={() => kopyala(m)}
                  siteHost={siteHost}
                  onBaglanti={(href, dis) => {
                    // Ders sayfasından ayrılmamak için bağlantı yeni sekmede.
                    if (dis) setDisBaglanti(href);
                    else window.open(href, "_blank", "noopener");
                  }}
                />
              );
            })}
          </ul>
        </div>

        {/* Yazma alanının 64px üstünde: "{n} yeni mesaj" ya da ↓ (Preply). */}
        {!altta && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
            <PlainButton
              onClick={altaIn}
              aria-label={yeniSayi > 0 ? undefined : t("chat.scrollDown")}
              className={`pointer-events-auto inline-flex h-10 items-center justify-center rounded-lg border-2 border-[#121117] bg-white text-[#121117] hover:bg-[#F4F4F8] ${
                yeniSayi > 0 ? "px-4 text-sm font-semibold" : "w-10"
              }`}
            >
              {yeniSayi > 0 ? (
                t("chat.newMessages", { count: yeniSayi > 99 ? "99+" : yeniSayi })
              ) : (
                <Icon name="arrowDown" className="h-5 w-5" />
              )}
            </PlainButton>
          </div>
        )}
      </div>

      {/* ── Yazma alanı (Preply `AddMessageWrapS`) ── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          gonder();
        }}
        className={dar ? "shrink-0" : "shrink-0 px-6 pb-6"}
      >
        <div
          className={`flex min-h-[81px] flex-col bg-white ${
            dar
              ? `border-t-2 ${asildi ? "border-red-600" : "border-[#DCDCE5]"}`
              : `rounded border-[1.6px] ${
                  asildi ? "border-red-600" : "border-[#DCDCE5] focus-within:border-[#121117]"
                }`
          } pb-[env(safe-area-inset-bottom)]`}
        >
          {yanit && (
            <div className="flex items-start gap-2 px-2 pt-3">
              <div className="min-w-0 flex-1 border-l-2 border-[#DCDCE5] pl-2">
                <p className="text-sm font-semibold">
                  {t("chat.replyingTo", { name: adi(yanit.sender_role) })}
                </p>
                <p className="truncate text-sm text-[#4D4C5C]">{yanit.body}</p>
              </div>
              <PlainButton
                onClick={() => setYanit(null)}
                aria-label={t("chat.cancelReply")}
                title={t("chat.cancelReply")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[#F4F4F8]"
              >
                <Icon name="dismiss" className="h-4 w-4" />
              </PlainButton>
            </div>
          )}
          <div className={`px-2 ${yanit ? "pt-3" : "pt-4"}`}>
            <textarea
              ref={alan}
              rows={1}
              value={metin}
              onChange={(e) => {
                setMetin(e.target.value);
                if (e.target.value.trim() && konusmaId !== null) yaziyorBildir(konusmaId);
              }}
              onKeyDown={tusBasildi}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              data-qa-id="message_field"
              className="block max-h-[300px] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-base leading-[1.43] text-[#121117] placeholder-[#4D4C5C] outline-none focus:ring-0"
            />
          </div>
          {metin.length > SAYAC_ESIGI && (
            <p
              className={`px-2 pt-2 text-xs ${asildi ? "text-red-600" : "text-[#6A697C]"}`}
              aria-live="polite"
            >
              {t("chat.charCount", { used: metin.length, limit: KARAKTER_SINIRI })}
            </p>
          )}
          <div className="flex items-center justify-between px-2 pb-4 pt-3">
            <div className="flex items-center gap-1">
              {sohbet.benimRolum === "TUTOR" && <SablonPaneli onSec={(body) => setMetin(body)} />}
              {!telefon && <EmojiSecici onSec={emojiEkle} />}
            </div>
            <button
              type="submit"
              disabled={bos || asildi}
              aria-label={t("chat.send")}
              title={t("chat.send")}
              data-qa-id="send_message"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-transparent bg-marka text-marka-fg hover:bg-marka-hover disabled:cursor-not-allowed disabled:border-[#A8A8B6] disabled:bg-[#DCDCE5] disabled:text-[#6A697C]"
            >
              <Icon name="send" className="h-5 w-5" />
            </button>
          </div>
        </div>
      </form>

      {/* Telefon: uzun basınca alttan açılan eylemler (Preply bottom sheet). */}
      <AltCekmece
        acik={cekmece !== null}
        onKapat={() => setCekmece(null)}
        baslik={t("chat.actions")}
      >
        {cekmece && (
          <>
            <div className="col-span-full flex justify-between gap-1">
              {SIK_EMOJILER.map((emoji) => (
                <PlainButton
                  key={emoji}
                  onClick={() => {
                    tepki.mutate({ messageId: cekmece.id, emoji });
                    setCekmece(null);
                  }}
                  aria-label={t("chat.react", { emoji })}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-2xl hover:bg-ders-dugme"
                >
                  <span aria-hidden>{emoji}</span>
                </PlainButton>
              ))}
            </div>
            <PlainButton
              onClick={() => {
                const m = cekmece;
                setCekmece(null);
                yanitla(m);
              }}
              className="flex flex-col items-center gap-2 rounded-ders p-3 text-sm text-white hover:bg-ders-dugme"
            >
              <Icon name="arrowReply" className="h-6 w-6" />
              {t("chat.reply")}
            </PlainButton>
            <PlainButton
              onClick={() => {
                kopyala(cekmece);
                setCekmece(null);
              }}
              className="flex flex-col items-center gap-2 rounded-ders p-3 text-sm text-white hover:bg-ders-dugme"
            >
              <Icon name="copy" className="h-6 w-6" />
              {t("chat.copy")}
            </PlainButton>
          </>
        )}
      </AltCekmece>

      {disBaglanti && <DisBaglantiUyarisi href={disBaglanti} onKapat={() => setDisBaglanti(null)} />}
    </div>
  );
}

/** Preply `InLessonHeaderWrap`: 64px, 0 12px, alt çizgi. */
function Baslik({
  karsiAd,
  ogretmen,
  onKapat,
}: {
  karsiAd: string;
  ogretmen: boolean;
  onKapat: () => void;
}) {
  const { t } = useTranslation();
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    if (!ogretmen) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 10_000);
    return () => window.clearInterval(z);
  }, [ogretmen]);

  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[#DCDCE5] px-3">
      <div className="min-w-0">
        <h2 className="truncate text-xl font-bold leading-6 text-[#121117]">{karsiAd}</h2>
        {ogretmen && (
          <p className="truncate text-sm text-[#4D4C5C]">
            {t("chat.localTime", { name: karsiAd, time: saat(simdi) })}
          </p>
        )}
      </div>
      <PlainButton
        onClick={onKapat}
        aria-label={t("chat.close")}
        title={t("chat.close")}
        data-qa-id="chat-widget-header-close-button"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#121117] hover:bg-[#F4F4F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
      >
        <Icon name="dismiss" className="h-6 w-6" />
      </PlainButton>
    </div>
  );
}

/** Preply `MessageWrap` + `MessageCore`: balonsuz, sola hizalı düz satır. */
function MesajSatiri({
  m,
  ad,
  avatar,
  yanitAdi,
  tarih,
  durum,
  telefon,
  menuAcik,
  onMenu,
  onUzunBasma,
  onTepki,
  onYanitla,
  onKopyala,
  siteHost,
  onBaglanti,
}: {
  m: MessageOut;
  ad: string;
  avatar?: string | null;
  yanitAdi: string;
  /** Bu mesajla yeni bir gün başlıyorsa ayırıcı etiketi. */
  tarih: string | null;
  /** "… tarafından görüldü" / "Gönderildi" (yalnız kendi mesajında). */
  durum: string | null;
  telefon: boolean;
  menuAcik: boolean;
  onMenu: (acik: boolean) => void;
  onUzunBasma: () => void;
  onTepki: (emoji: string) => void;
  onYanitla: () => void;
  onKopyala: () => void;
  siteHost: string;
  onBaglanti: (href: string, dis: boolean) => void;
}) {
  const { t } = useTranslation();
  const basma = useRef<number | undefined>(undefined);
  const tepkiler = m.reactions ?? [];

  const basmaBitti = () => window.clearTimeout(basma.current);
  const dokunma = telefon
    ? {
        onTouchStart: () => {
          basmaBitti();
          basma.current = window.setTimeout(onUzunBasma, UZUN_BASMA_MS);
        },
        onTouchEnd: basmaBitti,
        onTouchMove: basmaBitti,
        onTouchCancel: basmaBitti,
        onContextMenu: (e: FareOlayi) => e.preventDefault(),
      }
    : {};
  useEffect(() => basmaBitti, []);

  return (
    <>
      {tarih && (
        <li className="my-3 flex justify-center">
          <span className="rounded bg-[#F4F4F8] px-3 py-1 text-xs font-semibold text-[#6A697C]">
            {tarih}
          </span>
        </li>
      )}
      <li
        {...dokunma}
        className={`group relative rounded p-3 ${
          menuAcik
            ? "bg-[#F4F4F8]"
            : "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F4F4F8]"
        } ${telefon ? "select-none" : ""}`}
      >
        <div className="flex items-start gap-3">
          <Avatar ad={ad} url={avatar} />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-1 pb-1">
              <span className="truncate text-base font-semibold leading-6 text-[#121117]">{ad}</span>
              <span className="shrink-0 text-xs text-[#6A697C]">{saat(m.created_at)}</span>
            </p>
            {m.reply_preview && (
              <div className="mb-2 border-l-2 border-[#DCDCE5] pl-2">
                <p className="text-sm font-semibold text-[#121117]">{yanitAdi}</p>
                <p className="truncate text-sm text-[#4D4C5C]">{m.reply_preview.body}</p>
              </div>
            )}
            <p className="whitespace-pre-wrap break-words text-base leading-6 text-[#4D4C5C]">
              {mesajParcala(m.body, siteHost).map((p, i) =>
                p.tur === "metin" ? (
                  <span key={i}>{p.deger}</span>
                ) : (
                  <a
                    key={i}
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={(e) => {
                      e.preventDefault();
                      onBaglanti(p.href, p.dis);
                    }}
                    className="break-all underline hover:text-marka-metin-hover"
                  >
                    {p.deger}
                  </a>
                ),
              )}
            </p>
            {tepkiler.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tepkiler.map((r) => (
                  <PlainButton
                    key={r.emoji}
                    onClick={() => onTepki(r.emoji)}
                    aria-pressed={r.reacted}
                    aria-label={t("chat.react", { emoji: r.emoji })}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm shadow-[inset_0_0_0_1px_#DCDCE5]"
                  >
                    <span aria-hidden>{r.emoji}</span>
                    {r.count > 1 && <span className="text-xs text-[#4D4C5C]">{r.count}</span>}
                  </PlainButton>
                ))}
              </div>
            )}
            {durum && <p className="text-xs text-[#6A697C]">{durum}</p>}
          </div>
        </div>
        {!telefon && (
          <MesajMenusu
            acik={menuAcik}
            onAcik={onMenu}
            onTepki={onTepki}
            onYanitla={onYanitla}
            onKopyala={onKopyala}
          />
        )}
      </li>
    </>
  );
}

/** Masaüstü "…" (`omni-edit-dots`): üstte tepki emojileri, altta Yanıtla / Kopyala. */
function MesajMenusu({
  acik,
  onAcik,
  onTepki,
  onYanitla,
  onKopyala,
}: {
  acik: boolean;
  onAcik: (acik: boolean) => void;
  onTepki: (emoji: string) => void;
  onYanitla: () => void;
  onKopyala: () => void;
}) {
  const { t } = useTranslation();
  const kok = useRef<HTMLDivElement>(null);
  const dugme = useRef<HTMLButtonElement>(null);
  const kapat = useRef(() => onAcik(false));
  kapat.current = () => onAcik(false);
  // Varsayılan aşağı açılır; listenin altına sığmıyorsa (son mesajlar) yukarı.
  // (Kaynakta yok: menü kaydırma kabının dışına taşmasın diye.)
  const [yukari, setYukari] = useState(false);
  const ac = () => {
    const d = dugme.current;
    const kap = d?.closest("[data-sohbet-listesi]");
    if (d && kap) {
      setYukari(d.getBoundingClientRect().bottom + MENU_YUKSEKLIGI > kap.getBoundingClientRect().bottom);
    }
    onAcik(true);
  };

  useEffect(() => {
    if (!acik) return;
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        kapat.current();
        dugme.current?.focus();
      }
    };
    const dis = (e: PointerEvent) => {
      if (!kok.current?.contains(e.target as Node)) kapat.current();
    };
    document.addEventListener("keydown", tus);
    document.addEventListener("pointerdown", dis);
    return () => {
      document.removeEventListener("keydown", tus);
      document.removeEventListener("pointerdown", dis);
    };
  }, [acik]);

  const sec = (is: () => void) => {
    kapat.current();
    is();
  };
  const oge =
    "flex h-12 w-full items-center gap-3 px-4 text-left text-base text-[#121117] hover:bg-[#F4F4F8]";

  return (
    <div ref={kok} className="absolute right-3 top-3 z-10">
      <PlainButton
        ref={dugme}
        onClick={() => (acik ? onAcik(false) : ac())}
        aria-label={t("chat.actions")}
        title={t("chat.actions")}
        aria-haspopup="menu"
        aria-expanded={acik}
        data-qa-id="omni-edit-dots"
        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#121117] hover:bg-[#DCDCE5] focus:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 ${
          acik ? "bg-[#DCDCE5] opacity-100" : "opacity-0"
        }`}
      >
        <Icon name="moreHorizontal" className="h-6 w-6" />
      </PlainButton>
      {acik && (
        <div
          role="menu"
          className={`absolute right-0 ${yukari ? "bottom-full mb-1" : "top-full mt-1"} flex w-[368px] max-w-[calc(100vw-2rem)] flex-col gap-1`}
        >
          <div className="flex justify-between rounded-lg bg-white p-2 shadow-lg ring-1 ring-[#DCDCE5]">
            {SIK_EMOJILER.map((emoji) => (
              <PlainButton
                key={emoji}
                role="menuitem"
                onClick={() => sec(() => onTepki(emoji))}
                aria-label={t("chat.react", { emoji })}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-2xl hover:bg-[#F4F4F8]"
              >
                <span aria-hidden>{emoji}</span>
              </PlainButton>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-[#DCDCE5]">
            <PlainButton role="menuitem" onClick={() => sec(onYanitla)} className={oge}>
              <Icon name="arrowReply" className="h-5 w-5" />
              {t("chat.reply")}
            </PlainButton>
            <div className="mx-4 border-t border-[#DCDCE5]" />
            <PlainButton role="menuitem" onClick={() => sec(onKopyala)} className={oge}>
              <Icon name="copy" className="h-5 w-5" />
              {t("chat.copy")}
            </PlainButton>
          </div>
        </div>
      )}
    </div>
  );
}
