import type { DuyuruAktifOut } from "@/types";

/**
 * Duyuru şeridinin son bilinen durumu — CLS düzeltmesi (İP-C2, düzeltme
 * turu madde D).
 *
 * ## Neden var
 *
 * Şerit asenkron veriyle gelir; ilk boyamada `null` render edip yanıt
 * gelince içerik eklemek her ziyarette bir düzen kayması (CLS) üretir —
 * gerçek Chrome ölçümünde hızlı bağlantıda bile ~0.21, yavaşta ~0.12
 * ölçüldü (docs/ip-c2/cls.json). Şerit haftalarca değişmediği için ikinci
 * ve sonraki ziyaretlerde bu kayma TAMAMEN gereksiz: tarayıcı zaten
 * "geçen sefer ne göründüğünü" biliyor.
 *
 * ## Sözleşme
 *
 * `oku()` `undefined` dönerse (hiç kayıt yok — İLK ziyaret): çağıran taraf
 * hiçbir şey render ETMEMELİ (kapatılamaz bir yer tutucu koymak Ç-2/görsel
 * sözleşmeyi bozar). `null` dönerse (kayıtlı durum "aktif duyuru yoktu"):
 * yine render edilmez, ama bu BİLİNEN bir sonuç, tahmin değil. Bir nesne
 * dönerse (kayıtlı durum "şu duyuru aktifti"): çağıran taraf gerçek yanıt
 * gelene kadar bunu İYİMSER olarak gösterebilir.
 *
 * `yaz()` her başarılı sorgu sonrası çağrılır (veri olsun/olmasın) —
 * böylece "artık aktif duyuru yok" da kaydedilir ve bir sonraki ziyarette
 * eski (kaldırılmış) duyuru yanlışlıkla yeniden gösterilmez.
 *
 * `localStorage` özel gezinme / depolama kapalıyken fırlatabilir — HER İKİ
 * fonksiyon da sessizce yutar (bir önbellek yazılamazsa özellik BOZULMAZ,
 * yalnızca optimizasyon kaybolur ve ilk-ziyaret davranışına düşer).
 */
const ANAHTAR = "duyuru-seridi:son";

export function oku(): DuyuruAktifOut | null | undefined {
  try {
    const ham = localStorage.getItem(ANAHTAR);
    if (ham === null) return undefined;
    const ayrisik = JSON.parse(ham) as { veri: DuyuruAktifOut | null };
    return ayrisik.veri;
  } catch {
    return undefined;
  }
}

export function yaz(veri: DuyuruAktifOut | null): void {
  try {
    localStorage.setItem(ANAHTAR, JSON.stringify({ veri }));
  } catch {
    /* depolama dolu/kapalı — özellik bozulmaz, yalnız önbellek atlanır */
  }
}
