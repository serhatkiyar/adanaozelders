/**
 * Erişilebilir ad denetimi — A7'nin kabul kriterinin ALETİ (İP-A4 · Görev 4).
 *
 * ## Neden var
 *
 * `Form.Control`un adsız alan koruması `throw`/`console.error` ile çalışır,
 * yani ancak bileşen RENDER EDİLDİĞİNDE ateşlenir (İP-A3c). Hiçbir testin
 * uğramadığı koşullu bir dalda duran form alanı üretime adsız çıkar ve nöbetçi
 * sayacı "0 borç" der — çünkü sayaç da statik olarak `Form.Control` içinde
 * görüp adlandırılmış sayar.
 *
 * Bu yüzden göç eden her form için şu test zorunlu olacak:
 *
 *   > Form TÜM KOŞULLU DALLARIYLA render edilir ve her form alanının
 *   > erişilebilir adı doğrulanır.
 *
 * Bu dosya o testin tekrar eden kısmını taşır: bir kaptaki bütün form
 * kontrollerini bulur ve adını HTML'in adlandırma kurallarıyla çözer. Ekran
 * başına yazılacak tek şey "dalları açan tıklamalar" olur.
 *
 * ## Sınır (dürüstçe)
 *
 * Tam bir erişilebilir ad hesabı (accname) değildir: `title`, `placeholder`
 * gibi ZAYIF kaynakları BİLEREK saymaz — panelde bunlar ad yerine geçmemeli.
 * `aria-labelledby` çoklu id'yi birleştirir, `aria-label` boşsa yok sayar.
 * Amaç accname motoru yazmak değil, "bu alanın adı var mı" sorusunu jsdom'da
 * yanlış-yeşil üretmeden cevaplamaktır.
 */

/** Ad aranan kontroller — `Form.Control`un kapsadığı küme. */
const KONTROL = "input, select, textarea";

/**
 * Ölçüm dışı `input type` değerleri: HTML'de labelable DEĞİLLER ya da hiç
 * render edilmezler. (Sayaçla aynı liste — `scripts/ui-baseline-sayim.mjs`.)
 */
const OLCUM_DISI = new Set(["hidden", "submit", "reset", "button", "image"]);

function metin(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Bir kontrolün erişilebilir adı; yoksa boş dize. */
export function erisilebilirAd(el: HTMLElement): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const birlesik = labelledBy
      .split(/\s+/)
      .map((id) => metin(el.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (birlesik) return birlesik;
  }

  if (el.id) {
    // `id` içinde CSS'te özel anlamı olan karakterler olabilir (React'ın
    // `useId`'si `:r0:` üretir) — seçici yerine tarama.
    const etiket = Array.from(el.ownerDocument.querySelectorAll("label")).find(
      (l) => l.getAttribute("for") === el.id
    );
    const ad = metin(etiket ?? null);
    if (ad) return ad;
  }

  const sarmalayan = el.closest("label");
  if (sarmalayan) {
    // Kontrolün kendi değeri ada karışmasın (ör. seçili option metni).
    const kopya = sarmalayan.cloneNode(true) as HTMLElement;
    kopya.querySelectorAll(KONTROL).forEach((k) => k.remove());
    const ad = metin(kopya);
    if (ad) return ad;
  }

  return "";
}

/** Kaptaki, adlandırılması BEKLENEN bütün form kontrolleri. */
export function formKontrolleri(kap: HTMLElement): HTMLElement[] {
  return Array.from(kap.querySelectorAll<HTMLElement>(KONTROL)).filter((el) => {
    if (el.hasAttribute("hidden")) return false;
    if (el.tagName !== "INPUT") return true;
    const tip = (el.getAttribute("type") ?? "text").toLowerCase();
    return !OLCUM_DISI.has(tip);
  });
}

/** Adı olmayan kontroller — testin doğrudan iddia ettiği liste. */
export function adsizKontroller(kap: HTMLElement): { etiket: string; html: string }[] {
  return formKontrolleri(kap)
    .filter((el) => erisilebilirAd(el) === "")
    .map((el) => ({
      etiket: el.tagName.toLowerCase(),
      html: el.outerHTML.slice(0, 160),
    }));
}
