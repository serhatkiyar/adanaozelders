import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import { type ReactNode } from "react";
import { Button, EmptyState, PageSkeleton } from "@/components/admin/ui";

/**
 * ── İP-A7d1 · Görev 1: satır tıklaması ↔ satır aksiyonu çakışması ──
 *
 * Denetim #2 gerçek tarayıcıda ölçtü: `onRowClick` verildiğinde mobil kart
 * bütünüyle tek bir `<button>`a sarılıyordu. İç içe `<button>` GEÇERSİZ
 * HTML'dir; yani kartın içine ikinci bir aksiyon konulamıyordu. Kilitli
 * kararımız ise "satır aksiyonları açık düğme kalır, üç nokta menüye
 * geçilmez". İkisi bir arada mümkün değildi — bu bir kusur değil, çözülmesi
 * gereken bir ÇELİŞKİYDİ.
 *
 * ### Seçenekler ve seçilen
 *
 * 1. *Mobilde satır tıklamasını bırak* — reddedildi: aynı listede masaüstünde
 *    tıklanan bir satır mobilde tıklanamaz olur; kullanıcı aynı ekranın iki
 *    farklı davranışını öğrenmek zorunda kalır.
 * 3. *Aksiyonları kart altına ayrı bir şeride al* — reddedildi: aksiyonların
 *    hangi kayda ait olduğu görsel bir yakınlık meselesidir; ayrı şerit bunu
 *    zayıflatır ve kart yüksekliğini her satırda büyütür.
 * 2. **Kartı `<button>`a SARMA; tıklanabilir alanı kart içinde bir katmana
 *    indir — SEÇİLEN.**
 *
 * ### Nasıl çözüldü (ekran başına değil, burada)
 *
 * Kart artık bir `<div>`; tıklama kabın kendisinde dinlenir. Kabın içine,
 * içeriğin ALTINDA (`z-0`) duran bir "satırı aç" düğmesi serilir: bu düğme
 * klavye ve ekran okuyucu için vardır — odak halkasını o taşır, erişilebilir
 * adını çağırandan alır. Fare tıklaması için tek kural yeterli: **etkileşimli
 * bir öğeden gelen tıklama satırı açmaz.**
 *
 * ── İP-B2: DataTable v2 (liste sayfası anatomisi) ──
 *
 * Üç değişiklik, üçü de ekranların TEKRARLADIĞI kararları buraya alıyor:
 *
 *   1. **Çerçeve her hâlde durur.** Eski hâl boş listede `EmptyState`i
 *      tablonun YERİNE basıyordu: liste çerçevesi kayboluyor, ekran "veri
 *      alanı buradaydı" bilgisini de kaybediyordu. Artık iskelet de, boş
 *      durum da çerçevenin İÇİNDE. (Medusa'nın davranışı da budur.)
 *   2. **İki ayrı boş durum tip düzeyinde ayrıldı** (`bos` propu). Eski
 *      `emptyTitle`/`emptyDescription`/`emptyAction` üçlüsü hâlâ geçerli ve
 *      12 ekran onu kullanıyor — ama YENİ çağrı yeri ikisini birden vermek
 *      zorunda: hangisinin gösterileceğine `filtreli` bayrağına bakarak
 *      BİLEŞEN karar verir, ekran değil. Gerekçe: "kayıt yok" ile "sonuç yok"
 *      ayrımı ekran başına verildiğinde 22 ekranda 22 kez unutulabilir; bir
 *      kez unutulduğunda kullanıcı katalogun boşaldığını sanır.
 *   3. **Renkler token'a geçti** (Ç-3). `slate-*`/`indigo-*` çiftleri
 *      `panel-*` token'larıyla değişti; `dark:` ikizleri SİLİNDİ — her biri
 *      unutulabilecek ikinci bir yazımdı.
 *
 * Sıralama, sayfalama ve `manualSorting` sözleşmesi DEĞİŞMEDİ.
 */
const ETKILESIMLI = 'a[href], button, input, select, textarea, [role="button"], [contenteditable="true"]';

/**
 * Olayın kaynağı kartın/satırın kendi denetimlerinden biri mi.
 *
 * `closest` kullanılır: tıklama düğmenin İÇİNDEKİ bir `<span>`e de gelebilir.
 * "Satırı aç" katmanı kasten hariç tutulmaz — o katmana gelen tıklama zaten
 * kendi `onClick`inde ele alınır ve burada ikinci kez sayılmamalıdır.
 */
function etkilesimliKaynak(hedef: EventTarget | null): boolean {
  return hedef instanceof Element && hedef.closest(ETKILESIMLI) !== null;
}

/**
 * İki ayrı boş durum — İP-B2.
 *
 * `filtreli` bayrağı ÇAĞIRANDAN gelir çünkü "listeyi daraltan bir seçim var
 * mı" sorusunun cevabını yalnız ekran bilir (hangi parametreler filtre
 * sayılıyor). Ama hangi metnin basılacağına bileşen karar verir.
 */
