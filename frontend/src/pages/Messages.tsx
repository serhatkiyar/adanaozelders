import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { SAYFA_BASLIGI } from "@/lib/tipografi";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AxiosError } from "axios";
import { Icon } from "@/components/AppIcon";
import { DashboardShell } from "@/components/DashboardShell";
import { Avatar } from "@/components/Avatar";
import { BookingActionCard } from "@/components/BookingActionCard";
import { RightContextPanel } from "@/components/RightContextPanel";
import { ReportModal } from "@/components/ReportModal";
import { GuvenlikBandi } from "@/components/mesaj/GuvenlikBandi";
import { DisBaglantiUyarisi } from "@/components/mesaj/DisBaglantiUyarisi";
import { EmojiSecici } from "@/components/mesaj/EmojiSecici";
import { EngelleModal } from "@/components/mesaj/EngelleModal";
import { SablonPaneli } from "@/components/mesaj/SablonPaneli";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_BIRINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { UYE_NAV, TUTOR_NAV, OPERATOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useArchiveConversation,
  useConversations,
  useMarkConversationRead,
  useMessages,
  useMessageSearch,
  useMessagesUnreadCount,
  useMessagingEligibility,
  useSendMessage,
  useToggleReaction,
  useUnblockClient,
} from "@/hooks/useMessages";
import { useDebounce } from "@/hooks/useDebounce";
import { formatChatTime, formatDateTime } from "@/lib/datetime";
import { SIK_EMOJILER } from "@/lib/emoji";
import { cevapCokKisaMi } from "@/lib/kisaCevapUyarisi";
import { buildSnippet } from "@/lib/messageSearch";
import { mesajParcala } from "@/lib/mesajBaglantisi";
import { ROUTES, ilanYolu } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS, ReportReason } from "@/types";
import type {
  ConversationOut,
  MessageOut,
  MessageSearchHit,
  MessagingStage,
} from "@/types";

// Ortak emoji kaynağı `lib/emoji.ts`te — yazma alanındaki `EmojiSecici` de
// AYNI listeyi kullanır, iki ayrı emoji kümesi icat edilmesin diye.
const REACTION_EMOJIS = SIK_EMOJILER;

type Role = "CLIENT" | "TUTOR" | "LIBRARY";

/** Sohbet başlığı için tıklama anında saklanan bilgi (liste dışından açılabilir). */
type SohbetMeta = {
  id: number;
  counterpartyId: number | null;
  counterpartyRole?: string | null;
  name: string | null;
  avatar?: string | null;
  archived: boolean;
  stage?: MessagingStage | null;
  blocked?: boolean;
};

/** Sohbet listesi kaydından başlık bilgisi. */
function metaFrom(c: ConversationOut): SohbetMeta {
  return {
    id: c.id,
    counterpartyId: c.counterparty_id ?? null,
    counterpartyRole: c.counterparty_role,
    name: c.counterparty_name ?? null,
    avatar: c.counterparty_avatar_url,
    archived: c.archived ?? false,
    stage: c.stage ?? null,
    blocked: c.blocked ?? false,
  };
}

/** Şikâyet penceresinin hedefi: tek mesaj ya da karşı taraf. */
type RaporHedefi = {
  type: "MESSAGE" | "TUTOR" | "CLIENT";
  id: number;
  label: string;
  neden?: ReportReason;
};

/**
 * Gönderim hatasının kullanıcıya gösterilecek metni. Mesajlaşma uçları
 * yapılandırılmış hata döner (`detail = {code, message}`); telefon doğrulama
 * gibi eski uçlar düz metin döner.
 */
function gonderimHatasi(err: unknown): string {
  if (err instanceof AxiosError) {
    const detail: unknown = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (
      detail &&
      typeof detail === "object" &&
      typeof (detail as { message?: unknown }).message === "string"
    )
      return (detail as { message: string }).message;
  }
  return getErrorMessage(err, "Mesaj gönderilemedi.");
}

