// Vitest global kurulumu.
//
// ## Neden gerekiyor
//
// Node 22+ `globalThis.localStorage`'ı KENDİ deneysel uygulamasıyla tanımlıyor
// ve `--localstorage-file` verilmedikçe erişimde patlıyor. Bu tanım jsdom'un
// `window.localStorage`'ını gölgeliyor, dolayısıyla `zustand/persist` kullanan
// hiçbir store (authStore, themeStore, meetingStore…) testte import bile
// edilemiyordu: "localStorage.getItem is not a function".
//
// Bu yüzden repoda bugüne dek auth'a dokunan bir bileşen testi YOKTU — kusur
// testlerin değil, test ortamının eksikliğiydi. Aşağıdaki bellek-içi uygulama
// tarayıcı sözleşmesini birebir karşılar ve her test dosyası için izoledir.
import { afterEach } from "vitest";

class BellekDepolama implements Storage {
  private veri = new Map<string, string>();

  get length(): number {
    return this.veri.size;
  }
  clear(): void {
    this.veri.clear();
  }
  getItem(key: string): string | null {
    return this.veri.has(key) ? this.veri.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.veri.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.veri.delete(key);
  }
  setItem(key: string, value: string): void {
    this.veri.set(key, String(value));
  }
}

function calisiyorMu(depo: unknown): boolean {
  try {
    const d = depo as Storage;
    d.setItem("__probe__", "1");
    d.removeItem("__probe__");
    return true;
  } catch {
    return false;
  }
}

for (const ad of ["localStorage", "sessionStorage"] as const) {
  if (!calisiyorMu(globalThis[ad])) {
    Object.defineProperty(globalThis, ad, {
      value: new BellekDepolama(),
      configurable: true,
      writable: true,
    });
  }
}

// ## `window.matchMedia` — jsdom'da HİÇ YOK
//
// jsdom bu API'yi HİÇ sağlamaz (tanımlı değil, boş da değil); `matchMedia(...)`
// bir TypeError verir. `themeStore` modül yüklenirken
// `matchMedia(...).addEventListener` çağırdığı için ("system" tercihi OS
// temasını canlı izler), onu içeren her zincir — `DashboardShell →
// DashboardHeader → PersonalizeModal` — testte **render edilmeden** patlıyordu:
// "window.matchMedia is not a function". Pratikte bu, panel sayfalarının
// tamamı demektir; repoda bugüne dek panel kabuğunu (üst bar + nav) gerçek
// DOM'da render eden bir test bu yüzden yoktu.
//
// Suite yüklenemediği için sonuç "0 test" olur — bu, "test zayıf" ile
// KARIŞTIRILMAMASI gereken "test hiç koşmadı" hâlidir (kök CLAUDE.md §D'nin
// `--collect-only` nöbetçisiyle aynı gerekçe) ve yeşil bir toplamın içinde
// sessizce kaybolabilir.
//
// Stub bilinçli olarak "eşleşme yok" (`matches: false`) döner: "system"
// tercihi testlerde AÇIK temaya çözülür ve testler OS ayarına göre değişmez.
// Dinleyici kaydı sessizce yutulur — store gerçek bir değişim beklemez.
// Karanlık mod paritesini ölçen bir test yazılırsa bu değeri kendi içinde
// ezmelidir; global varsayılan sessizce tema seçmesin diye burada tek yerde ve
// görünür durur.
//
// ⚠️ Bu stub İKİ dalda BAĞIMSIZ olarak bulundu ve eklendi: İP-14 (panel
// navigasyon düğümleri N-* tam olarak bu yüzeyi ölçüyor) ve SM-2 kaldırma
// paketi (Öğren hub'ının gerçek DOM nöbetçisi). Merge'de kod blokları bayt
// bayt aynı çıktı, tek kopya kaldı; bu yorum ikisinin gerekçesini birleştirir.
// Mükerrer bir `Object.defineProperty` eklenmemelidir — ikincisi birincisini
// sessizce ezer ve hangi davranışın geçerli olduğu okunamaz hâle gelir.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// Testler birbirinin oturumunu miras almasın.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// ## RTL asenkron bekleme bütçesi (İP-A4 · Görev 5b)
//
// `findBy*`/`waitFor` varsayılan bütçesi 1000 ms'dir ve **Vitest'in
// `testTimeout`undan bağımsızdır** — `vitest.config.ts`'teki 9000 ms bu
// bekleyişi hiç ilgilendirmiyordu. Kararsız düşen iki test
// (`ticketsPaymentGate`, `storeVariants.acceptance`) her seferinde bu bütçeyi
// aşıyordu: ikisi de İKİ ağ sorgusu çözülene kadar bekleyen `findAllBy*`
// çağrılarıdır ve tam suite yük altında koşarken (114 dosya, paralel işçiler)
// jsdom render + query çözümü 1 saniyeyi geçebiliyor.
//
// Kanıt: düşüşlerin İKİSİ de "Unable to find …" biçimindedir — yani iddia
// YANLIŞ değil, HENÜZ doğru değildir; aynı testler yalnız koşturulduğunda
// hiç düşmez ve aynı seed iki koşumda farklı sonuç verir. Sıra bağımlılığı
// değil, YÜK bağımlılığıdır (TB-23'ün kaydettiği kökün aynısı: yeşil/kırmızı
// sinyalinin makine yüküne bağlanması).
//
// 4000 ms ölçüyle seçildi: yükte gözlenen en uzun gerçek bekleyiş ~2.3 s'ydi;
// 4 s onun ~1.7 katı ve Vitest'in 9 s'lik test bütçesinin altında kalır —
// yani gerçek bir asılma hâlâ testi düşürür, sessizce yutulmaz. Daha geniş
// bir değer (ör. 8 s) gerçek bir performans regresyonunu gizlerdi.
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 4000 });