export interface BosDurumlar {
  filtreli: boolean;
  /** Hiç kayıt yokken — yaratma daveti. */
  kayitYok: ReactNode;
  /** Filtre eşleşmediğinde — filtreyi gevşetme talimatı. */
  sonucYok: ReactNode;
}

export interface DataTableProps<TData extends object> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  isLoading?: boolean;
  /**
   * Tavana dayanmış liste uyarısı ("ilk N kayıt gösteriliyor").
   *
   * Sayfalaması olan listede VERİLMEZ — orada zaten toplam sayı görünüyor ve
   * uyarı yanıltıcı olur.
   */
  truncationNotice?: ReactNode;
  onRowClick?: (row: TData) => void;
  /**
   * Satırın KENDİ adı — "satırı aç" denetiminin erişilebilir adı (İP-A7d2 · SK-5).
   *
   * A7d1 bu adı kartın TÜM içeriğinden (`aria-labelledby`) alıyordu ve kartın
   * içinde aksiyon düğmesi olduğu anda ekran okuyucu tek düğmeyi
   * `"PKT-000077 … Yeniden paketle Bozuldu olarak işaretle"` diye okuyordu;
   * ayrıca aynı ada sahip İKİ denetim doğuyordu. Ad artık çağırandan gelir ve
   * `onRowClick` verildiğinde TİP DÜZEYİNDE zorunludur (aşağıdaki birleşim).
   */
  satirAdi?: (row: TData) => string;
  renderMobileRow?: (row: TData) => ReactNode;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * Boş durum sözleşmesi: ESKİ üçlü ya da YENİ ikili — ikisi birden değil.
 *
 * `never` alanları bilinçli: ikisini karıştıran bir çağrı yeri tip hatası
 * verir. Eski üçlü A7'de göç etmiş 12 ekranı taşıyor ve bu pakette
 * DOKUNULMUYOR; yeni ikili B2'den itibaren yazılan her liste için zorunlu.
 */
export type DataTableBosDurumu =
  | {
      emptyTitle: string;
      emptyDescription?: string;
      emptyAction?: ReactNode;
      bos?: undefined;
    }
  | {
      bos: BosDurumlar;
      emptyTitle?: undefined;
      emptyDescription?: undefined;
      emptyAction?: undefined;
    };

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  return (
    <span aria-hidden="true" className="ml-1 inline-flex w-3 justify-center text-[10px] text-panel-fg-subtle">
      {direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}
    </span>
  );
}

/**
 * Satır tıklaması varsa satır ADI da vardır — tip düzeyinde bağlı iki prop.
 *
 * Ayrı iki isteğe bağlı prop yazmak, `satirAdi`yı yazmayı unutmayı serbest
 * bırakırdı ve unutulduğunda ortaya çıkan hata SESSİZDİR (yalnız ekran
 * okuyucuda ve otomasyonda görünür). A3c'den beri seçilen yol aynı: sessiz
 * varsayılan yerine açık beyan.
 */
export type DataTableSatirTiklamasi<TData> =
  | { onRowClick: (row: TData) => void; satirAdi: (row: TData) => string }
  | { onRowClick?: undefined; satirAdi?: undefined };

