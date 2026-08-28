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
