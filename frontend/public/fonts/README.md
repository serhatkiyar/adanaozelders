# Yazı tipleri — neden burada duruyorlar

Bu klasördeki `.woff2` dosyaları **bilinçli olarak depoya alınmıştır**; bir
build adımı ya da paket bağımlılığı onları üretmez.

## Gerekçe: KVKK (İP-B2 · Ç-5)

İP-B2'ye kadar `index.html`, `Inter`ı Google Fonts CDN'inden çekiyordu. Bu,
her sayfa yüklemesinde — henüz giriş yapmamış anonim ziyaretçi dahil —
tarayıcının ABD'de barındırılan bir sunucuya bağlanması ve **IP adresini oraya
göndermesi** demektir. Aynı depoda `tailwind.config.js` yorumu ise "KVKK gereği
Google Fonts CDN'i kullanılmıyor" diyordu; yani belge ile kod çelişiyordu ve
doğru olmayan taraf koddu.

Bu, projenin Cloudflare'i DNS-only tutma gerekçesiyle birebir aynı sebeptir
(KVKK m.9 — yurt dışına aktarım). Almanya'da aynı gerekçeyle tazminata
hükmedilmiş emsal karar vardır (LG München I, 3 O 17493/20, 20.01.2022).

## Ne var

| Dosya | Boyut | Kapsam |
|---|---|---|
| `inter-latin.woff2` | 48 KB | `U+0000-00FF`, `U+0131` (ı), tipografik işaretler |
| `inter-latin-ext.woff2` | 85 KB | `U+0100-02BA` … — **Türkçenin `ş ğ İ Ş Ğ` harfleri burada** |

İkisi de **değişken (variable)** yazı tipidir: `font-weight: 100 900`
aralığının tamamını tek dosyada taşırlar. Altı ayrı ağırlık dosyası
indirmeye gerek yoktur; toplam 133 KB.

`latin-ext` isteğe bağlı değildir. `ş`, `ğ` ve `İ` `latin` altkümesinde
yoktur; yalnız `latin` alınsaydı panel ve public site Türkçe metinlerin bir
kısmını yedek yazı tipiyle çizerdi ve fark ancak gerçek tarayıcıda görülürdü.

## Nereden geldi

Google Fonts'un `css2` uç noktasının `Inter` için ürettiği altküme
dosyalarının aynısı (v20). Tek seferlik indirme; `unicode-range` sınırları da
oradan alındı, böylece sayfada latin-ext karakter yoksa tarayıcı o 85 KB'ı
hiç indirmez.

## Lisans

Inter, **SIL Open Font License 1.1** ile dağıtılır — self-host açıkça
serbesttir (OFL §2: "The Original Version … may be … redistributed"). Yazı
tipinin kendisi satılamaz, gömülü kullanım ve yeniden dağıtım serbesttir.
Kaynak: <https://github.com/rsms/inter> · `LICENSE.txt` (OFL 1.1).

## Bildirim nerede

`src/index.css` → `@font-face` (iki blok, `font-display: swap`).
`index.html` yalnız `latin` altkümesine `preload` verir.

## Nöbetçi

`src/__guards__/disFont.test.ts` üç şeyi birden tutar:

1. depoda dış yazı tipi konağına (`fonts.google…` / `…gstatic.com`) atıf
   **yoktur**;
2. `index.css` her iki `@font-face` bildirimini `font-display: swap` ile
   taşır;
3. bu klasördeki `.woff2` dosyaları **gerçekten vardır** ve gerçek WOFF2
   imzası (`wOF2`) taşır.

Üçü birden olmadan "self-host ediyoruz" cümlesi bir daha sessizce yanlışa
dönebilirdi — nitekim bir kez döndü.