export default function Messages({ embedded = false }: { embedded?: boolean }) {
  const { data: user } = useCurrentUser();
  const role: Role | null =
    user?.role_id === ROLE_IDS.CLIENT
      ? "CLIENT"
      : user?.role_id === ROLE_IDS.TUTOR
        ? "TUTOR"
        : user?.role_id === ROLE_IDS.LIBRARY_OPERATOR
          ? "LIBRARY"
          : null;
  const navItems =
    role === "TUTOR"
      ? TUTOR_NAV
      : role === "CLIENT"
        ? UYE_NAV
        : role === "LIBRARY"
          ? OPERATOR_NAV
          : undefined;

  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Seçili sohbetin başlık/arşiv bilgisi. Gözatma listesinde olmayabileceği için
  // (ör. arşiv sekmesindeyken aramadan bir mesaja atlanınca) tıklama anında saklanır.
  const [selectedMeta, setSelectedMeta] = useState<SohbetMeta | null>(null);
  const [draft, setDraft] = useState<{
    counterpartyId: number;
    counterpartyRole?: string | null;
    name: string;
  } | null>(null);
  // Aramadan bir mesaja atlandığında, mesajlar yüklenince kaydırılacak hedef.
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<number | null>(
    null
  );
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  // Arama sunucu tarafında (ad + tüm mesaj geçmişi); "okunmamış" istemci tarafı.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<MessageOut | null>(null);
  const debouncedQuery = useDebounce(query, 300);
  const term = debouncedQuery.trim();
  const searching = term.length > 0;

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const { data: conversations, isLoading } = useConversations(filter === "archived");
  const { data: searchResults, isLoading: searchLoading } = useMessageSearch(term);
  // Okunmamış sayısı: gelen kutusu rozeti "Okunmamış" çipinde, arşivdeki
  // okunmamışlar ise arşiv ikonunda gösterilir (arama sonucuna bağlı değil).
  const { data: unreadCounts } = useMessagesUnreadCount();
  const inboxUnread = unreadCounts?.inbox ?? 0;
  const archivedUnread = unreadCounts?.archived ?? 0;

  const openConversation = (
    meta: SohbetMeta,
    matchMessageId?: number | null
  ) => {
    setSelectedId(meta.id);
    setSelectedMeta(meta);
    setDraft(null);
    setReplyTarget(null);
    setPendingScrollMessageId(matchMessageId ?? null);
  };

  // Profilden "Mesaj Gönder" ile gelindiğinde (?to=&name=) doğru sohbeti seç
  // veya henüz yoksa taslak oluştur. Çözümleyince parametreyi temizle.
  useEffect(() => {
    const toParam = searchParams.get("to");
    if (!toParam || conversations === undefined) return;
    const cpId = Number(toParam);
    const toRole = searchParams.get("role"); // CLIENT | TUTOR | LIBRARY (opsiyonel)
    const existing = conversations.find(
      (c) =>
        c.counterparty_id === cpId &&
        (!toRole || c.counterparty_role === toRole)
    );
    if (existing) {
      openConversation({
        ...metaFrom(existing),
        counterpartyId: existing.counterparty_id ?? cpId,
      });
    } else {
      setDraft({
        counterpartyId: cpId,
        counterpartyRole: toRole,
        name: searchParams.get("name") ?? "Kullanıcı",
      });
      setSelectedId(null);
      setSelectedMeta(null);
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, conversations, setSearchParams]);

  const browseConv = useMemo(
    () => conversations?.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  // "Okunmamış" filtresi (arşiv zaten sunucuda uygulandı)
  const filteredConversations = useMemo(() => {
    if (!conversations) return conversations;
    if (filter !== "unread") return conversations;
    return conversations.filter((c) => (c.unread ?? 0) > 0);
  }, [conversations, filter]);

  // Başlık/aksiyon bilgisi: önce taze gözatma kaydı, yoksa tıklamadaki meta.
  const activeCounterpartyId =
    browseConv?.counterparty_id ??
    selectedMeta?.counterpartyId ??
    draft?.counterpartyId ??
    null;
  const activeName =
    browseConv?.counterparty_name ?? selectedMeta?.name ?? draft?.name ?? null;
  const activeAvatar =
    browseConv?.counterparty_avatar_url ?? selectedMeta?.avatar ?? null;
  const activeArchived = browseConv?.archived ?? selectedMeta?.archived ?? false;
  // Karşı tarafın türü: sohbet kaydından, yoksa meta/draft'tan, yoksa rolüme göre
  // varsayılan (CLIENT→TUTOR, TUTOR→CLIENT). Kütüphane operatörü için zorunlu gelir.
  const activeCounterpartyRole: string | null =
    browseConv?.counterparty_role ??
    selectedMeta?.counterpartyRole ??
    draft?.counterpartyRole ??
    (role === "CLIENT" ? "TUTOR" : role === "TUTOR" ? "CLIENT" : null);

  // Öğrenci↔eğitmen sohbetinin aşaması ve engel durumu (Modül 5).
  const ogrenciEgitmene = role === "CLIENT" && activeCounterpartyRole === "TUTOR";
  const egitmenOgrenciye = role === "TUTOR" && activeCounterpartyRole === "CLIENT";
  const { data: uygunluk, refetch: uygunluguTazele } = useMessagingEligibility(
    ogrenciEgitmene && (selectedId !== null || draft !== null)
      ? activeCounterpartyId
      : null
  );
  const activeStage: MessagingStage | null =
    (ogrenciEgitmene ? uygunluk?.stage : undefined) ??
    browseConv?.stage ??
    selectedMeta?.stage ??
    null;
  const activeBlocked =
    (ogrenciEgitmene ? uygunluk?.blocked : undefined) ??
    browseConv?.blocked ??
    selectedMeta?.blocked ??
    false;

  // Karşı tarafın profili: kütüphane → kütüphane sayfası; eğitmen → ilan; öğrenci → profil.
  // Ders öncesi sohbette eğitmen öğrenci profiline bağlanmaz: aralarında
  // ilişki olmadığı için o sayfa sunucuda zaten açılmıyor.
  // Eğitmenin kök ilan adresi (Modül 6); adres yoksa eski yol yönlendirir.
  const egitmenIlanYolu =
    activeCounterpartyId == null
      ? null
      : ilanYolu({
          id: activeCounterpartyId,
          url_slug: browseConv?.counterparty_url_slug,
        });
  const counterpartyHref =
    activeCounterpartyId == null || (egitmenOgrenciye && activeStage === "INQUIRY")
      ? null
      : activeCounterpartyRole === "LIBRARY"
        ? ROUTES.library(activeCounterpartyId)
        : activeCounterpartyRole === "TUTOR"
          ? egitmenIlanYolu
          : null; // Öğrenci profili sayfası yok (23 Eyl 2026).

  const { data: messages, isLoading: messagesLoading } = useMessages(selectedId);
  const send = useSendMessage();
  const markRead = useMarkConversationRead();
  const reaction = useToggleReaction(selectedId);
  const archive = useArchiveConversation();
  const unblock = useUnblockClient();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [raporHedefi, setRaporHedefi] = useState<RaporHedefi | null>(null);
  const [disBaglanti, setDisBaglanti] = useState<{
    href: string;
    mesaj: MessageOut | null;
  } | null>(null);
  const [engelleAcik, setEngelleAcik] = useState(false);
  const [secenekAcik, setSecenekAcik] = useState(false);
  // Eğitmenin yeni bir lead'e ilk cevabı kısaysa BİR KEZ öneri gösterilir
  // (kullanıcı kararı, 22 Eyl 2026: Preply'de olduğu gibi tekrar tekrar
  // engellemez — "çat çat" ikinci tıklayışta zaten gönderilir, zorunlu
  // hissettirmez). Sohbet değişince sıfırlanır.
  const [kisaCevapUyarisiGosterildi, setKisaCevapUyarisiGosterildi] =
    useState(false);
  const navigate = useNavigate();
  const siteHost = typeof window !== "undefined" ? window.location.hostname : "";

  const bottomRef = useRef<HTMLDivElement>(null);
  // En-alta kaydırmanın hangi sohbet/uzunlukta yapıldığını izler; böylece bir
  // arama hedefine atlama "en alta in" ile çakışmaz ve her poll'da zıplamayız.
  const bottomStateRef = useRef<{ conv: number | null; count: number }>({
    conv: null,
    count: 0,
  });

  // (1) Atlama: aramadan gelen hedef mesaj yüklenince o satıra kaydır + vurgula
  // (tek seferlik). Hedef yüklü pencerede yoksa en alta in. "En alta" effect'iyle
  // çakışmamak için, atladığımız sohbeti bottomStateRef'e işaretleriz.
  useEffect(() => {
    if (pendingScrollMessageId === null || messagesLoading || !messages) return;
    const present = messages.some((m) => m.id === pendingScrollMessageId);
    if (present) {
      const target = pendingScrollMessageId;
      requestAnimationFrame(() => {
        document
          .getElementById(`msg-${target}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      setHighlightedMessageId(target);
    } else {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    bottomStateRef.current = { conv: selectedId, count: messages.length };
    setPendingScrollMessageId(null);
  }, [messages, messagesLoading, selectedId, pendingScrollMessageId]);

  // (2) En alta in: sohbet açıldığında veya yeni mesaj eklendiğinde. Atlama
  // beklerken devre dışı (yukarı kaydırmayı geri almasın).
  useEffect(() => {
    if (pendingScrollMessageId !== null || !messages) return;
    const prev = bottomStateRef.current;
    const convChanged = selectedId !== prev.conv;
    const grew = selectedId === prev.conv && messages.length > prev.count;
    if (convChanged || grew) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    bottomStateRef.current = { conv: selectedId, count: messages.length };
  }, [messages, selectedId, pendingScrollMessageId]);

  // Vurguyu animasyon bitince temizle (aynı mesaja tekrar atlanabilsin).
  useEffect(() => {
    if (highlightedMessageId === null) return;
    const t = setTimeout(() => setHighlightedMessageId(null), 2600);
    return () => clearTimeout(t);
  }, [highlightedMessageId]);

  // Sohbet açılınca VE açıkken yeni mesaj gelince okundu işaretle. Böylece sohbeti
  // görüntülerken yan listedeki ve navbar'daki okunmamış sayısı artmaya devam etmez.
  const lastMessageId =
    messages && messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (selectedId !== null) markRead.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, lastMessageId]);

  // Sohbet değişince kısa-cevap uyarısı sıfırlanır — her yeni lead kendi hakkını alır.
  useEffect(() => {
    setKisaCevapUyarisiGosterildi(false);
  }, [selectedId]);

  const showChat = selectedId !== null || draft !== null;

  const backToList = () => {
    setSelectedId(null);
    setSelectedMeta(null);
    setDraft(null);
    setReplyTarget(null);
    setPendingScrollMessageId(null);
  };

  const engeliKaldir = () => {
    if (activeCounterpartyId === null) return;
    unblock.mutate(activeCounterpartyId, {
      onSuccess: () => {
        setSelectedMeta((m) => (m ? { ...m, blocked: false } : m));
        toast.success("Engel kaldırıldı.");
      },
      onError: (err) => toast.error(getErrorMessage(err, "Engel kaldırılamadı.")),
    });
  };

  // Eğitmenin bu sohbete HENÜZ hiç cevap yazmadığı, deneme öncesi (INQUIRY)
  // bir lead mi? Yalnız bu durumda kısa-cevap önerisi gösterilir — ders
  // ilişkisi kurulmuş bir öğrenciye kısa "tamam" gibi cevaplar zaten normaldir.
  const egitmenIlkCevabiBekleniyor =
    egitmenOgrenciye &&
    activeStage === "INQUIRY" &&
    !(messages ?? []).some((m) => m.sender_role === "TUTOR");

  // Emoji seçilince imlecin BULUNDUĞU YERE basılır (sona eklenmez) —
  // `textareaRef` olmadan yalnız sona ekleyebilirdik, kullanıcı cümlenin
  // ortasındayken yanlış yere düşerdi.
  const emojiEkle = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const konum = start + emoji.length;
      el.setSelectionRange(konum, konum);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || activeCounterpartyId == null) return;
    if (
      egitmenIlkCevabiBekleniyor &&
      !kisaCevapUyarisiGosterildi &&
      cevapCokKisaMi(body)
    ) {
      setKisaCevapUyarisiGosterildi(true);
      toast.info(
        "Daha uzun bir cevap, bu potansiyel öğrenciye ders verme şansını artırır. Yine de göndermek istersen düğmeye bir daha bas."
      );
      return;
    }
    send.mutate(
      {
        counterpartyId: activeCounterpartyId,
        counterpartyRole: activeCounterpartyRole,
        body,
        replyToId: replyTarget?.id,
      },
      {
        onSuccess: (msg) => {
          setText("");
          setReplyTarget(null);
          setSelectedId(msg.conversation_id);
          setSelectedMeta({
            id: msg.conversation_id,
            counterpartyId: activeCounterpartyId,
            counterpartyRole: activeCounterpartyRole,
            name: activeName,
            avatar: activeAvatar,
            archived: false,
            stage: activeStage,
            blocked: false,
          });
          setDraft(null);
          if (msg.contact_masked) {
            toast.info("Güvenliğin için iletişim bilgileri ve dış bağlantılar gizlendi.");
          }
        },
        onError: (err) => {
          // 403/429'un gerçek sebebini (telefon doğrulama, engel, ders öncesi
          // sınırlar) sunucudan gelen Türkçe metinle göster.
          toast.error(gonderimHatasi(err));
          // Engel/sınır sunucuda değişmiş olabilir: yazma alanını güncel duruma getir.
          const kod = err instanceof AxiosError ? err.response?.status : undefined;
          if (ogrenciEgitmene && (kod === 403 || kod === 429)) void uygunluguTazele();
        },
      }
    );
  };

  if (role === null) {
    const notice = (
      <div className={`${KART} mx-auto max-w-md py-16 text-center`}>
        <p className={ACIKLAMA}>
          Mesajlaşma yalnızca öğrenci ve öğretmenler içindir.
        </p>
      </div>
    );
    if (embedded) return notice;
    return <DashboardShell title="Mesajlar">{notice}</DashboardShell>;
  }

  // Gövde shell'den ayrı: Mesaj Merkezi (embedded) kendi yüksekliğini verir.
  //
  // Telefonda yatay padding YOK: ekran tek bir listeye veriliyor, satır
  // ayraçları kenardan kenara uzuyor ve başlık kendi `px-5`ini taşıyor.
  // Dıştaki `px-4` kalsaydı telefonda 36px'lik bir sol boşluk çıkardı.
  const body = (
      <div className="mx-auto flex h-full w-full max-w-screen-2xl overflow-hidden bg-white md:px-8 ">
        {/* ── Sohbet listesi ── ~%30 daraltıldı (380/460 → 270/320px; kullanıcı
            kararı, 23 Eyl 2026): mesajlaşma alanı genişlesin. */}
        <aside
          aria-label="Konuşma listesi"
          className={`${
            showChat ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col md:w-[270px] md:border-r md:border-slate-200 lg:w-[320px]`}
        >
          <div className="space-y-3 border-b border-slate-200 px-5 pb-3 pt-5 ">
            {/* Başlık ↔ arama (Airbnb gibi: ikona tıklayınca animasyonla açılır) */}
            {searchOpen ? (
              <div className="animate-searchbar flex items-center gap-2">
                <div className="relative flex-1">
                  <svg
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
                    />
                  </svg>
                  <input
                    type="search"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") closeSearch();
                    }}
                    placeholder="Sohbetlerde ara"
                    aria-label="Sohbetlerde ara"
                    className="w-full rounded-full border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 "
                  />
                </div>
                <button
                  type="button"
                  onClick={closeSearch}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 "
                >
                  İptal et
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <h1 className={SAYFA_BASLIGI}>
                  Mesajlar
                </h1>
                {/* Başlığın sağındaki iki yuvarlak: ara · arşiv. Arşiv eskiden
                    çip satırındaydı; oradaki tek "ikon" filtre çipleriyle aynı
                    satırı paylaşıp iki farklı şeyi (filtre ↔ ayrı kutu) tek
                    ritimde gösteriyordu. Telefonda üst bar kalkınca bu satır
                    ekranın kendi başlığı oldu; eylemler de oraya taşındı. */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Ara"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 "
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFilter(filter === "archived" ? "all" : "archived")
                    }
                    aria-pressed={filter === "archived"}
                    aria-label={filter === "archived" ? "Arşivden çık" : "Arşiv"}
                    title={filter === "archived" ? "Arşivden çık" : "Arşiv"}
                    className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
                      filter === "archived"
                        ? "bg-slate-900 text-white "
                        : "text-slate-600 hover:bg-slate-100 "
                    }`}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                    </svg>
                    {archivedUnread > 0 && (
                      <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-marka px-1 text-[10px] font-bold text-marka-fg ring-2 ring-white ">
                        {archivedUnread > 9 ? "9+" : archivedUnread}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}
            {/* Filtre çipleri */}
            <div className="flex items-center gap-2">
              {([
                { key: "all", label: "Tümü" },
                { key: "unread", label: "Okunmamış" },
              ] as const).map((f) => {
                const activeChip = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold transition ${
                      activeChip
                        ? "bg-slate-900 text-white "
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
                    }`}
                  >
                    {f.label}
                    {f.key === "unread" && inboxUnread > 0 && (
                      <span
                        className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                          activeChip
                            ? "bg-white/20 text-current "
                            : "bg-marka text-marka-fg"
                        }`}
                      >
                        {inboxUnread > 9 ? "9+" : inboxUnread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searching ? (
              searchLoading && !searchResults ? (
                <ListSkeleton />
              ) : !searchResults ||
                (searchResults.chats.length === 0 &&
                  searchResults.messages.length === 0) ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <p className={ETIKET}>
                    Sonuç bulunamadı
                  </p>
                  <p className={`mt-1 ${ACIKLAMA}`}>
                    "{term}" için isim veya mesaj eşleşmedi.
                  </p>
                </div>
              ) : (
                <div className="pb-2">
                  {searchResults.chats.length > 0 && (
                    <>
                      <SectionHeader label="Sohbetler" />
                      <ul className="divide-y divide-slate-200 ">
                        {searchResults.chats.map((c) => (
                          <li key={c.id}>
                            <ConversationRow
                              c={c}
                              role={role}
                              active={c.id === selectedId}
                              onClick={() => openConversation(metaFrom(c))}
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {searchResults.messages.length > 0 && (
                    <>
                      <SectionHeader
                        label="Mesajlar"
                        count={searchResults.messages.length}
                      />
                      <ul className="divide-y divide-slate-200 ">
                        {searchResults.messages.map((hit) => (
                          <li key={hit.message_id}>
                            <MessageHitRow
                              hit={hit}
                              term={term}
                              active={hit.conversation_id === selectedId}
                              onClick={() =>
                                openConversation(
                                  {
                                    id: hit.conversation_id,
                                    counterpartyId: hit.counterparty_id ?? null,
                                    counterpartyRole: hit.counterparty_role,
                                    name: hit.counterparty_name ?? null,
                                    avatar: hit.counterparty_avatar_url,
                                    archived: false,
                                  },
                                  hit.message_id
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )
            ) : isLoading ? (
              <ListSkeleton />
            ) : !conversations || conversations.length === 0 ? (
              filter === "archived" ? (
                <EmptyArchived />
              ) : (
                <EmptyInbox role={role} />
              )
            ) : !filteredConversations || filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 pb-28 text-center">
                <img src="/icons/omuz-silkme.png" alt="" aria-hidden className="h-36 w-36" />
                <p className={`mt-4 ${ETIKET}`}>
                  Okunmamış mesaj yok
                </p>
                <p className={`mt-1 ${ACIKLAMA}`}>
                  Tüm sohbetlerin okundu.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-200 ">
                {filteredConversations.map((c) => (
                  <li key={c.id}>
                    <ConversationRow
                      c={c}
                      role={role}
                      active={c.id === selectedId}
                      onClick={() => openConversation(metaFrom(c))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Sohbet penceresi ── */}
        <section
          className={`${
            showChat ? "flex" : "hidden md:flex"
          } min-w-0 flex-1 flex-col`}
        >
          {!showChat ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-28 text-center">
              {/* Fluent Emoji "Incoming envelope" (3D) — kullanıcı kararı,
                  22 Eyl 2026: gri kutu içindeki çizgi ikonunun yerine. */}
              <img src="/icons/incoming-envelope.png" alt="" aria-hidden className="h-40 w-40" />
              {/* Tek satır ve GRİ (kullanıcı kararı, 22 Eyl 2026): siyah
                  başlık + onu tekrar eden alt satır yerine. Metin role göre
                  değişir — aynı sayfayı öğrenci de öğretmen de açar. */}
              <p className={`mt-4 ${ACIKLAMA}`}>
                {role === "TUTOR"
                  ? "Sohbete başlamak için bir öğrenci seç"
                  : role === "LIBRARY"
                    ? "Sohbete başlamak için bir kişi seç"
                    : "Sohbete başlamak için bir öğretmen seç"}
              </p>
            </div>
          ) : (
            <>
              {/* Başlık */}
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
                <button
                  type="button"
                  onClick={backToList}
                  aria-label="Listeye dön"
                  className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 md:hidden"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                  </svg>
                </button>
                {counterpartyHref ? (
                  <Link
                    to={counterpartyHref}
                    className="-mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1 transition hover:bg-slate-100 "
                    title={
                      role === "CLIENT"
                        ? "Öğretmenin ilanını görüntüle"
                        : "Öğrencinin profilini görüntüle"
                    }
                  >
                    <Avatar name={activeName ?? "?"} avatar_url={activeAvatar} size="md" />
                    <span className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 ">
                      {activeName ?? "Kullanıcı"}
                    </span>
                  </Link>
                ) : (
                  <>
                    <Avatar name={activeName ?? "?"} avatar_url={activeAvatar} size="md" />
                    <span className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 ">
                      {activeName ?? "Kullanıcı"}
                    </span>
                  </>
                )}
                {selectedId !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      archive.mutate(
                        { id: selectedId, archived: !activeArchived },
                        {
                          onSuccess: () => {
                            toast.success(
                              activeArchived
                                ? "Sohbet arşivden çıkarıldı."
                                : "Sohbet arşivlendi."
                            );
                            backToList();
                          },
                          onError: (err) =>
                            toast.error(getErrorMessage(err, "İşlem başarısız.")),
                        }
                      )
                    }
                    disabled={archive.isPending}
                    title={activeArchived ? "Arşivden çıkar" : "Arşivle"}
                    aria-label={activeArchived ? "Arşivden çıkar" : "Arşivle"}
                    className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 "
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                    </svg>
                  </button>
                )}
                {/* Sohbet seçenekleri (Modül 5): şikâyet ve öğretmen için engel.
                    Kütüphane sohbetinde karşılığı olan bir eylem yok. */}
                {activeCounterpartyId !== null &&
                  (activeCounterpartyRole === "TUTOR" ||
                    activeCounterpartyRole === "CLIENT") && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setSecenekAcik((a) => !a)}
                        aria-haspopup="menu"
                        aria-expanded={secenekAcik}
                        aria-label="Sohbet seçenekleri"
                        title="Sohbet seçenekleri"
                        className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <circle cx="5" cy="12" r="1.75" />
                          <circle cx="12" cy="12" r="1.75" />
                          <circle cx="19" cy="12" r="1.75" />
                        </svg>
                      </button>
                      {secenekAcik && (
                        <>
                          <div
                            aria-hidden
                            className="fixed inset-0 z-20"
                            onClick={() => setSecenekAcik(false)}
                          />
                          <div
                            role="menu"
                            aria-label="Sohbet seçenekleri"
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setSecenekAcik(false);
                            }}
                            className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSecenekAcik(false);
                                setRaporHedefi({
                                  type: activeCounterpartyRole === "TUTOR" ? "TUTOR" : "CLIENT",
                                  id: activeCounterpartyId,
                                  label: activeName ?? "Kullanıcı",
                                });
                              }}
                              className="flex w-full items-center px-4 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-50"
                            >
                              Şikâyet et
                            </button>
                            {egitmenOgrenciye &&
                              (activeBlocked ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setSecenekAcik(false);
                                    engeliKaldir();
                                  }}
                                  className="flex w-full items-center px-4 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-50"
                                >
                                  Engeli kaldır
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setSecenekAcik(false);
                                    setEngelleAcik(true);
                                  }}
                                  className="flex w-full items-center px-4 py-2.5 text-left text-sm text-red-700 transition hover:bg-red-50"
                                >
                                  Öğrenciyi engelle
                                </button>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
              </div>

              {/* Güvenlik bandı — yalnız öğrenci↔öğretmen sohbetinde */}
              {activeStage && (ogrenciEgitmene || egitmenOgrenciye) && (
                <GuvenlikBandi stage={activeStage} rol={role === "TUTOR" ? "TUTOR" : "CLIENT"} />
              )}

              {/* Mesajlar */}
              <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-6">
                <div className="mx-auto w-full max-w-4xl space-y-2.5">
                {selectedId !== null && messagesLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-10 w-2/3 animate-pulse rounded-2xl bg-slate-200 ${
                          i % 2 ? "ml-auto" : ""
                        }`}
                      />
                    ))}
                  </div>
                ) : !messages || messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className={ETIKET}>
                      Henüz mesaj yok.
                    </p>
                    <p className={`mt-1 ${ACIKLAMA}`}>
                      {ogrenciEgitmene && activeStage === "INQUIRY"
                        ? "Kendini tanıt; hedefini ve uygun olduğun saatleri yaz."
                        : "İlk mesajı sen yaz."}
                    </p>
                  </div>
                ) : (
                  messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      m={m}
                      mine={m.sender_role === role}
                      highlighted={m.id === highlightedMessageId}
                      siteHost={siteHost}
                      onReply={() => setReplyTarget(m)}
                      onReact={(emoji) => reaction.mutate({ messageId: m.id, emoji })}
                      onBaglanti={(href, dis) => {
                        if (dis) {
                          setDisBaglanti({
                            href,
                            mesaj: m.sender_role === role ? null : m,
                          });
                          return;
                        }
                        // İç bağlantı sayfa yenilemeden açılır.
                        const u = new URL(href);
                        navigate(`${u.pathname}${u.search}${u.hash}`);
                      }}
                      onBildir={() =>
                        setRaporHedefi({
                          type: "MESSAGE",
                          id: m.id,
                          label: `${activeName ?? "Kullanıcı"} kişisinin mesajı`,
                        })
                      }
                    />
                  ))
                )}
                {/* Görüldü/Gönderildi — yalnız son mesaj benimse (WhatsApp tarzı) */}
                {messages && messages.length > 0 && role && (() => {
                  const last = messages[messages.length - 1];
                  if (last.sender_role !== role) return null;
                  const readAt = browseConv?.counterparty_last_read_at;
                  const seen =
                    readAt != null &&
                    new Date(last.created_at).getTime() <= new Date(readAt).getTime();
                  return (
                    <p className="px-1 pb-1 text-right text-[11px] font-medium">
                      {seen ? (
                        <span className="text-marka-metin ">Görüldü</span>
                      ) : (
                        <span className="text-slate-400 ">Gönderildi</span>
                      )}
                    </p>
                  );
                })()}
                <div ref={bottomRef} />
                </div>
              </div>

              {/* Yazma alanı */}
              <div className="border-t border-slate-200 bg-white ">
              {replyTarget && (
                <div className="mx-auto flex w-full max-w-4xl items-start gap-2 px-3 pt-3 sm:px-6">
                  <div className="min-w-0 flex-1 rounded-lg border-l-2 border-marka-mid bg-slate-50 px-3 py-2 ">
                    <p className="text-[11px] font-semibold text-marka-metin ">
                      {replyTarget.sender_role === role
                        ? "Kendine yanıt"
                        : `${activeName ?? "Kullanıcı"} kişisine yanıt`}
                    </p>
                    <p className="truncate text-xs text-slate-500 ">
                      {replyTarget.body}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Yanıtı iptal et"
                    className="mt-1 shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              {egitmenOgrenciye && activeBlocked ? (
                <YazmaKapali metin="Bu öğrenciyi engelledin.">
                  <button
                    type="button"
                    onClick={engeliKaldir}
                    disabled={unblock.isPending}
                    className="shrink-0 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Engeli kaldır
                  </button>
                </YazmaKapali>
              ) : ogrenciEgitmene && activeBlocked ? (
                <YazmaKapali metin="Bu öğretmen şu anda mesaj kabul etmiyor.">
                  <Link
                    to={ROUTES.tutors}
                    className="shrink-0 rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
                  >
                    Başka öğretmen bul
                  </Link>
                </YazmaKapali>
              ) : ogrenciEgitmene && uygunluk && !uygunluk.can_send ? (
                <YazmaKapali
                  metin={uygunluk.reason_message ?? "Şu anda bu öğretmene mesaj gönderemezsin."}
                >
                  {uygunluk.reason_code === "INQUIRY_DAILY_LIMIT" &&
                    egitmenIlanYolu !== null && (
                      <Link
                        to={egitmenIlanYolu}
                        className="shrink-0 rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
                      >
                        Ders talep et
                      </Link>
                    )}
                </YazmaKapali>
              ) : (
              <>
              <form
                onSubmit={submit}
                className="mx-auto w-full max-w-4xl p-3 sm:px-6 sm:py-4"
              >
                {/* Tek birleşik kutu (kullanıcı kararı, 22 Eyl 2026 — Preply
                    referansı): yazı alanı ve araç satırı AYNI çerçevenin
                    içinde, üç ayrı parça değil. Odak halkası bu dış kutuya
                    taşındı; textarea kendi çerçevesini/odak halkasını
                    kaybetti (`border-0`, `focus:ring-0`) — aksi hâlde iç içe
                    iki çerçeve/iki odak halkası görünürdü. */}
                <div className="rounded-2xl border border-slate-200 bg-white transition focus-within:border-marka-mid focus-within:ring-2 focus-within:ring-marka/20 ">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit(e);
                      }
                    }}
                    placeholder="Mesajın"
                    className="max-h-40 min-h-[44px] w-full resize-none border-0 bg-transparent px-4 pt-3 text-[15px] text-slate-900 placeholder-slate-400 outline-none focus:ring-0 "
                  />
                  <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
                    <div className="flex items-center gap-0.5">
                      {role === "TUTOR" && (
                        <SablonPaneli onSec={(body) => setText(body)} />
                      )}
                      {/* Emoji seçici HER İKİ rol için de — şablonların
                          aksine tutor'a özgü bir yetenek değil. */}
                      <EmojiSecici onSec={emojiEkle} />
                    </div>
                    <button
                      type="submit"
                      disabled={send.isPending || !text.trim()}
                      aria-label="Gönder"
                      title="Gönder"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marka text-marka-fg transition hover:bg-marka-hover active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 "
                    >
                      {send.isPending ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent " />
                      ) : (
                        <Icon name="send" className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
              </form>
              {ogrenciEgitmene && uygunluk?.remaining_before_reply != null && (
                <p className={`mx-auto -mt-1 w-full max-w-4xl px-3 pb-3 sm:px-6 ${KUCUK_ACIKLAMA}`}>
                  Öğretmen yanıt verene kadar {uygunluk.remaining_before_reply} mesaj hakkın kaldı.
                </p>
              )}
              </>
              )}
              </div>
            </>
          )}
        </section>

        {raporHedefi && (
          <ReportModal
            targetType={raporHedefi.type}
            targetId={raporHedefi.id}
            targetLabel={raporHedefi.label}
            varsayilanNeden={raporHedefi.neden}
            onClose={() => setRaporHedefi(null)}
          />
        )}
        {disBaglanti && (
          <DisBaglantiUyarisi
            href={disBaglanti.href}
            onKapat={() => setDisBaglanti(null)}
            onBildir={
              disBaglanti.mesaj
                ? () => {
                    const hedef = disBaglanti.mesaj as MessageOut;
                    setDisBaglanti(null);
                    setRaporHedefi({
                      type: "MESSAGE",
                      id: hedef.id,
                      label: `${activeName ?? "Kullanıcı"} kişisinin mesajı`,
                      neden: ReportReason.SCAM,
                    });
                  }
                : undefined
            }
          />
        )}
        {engelleAcik && egitmenOgrenciye && activeCounterpartyId !== null && (
          <EngelleModal
            clientId={activeCounterpartyId}
            ogrenciAdi={activeName ?? "Kullanıcı"}
            onKapat={() => setEngelleAcik(false)}
            onEngellendi={() =>
              setSelectedMeta((m) => (m ? { ...m, blocked: true } : m))
            }
          />
        )}

        {/* Right Context Panel */}
        {(() => {
          if (!messages) return null;
          const lastBookingMsg = [...messages].reverse().find((m) => m.msg_type === "booking_card");
          const activeBookingId = lastBookingMsg?.meta_data?.booking_id;
          if (!activeBookingId) return null;
          return <RightContextPanel bookingId={activeBookingId} />;
        })()}
      </div>
  );

  if (embedded) return body;
  return (
    /*
     * `mobilUstGizle` — telefonda üst bar ve panel şeridi çizilmez.
     *
     * Ölçülmüş kusur (11 Eyl 2026, kullanıcı: *"navbar falan gereksiz yer
     * kaplıyor"*): üst bar + şerit, 390px'lik bir ekranın tepesinden ~120px
     * alıyordu ve hemen altında sayfanın KENDİ "Mesajlar" başlığı geliyordu —
     * yani iki başlık, üst üste. Gezinme kaybolmuyor: alt sekme çubuğunda
     * "Mesajlar" sekmesi zaten var (`MobilAltSekmeler`). Referans (Airbnb,
     * 390px) da bu ekranda üst barı çizmiyor.
     *
     * Masaüstünde hiçbir şey değişmez; prop yalnız `<md` bandında iş yapar.
     * Kütüphane sonuç ekranıyla aynı sözleşme — bkz. `Libraries.tsx`.
     */
    <DashboardShell title="Mesajlar" navItems={navItems} flush mobilUstGizle>
      {body}
    </DashboardShell>
  );
}

// Tek mesaj satırı: balon (yanıt önizleme dahil) + reaksiyon çipleri + hover'da
// "yanıtla" ve emoji tepki aksiyonları.
function MessageRow({
  m,
  mine,
  highlighted,
  siteHost,
  onReply,
  onReact,
  onBaglanti,
  onBildir,
}: {
  m: MessageOut;
  mine: boolean;
  highlighted: boolean;
  siteHost: string;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /** Gövdedeki bağlantıya tıklandı; dış bağlantıda önce ara uyarı açılır. */
  onBaglanti: (href: string, dis: boolean) => void;
  onBildir: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactions = m.reactions ?? [];

  // ── Sistem mesajları (booking_card vb.) — özel render ──
  if (m.msg_type === "booking_card" && m.meta_data) {
    return (
      <div
        id={`msg-${m.id}`}
        className={`-mx-3 flex scroll-mt-6 justify-center rounded-xl px-3 py-2 ${
          highlighted ? "animate-highlight-row" : ""
        }`}
      >
        <BookingActionCard meta={m.meta_data} />
      </div>
    );
  }

  return (
    <div
      id={`msg-${m.id}`}
      className={`group -mx-3 flex scroll-mt-6 rounded-xl px-3 py-1 ${
        highlighted ? "animate-highlight-row" : ""
      } ${mine ? "justify-end" : "justify-start"}`}
    >
      <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            mine
              ? "bg-marka text-marka-fg"
              : "bg-white text-slate-700 ring-1 ring-slate-100 "
          }`}
        >
          {m.reply_preview && (
            <div
              className={`mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs ${
                mine
                  ? "border-white/60 bg-white/15 text-marka-fg"
                  : "border-marka-mid bg-slate-50 text-slate-500 "
              }`}
            >
              <span className="line-clamp-2 whitespace-pre-line">
                {m.reply_preview.body}
              </span>
            </div>
          )}
          <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">
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
                  className="break-all underline underline-offset-2"
                >
                  {p.deger}
                </a>
              )
            )}
          </p>
          <p
            className={`mt-1 text-[10px] ${
              mine ? "text-marka-fg" : "text-slate-400 "
            }`}
          >
            {formatDateTime(m.created_at)}
          </p>
        </div>

        {reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition ${
                  r.reacted
                    ? "bg-marka-line text-marka-metin-hover ring-1 ring-marka-focus "
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-semibold">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        <div
          className={`relative mt-1 flex items-center gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 ${
            mine ? "flex-row-reverse" : ""
          }`}
        >
          <button
            type="button"
            onClick={onReply}
            title="Yanıtla"
            aria-label="Yanıtla"
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 6 6v3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            title="Tepki ver"
            aria-label="Tepki ver"
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M9 9.75h.008v.008H9V9.75Zm6 0h.008v.008H15V9.75ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </button>
          {!mine && m.sender_role !== "SYSTEM" && (
            <button
              type="button"
              onClick={onBildir}
              title="Mesajı bildir"
              aria-label="Mesajı bildir"
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-red-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
              </svg>
            </button>
          )}
          {pickerOpen && (
            <div className="absolute bottom-full z-10 mb-1 flex gap-0.5 rounded-full bg-white p-1 shadow-lg ring-1 ring-slate-200 ">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(e);
                    setPickerOpen(false);
                  }}
                  className="rounded-full px-1.5 py-0.5 text-base transition hover:bg-slate-100 "
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Yazma alanının yerine geçen durum satırı (engel, ders öncesi sınır).
function YazmaKapali({
  metin,
  children,
}: {
  metin: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4"
    >
      <p className={KUCUK_ACIKLAMA}>{metin}</p>
      {children}
    </div>
  );
}

// Liste yükleme iskeleti (gözatma + arama ortak).
function ListSkeleton() {
  return (
    <div className="space-y-2 px-5 py-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-lg bg-slate-100"
        />
      ))}
    </div>
  );
}

// Arama sonuçlarındaki bölüm başlığı ("Sohbetler" / "Mesajlar").
function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
        {label}
      </span>
      {count !== undefined && (
        <span className="text-xs text-slate-400 ">
          {count} sonuç
        </span>
      )}
    </div>
  );
}

// Sohbet listesi satırı (gözatma + arama "Sohbetler" bölümü ortak).
function ConversationRow({
  c,
  role,
  active,
  onClick,
}: {
  c: ConversationOut;
  role: Role;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition ${
        active
          ? "bg-marka-soft "
          : "hover:bg-slate-50 "
      }`}
    >
      <Avatar
        name={c.counterparty_name ?? "?"}
        avatar_url={c.counterparty_avatar_url}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold leading-6 text-slate-900">
              {c.counterparty_name ?? "Kullanıcı"}
            </span>
            {/* Öğretmene: bu öğrenci henüz ders ayırtmadı (Modül 5). */}
            {role === "TUTOR" && c.stage === "INQUIRY" && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                Ders öncesi
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {formatChatTime(c.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          {/* `min-w-0`: flex öğesi içerik genişliğinin altına inmezse `truncate`
              "..." basamaz, metin kenarda kesik kalır (23 Eyl 2026). */}
          <p className="min-w-0 truncate text-sm text-slate-500 ">
            {c.last_message ?? "Yeni sohbet"}
          </p>
          {(c.unread ?? 0) > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-marka px-1.5 text-[10px] font-bold text-marka-fg">
              {(c.unread ?? 0) > 9 ? "9+" : c.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// Arama "Mesajlar" bölümünde tek eşleşen mesaj satırı (terim vurgulu).
// Tıklanınca sohbet açılır ve bu mesaja kaydırılıp işaretlenir.
function MessageHitRow({
  hit,
  term,
  active,
  onClick,
}: {
  hit: MessageSearchHit;
  term: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3.5 px-5 py-3 text-left transition ${
        active
          ? "bg-marka-soft "
          : "hover:bg-slate-50 "
      }`}
    >
      <Avatar
        name={hit.counterparty_name ?? "?"}
        avatar_url={hit.counterparty_avatar_url}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-base font-semibold leading-6 text-slate-900">
            {hit.counterparty_name ?? "Kullanıcı"}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {formatChatTime(hit.created_at)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500 ">
          {buildSnippet(hit.body, term).map((seg, i) =>
            seg.match ? (
              <mark
                key={i}
                className="rounded bg-marka-line px-0.5 font-medium text-marka-metin-hover "
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </p>
      </div>
    </button>
  );
}

// Boş durum: arşiv sekmesi. Ölçeği `EmptyInbox` ile AYNI — ikisi aynı yerde,
// aynı düğmeyle değişiyor; farklı boyutta olmaları geçişi zıplatıyordu.
function EmptyArchived() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-36 pt-6 text-center">
      {/* Fluent Emoji "Card file box" (3D) — kullanıcı kararı, 22 Eyl 2026. */}
      <img src="/icons/arsiv.png" alt="" aria-hidden className="h-36 w-36" />
      <p className={`mt-5 ${BOLUM_BASLIGI}`}>
        Arşiv boş
      </p>
      <p className={`mt-2 max-w-xs ${ACIKLAMA}`}>
        Arşivlediğin sohbetler burada görünür.
      </p>
    </div>
  );
}

/*
 * Boş durum: hiç sohbet yok.
 *
 * Eylem düğmesi YALNIZ üyede var: sohbeti o başlatır (bir eğitmen ilanından
 * "Mesaj Gönder"). Eğitmende ve operatörde karşılığı olan bir eylem yok —
 * mesaj onlara gelir — ve olmayan bir yere düğme koymak boş durumu
 * açıklamak yerine yanıltırdı.
 */
function EmptyInbox({ role }: { role: Role }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-36 pt-6 text-center">
      {/* Fluent Emoji "Person shrugging" (3D) — kullanıcı kararı, 22 Eyl 2026. */}
      <img src="/icons/omuz-silkme.png" alt="" aria-hidden className="h-36 w-36" />
      <p className={`mt-5 ${BOLUM_BASLIGI}`}>
        Henüz mesajın yok
      </p>
      <p className={`mt-2 max-w-xs ${ACIKLAMA}`}>
        {role === "CLIENT"
          ? "Bir öğretmenin ilanındaki “Mesaj Gönder” ile sohbet başlatabilirsin."
          : "Sana yazıldığında sohbetler burada görünür."}
      </p>
      {role === "CLIENT" && (
        <Link
          to={ROUTES.tutors}
          className={`mt-6 ${DUGME_BIRINCIL}`}
        >
          Öğretmenleri keşfet
        </Link>
      )}
    </div>
  );
}