export function DataTable<TData extends object>({
  columns,
  data,
  getRowId,
  sorting = [],
  onSortingChange,
  isLoading = false,
  emptyTitle,
  emptyDescription,
  emptyAction,
  bos,
  truncationNotice,
  onRowClick,
  satirAdi,
  renderMobileRow,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: Omit<DataTableProps<TData>, "onRowClick" | "satirAdi"> &
  DataTableSatirTiklamasi<TData> &
  DataTableBosDurumu) {
  const table = useReactTable({
    columns,
    data,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    state: { sorting },
    onSortingChange,
    manualSorting: true,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  const yukleniyor = isLoading && data.length === 0;
  const bosMu = !yukleniyor && data.length === 0;

  const activateRow = (row: Row<TData>) => onRowClick?.(row.original);

  return (
    <div className="overflow-hidden rounded-2xl border border-panel-border bg-panel-surface">
      {truncationNotice}

      {/* İskelet ve boş durum ÇERÇEVENİN İÇİNDE (İP-B2): liste alanı
          kaybolmaz, sayfa "bir şey eksik" gibi görünmez. */}
      {yukleniyor && (
        <div className="p-4">
          <PageSkeleton rows={Math.min(pageSize, 6)} />
        </div>
      )}

      {bosMu &&
        (bos ? (
          bos.filtreli ? bos.sonucYok : bos.kayitYok
        ) : (
          <EmptyState
            title={emptyTitle ?? ""}
            description={emptyDescription}
            action={emptyAction}
          />
        ))}

      {!yukleniyor && !bosMu && (
        <>
          {renderMobileRow && (
            <div data-mobil-satirlar className="divide-y divide-panel-border md:hidden">
              {table.getRowModel().rows.map((row) =>
                onRowClick ? (
                  <div
                    key={row.id}
                    className="relative px-4 py-4 transition hover:bg-panel-surface-hover"
                    onClick={(event) => {
                      // Aksiyon düğmesine/bağlantıya gelen tıklama satırı AÇMAZ.
                      if (!etkilesimliKaynak(event.target)) activateRow(row);
                    }}
                  >
                    {/* Klavye + ekran okuyucu affordance'ı. Görünmez ama odak
                        halkasını taşır. Adı çağıran taraftan gelir: kart
                        içeriğinden türetmek, kartın kendi aksiyon düğmelerinin
                        metnini de bu düğmenin adına karıştırıyordu
                        (İP-A7d2 · SK-5). */}
                    <button
                      type="button"
                      aria-label={satirAdi?.(row.original)}
                      onClick={() => activateRow(row)}
                      className="absolute inset-0 z-0 rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-panel-focus"
                    />
                    <div className="relative z-10">{renderMobileRow(row.original)}</div>
                  </div>
                ) : (
                  <div key={row.id} className="px-4 py-4">
                    {renderMobileRow(row.original)}
                  </div>
                )
              )}
            </div>
          )}

          <div className={renderMobileRow ? "hidden overflow-x-auto md:block" : "overflow-x-auto"}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-panel-border bg-panel-surface-subtle">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => {
                      const sortable = header.column.getCanSort();
                      const direction = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          /* İP-A6 · Görev 2: sıralama göstergesi GÖRSELDİ ama
                             ekran okuyucuya görünmüyordu — ok işareti
                             `aria-hidden`, `<th>`de ise hiçbir durum yoktu.
                             Sıralı kolonun hangisi olduğu ve yönü ancak
                             `aria-sort` ile duyurulur. Sıralanabilir ama sırasız
                             kolon "none" der; sıralanamayan kolon hiçbir şey
                             demez (öznitelik anlamsız olurdu). */
                          aria-sort={
                            !sortable
                              ? undefined
                              : direction === "asc"
                                ? "ascending"
                                : direction === "desc"
                                  ? "descending"
                                  : "none"
                          }
                          className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-panel-fg-subtle"
                        >
                          {header.isPlaceholder ? null : sortable ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              /* `min-h-8`: gerçek tarayıcı turu bu düğmenin
                                 yüksekliğini **20 px** ölçtü (masaüstünde en
                                 küçük tıklama hedefi buydu). `<th>`in `py-3`
                                 dolgusu satırı ~44 px yaptığı için 32 px'lik
                                 hedef satır yüksekliğini BÜYÜTMEZ. */
                              className="inline-flex min-h-8 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <SortIndicator direction={direction} />
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-panel-border">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={(event) => {
                      // Satır aksiyonuna basmak satırı AÇMAZ (İP-A7d1 · Görev 1).
                      if (!etkilesimliKaynak(event.target)) activateRow(row);
                    }}
                    onKeyDown={(event) => {
                      if (!onRowClick) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      // Hücredeki bir düğmede Enter'a basmak o düğmeyi çalıştırır;
                      // satırı da açması kullanıcının istemediği ikinci bir iştir.
                      if (etkilesimliKaynak(event.target)) return;
                      event.preventDefault();
                      activateRow(row);
                    }}
                    className={
                      onRowClick
                        ? "cursor-pointer transition hover:bg-panel-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-panel-focus"
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-panel-fg-muted">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border px-4 py-3 text-sm">
            <p className="text-xs text-panel-fg-subtle tabular-nums">
              {firstItem}–{lastItem} / {total} kayıt
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-panel-fg-subtle">
                Sayfa başına
                <select
                  value={pageSize}
                  onChange={(event) => onPageSizeChange(Number(event.target.value))}
                  className="rounded-lg border border-panel-border-strong bg-panel-surface px-2 py-1.5 text-xs text-panel-fg outline-none focus:border-panel-accent focus:ring-2 focus:ring-panel-accent/20"
                >
                  {[10, 25, 50].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              {/* İP-A4: ham `<button>` yerine ortak `Button`. Sayfalama düğmeleri
                  panelin EN ÇOK tekrar eden düğmeleriydi ve odak halkası,
                  `disabled` opaklığı, dokunma yüksekliği burada elle yazılmıştı —
                  yani ortak sistemden ayrı yaşıyorlardı. */}
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Önceki
              </Button>
              <span className="min-w-16 text-center text-xs font-semibold text-panel-fg-muted tabular-nums">
                {page} / {totalPages}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                Sonraki
              </Button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
