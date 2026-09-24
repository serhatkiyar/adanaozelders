import { useId, useState, type FormEvent } from "react";

import { Icon } from "@/components/AppIcon";
import { KUCUK_ACIKLAMA } from "@/components/pano/stil";
import {
  useCreateMessageTemplate,
  useDeleteMessageTemplate,
  useMessageTemplates,
} from "@/hooks/useMessages";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Sabit varsayılan şablonlar — gerçek bir API çağrısı DEĞİL, yalnız frontend
 * sabiti (ilk kullanımda boş liste kullanıcıya faydasız görünmesin diye).
 * Kullanıcının kendi kaydettiği şablonlar `useMessageTemplates()` ile gerçek
 * API'den gelir, ayrı bir bölümde listelenir ve silinebilir — bu ikisi aynı
 * kaynaktan gelmiyor; ileride biri bu sabit listeyi de veritabanına taşınması
 * gereken veri sanmasın.
 */
const VARSAYILAN_SABLONLAR: { title: string; body: string }[] = [
  {
    title: "Deneme dersi öncesi karşılama",
    body: "Merhaba! Yarınki deneme dersimiz için heyecanlıyım. Ders öncesinde seninle tanışmak ve hedeflerini biraz daha netleştirmek isterim — uygun olduğunda birkaç satırla anlatır mısın?",
  },
  {
    title: "Deneme dersi sonrası teşekkür",
    body: "Bugünkü dersimiz için teşekkür ederim! Umarım verimli geçmiştir. Devam etmek istersen sıradaki adımları birlikte planlayabiliriz, aklına takılan bir şey olursa buradan yazabilirsin.",
  },
  {
    title: "Ders hatırlatma",
    body: "Merhaba, yaklaşan dersimizi hatırlatmak istedim. Saatte görüşmek üzere — bir engelin olursa lütfen önceden haber ver.",
  },
  {
    title: "Ödev hatırlatma",
    body: "Merhaba, geçen derste konuştuğumuz ödevi hatırlatmak istedim. Zaman ayırabildiysen ders öncesinde buradan paylaşabilirsin.",
  },
];

const BASLIK_UST_SINIR = 80;
const GOVDE_UST_SINIR = 4000;

/**
 * Eğitmenin hazır mesaj şablonları — composer'ın yanındaki düğmeden açılır.
 * Seçilince metin composer'a BASILIR, otomatik gönderilmez (kullanıcı önce
 * düzenleyip sonra göndermeli). Yalnız TUTOR rolünde kullanılır (çağıran
 * bunu `role === "TUTOR"` koşuluyla render eder).
 */
