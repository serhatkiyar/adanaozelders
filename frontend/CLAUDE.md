# Frontend — çalışma notları

Node sürümü CI ile aynı olmalıdır: Node 20.

## Veri ve gezinme

- Yeni API kullanımı: type → API fonksiyonu → React Query hook'u → bileşen akışını izler.
- Ortak axios instance'ını kullan; bileşen içinde dağınık ham HTTP çağrısı açma.
- Server response'unu sahte liste veya placeholder ile ikame etme.
- Link/navigate URL'lerini `ROUTES`/`PATHS` üzerinden üret; mevcut dış bağlantılar dışında sayfa yenileten gezinme ekleme.
- Refresh token JavaScript state'ine alınmaz; httpOnly cookie akışını koru.
- Loading, empty ve error durumlarını değiştirilen yüzeyin ihtiyacına göre ele al.

## UI yaklaşımı

- Çevredeki ekranın mevcut dilini takip et; proje çapında yeni estetik kural icat etme.
- Responsive davranışı ve klavye erişimini bozma.
- Site TEK temadır (açık): `dark:` sınıfı YAZMA — nöbetçisi `src/__guards__/tekTema.test.ts`.
- Küçük talepte geniş UI refactor'ı yapma.
### Görsel kalite

- Anlamlı bir görsel değişiklikten önce `../docs/DESIGN.md` dosyasını oku. Yeni yönetim paneli (`/yonetim-yeni`, `src/panel/`) DESIGN.md kapsamı dışındadır: ölçü/yerleşim kaynağı `../docs/ikas-panel-referans.md`, modül durumu `../docs/panel-ikas-ilerleme.md`.
- Kullanıcı açıkça yeni bir görsel yön istemedikçe mevcut ürün dilini koru; her görevde yeni bir estetik icat etme.
- Jenerik AI/SaaS estetiğinden kaçın: gereksiz kartlar, renkli kutular, gradientler, glassmorphism, dekoratif badge/pill, anlamsız gölgeler ve sırf görsel çeşitlilik için eklenen öğeler kullanma.
- Referans ekranları birebir kopyalama; bilgi hiyerarşisi, etkileşim ve yerleşim fikrini mevcut Adana Özel Ders tasarımına uyarla.
- Anlamlı frontend değişikliğini yalnız test/build geçti diye tamamlanmış sayma. Mümkün olduğunda gerçek sayfayı tarayıcıda desktop ve mobil boyutta görsel olarak kontrol et.
- Görsel kontrolde hiyerarşi, boşluklar, hizalama, tipografi, taşma, responsive davranış ve ana aksiyonun belirginliğini değerlendir.
- Yeni ve önemli bir görsel yön gerekiyorsa kodlamadan önce birbirinden gerçekten farklı birkaç yön öner; seçilen yönü uygula.
- Anlamlı frontend görsel değişikliklerinde tamamlamadan önce `ui-review` skill'ini uygula.
- Bağımsız eleştiri gereken değişikliklerde `ui-reviewer` subagent'ini kullan; reviewer sonucunu otomatik doğru kabul etme, `DESIGN.md` ve ürün gereksinimleriyle değerlendir.
- Frontend review sırasında bulunan veya çözülen somut açık sorunlar `docs/UI-ISSUES.md` içinde `ui-review` workflow'u tarafından güncel tutulur.
## Çalıştırma ve doğrulama

```bash
cd frontend
npm ci
npm run dev
```

En küçük ilgili kontrolü bir kez çalıştır:

- Saf yardımcı değiştiyse ilgili `*.test.ts(x)` dosyası.
- Type/API sınırı değiştiyse `npx tsc -b` veya `npm run build`.
- JSX erişilebilirliği değiştiyse ilgili dosyada ESLint; bütün suite ancak gerekliyse.
- Sadece metin, stil veya Claude talimatı değiştiyse bütün frontend testlerini çalıştırma.

Her bileşen değişikliğine otomatik test yazma. Yeni kritik davranış, düzeltilen bug veya saf ve geri dönmesi kolay mantık varsa test ekle; aynı başarılı komutu tekrar tekrar çalıştırma.
