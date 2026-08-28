import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, ErrorState } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { formatTL, parseMoney } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import {
  useCreatePayout,
  usePayoutHistory,
  usePendingPayouts,
} from "@/hooks/usePayouts";
import type { PayeeBalance } from "@/api/payouts";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Hakediş defteri — "kime ne kadar ödeyeceğim".
 *
 * Platform, eğitmen ve kütüphaneler adına para tahsil ediyor ama onlara ödeme
 * yapan otomatik bir mekanizma yok (iyzico alt üye işyeri kapalı; banka sanal
 * POS'larında zaten yoktur). Ödeme bankadan ELLE yapılır, burada kaydı tutulur.
 *
 * Emanetteki tutar ayrı gösterilir: ders henüz yapılmadığı için borç değildir.
 */
export default function AdminPayoutsPage() {
  // Sekme bir FİLTREDİR: adreste yaşar ("filtreler URL'de" kilitli kararı).
  // `useState`teyken paylaşılan bağlantı hep "ödenecekler"e düşüyordu ve geri
  // tuşu sekme değişimini görmüyordu.
  const url = useUrlDurumu({ sekme: "odenecekler" });
  const tab = url.degerler.sekme === "gecmis" ? "gecmis" : "odenecekler";
  // Pencere durumu ekranda yaşamaz.
  const odeme = useDuzenlemeYuzeyi<PayeeBalance, void>();

  return (
    // Başlık ve açıklama `AdminPageHeader` tarafından basılır (nav öğesinin
    // label + description alanlarından). Sayfa kendi <h1>'ini basmaz — aksi
    // halde ekranda iki <h1> olur ve belge başlık hiyerarşisi bozulur.
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-slate-200 ">
        {/* Sekme şeridi ORTAK `Button`a çevrilmedi ve bu bilinçlidir:
            bunlar bir aksiyon değil, bir SEÇİM DURUMU (`aria-pressed`) ve alt
            çizgi göstergesi ortak düğmenin dolgu/gölge varyantlarıyla
            çizilemez. `AdminStore`daki `KatlanirBaslik` ve kütüphane
            editöründeki olanak rozetleriyle aynı istisna. */}
        {(
          [
            ["odenecekler", "Ödenecekler"],
            ["gecmis", "Ödeme geçmişi"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => url.ayarla({ sekme: key })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-panel-accent text-panel-accent"
                : "border-transparent text-slate-500 hover:text-slate-800 "
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "odenecekler" ? <PendingList onPay={odeme.ac} /> : <HistoryList />}

      <PayPenceresi yuzey={odeme} />
    </div>
  );
}

function PendingList({ onPay }: { onPay: (b: PayeeBalance) => void }) {
  const { data, isLoading, isError, refetch } = usePendingPayouts(true);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  }
  if (isError) {
    // Ortak `ErrorState`: aynı ekranın iki listesi iki farklı hata yüzeyi
    // çiziyordu ve "Tekrar dene" ile "Yeniden dene" iki ayrı addı.
    return (
      <ErrorState
        description="Ödenecekler listesi alınamadı. Listenin boş olduğu anlamına gelmez."
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center ">
        <p className="text-sm text-slate-500 ">
          Ödenmemiş hakediş yok.
        </p>
      </div>
    );
  }

  const toplam = data.reduce((s, b) => s + (parseMoney(b.balance) ?? 0), 0);

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600 ">
        Toplam ödenecek: <strong>{formatTL(toplam)}</strong> · {data.length} alıcı
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 ">
              <th className="py-2 pr-4 font-medium">Alıcı</th>
              <th className="py-2 pr-4 font-medium">IBAN</th>
              <th className="py-2 pr-4 text-right font-medium">Hak edilen</th>
              <th className="py-2 pr-4 text-right font-medium">Ödenen</th>
              <th className="py-2 pr-4 text-right font-medium">Bakiye</th>
              <th className="py-2 pr-4 text-right font-medium">Emanette</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 ">
            {data.map((b) => (
              <tr key={`${b.payee_type}-${b.payee_id}`}>
                <td className="py-3 pr-4">
                  <span className="font-medium text-slate-800 ">
                    {b.name}
                  </span>
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 ">
                    {b.payee_type === "TUTOR" ? "Eğitmen" : "Kütüphane"}
                  </span>
                </td>
                <td className="py-3 pr-4 font-mono text-xs text-slate-500 ">
                  {b.iban ?? (
                    <span className="text-amber-600 ">
                      IBAN yok
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right text-slate-600 ">
                  {formatTL(b.earned)}
                </td>
                <td className="py-3 pr-4 text-right text-slate-500 ">
                  {formatTL(b.paid)}
                </td>
                <td className="py-3 pr-4 text-right font-semibold text-slate-900 ">
                  {formatTL(b.balance)}
                </td>
                <td className="py-3 pr-4 text-right text-slate-400 ">
                  {formatTL(b.pending)}
                </td>
                <td className="py-3 text-right">
                  <Button size="sm" onClick={() => onPay(b)}>
                    Ödedim
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400 ">
        “Emanette” sütunu henüz hak edilmemiş tutardır (ders yapılmadı / katılım
        doğrulanmadı) — borç değildir, iade edilebilir.
      </p>
    </div>
  );
}

function HistoryList() {
  const { data, isLoading, isError, error, refetch } = usePayoutHistory();

  if (isLoading) return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  // P1-6: hata "Henüz ödeme kaydı yok." diye gösterilemez — bu bir PARA
  // ekranıdır; yönetici geçmişi boş sanıp aynı havaleyi ikinci kez yapabilir.
  // (`PendingList` bu kontrolü zaten yapıyordu; geçmiş listesi atlanmıştı.)
  if (isError) {
    return (
      <ErrorState
        description={getErrorMessage(error, "Ödeme geçmişi yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center ">
        <p className="text-sm text-slate-500 ">
          Henüz ödeme kaydı yok.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 ">
            <th className="py-2 pr-4 font-medium">Tarih</th>
            <th className="py-2 pr-4 font-medium">Alıcı</th>
            <th className="py-2 pr-4 text-right font-medium">Tutar</th>
            <th className="py-2 pr-4 font-medium">Referans</th>
            <th className="py-2 font-medium">IBAN (o anki)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 ">
          {data.map((r) => (
            <tr key={r.id}>
              <td className="py-3 pr-4 text-slate-600 ">
                {formatDate(r.paid_at)}
              </td>
              <td className="py-3 pr-4 text-slate-600 ">
                {r.payee_type === "TUTOR" ? "Eğitmen" : "Kütüphane"} #{r.payee_id}
              </td>
              <td className="py-3 pr-4 text-right font-medium text-slate-900 ">
                {formatTL(r.amount)}
              </td>
              <td className="py-3 pr-4 text-slate-500 ">
                {r.reference ?? "—"}
              </td>
              <td className="py-3 font-mono text-xs text-slate-400 ">
                {r.iban_snapshot ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Ödeme kaydı penceresi — DIŞ kabuk (İP-A7d2 · Görev 4).
 *
 * Nöbetçinin üçüncü ve son etiketsiz overlay'i buydu. Bir PARA ekranı olması
 * kirli form korumasını sıradan bir konfor olmaktan çıkarır: yönetici dekont
 * referansını yazıp yanlışlıkla dışarı tıklarsa, kaydı yeniden bulup yazması
 * gerekir ve bu sırada aynı havaleyi iki kez kaydetme riski doğar.
 */
function PayPenceresi({ yuzey }: { yuzey: DuzenlemeYuzeyiDurumu<PayeeBalance, void> }) {
  const bakiye = yuzey.kayit;
  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik={bakiye ? `Ödeme kaydı — ${bakiye.name}` : "Ödeme kaydı"}
      aciklama="Havaleyi bankadan yaptıktan sonra buraya kaydedin."
    >
      {bakiye && <PayIcerik yuzey={yuzey} balance={bakiye} />}
    </DuzenlemePenceresi>
  );
}

/**
 * Tutar şeması bakiyeye BAĞLIDIR: üst sınır alıcıya göre değişir.
 *
 * Eskiden bu kural düğmeyi kapatıyordu (`disabled={gecersiz}`) ve kilitli
 * kararın açık ihlaliydi: kullanıcı düğmeye basamadığında sebebini
 * göremiyordu. Artık basılır, gönderim yapılmaz, hata TUTAR alanında çıkar.
 */
function odemeSemasi(enFazla: number, enFazlaMetin: string) {
  return z.object({
    amount: z
      .string()
      .refine((v) => v.trim() !== "", "Tutar gerekli.")
      .refine((v) => Number.isFinite(Number(v)), "Tutar bir sayı olmalı.")
      .refine((v) => Number(v) > 0, "Tutar sıfırdan büyük olmalı.")
      .refine((v) => Number(v) <= enFazla, `Tutar en fazla ${enFazlaMetin} olabilir.`),
    reference: z.string().max(120, "Referans en fazla 120 karakter olabilir."),
    note: z.string().max(1000, "Not en fazla 1000 karakter olabilir."),
  });
}

type OdemeFormDegerleri = z.infer<ReturnType<typeof odemeSemasi>>;

const ODEME_SIRA = ["amount", "reference", "note"] as const;

function PayIcerik({
  yuzey,
  balance,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<PayeeBalance, void>;
  balance: PayeeBalance;
}) {
  const create = useCreatePayout();
  const max = parseMoney(balance.balance) ?? 0;

  const form = useForm<OdemeFormDegerleri>({
    resolver: zodResolver(odemeSemasi(max, formatTL(balance.balance))),
    defaultValues: { amount: balance.balance, reference: "", note: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error });

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      create.mutate(
        {
          payee_type: balance.payee_type,
          payee_id: balance.payee_id,
          amount: deger.amount,
          reference: deger.reference.trim() || null,
          note: deger.note.trim() || null,
        },
        {
          onSuccess: () => {
            toast.success("Ödeme kaydedildi.");
            yuzey.kapat();
          },
          onError: (hata) => {
            const kalan = sunucuHatasiniUygula(hata, form, [...ODEME_SIRA]);
            form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
          },
        }
      );
    },
    (hatalar) => {
      const alan = ODEME_SIRA.find((a) => hatalar[a]);
      if (alan) form.setFocus(alan);
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 ">
        Ödenmemiş bakiye: <strong>{formatTL(balance.balance)}</strong>
      </p>
      {balance.iban ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 ">
          {balance.iban}
        </p>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ">
          Bu alıcının IBAN&apos;ı kayıtlı değil; ödemeden önce kendisinden isteyin.
        </p>
      )}

      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 "
        >
          {genelHata}
        </p>
      )}

      <Form.Field
        control={form.control}
        name="amount"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Tutar (TL)</Form.Label>
            <Form.Control>
              <input type="number" step="0.01" min="0.01" className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="reference"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Havale referansı</Form.Label>
            <Form.Control>
              <input
                maxLength={120}
                placeholder="Dekonttaki referans no"
                className="input"
                {...field}
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="note"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Not</Form.Label>
            <Form.Control>
              <textarea rows={2} maxLength={1000} className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <div className="flex justify-end pt-1">
        <Button isPending={create.isPending} onClick={gonder}>
          Ödemeyi kaydet
        </Button>
      </div>
    </div>
  );
}
