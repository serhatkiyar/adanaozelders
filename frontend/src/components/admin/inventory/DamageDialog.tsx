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
// idempotency anahtarının ömrü ve sunucu gövdesi.
//
// ## İP-A3c: "geçerlilik nedeniyle kapalı düğme" deseni BIRAKILDI
//
// Eskiden gönder düğmesi form geçersizken `disabled` idi ve neyin eksik
// olduğunu formun altındaki gri `eksikIpucu` satırı söylüyordu. Dört sebeple
// bırakıldı (ürün kararı, İP-A3c · Görev 4):
//
//   1. Kapalı düğme GERİ BİLDİRİM VERMEZ: kullanıcı basar, hiçbir şey olmaz.
//   2. Ekran okuyucuya NEDEN kapalı olduğunu söylemez; kontrast muafiyeti
//      yüzünden az gören kullanıcı için de zor görünür.
//   3. "Neyin eksik olduğunu" anlatan PARALEL bir mekanizma yazmayı zorunlu
//      kılar (`eksikIpucu`) — o mekanizma İP-A2 pilotunda bir kez kırıldı ve
//      regresyon olarak geri kondu.
//   4. Kapı (senkron `safeParse`) ile alan hataları (asenkron çözümleyici +
//      sunucudan `setError`) İKİ AYRI DOĞRULUK KAYNAĞIDIR ve saparlar:
//      denetim, sunucu alan hatası varken düğmenin AÇIK kaldığını üretti.
//
// Yerine gelen desen: düğme geçerlilik yüzünden hiç kapanmaz; basılınca form
// geçersizse GÖNDERİM YAPILMAZ, hatalar alanların altında görünür ve ODAK İLK
// HATALI ALANA taşınır. Düğme yalnız işlem sürerken (`isPending`) kapanır —
// bu geçerlilik değil, çift gönderim korumasıdır.
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/admin/ui";
import { ProductPicker } from "@/components/admin/ProductPicker";
import {
  DuzenlemeYuzeyi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  DAMAGE_KINDS,
  DAMAGE_REASON_OPTIONS,
  damageEffect,
  damageFormSchema,
  damageKindLabel,
  damagePayload,
  inventoryErrorMessage,
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
  /**
   * Düzenleme yüzeyi (İP-A4 · Görev 2). Eskiden burada `kind` ve `onClose`
   * vardı ve pencere durumu EKRANDA yaşıyordu. Artık yüzey taşıyor: hangi
   * işlem açıldığı `yuzey.baglam`, kapatma `yuzey.kapat`.
   */
  yuzey: DuzenlemeYuzeyiDurumu<never, DamageKind>;
  isPending: boolean;
  /**
   * HAM sunucu hatası (İP-A3a'da `string`ten değişti).
   *
   * Metne çevirme işi artık diyaloğun kendisinde: 422'nin `loc` bilgisi
   * ancak burada, hangi alanın hangi kontrole karşılık geldiğini bilen yerde
   * alanlara dağıtılabilir. Sayfa hatayı önceden metne indirgeseydi `loc`
   * kaybolur ve mesaj mecburen genel şeride düşerdi — İP-A2'nin açık bıraktığı
   * uç tam olarak buydu.
   */
  error: unknown;
  onSubmit: (payload: DamagePayload) => void;
}

/** Formdaki alan adları — `sunucuHatasiniUygula` için BEYAZ LİSTE. */
const ALANLAR = ["urunId", "miktar", "neden", "aciklama", "kova"] as const;

/**
 * Sunucu alan adı → form alan adı.
 *
 * Sunucu `snake_case` ve kendi şemasının adlarını kullanır (`qty`,
 * `reason_code`); form Türkçe adlarla çalışır. Eşleme olmadan her 422 genel
 * şeride düşerdi — teknik olarak "kaybolmaz" ama kullanıcı yine hangi alanı
 * düzelteceğini bilemezdi.
 */
const SUNUCU_ALAN_ESLEMESI: Record<string, string> = {
  product_id: "urunId",
  qty: "miktar",
  reason_code: "neden",
  note: "aciklama",
  bucket: "kova",
};

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

