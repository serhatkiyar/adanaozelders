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

// Testler birbirinin oturumunu miras almasın.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
