# Medusa v2 vs Adana Özel Ders — Arayüz ve Tasarım Karşılaştırması

Tarih: 2026-08-19 · Kapsam: **yalnız products ve inventory ekranları** · Yöntem: her iki taraf da kaynak koddan okundu, sayımlar `grep` ile yapıldı.
Kardeş belge: `docs/medusa-karsilastirma-raporu.md` (fonksiyonel karşılaştırma).

Kısaltmalar: `M:` → `medusa2/node_modules/@medusajs/` · `B:` → `adana-main/frontend/src/`

Ölçüm tabanı (bizim taraf): `components/admin/**` + `pages/admin/**` + `pages/dashboards/Admin*.tsx` = **59 dosya, 15.620 satır**.

---

## 1. Karşılaştırma tablosu

### 1.1 Bileşen sistemi

| | Medusa | Bizde |
|---|---|---|
| UI kütüphanesi | **`@medusajs/ui` 4.2.1** — 41 dışa verilen bileşen + ayrı `blocks/data-table` (`M:ui/dist/cjs/index.d.ts:1-44`) | **Yok.** `components/admin/ui/` altında ~6 parçalık ev yapımı mini kit: `Button`, `Badge`, `Dialog`, `ConfirmDialog`, `EmptyState`/`ErrorState`/`PageSkeleton` |
| Bileşen envanteri | Alert, Avatar, Badge, Button, Calendar, Checkbox, Code, CodeBlock, OtpInput, Command, CommandBar, Container, Copy, CurrencyInput, DatePicker, Divider, **Drawer**, DropdownMenu, **FocusModal**, Heading, **Hint**, IconBadge, IconButton, InlineTip, Input, Kbd, Label, Popover, ProgressAccordion, **ProgressTabs**, **Prompt**, RadioGroup, Select, **Skeleton**, StatusBadge, Switch, Table, Tabs, Text, Textarea, Toast/Toaster, Tooltip | Button, Badge, Dialog, ConfirmDialog/ReasonDialog, EmptyState, ErrorState, PageSkeleton, DataTable, `components/ui/Field.tsx` (label↔input primitive) |
| Alt katman | **Radix UI** (61 dosyada import) + **cva** (varyant sistemi) + **sonner** (toast) + `tailwind-merge` sarmalayıcı `clx`. Kanıt: `M:ui/dist/esm/components/button/button.js:1-2`, `focus-modal.js:3`, `prompt.js:2`, `toaster.js:3` | Hiçbiri. Doğrudan `<button className="...">` + elle `createPortal` |
| Form kütüphanesi | **react-hook-form 7.83 + zod 4.2** (`@hookform/resolvers`), ortak sarmalayıcı `useExtendableForm` (`M:dashboard/src/dashboard-app/forms/hooks.tsx:85-115`) | **Yok** — tüm formlar elle `useState` (`B:pages/dashboards/AdminStore.tsx:507-588`, `components/admin/DamageDialog.tsx:48-53`) |
| Diğer bağımlılıklar | dnd-kit, cmdk, motion, react-virtual, i18next, date-fns, match-sorter, react-currency-input-field | @tanstack/react-table, @tabler/icons-react (admin'de kullanılmıyor), zustand |
| Ham `<button>` vs ortak `Button` | — (ham buton yok, hepsi `Button`) | **126 ham `<button>` / 95 ortak `<Button>`.** `AdminStore.tsx` tek başına: `Button` import ediyor ama **4 kez** kullanıyor, **28 kez** ham `<button>` yazıyor |

### 1.2 Sayfa düzeni ve liste→detay geçişi

| | Medusa | Bizde |
|---|---|---|
| Detay | **Ayrı sayfa** — nested route + `Outlet` (`M:dashboard/src/dashboard-app/routes/get-route.map.tsx:69-80`) | Karışık |
| Düzenleme yüzeyi | **URL'e yansıyan modal/drawer**: `RouteDrawer` (yan panel, edit) ve `RouteFocusModal` (tam ekran, create) — `M:components/modals/route-drawer/route-drawer.tsx`, `route-focus-modal/route-focus-modal.tsx`. Kapanınca `navigate(to,{replace:true})` | **Ürün düzenleme URL'siz modal** (`B:AdminStore.tsx:1283-1326`); **sayım oturumu detayı gerçek sayfa** (`/yonetim/envanter/sayimlar/:id`); **hasar işlemi modal**, URL'siz; **stok defteri** edit modalının içine gömülü panel |
| Alt rotalar | `products/:id/edit`, `/media`, `/prices`, `/stock`, `/organization`, `/sales-channels`, `/attributes`, `/options/manage`, `/variants/create`, `/metadata/edit` (`get-route.map.tsx:81-160`); inventory ve reservations aynı desende | Ürün için alt rota yok — her şey tek modalda |
| Detay bölüm deseni | **Salt-okunur bölüm + üç nokta → ayrı düzenleme rotası** (`to="edit"`, `to="organization"`), iki kolonlu grid | Tek modal içinde tüm alanlar; salt-okunur/düzenleme ayrımı yok |
| Deep-link | Tam (her düzenleme yüzeyi paylaşılabilir/geri tuşuyla kapanır) | Yok (modal durumu URL'de değil) |

### 1.3 Form deseni

| | Medusa | Bizde |
|---|---|---|
| Ürün formu bölünmesi | **4 sekmeli `ProgressTabs`** (DETAILS → ORGANIZE → VARIANTS → INVENTORY) | **Tek uzun form** + katlanır bölümler ("Kitap künyesi" `AdminStore.tsx:776-804`, "Varyantlar" `:836-848`) |
| Alan sarmalayıcısı | Ortak `Form.Field`/`Form.Item`/`Form.Label`/`Form.Control` (`M:components/common/form/form.tsx:41-169`) | **Yok** — her formda elle `<div><label>…<input>` |
| Yardım metni | `Form.Hint` (`form.tsx:171-186`) | Elle `<span>` (`AdminStore.tsx:96, 733-736, 789-792`) |
| Hata mesajı | `Form.ErrorMessage` (`form.tsx:188-210`) — **hint ile aynı slotu paylaşır**: hata varsa hata, yoksa hint | Çoğunlukla **toast** (`AdminStore.tsx:662-666`); alan altında hata yalnız `DamageDialog.tsx:216-218` (`role="alert"`) ve `ConfirmDialog.tsx:104-113` |
| Zorunlu alan işareti | **Yok** — tersi var: `Form.Label` `optional` prop'uyla "(optional)" yazıyor (`form.tsx:132-136`) | Yok — placeholder metniyle ima ediliyor |
| Doğrulama zamanı | zod resolver, submit + alan bazlı | Submit-time (mutation içinde throw) + `disabled` ile ön-engelleme. İstisna: `DamageDialog` anlık (`:79-87`) |
| Kaydet/İptal | **Sticky footer** (`RouteDrawer.Footer`), İptal = `RouteDrawer.Close` (`M:product-organization-form.tsx:212-224`) | Dialog'larda sağa yaslı footer (`DamageDialog.tsx:229-241`); ürün formunda tek buton, ayrı İptal yok |
| **Kaydedilmemiş değişiklik uyarısı** | **VAR** — react-router `useBlocker` + `Prompt` (`M:components/modals/route-modal-form/route-modal-form.tsx:26-92`) | **YOK** |

### 1.4 Tablo deseni

| | Medusa | Bizde |
|---|---|---|
| Uygulama | **İki paralel**: eski `components/table/data-table/` + yeni `components/data-table/data-table.tsx` (→ `@medusajs/ui` DataTable). 108 dosyada `@tanstack/react-table` | **Tek** `B:components/admin/data-table/DataTable.tsx` (@tanstack/react-table) — **ama yalnız `ProductsPanel` kullanıyor**; envanter/hasar sayfaları kendi elle tablosunu yazmış (`CountSessionDetailPage.tsx:491-528`, `DamageEventsPage.tsx:159-206`) |
| Kolon genişliği | `size`/`minSize` **bulunamadı** — kolon dosyalarında tanımlı değil | Sabit `min-w-[720px]` kapsayıcı (`DataTable.tsx:122`) |
| Satır aksiyonları | **Üç nokta menü** `ActionMenu` (`M:components/common/action-menu/action-menu.tsx:1-40`) | **Açık butonlar** (`UrunAksiyonlari`, `AdminStore.tsx:1200-1281`) — dokunmatikte daha iyi, kalabalıkta daha kötü |
| Sıralama göstergesi | **Yok** — products/inventory/reservations/locations listelerinin hiçbirinde `enableSorting` kullanılmıyor | **Var** — `SortIndicator` `▲/▼/↕` (`DataTable.tsx:48-54`), `manualSorting: true` sunucu taraflı |
| Satır tıklama | `rowHref` + Cmd/Ctrl → yeni sekme, Shift → yeni pencere (`M:components/data-table/data-table.tsx:304-326`) | `onRowClick` desteği **var ama `ProductsPanel` kullanmıyor** (`DataTable.tsx:151-161`) |
| Boş durum | **İki ayrı bileşen**: `NoResults` (arama boş, h-400) ve `NoRecords` (hiç kayıt yok, h-150, aksiyon butonlu) — `M:components/common/empty-table-content/empty-table-content.tsx:13-104` | Tek `EmptyState` (`B:components/admin/ui/PageState.tsx`) — arama-boş / kayıt-yok ayrımı yok |
| Yükleniyor | Tabloya özel skeleton **bulunamadı**; genel `Skeleton` var | `PageSkeleton` (`animate-pulse`), DataTable içinde otomatik (`DataTable.tsx:88-93`) |
| Hata | `ErrorBoundary` (`M:components/utilities/error-boundary/error-boundary.tsx:9-59`) | `ErrorState` + `role="alert"` + "Yeniden dene" — her sorguda kullanılıyor |
| Sayfalama | `@medusajs/ui` `Table.Pagination`, i18n sarmalayıcı; `offset` query param | 10/25/50 seçici + Önceki/Sonraki (`DataTable.tsx:174-197`) |
| URL state | Tutarlı `useSearchParams` + prefix (`M:hooks/use-query-params.tsx:7-24`) | **Tutarsız**: `ProductsPanel` tam + 300ms debounce (`AdminStore.tsx:192-219`); `CountSessionsPage` kısmi, debounce yok; `DamageEventsPage` **hiç yok** (lokal `useState`, yenilenince kaybolur) |

### 1.5 Görsel dil ve token sistemi

| | Medusa | Bizde |
|---|---|---|
| Token tanımı | **Var** — `M:dashboard/dist/app.css:340-518` `:root` bloğunda ~90 CSS değişkeni (`--bg-base`, `--bg-subtle`, `--bg-field`, `--fg-base`, `--fg-muted`, `--border-strong`, `--tag-{blue,green,red,orange,purple,neutral}-{bg,text,border,icon}` …) | **Yok.** `tailwind.config.js` `theme.extend` altında yalnız `fontFamily.sans` + bir animasyon |
| Semantik sınıflar | `bg-ui-bg-base`, `text-ui-fg-subtle`, `border-ui-border-strong` … (81 `ui-` önekli sınıf, `app.css:2853-3062`) | Ham Tailwind: `bg-slate-50`, `text-slate-500`, `border-slate-200` … |
| **Renk sınıfı çeşitliliği** | Token'a indirgenmiş (tek sınıf → CSS değişkeni) | **120 farklı** benzersiz renk sınıfı. En sık: `text-slate-400`(311), `text-slate-500`(295), `text-slate-900`(114), `border-slate-200`(106), `border-slate-800`(99) |
| Yarım kalmış token | — | `B:index.css:6-18`'de `--admin-surface`, `--admin-border`, `--admin-focus` **tanımlı ama Tailwind'e köprülenmemiş ve admin dosyalarında kullanılmıyor** |
| Dark mode | `.dark` sınıfı **aynı değişken adlarını override eder** (`app.css:519+`) → bileşenler otomatik tema değiştirir, ikinci sınıf yazılmaz | `darkMode:"class"` + **891 elle `dark:` sınıfı** (1199 satırda). Disiplinli ama her sınıf iki kez yazılıyor. Eksikler: `LabelSheet.tsx:31,50`, `PackageLabel.tsx:178,192,401`, `PackingLabelSheet.tsx:108,165` (baskı çıktıları — kasıtlı olabilir, işaretsiz), `AdminStore.tsx:1958` (rozet, dark eşleniksiz) |
| Tipografi ölçeği | **İki adlandırılmış ölçek**: `txt-compact-{xsmall…xlarge}[-plus]` (9 varyant, `app.css:796-1068`) ve `txt-{…}` (6 varyant); başlıklar `h1-core/h2-core/h3-core`. "-plus" = 500 ağırlık. Font: Inter + Roboto Mono, gömülü | Ham Tailwind: 7 boyut (`text-xs` 374, `text-sm` 256, `text-base` 29, `text-lg` 11, `text-2xl` 5, `text-xl` 4, `text-3xl` 3), 5 ağırlık (`font-semibold` 228, `font-medium` 137, `font-bold` 74, `font-normal` 14, `font-black` 1 → tekil sapma). Font: Inter |
| Boşluk | Standart Tailwind ölçeği, özel token yok | **43 farklı** padding değeri (`py-2.5`, `px-3.5`, `py-0.5` dahil), **15 farklı** gap değeri |
| Radius | Standart Tailwind + bileşene özel px değerleri | **8 farklı**; `rounded-lg`(89) / `rounded-xl`(73) / `rounded-2xl`(69) birbiriyle yarışıyor — hiyerarşi yok |
| Gölge/elevation | **Adlandırılmış elevation token'ları**: `--elevation-{card-rest,card-hover,flyout,modal,tooltip,commandbar,code-block}` + `--buttons-*` + `--borders-{base,error,focus,interactive-*}` (`app.css:431-517` → `.shadow-elevation-*` 3719-3908) | 5 `shadow-*` varyantı, `shadow-sm` baskın (41) |
| Kart kalıbı | `Container` bileşeni | Ortak `Card` **yok** — `rounded-2xl border border-slate-200 bg-white` kombinasyonu 17+ kez elle yazılmış |
| İkonlar | **`@medusajs/icons`, 465 ikon**, sabit 15×15 viewBox, stroke 1.5, `currentColor`, outline+solid iki aile | `@tabler/icons-react` yüklü ama **admin ekranlarında hiç kullanılmıyor**; admin tarafı **elle inline `<svg>`** (10 dosyada dağınık) |

### 1.6 Erişilebilirlik

| | Medusa | Bizde |
|---|---|---|
| Yaklaşım | **Radix'ten miras** — kendi `aria-*` yazmıyor | **Elle yazılmış ama gerçek**: `B:hooks/useModalA11y.ts` — focus trap (`:76-84`), ESC (`:70-73`), odak geri dönüşü (`:61,95`), scroll kilidi (`:91-94`); `components/admin/ui/Dialog.tsx` `role="dialog"` + `aria-modal` + `createPortal` (`:24`) |
| Odak tuzağı | `@radix-ui/react-focus-scope` `trapped` + `AUTOFOCUS_ON_MOUNT/UNMOUNT` | `useModalA11y` (yukarıda) |
| Arka plan gizleme | `aria-hidden` paketi (`react-dialog/index.js:69`) | Scroll kilidi var, `aria-hidden` yok |
| Geliştirici zorlaması | `DialogTitleWarning` — `aria-describedby` eksikse **konsola uyarı** (`react-dialog/index.js:330-356`) | Yok |
| Label↔input bağı | Radix `Form.Control` (Slot) ile otomatik | **`<label>` 59 / form kontrolü 144.** `htmlFor` yalnız **3 dosyada** (`DeliveryOrdersPage`, `DeliveryTodayPage`, `PackingStationPage`). Erişilebilir primitive `components/ui/Field.tsx` var ama admin'de **yalnız 1 dosyada** kullanılıyor |
| `aria-*` kullanımı | Alt katmanda yoğun | 87 kullanım (144 form kontrolüne göre düşük) |
| Lint | — | `eslint.config.js`: jsx-a11y **recommended değil, bilinçli dar liste** (`label-has-associated-control`, `alt-text`, `aria-props`, `aria-unsupported-elements`, `role-has-required-aria-props`, `role-supports-aria-props` = error; `no-noninteractive-element-interactions`, `no-autofocus` = warn). Gerekçe kod yorumunda: "recommended yüzlerce uyarı üretir, CI sürekli kırmızı gürültüye döner" |
| **Kritik istisna** | — | **`EditProductModal` (`AdminStore.tsx:1294-1320`) ortak `Dialog`/`useModalA11y`'yi hiç kullanmıyor**: elle `fixed inset-0` + `onClick={onClose}`; `role="dialog"` yok, `aria-modal` yok, focus trap yok, ESC yok. Mağaza ekranının **en çok kullanılan modalı** bu |
| Klavye kısayolları | Global `G P`/`G I`/`G R` (`M:providers/keybind-provider/hooks.tsx:112-201`), Cmd+K paleti, DataGrid ok tuşu/undo/redo/kopyala-yapıştır (`components/data-grid/hooks/use-data-grid-keydown-event.tsx:45-80`) + kısayol modalı | Admin'de yok (Görevler modülünde Ctrl+K paleti var, admin'e taşınmamış) |

### 1.7 Mobil / dar ekran

| | Medusa | Bizde |
|---|---|---|
| Responsive sınıf | products/inventory/reservations/locations route dizinlerinde `sm:`/`md:`/`lg:` araması **sıfır sonuç** | **83 kullanım** (`sm:` 62, `lg:` 10, `md:` 8, `xl:` 3) — 15.620 satıra göre seyrek ama var |
| Tablo dar ekranda | Ayrı mobil düzen **bulunamadı** (`@medusajs/ui` içinde olabilir, doğrulanamadı) | **`DataTable` `renderMobileRow` ile `md:hidden` kart görünümü** (`DataTable.tsx:98-122`) — iyi desen, **ama `ProductsPanel` bu prop'u kullanmıyor**, sadece `overflow-x-auto`. Envanter tabloları `min-w-[64rem]`/`min-w-[52rem]` + yatay kaydırma |
| Modal | — | `Dialog` mobilde alttan sheet, masaüstünde ortalanmış (`Dialog.tsx:25`) |
| Dokunmatik | Üç nokta menü (hover/tık) | Açık butonlar, **hover-only aksiyon yok** — dokunmatik birinci sınıf (dağıtım panelinde bilinçli karar) |

---

## 2. Bizim panelin görsel/UX olarak en zayıf 5 noktası

### 2.1 `AdminStore.tsx` kendi altyapısını kullanmıyor (2216 satır tek dosya)
**Sorun:** Mağaza-ürün ekranının kalbi olan dosya, projenin kendi yazdığı primitive'leri görmezden geliyor: `Button` import edilmiş ama 4 kez kullanılmış, 28 ham `<button>` var; `Field` hiç kullanılmıyor; `EditProductModal` ortak `Dialog`/`useModalA11y`'yi atlayıp erişilebilirlik altyapısız kendi portal'ını yazmış. Aynı dosyada ürün formu, liste, filtre çubuğu, varyant UI'ı, CSV paneli, kategori paneli ve satır aksiyonları iç içe.
**Ne yapılmalı:** (a) `EditProductModal`'ı ortak `Dialog`'a taşı — bu tek başına focus trap + ESC + `role="dialog"` + scroll kilidi kazandırır; (b) ham `<button>`'ları `Button`'a çevir; (c) dosyayı panel bazında böl (`ProductsPanel`, `ProductForm`, `VariantSection`, `BulkImportPanel`, `CategoriesPanel` ayrı dosyalar).
**Kaba büyüklük:** (a) yarım gün · (b) yarım gün · (c) 1-1.5 gün.

### 2.2 Tasarım token sistemi yok — 120 farklı renk sınıfı
**Sorun:** Semantik katman olmadığı için her yüzey rengi elle seçiliyor; `rounded-lg/xl/2xl` üçü de ~70-90 kez geçiyor (hiyerarşi yok), 43 farklı padding değeri var, kart kalıbı 17+ kez elle yazılmış. Dark mode 891 elle `dark:` sınıfıyla ayakta duruyor — çalışıyor ama her yeni ekran iki kat yazım maliyeti ve unutma riski demek (`AdminStore.tsx:1958` zaten unutulmuş). **Ayrıca `index.css:6-18`'de `--admin-surface`/`--admin-border`/`--admin-focus` değişkenleri tanımlanmış ama hiçbir yere bağlanmamış** — yarım kalmış bir girişim duruyor.
**Ne yapılmalı:** Medusa'nın indirection'ını al: `tailwind.config.js`'e semantik renkler ekle (`surface`, `surface-subtle`, `fg`, `fg-muted`, `border`, `border-strong`), değerlerini `:root` ve `.dark` altında CSS değişkeniyle ver. Sonuç: `bg-surface` tek sınıfı iki temada da doğru çalışır, `dark:` çiftlemesi büyük ölçüde kalkar. Mevcut `--admin-*` değişkenleri bu işin başlangıcı olarak kullanılabilir.
**Kaba büyüklük:** Token tanımı + `Card`/`Surface` primitive'i ~1 gün; kademeli geçiş (ekran ekran) ayrı.

### 2.3 Düzenleme yüzeyleri URL'e yansımıyor, desen ekran ekran değişiyor
**Sorun:** Ürün düzenleme URL'siz modal, sayım detayı gerçek sayfa, hasar işlemi URL'siz modal, stok defteri modal içine gömülü panel. Sonuç: ürün düzenlemesine deep-link atılamıyor, geri tuşu modalı kapatmıyor, sayfa yenilenince bağlam kayboluyor. Sayfalama/filtre URL state'i de tutarsız — `DamageEventsPage` filtresini hiç URL'e yazmıyor.
**Ne yapılmalı:** Medusa'nın rota-modal desenini al: `/yonetim/magaza/urunler/:id/duzenle` gibi nested route + kapanınca `navigate(-1)`. En azından ürün düzenleme ve tüm liste filtrelerini URL'e taşı.
**Kaba büyüklük:** Rota-modal sarmalayıcısı ~1 gün, ürün ekranına uygulama ~0.5 gün, filtre URL state'i tekilleştirme ~0.5 gün.

### 2.4 Ortak form katmanı yok — hata ve yardım metni her yerde elle
**Sorun:** Form kütüphanesi yok, `Field`/`Hint`/`ErrorMessage` üçlüsü yok. Doğrulama hataları çoğunlukla toast'a gidiyor — kullanıcı **hangi alanın** hatalı olduğunu göremiyor. Zorunlu alan işareti yok. Kaydedilmemiş değişiklik uyarısı yok: uzun ürün formunu doldurup modalın dışına tıklayınca her şey gidiyor.
**Ne yapılmalı:** (a) `Field` primitive'ini genişletip (`label htmlFor` + `hint` + `error` tek slot, Medusa'daki gibi) admin formlarında zorunlu kıl — bu aynı zamanda 59/144 label açığını kapatır; (b) modal formlarda `dirty` bayrağı + kapatma onayı; (c) alan bazlı hata gösterimi (toast'a ek, yerine değil).
**Kaba büyüklük:** (a) 1 gün + ekran başına dönüşüm · (b) yarım gün · (c) (a) ile birlikte gelir.

### 2.5 Tablo deseni bölünmüş, mobil kart görünümü yazılmış ama kullanılmıyor
**Sorun:** Ortak `DataTable` yalnız `ProductsPanel`'de kullanılıyor; `CountSessionDetailPage` ve `DamageEventsPage` kendi tablolarını elle yazmış — sayfalama, boş durum, sıralama göstergesi ve mobil davranış oralarda tekrar üretilmiş/eksik. `DataTable`'daki `renderMobileRow` kart deseni (Medusa'da karşılığı **yok**, bizim artımız) hiçbir ürün/envanter ekranında kullanılmıyor; dar ekranda 720px–1024px genişlikte yatay kaydırma kalıyor.
**Ne yapılmalı:** Envanter tablolarını ortak `DataTable`'a taşı; `ProductsPanel` ve envanter listelerine `renderMobileRow` yaz; `EmptyState`'i Medusa gibi ikiye ayır ("arama sonucu yok" vs "hiç kayıt yok" — ikincisi aksiyon butonlu).
**Kaba büyüklük:** ~2 gün.

---

## 3. Medusa'dan alınabilecek somut desenler (kütüphane değil, desen)

1. **Rota-modal** — düzenleme yüzeyi kendi URL'inde yaşar, kapanınca geri navigasyon. Deep-link, geri tuşu ve sayfa yenileme bedava gelir. (`route-drawer.tsx`, `route-focus-modal.tsx`)
2. **Kaydedilmemiş değişiklik bekçisi** — `useBlocker` + onay diyaloğu; başarılı submit'te bayrakla atlanır. (`route-modal-form.tsx:26-92`)
3. **Salt-okunur bölüm + ayrı düzenleme yüzeyi** — detay sayfası bölümlere ayrılır, her bölümün kendi "Düzenle" rotası olur. Dev tek forma göre hem okunabilir hem odaklı.
4. **Hint ve error'ın aynı slotu paylaşması** — alan altında tek satır: hata varsa hata, yoksa açıklama. Yerleşim zıplamaz. (`form.tsx:188-210`)
5. **Token indirection** — semantik sınıf → CSS değişkeni → `.dark` override. `dark:` çiftlemesini ortadan kaldırır.
6. **Adlandırılmış elevation ölçeği** — `card-rest`/`card-hover`/`flyout`/`modal`/`tooltip` gibi rol bazlı gölge isimleri; `shadow-sm`/`shadow-md` keyfiliğini bitirir.
7. **İki ayrı boş durum** — `NoResults` (filtre eşleşmedi, "filtreleri temizle") vs `NoRecords` (hiç kayıt yok, "ilkini ekle"). İkisi farklı kullanıcı niyetidir.
8. **Satır tıklamasının gerçek link semantiği** — `rowHref` + Ctrl/Cmd tık yeni sekme, Shift yeni pencere. Tablo satırı "tıklanabilir div" değil, gerçek gezinti.
9. **Adım göstergeli sekmeler (`ProgressTabs`)** — uzun ürün formunu 3-4 mantıklı adıma bölerken hangi adımın tamamlandığını göstermek.
10. **DataGrid ile toplu düzenleme** — varyant fiyat/stok gibi matris veriyi Excel benzeri ızgarada girmek; ok tuşları, kopyala-yapıştır, undo/redo. (Fonksiyonel rapordaki "varyant matrisi" eksiğinin doğal arayüzü.)
11. **Alan zorunluluğunu tersten işaretlemek** — çoğunluk zorunluysa yalnız isteğe bağlı olanları "(opsiyonel)" diye işaretle; yıldız gürültüsü kalkar.
12. **Geliştirici zorlaması** — a11y sözleşmesi ihlal edilince dev modda konsol uyarısı (Radix'in `DialogTitleWarning`'i gibi). Bizde `EditProductModal` sapması böyle bir bekçi olsaydı doğduğu gün yakalanırdı.

**Almaya değmeyenler:** Medusa'nın ana listelerinde **sıralama göstergesi yok** (bizde var), **mobil düzen yok** (bizde kart deseni var), tablo skeleton'ı bulunamadı, ve **iki paralel tablo implementasyonu** taşıyor — bunlar kopyalanacak şeyler değil.

---

## 4. Bizde iyi olan ve korunması gereken şeyler

1. **`useModalA11y` + `Dialog`** — Radix olmadan elle yazılmış ama tam: focus trap, ESC, odak geri dönüşü, scroll kilidi, body portal. Medusa bunu kütüphaneden alıyor; biz yazmışız ve çalışıyor. **Korunmalı ve zorunlu kılınmalı** (bkz. 2.1).
2. **`DataTable`'ın mobil kart deseni** (`renderMobileRow`) — Medusa'da karşılığı bulunamadı. Bizim artımız; kullanılmıyor olması ayıp, varlığı değerli.
3. **Sıralama göstergesi + sunucu taraflı `manualSorting`** — Medusa'nın ana liste ekranlarında sıralama hiç yok.
4. **`EmptyState`/`ErrorState`/`PageSkeleton` üçlüsü tutarlı kullanılıyor** — "hata ≠ boş ekran" kuralı envanter sayfalarında da uygulanmış, her sorguda `ErrorState` + "Yeniden dene" var.
5. **Dark mode kapsamı** — 891 `dark:` kullanımı, 59 dosyanın neredeyse tamamında. Yöntem pahalı ama sonuç kapsayıcı; token'a geçerken bu kapsam kaybedilmemeli.
6. **Hover-only aksiyon yok / dokunmatik birinci sınıf** — satır aksiyonları açık buton. Üç nokta menüye geçerken bu kararı bilinçli olarak korumak gerekir (kalabalık listede menüye geçilecekse, dokunmatik hedef boyutu korunmalı).
7. **Dar kapsamlı a11y lint** — "recommended açıp CI'ı kırmızı gürültüye boğmak" yerine gerçekten uygulanan 8 kural. Doğru mühendislik kararı; `Field` benimsendikçe liste genişletilebilir.
8. **Merkezi toast** (`store/toastStore.ts`) ve **URL query state + debounce** (`ProductsPanel`) — desen doğru, sorun yalnız her ekranda uygulanmamış olması.
9. **Türkçe arayüz dili ve `Intl` ile yerelleştirme** — Medusa i18next taşıyor, biz doğrudan Türkçe yazıyoruz; tek dilli ürün için doğru sadelik.
