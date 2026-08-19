// Hasar işlemi formu — dört işlemin ortak penceresi.
//
// Kullanıcı API'nin `kind` enum'unu bilmez: pencere dört FİİLDEN biriyle
// açılır. Etki (hangi raftan ne kadar düşer, hangi rafa ne kadar eklenir)
// onaydan ÖNCE rakamla yazılır.
//
// İdempotency anahtarı pencerenin açılışında üretilir ve **tek gönderim
// niyeti boyunca değişmez**; işlem başarıyla bitince yenilenir. Her render'da
// yenilenseydi ağ tekrarında sunucu iki ayrı iş görür ve stok iki kez düşerdi.
//
// ## İP-A2 pilotu
//
// Bu form panelde `Form.*` katmanına geçen İLK formdur. Değişen:
//
//   - Elle yazılmış `useState` doğrulaması → `react-hook-form` + zod şeması
//     (`damageFormSchema`, kurallar `lib/inventory.ts`'te tek kaynakta).
//   - Her alan `Form.Item` + `Form.Label` içinde: `htmlFor`/`id` bağı, hatada
//     `aria-invalid`, `aria-describedby` ve `role="alert"` artık otomatik.
//   - **Hata artık ilgili alanın altında.** Eskiden tüm doğrulama tek bir gri
//     satıra iniyordu ("Miktar sıfırdan büyük bir tam sayı olmalı." formun
//     dibinde) — kullanıcı hangi alanı düzelteceğini okumak zorundaydı.
//   - Alan hataları genel kanala GİTMEZ; üstteki şerit yalnız sunucudan gelen
//     genel hata içindir (`error` prop'u).
//
// Değişmeyen: anlık doğrulama (kullanıcı yazarken hata belirir), etki metni,
// imha onay kutusu kapısı, idempotency anahtarının ömrü ve sunucu gövdesi.
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button, Dialog } from "@/components/admin/ui";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { Form } from "@/components/admin/ui2/form";
import {
  DAMAGE_KINDS,
  DAMAGE_REASON_OPTIONS,
  damageEffect,
  damageFormSchema,
  damageKindLabel,
  damagePayload,
  newIdempotencyKey,
  requiresDamageNote,
  type Bucket,
  type DamageFormValues,
  type DamageKind,
  type DamageReason,
} from "@/lib/inventory";

import type { DamagePayload } from "@/api/inventory";
import type { ProductSearchOut } from "@/types";

export interface DamageDialogProps {
  kind: DamageKind | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: DamagePayload) => void;
}

const GONDER_ETIKET: Record<DamageKind, string> = {
  TRANSFER: "Hasara ayır",
  RECOVERY: "Satılabilir duruma döndür",
  DISPOSAL: "İmha et",
  SUPPLIER_RETURN: "Tedarikçiye iade et",
};

const BOS: DamageFormValues = {
  urunId: null,
  miktar: "",
  neden: "",
  aciklama: "",
  kova: "",
};