export function SablonPaneli({
  onSec,
}: {
  /** Seçilen şablon metnini composer'a basar. */
  onSec: (body: string) => void;
}) {
  const [acik, setAcik] = useState(false);
  const [yeniAcik, setYeniAcik] = useState(false);
  const [baslik, setBaslik] = useState("");
  const [govde, setGovde] = useState("");
  // Eksik alan basınca ALANIN altında yazılır; "Kaydet" geçerlilikle kapanmaz
  // (`__guards__/gonderDugmesi.test.ts` kilitli kararı, 24 Eyl 2026).
  const [hata, setHata] = useState<{ baslik?: string; govde?: string }>({});
  const baslikHataId = useId();
  const govdeHataId = useId();

  const { data: sablonlar, isLoading } = useMessageTemplates();
  const olustur = useCreateMessageTemplate();
  const sil = useDeleteMessageTemplate();

  const sec = (body: string) => {
    onSec(body);
    setAcik(false);
  };

  const kaydet = (e: FormEvent) => {
    e.preventDefault();
    const temizBaslik = baslik.trim();
    const temizGovde = govde.trim();
    const yeniHata: typeof hata = {};
    if (!temizBaslik) yeniHata.baslik = "Şablon başlığı yaz.";
    if (!temizGovde) yeniHata.govde = "Mesaj metni yaz.";
    setHata(yeniHata);
    if (yeniHata.baslik || yeniHata.govde) return;
    olustur.mutate(
      { title: temizBaslik, body: temizGovde },
      {
        onSuccess: () => {
          setBaslik("");
          setGovde("");
          setHata({});
          setYeniAcik(false);
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Şablon kaydedilemedi.")),
      }
    );
  };

  return (
    <div className="relative shrink-0">
      {/* Composer'ın araç satırındaki bir simge (kullanıcı kararı, 22 Eyl
          2026 — birleşik kutu tasarımı): kendi çerçevesi/kutusu YOK, yalnız
          hover'da zemin. Öncesinde ayrı bordürlü bir kutuydu; artık yazı
          alanıyla AYNI çerçevenin içindeki araç satırında yaşıyor. */}
      <button
        type="button"
        onClick={() => setAcik((o) => !o)}
        title="Hazır mesaj şablonları"
        aria-label="Hazır mesaj şablonları"
        aria-expanded={acik}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-slate-100 "
      >
        {/* Fluent System "Document One Page" (Regular) — uygulama ikon seti
            (AppIcon); kullanıcı kararı, 23 Eyl 2026 (önceki: Fluent UI Emoji
            "Bookmark tabs" statik dosyası). */}
        <Icon name="documentOnePage" className="h-5 w-5 text-slate-800" />
      </button>

      {acik && (
        <div className="absolute bottom-full left-0 z-10 mb-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg ">
          <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Hazır mesajlar
          </p>
          <ul className="space-y-1">
            {VARSAYILAN_SABLONLAR.map((s) => (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => sec(s.body)}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  <span className="block font-medium text-slate-900">
                    {s.title}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {s.body}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-3 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Kendi şablonlarım
          </p>
          {isLoading ? (
            <p className={`${KUCUK_ACIKLAMA} px-1`}>Yükleniyor…</p>
          ) : sablonlar && sablonlar.length > 0 ? (
            <ul className="space-y-1">
              {sablonlar.map((s) => (
                <li key={s.id} className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => sec(s.body)}
                    className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="block font-medium text-slate-900">
                      {s.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {s.body}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sil.mutate(s.id)}
                    aria-label={`${s.title} şablonunu sil`}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-red-700"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${KUCUK_ACIKLAMA} px-1`}>Henüz şablon eklemedin.</p>
          )}

          {yeniAcik ? (
            <form
              onSubmit={kaydet}
              noValidate
              className="mt-3 space-y-2 border-t border-slate-200 pt-3"
            >
              <input
                value={baslik}
                onChange={(e) => {
                  setBaslik(e.target.value);
                  setHata((h) => ({ ...h, baslik: undefined }));
                }}
                maxLength={BASLIK_UST_SINIR}
                placeholder="Şablon başlığı"
                aria-label="Şablon başlığı"
                aria-invalid={hata.baslik ? true : undefined}
                aria-describedby={hata.baslik ? baslikHataId : undefined}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20"
              />
              {hata.baslik && (
                <p id={baslikHataId} role="alert" className="text-xs text-red-700">
                  {hata.baslik}
                </p>
              )}
              <textarea
                value={govde}
                onChange={(e) => {
                  setGovde(e.target.value);
                  setHata((h) => ({ ...h, govde: undefined }));
                }}
                maxLength={GOVDE_UST_SINIR}
                rows={3}
                placeholder="Mesaj metni"
                aria-label="Mesaj metni"
                aria-invalid={hata.govde ? true : undefined}
                aria-describedby={hata.govde ? govdeHataId : undefined}
                className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20"
              />
              {hata.govde && (
                <p id={govdeHataId} role="alert" className="text-xs text-red-700">
                  {hata.govde}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setHata({});
                    setYeniAcik(false);
                  }}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={olustur.isPending}
                  className="rounded-lg bg-marka px-3 py-1 text-xs font-semibold text-marka-fg hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {olustur.isPending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setYeniAcik(true)}
              className="mt-3 w-full border-t border-slate-200 pt-3 text-left text-sm font-semibold text-marka-metin hover:text-marka-metin-hover"
            >
              + Yeni şablon ekle
            </button>
          )}
        </div>
      )}
    </div>
  );
}
