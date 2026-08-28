// Hasar olayları — dört işlem + append-only geçmiş.
//
// Geçmiş satırlarında GEÇMİŞ ZAMAN kullanılır ("Hasara ayrıldı"): buton "yap"
// der, kayıt "yapıldı" der. Aynı metni ikisinde de kullanmak, liste satırını
// tıklanabilir bir eylem gibi okutur.
//
// ## İP-A4 pilotu — göçün deseni burada belirlendi
//
// Bu ekran panelde TAMAMI göç eden ilk ekrandır. A6-A7'de 70 ekran bunun
// kopyası olacak; değişenler ve gerekçeleri:
//
//   1. **Pencere durumu ekranda YOK.** Eskiden `useState<DamageKind | null>`
//      vardı. Artık `useDuzenlemeYuzeyi` (`ui2/duzenlemeYuzeyi.tsx`): ekran
//      "modal açık mı" bilmez, yüzey açar. Rota tabanlı düzenleme yüzeylerine
//      (`/…/:id/duzenle`) geçilirse o dosyanın İÇİ değişir, bu ekran değişmez.
//   2. **Kirli form bekçisi ekranda yazılmaz.** Yüzeyin içinden bağlanır.
//   3. **Elle yazılmış tablo → ortak `DataTable`**, `renderMobileRow` ile.
//      Dokunmatik satırlar artık gerçek bir mobil düzen alıyor; ekran ortak
//      sayfalama/boş durum davranışını miras alıyor.
//   4. **Filtreler URL'de** (`useUrlDurumu`). Sayfa yenilenince filtre
//      kaybolmuyor, filtreli görünüm paylaşılabiliyor, geri tuşu çalışıyor.
//   5. **İki ayrı boş durum**: "filtre eşleşmedi" (çıkışı: filtreyi temizle)
//      ile "hiç kayıt yok" (çıkışı: ilk kaydı oluştur) aynı ekran değildir.
//
// ## Sıralama: bu uçta sunucu tarafında YOK (bilinçli)
//
// `GET /inventory/damage-events` yalnız `product_id/limit/offset` alır ve
// daima `id DESC` döner (`services/inventory_damage.py::list_damage_events`).
// `DataTable`'ın sıralaması bu yüzden AÇILMADI: sayfalanmış bir listede
// istemci tarafında sıralamak, kullanıcıya yalnız GÖRÜNEN 25 satırı sıralayıp
// "sıraladım" demektir — yanlış veriyi doğru gibi gösterir. Sunucu bir
// `sort` parametresi kazanırsa kolonlara `enableSorting` açılır; borç
// raporda (İP-A4 → Bilinen sınırlar).
import { useMemo, useState } from "react";

import { DamageDialog } from "@/components/admin/inventory/DamageDialog";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useCreateDamageEvent, useDamageEvents } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import {
  DAMAGE_KINDS,
  bucketLabel,
  damageKindPastLabel,
  damageReasonLabel,
  inventoryErrorMessage,
  type DamageKind,
} from "@/lib/inventory";

import type { DamageEventOut, DamagePayload } from "@/api/inventory";
import type { ColumnDef } from "@tanstack/react-table";