export function DamageDialog({ kind, isPending, error, onClose, onSubmit }: DamageDialogProps) {
  // Ham ID metni değil SEÇİLMİŞ ÜRÜN: ekranda adıyla görünen şeyle gövdeye
  // giden ID aynı kaynaktan okunur. Gövdeye giden `urunId` formda yaşar;
  // burada tutulan yalnız ekranda gösterilecek ürün nesnesidir.
  const [secilenUrun, setSecilenUrun] = useState<ProductSearchOut | null>(null);
  const [onaylandi, setOnaylandi] = useState(false);
  const anahtarRef = useRef<string>(newIdempotencyKey());
  const gonderildiRef = useRef(false);

  const form = useForm<DamageFormValues>({
    // Şema `kind`'a bağlı (kaynak kova yalnız tedarikçi iadesinde zorunlu).
    resolver: zodResolver(damageFormSchema(kind ?? "TRANSFER")),
    defaultValues: BOS,
    // Anlık doğrulama korunur: kullanıcı yazarken hata belirir, gönder'e
    // basmayı beklemez.
    mode: "onChange",
  });

  // Pencere her açıldığında form ve anahtar sıfırlanır.
  useEffect(() => {
    if (kind) {
      form.reset(BOS);
      setSecilenUrun(null);
      setOnaylandi(false);
      anahtarRef.current = newIdempotencyKey();
      gonderildiRef.current = false;
    }
    // `form` her render'da kimliğini korur; bağımlılığa eklemek gereksiz
    // sıfırlama üretirdi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const degerler = form.watch();
  const { miktar, neden, kova } = degerler;

  const adet = Number(miktar);
  const etki = useMemo(
    () => (kind ? damageEffect(kind, adet, (kova || null) as Bucket | null) : null),
    [kind, adet, kova]
  );

  if (!kind) return null;

  const geriAlinamaz = etki?.irreversible ?? false;
  // Ek onay kutusu YALNIZ imhada: mal tamamen yok edilir ve hiçbir rafa
  // dönmez. Tedarikçi iadesi de fiziksel çıkıştır ama karşılığında bir
  // muhatap vardır; orada kapı "kaynak kovanın açıkça seçilmesi"dir.
  const onayGerekli = kind === "DISPOSAL";

  // Gönder kapısı ŞEMADAN SENKRON okunur, `formState.isValid`'ten değil.
  //
  // Sebep ölçülmüş bir davranış farkı: `react-hook-form` çözümleyicisi
  // asenkrondur, `isValid` değişiklikten BİR TİK SONRA güncellenir. Eski form
  // doğrulamayı render sırasında hesapladığı için son karakteri yazıp hemen
  // tıklayan kullanıcı düğmeyi açık buluyordu; `isValid`'e bağlanınca aynı
  // tıklama kapalı düğmeye çarpıyor ve SESSİZCE hiçbir şey olmuyordu.
  // (Envanter kabul testlerinden beşi tam olarak bunu yakaladı.)
  //
  // Aynı şema iki yerde de kullanıldığı için tek doğruluk kaynağı korunur:
  // alan altındaki kırmızı mesajlar çözümleyiciden, kapı buradan gelir.
  const semaSonucu = damageFormSchema(kind).safeParse(degerler);
  const gonderilebilir = semaSonucu.success && (!onayGerekli || onaylandi);

  // "Gönder neden kapalı?" ipucu — eski formdan KORUNAN davranış.
  //
  // `react-hook-form` anlık modda yalnız DOKUNULAN alanı işaretler; hiç
  // dokunulmamış zorunlu bir alan (ör. tedarikçi iadesinde kaynak kova)
  // sessizce eksik kalır ve kullanıcı düğmenin neden kapalı olduğunu göremez.
  // Eski form bunu formun altındaki GRİ satırla söylüyordu (kırmızı hata
  // değil, yönlendirme). O satır burada korunur; alanında zaten kırmızı
  // görünen bir eksik ikinci kez yazılmaz.
  const eksikIpucu = (() => {
    if (!form.formState.isDirty || semaSonucu.success) return null;
    const gorunen = new Set(Object.keys(form.formState.errors));
    return (
      semaSonucu.error.issues.find((i) => !gorunen.has(String(i.path[0])))
        ?.message ?? null
    );
  })();

  const gonder = form.handleSubmit((degerler) => {
    if (gonderildiRef.current) return;
    gonderildiRef.current = true;
    onSubmit(damagePayload(kind, degerler, anahtarRef.current));
    // Kilit sunucu yanıtından SONRA açılır; hata hâlinde kullanıcı formu
    // düzeltip yeniden gönderebilsin diye burada bırakılır.
    window.setTimeout(() => {
      gonderildiRef.current = false;
    }, 0);
  });

  return (
    <Dialog
      open
      title={damageKindLabel(kind)}
      description={DAMAGE_KINDS.find((k) => k.value === kind)?.description}
      onClose={() => !isPending && onClose()}
    >
      <div className="space-y-4">
        {/* Ham ürün numarası yerine arama: hasar kaydı stoktan düşen ve geri
            alınamaz bir defter satırı üretir; yanlış numaraya yazılan bir
            hasar sessizce yanlış kitabı eksiltir. Seçilen ürün adıyla teyit
            edilebilmeli.

            Seçici kendi etiketini taşıdığı için burada `Form.Label` YOK;
            `Form.Item` yalnız hata slotunu açar. */}
        <Form.Field
          control={form.control}
          name="urunId"
          render={({ field }) => (
            <Form.Item>
              <ProductPicker
                selected={secilenUrun ? [secilenUrun] : []}
                onChange={(secilenler) => {
                  const secilen = secilenler[0] ?? null;
                  setSecilenUrun(secilen);
                  field.onChange(secilen?.id ?? null);
                }}
                multiple={false}
              />
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Form.Field
            control={form.control}
            name="miktar"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Miktar</Form.Label>
                <Form.Control>
                  <input className="input" type="number" min="1" step="1" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        {kind === "SUPPLIER_RETURN" && (
          <Form.Field
            control={form.control}
            name="kova"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Kaynak kova</Form.Label>
                <Form.Control>
                  <select className="input" {...field}>
                    <option value="">Seçin…</option>
                    <option value="SALEABLE">Satılabilir</option>
                    <option value="DAMAGED">Hasarlı</option>
                  </select>
                </Form.Control>
                <Form.Hint>
                  Adet yalnız seçtiğiniz raftan düşer; diğer rafa aktarılmaz.
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        )}

        <Form.Field
          control={form.control}
          name="neden"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Neden</Form.Label>
              <Form.Control>
                <select className="input" {...field}>
                  <option value="">Seçin…</option>
                  {DAMAGE_REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        {requiresDamageNote((neden || null) as DamageReason | null) && (
          <Form.Field
            control={form.control}
            name="aciklama"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Açıklama</Form.Label>
                <Form.Control>
                  <input className="input" placeholder="Ne olduğunu kısaca yazın" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        )}

        {eksikIpucu && (
          <p
            data-testid="damage-eksik-ipucu"
            className="text-xs text-slate-500 dark:text-slate-400"
          >
            {eksikIpucu}
          </p>
        )}

        <p
          data-testid="damage-effect"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
        >
          {etki?.text}
        </p>

        {onayGerekli && (
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={onaylandi}
              onChange={(e) => setOnaylandi(e.target.checked)}
            />
            <span>
              Bu işlem <strong>geri alınamaz</strong>: mal fiziksel olarak çıkar ve stoğa
              kendiliğinden dönmez. Onaylıyorum.
            </span>
          </label>
        )}

        {geriAlinamaz && !onayGerekli && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Bu işlem geri alınamaz: mal fiziksel olarak çıkar.
          </p>
        )}

        {/* YALNIZ genel/sunucu hatası. Alan doğrulama hataları buraya asla
            düşmez — kendi alanlarının altında dururlar (İP-A2 sözleşmesi). */}
        {error && (
          <p
            role="alert"
            data-testid="damage-genel-hata"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant={geriAlinamaz ? "danger" : "primary"}
            disabled={!gonderilebilir}
            isPending={isPending}
            onClick={gonder}
          >
            {GONDER_ETIKET[kind]}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