export function DamageDialog({ yuzey, isPending, error, onSubmit }: DamageDialogProps) {
  // Hangi işlem açık — pencere durumunun tek kaynağı yüzeydir.
  const kind = yuzey.baglam;
  // Ham ID metni değil SEÇİLMİŞ ÜRÜN: ekranda adıyla görünen şeyle gövdeye
  // giden ID aynı kaynaktan okunur. Gövdeye giden `urunId` formda yaşar;
  // burada tutulan yalnız ekranda gösterilecek ürün nesnesidir.
  const [secilenUrun, setSecilenUrun] = useState<ProductSearchOut | null>(null);
  const [onaylandi, setOnaylandi] = useState(false);
  const anahtarRef = useRef<string>(newIdempotencyKey());
  // Onay kutusu formun DIŞINDA yaşadığı için hatası da burada tutulur; bir
  // kutucuk için şemaya alan açmak `damagePayload` gövdesini de kirletirdi.
  const [onayHatasi, setOnayHatasi] = useState(false);
  const onayRef = useRef<HTMLInputElement>(null);
  // Odak kurtarması için: `urunId` alanının kontrolü `ProductPicker`ın kendi
  // arama kutusudur ve `react-hook-form`a bir `ref` vermez.
  const kapRef = useRef<HTMLDivElement>(null);

  const form = useForm<DamageFormValues>({
    // Şema `kind`'a bağlı (kaynak kova yalnız tedarikçi iadesinde zorunlu).
    resolver: zodResolver(damageFormSchema(kind ?? "TRANSFER")),
    defaultValues: BOS,
    // Anlık doğrulama korunur: kullanıcı yazarken hata belirir, gönder'e
    // basmayı beklemez.
    mode: "onChange",
    // Odaklamayı KENDİMİZ yapıyoruz (`ilkHatayaOdaklan`). `react-hook-form`un
    // kendi odaklaması `onInvalid`ten SONRA çalışır (ve bir de `setTimeout`
    // ile tekrarlar), yani bizimkini ezer; ayrıca `ref` taşımayan alanı
    // (`urunId` → ProductPicker) atlar ve "ilk hatalı alan" yerine ilk
    // ODAKLANABİLİR hatalı alana gider.
    shouldFocusError: false,
  });

  // Pencere her açıldığında form ve anahtar sıfırlanır.
  useEffect(() => {
    if (kind) {
      form.reset(BOS);
      setSecilenUrun(null);
      setOnaylandi(false);
      setOnayHatasi(false);
      anahtarRef.current = newIdempotencyKey();
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

  // ── Sunucu hatasının dağıtımı (İP-A3a) ──
  //
  // `loc`'u bir alana düşen 422 mesajı O ALANIN altına yazılır ve genel
  // şeride HİÇ gitmez (İP-A2 hata yönlendirme sözleşmesi). Alana düşmeyen
  // kısım — 500, ağ hatası, formda karşılığı olmayan alan — şeritte kalır;
  // beyaz liste sayesinde sessizce kaybolmaz.
  //
  // 422 dışı metinler envanterin kendi sözlüğünden gelir: defter bütünlüğü
  // uyarısı ve 409'un "sayfayı yenileyin" yönlendirmesi genel çeviride yok.
  const [genelHata, setGenelHata] = useState<string | null>(null);
  useEffect(() => {
    if (!error) {
      setGenelHata(null);
      return;
    }
    setGenelHata(
      sunucuHatasiniUygula(error, form, ALANLAR, SUNUCU_ALAN_ESLEMESI, (h) =>
        // Hazır metin geçiren çağıran (ör. istemci tarafı ağ hatası) olduğu
        // gibi gösterilir; aksi hâlde envanter sözlüğünden çevrilir.
        typeof h === "string" ? h : inventoryErrorMessage(h, "İşlem tamamlanamadı.")
      )
    );
    // `form` kimliğini korur; bağımlılığa eklemek gereksiz yeniden dağıtım
    // üretirdi (aynı hata iki kez alanlara yazılırdı).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // ── Kirli form bekçisi ve odak yönetimi ARTIK BURADA DEĞİL ──
  //
  // İkisi de `DuzenlemeYuzeyi`nin içinde (İP-A4 · Görev 2). Eskiden bu
  // dosyada `useKirliFormBekcisi` çağrısı, `Dialog`a verilen `onClose`un
  // kimliğini elle sabitleyen bir `kapatmaRef`/`useCallback` ikilisi ve
  // ayrı bir "Vazgeç" düğmesi vardı — üçü de göç edecek her ekranda tekrar
  // yazılacak, her ekranda ayrı ayrı unutulabilecek şeylerdi.
  //
  // `kapatmaRef` özel olarak `useModalA11y`nin odak sıfırlaması yüzünden
  // gerekliydi (TB-A3c-1); o kusur hook'un içinde düzeltildiği için
  // (İP-A4 · Görev 1) geçici sabitleme kaldırıldı.

  if (!kind) return null;

  const geriAlinamaz = etki?.irreversible ?? false;
  // Ek onay kutusu YALNIZ imhada: mal tamamen yok edilir ve hiçbir rafa
  // dönmez. Tedarikçi iadesi de fiziksel çıkıştır ama karşılığında bir
  // muhatap vardır; orada kapı "kaynak kovanın açıkça seçilmesi"dir.
  const onayGerekli = kind === "DISPOSAL";

  // ── Gönderim: kapı yok, ama geçersiz veri de sunucuya gitmez ──
  //
  // `handleSubmit` geçersiz formda `onGecerli`yi HİÇ çağırmaz; bu, "veri
  // sunucuya gitmez" garantisinin tek kaynağıdır. Kullanıcıya geri bildirim
  // alanların altındaki hatalarla verilir — ve odak ilk hatalı alana taşınır,
  // çünkü hata ekranın görünmeyen kısmındaysa kullanıcı yine hiçbir şey
  // görmemiş olur.
  //
  // Alanların GÖRSEL sırası; "ilk hatalı alan" bu sıradan okunur.
  const GORSEL_SIRA = ["urunId", "miktar", "kova", "neden", "aciklama"] as const;

  const ilkHatayaOdaklan = (hatalar: FieldErrors<DamageFormValues>) => {
    const ilk = GORSEL_SIRA.find((a) => hatalar[a]);
    if (!ilk) return;
    if (ilk === "urunId") {
      // `ProductPicker` kendi arama kutusunu yönetir ve forma `ref` vermez;
      // `setFocus` bu alanda hiçbir şey yapmaz. Kutuyu doğrudan buluyoruz.
      kapRef.current
        ?.querySelector<HTMLInputElement>('input[type="search"]')
        ?.focus();
      return;
    }
    form.setFocus(ilk);
  };

  const gonder = form.handleSubmit(
    (degerler) => {
      // İmha onayı: kutucuk formun dışında yaşadığı için ayrı kapılanır ama
      // davranışı aynı — düğme kapanmaz, basılınca hata belirir ve odak
      // kutucuğa taşınır.
      if (onayGerekli && !onaylandi) {
        setOnayHatasi(true);
        onayRef.current?.focus();
        return;
      }
      onSubmit(damagePayload(kind, degerler, anahtarRef.current));
    },
    (hatalar) => {
      if (onayGerekli && !onaylandi) setOnayHatasi(true);
      ilkHatayaOdaklan(hatalar);
    }
  );

  return (
    <DuzenlemeYuzeyi
      yuzey={yuzey}
      baslik={damageKindLabel(kind)}
      aciklama={DAMAGE_KINDS.find((k) => k.value === kind)?.description}
      form={form}
      // Gönderim ağa çıkıp başarısız olduysa form KİRLİ sayılmaya devam eder;
      // `isSubmitSuccessful` tek başına "mutate çağrıldı" demektir.
      sunucuHatasi={error}
      islemSuruyor={isPending}
      aksiyonlar={
        <Button
          variant={geriAlinamaz ? "danger" : "primary"}
          /* Geçerlilik kapısı YOK. `isPending` çift gönderimi engeller —
             `Button` bunu kendi `disabled`ına katar. */
          isPending={isPending}
          onClick={gonder}
        >
          {GONDER_ETIKET[kind]}
        </Button>
      }
    >
      <div className="space-y-4" ref={kapRef}>
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

        <p
          data-testid="damage-effect"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
        >
          {etki?.text}
        </p>

        {onayGerekli && (
          <div>
            <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <input
                ref={onayRef}
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                aria-invalid={onayHatasi || undefined}
                checked={onaylandi}
                onChange={(e) => {
                  setOnaylandi(e.target.checked);
                  if (e.target.checked) setOnayHatasi(false);
                }}
              />
              <span>
                Bu işlem <strong>geri alınamaz</strong>: mal fiziksel olarak çıkar ve stoğa
                kendiliğinden dönmez. Onaylıyorum.
              </span>
            </label>
            {onayHatasi && (
              <p
                role="alert"
                data-testid="damage-onay-hatasi"
                className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
              >
                Devam etmek için bu kutuyu işaretleyin.
              </p>
            )}
          </div>
        )}

        {geriAlinamaz && !onayGerekli && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Bu işlem geri alınamaz: mal fiziksel olarak çıkar.
          </p>
        )}

        {/* YALNIZ genel/sunucu hatası. Alan doğrulama hataları buraya asla
            düşmez — kendi alanlarının altında dururlar (İP-A2 sözleşmesi). */}
        {genelHata && (
          <p
            role="alert"
            data-testid="damage-genel-hata"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
          >
            {genelHata}
          </p>
        )}
      </div>
    </DuzenlemeYuzeyi>
  );
}