const ZAMAN = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function DamageEventsPage() {
  const { canApply } = useInventoryAccess();

  // Filtre + sayfalama URL'de. `sayfa`/`boyut` filtre SAYILMAZ: 2. sayfada
  // olmak boş durumun metnini değiştirmemeli.
  const { degerler, ayarla, temizle, filtreliMi } = useUrlDurumu(
    { urun: "", sayfa: 1, boyut: 25 },
    { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa", "boyut"] }
  );
  const { urun, sayfa, boyut } = degerler;

  // Pencere durumu EKRANDA DEĞİL: yüzey tutar. "Yeni"nin bağlamı hangi
  // işlemin açıldığıdır; düzenlenen bir kayıt yoktur (hasar olayı
  // append-only'dir, güncellenemez).
  const yuzey = useDuzenlemeYuzeyi<never, DamageKind>();

  // HAM hata (İP-A3a). Metne çevirme işi `DamageDialog`'a taşındı: 422'nin
  // `loc` bilgisi burada metne indirgenirse alan bilgisi kaybolur ve mesaj
  // mecburen genel şeride düşer. Diyalog hem alanlara dağıtır hem alana
  // düşmeyeni envanter sözlüğüyle metne çevirir.
  const [formHatasi, setFormHatasi] = useState<unknown>(null);
  const [sonuc, setSonuc] = useState<string | null>(null);

  const urunNo = Number(urun) > 0 ? Number(urun) : undefined;
  const sorgu = useDamageEvents({
    product_id: urunNo,
    limit: boyut,
    offset: (sayfa - 1) * boyut,
  });
  const olustur = useCreateDamageEvent();

  const olaylar = sorgu.data?.items ?? [];
  const toplam = sorgu.data?.total ?? 0;

  const gonder = (payload: DamagePayload) => {
    setFormHatasi(null);
    olustur.mutate(payload, {
      onSuccess: (r) => {
        setSonuc(
          r.replayed
            ? "Bu işlem zaten işlenmişti — aynı anahtarla ikinci kez uygulanmadı, stok değişmedi."
            : `Hasar kaydı alındı: ${damageKindPastLabel(payload.kind)}, ürün #${payload.product_id}, ${payload.qty} adet.`
        );
        // KOŞULSUZ kapatma: veri kaydedildi, bekçiye soracak bir şey yok.
        yuzey.kapat();
      },
      onError: (e) => setFormHatasi(e),
    });
  };

  const kolonlar = useMemo<ColumnDef<DamageEventOut, unknown>[]>(
    () => [
      {
        id: "islem",
        header: "İşlem",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium text-slate-900 ">
            {damageKindPastLabel(row.original.kind)}
          </span>
        ),
      },
      {
        id: "urun",
        header: "Ürün",
        enableSorting: false,
        cell: ({ row }) => `Ürün #${row.original.product_id}`,
      },
      {
        id: "miktar",
        header: "Miktar",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-slate-900 ">
            {row.original.qty}
          </span>
        ),
      },
      {
        id: "kova",
        header: "Kaynak kova",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={row.original.source_bucket === "DAMAGED" ? "warning" : "neutral"}>
            {bucketLabel(row.original.source_bucket)}
          </Badge>
        ),
      },
      {
        id: "neden",
        header: "Neden",
        enableSorting: false,
        cell: ({ row }) => (
          <>
            {damageReasonLabel(row.original.reason_code)}
            {row.original.note && (
              <span className="block text-xs text-slate-500 ">
                {row.original.note}
              </span>
            )}
          </>
        ),
      },
      {
        id: "yapan",
        header: "Yapan",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-slate-500 ">
            #{row.original.actor_admin_id}
          </span>
        ),
      },
      {
        id: "zaman",
        header: "Zaman",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-slate-500 ">
            {ZAMAN.format(new Date(row.original.created_at))}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 ">
        <h2 className="text-base font-bold text-slate-900 ">Hasar işlemleri</h2>
        <p className="mt-0.5 text-xs text-slate-500 ">
          Her işlem stok defterine yazılır ve geri alınamaz bir kayıt bırakır.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAMAGE_KINDS.map((k) =>
            canApply ? (
              <Button
                key={k.value}
                size="sm"
                variant={k.value === "DISPOSAL" || k.value === "SUPPLIER_RETURN" ? "secondary" : "primary"}
                onClick={() => {
                  setFormHatasi(null);
                  setSonuc(null);
                  yuzey.yeniAc(k.value);
                }}
              >
                {k.label}
              </Button>
            ) : (
              <span
                key={k.value}
                className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-400 "
              >
                {k.label}
              </span>
            )
          )}
        </div>
        {!canApply && (
          <p className="mt-2 text-xs text-slate-500 ">
            İşlem başlatmak için rolünüzde <code>inventory.apply</code> izni bulunmalı.
          </p>
        )}
        {sonuc && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 "
          >
            {sonuc}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-bold text-slate-900 ">Geçmiş</h2>
            <p className="mt-0.5 text-xs text-slate-500 ">
              Kayıtlar değiştirilemez; yanlış işlem ters yönde yeni bir kayıtla düzeltilir.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 ">
              Ürün numarasına göre
            </span>
            <input
              className="input w-28"
              inputMode="numeric"
              value={urun}
              /* Serbest metin: her tuş vuruşu ayrı geçmiş girdisi ÜRETMEZ
                 (`replace`). Ayrık filtreler `push` kalır. */
              onChange={(e) => ayarla({ urun: e.target.value }, { replace: true })}
            />
          </label>
          {filtreliMi && (
            <Button size="sm" variant="secondary" onClick={temizle}>
              Filtreyi temizle
            </Button>
          )}
        </div>

        {sorgu.isError ? (
          <ErrorState
            description={inventoryErrorMessage(sorgu.error, "Hasar olayları yüklenemedi.")}
            onRetry={() => sorgu.refetch()}
          />
        ) : (
          <DataTable
            columns={kolonlar}
            data={olaylar}
            getRowId={(olay) => String(olay.id)}
            isLoading={sorgu.isLoading}
            /* "Filtre eşleşmedi" ile "hiç kayıt yok" AYRI ekranlardır: ilki
               bir düzeltme talimatı, ikincisi bir davet. Aynı metni ikisinde
               de göstermek kullanıcıyı "kayıtlar kayboldu" sanısına sürükler. */
            emptyTitle={filtreliMi ? "Bu filtreyle kayıt bulunamadı" : "Hasar kaydı yok"}
            emptyDescription={
              filtreliMi
                ? `Ürün #${urun} için hasar kaydı bulunmuyor. Filtreyi temizleyip tüm geçmişe bakabilirsiniz.`
                : "Kırık, ıslak ya da baskı hatalı ürünleri hasarlı rafa ayırdığınızda burada listelenir."
            }
            emptyAction={
              filtreliMi ? (
                <Button size="sm" variant="secondary" onClick={temizle}>
                  Filtreyi temizle
                </Button>
              ) : canApply ? (
                <Button size="sm" onClick={() => yuzey.yeniAc("TRANSFER")}>
                  İlk kaydı oluştur
                </Button>
              ) : undefined
            }
            /* Dokunmatik: mobilde satır aksiyonu değil, okunabilir bir kart.
               Bu desen kod tabanında vardı ama hiçbir ekranda kullanılmıyordu;
               pilot onu kullanıma sokan ekran. */
            renderMobileRow={(olay) => (
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-900 ">
                    {damageKindPastLabel(olay.kind)}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-slate-900 ">
                    {olay.qty} adet
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 ">
                  Ürün #{olay.product_id} · {bucketLabel(olay.source_bucket)} ·{" "}
                  {damageReasonLabel(olay.reason_code)}
                </p>
                {olay.note && (
                  <p className="mt-1 text-xs text-slate-500 ">{olay.note}</p>
                )}
                <p className="mt-1 text-xs tabular-nums text-slate-400 ">
                  {ZAMAN.format(new Date(olay.created_at))} · #{olay.actor_admin_id}
                </p>
              </div>
            )}
            page={sayfa}
            pageSize={boyut}
            total={toplam}
            onPageChange={(p) => ayarla({ sayfa: p })}
            onPageSizeChange={(b) => ayarla({ boyut: b })}
          />
        )}
      </section>

      <DamageDialog
        yuzey={yuzey}
        isPending={olustur.isPending}
        error={formHatasi}
        onSubmit={gonder}
      />
    </div>
  );
}
