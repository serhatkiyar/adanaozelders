# Claude Fable 5 — Cıncık Teslimat’ı profesyonel operasyona taşı

## Rol ve çalışma biçimi

Sen bu repo içinde çalışan kıdemli bir staff/principal full-stack mühendisi, son-kilometre lojistik ürün mimarı ve operasyon güvenilirliği uzmanısın. Görevin çalışan “Cıncık Teslimat” sistemini yeniden yazmak değil; kanıtlı mevcut kabiliyetleri koruyup hobi düzeyinden ölçülebilir, kapasite ve saha gerçeklerine dayanıklı profesyonel Adana kent içi operasyona taşımaktır.

Önce kodu ve belgeleri incele, bir boşluk/izlenebilirlik matrisi çıkar, sonra öncelik sırasıyla uygula. Belgelerdeki hedefleri uygulanmış özellik sanma. Her önemli iddiayı gerçek dosya, model, endpoint veya test ile doğrula. Repo ile bu prompt çelişirse çalışan kodu gerçek kabul et; farkı raporla ve güvenli geçiş tasarla. Yarım iskelet, sahte başarı, yalnız UI’dan ibaret özellik veya mock veri bırakma.

Repo içinden çıkarılamayan ve ürün davranışını maddi biçimde değiştiren kararlarda tahmin yürütme. Güvenli/konfigüre edilebilir sınırda dur ve şu formatı kullan:

`KULLANICIYA SOR: <somut karar> — <seçenekler ve etkileri>`

## Önce okunacak kaynaklar

- `CLAUDE.md`: “Mağaza Kendi-Filo Teslimatı (Faz A)” ve “Cıncık Teslimat genişletmesi (Faz D-H)”.
- `docs/delivery-experience-design.md`: PDS v2; kapasiteli söz motoru, akışlar, 57 edge case, MVP/V2/V3 ve KPI sözlüğü. Bu belge tasarım referansıdır, implementasyon sözleşmesi değildir.
- `docs/delivery-screens-wireframes.md`: 28 ekran, durumlar, responsive ve accessibility beklentileri.
- `backend/services/delivery_promise.py`, `backend/services/delivery_service.py`, `backend/services/delivery_timeline.py`.
- `backend/core/routing/`, `backend/core/courier_position.py`, `backend/core/sms/`.
- İlgili modeller, şemalar, router’lar, migration’lar, ayarlar ve testler; özellikle `Order`, `ClientAddress`, `DeliveryRun`, `DeliveryStop`, `Courier` ve status history.
- `frontend/src/pages/dashboards/AdminDelivery.tsx`, `frontend/src/pages/DeliveryDriver.tsx`, `frontend/src/pages/store/CargoTrackingPage.tsx`, `frontend/src/api/delivery.ts`, `frontend/src/hooks/useDelivery.ts`, `frontend/src/components/DeliveryRouteMap.tsx`, `frontend/src/components/admin/CourierManager.tsx`, `frontend/src/components/store/DeliveryPromiseBadge.tsx` ve ilgili type/lib testleri.

İlk çıktın koddan önce “tasarım hedefi / bugün gerçekten var / boşluk / risk / önerilen faz” matrisi olsun. PDS’nin V2/V3 etiketleriyle repo içinde Faz B-H kapsamında zaten uygulanmış parçaları ayır.

## Doğrulanmış mevcut sistem ve iş bağlamı

Operasyon Adana kent merkezinde, Seyhan/Çukurova/Yüreğir’in yoğun apartman dokusunda, yaklaşık bir milyon nüfuslu çekirdekte yürür. Alan depo merkezli `DELIVERY_ZONE_RADIUS_KM=25` yarıçapıdır. Pin varsa otoritedir; yoksa yapısal il/ilçe fallback’i kullanılır. Repo dışında mahalle, trafik veya servis süresi sayısı uydurma.

“Cıncık Teslimat” gün içi teslimat iddiasıdır. Mevcut saf hesap Adana yerel saatinde 16:00 cutoff’u, Pazar sarmasını ve ödeme anında `Order.promised_delivery_date` snapshot’ını içerir; `first_day_with_capacity` kapasiteye duyarlı gün seçer. Profesyonel hedef, cutoff’a değil gerçek araç/kurye/vardiya/yeniden-deneme kapasitesine dayanarak tutulabilir söz vermektir.

Fiziksel kitaplarda otomatik dış kargo entegrasyonu yoktur. LADA birincil, COROLLA yedektir; `DELIVERY_SINGLE_VEHICLE_MAX_STOPS=12` üstünde çoklu araç planlama vardır. Bölge dışı siparişler “Dış kargo bekleyenler” kuyruğundadır; şirket+sandbox sağlanmadan taşıyıcı veya manuel takip akışı uydurma.

Mevcut omurga günlük tur kurma, PAID fiziksel siparişi durağa ekleme, elle sıralama, QR etiket, tur başlatma; mobil ADMIN saha ekranında Google Maps deep-link, paket QR, SMS OTP, notlu yönetici teslimi, foto PoD, FAILED ve RESCHEDULED sonuçlarını içerir. Teslim DELIVERED yapar; FAILED siparişi PAID’e döndürüp yeniden uygun kılar. Tercihler siparişte yaşar: `ADRESIMDEYIM`, `KAPIYA_BIRAK`, `KOMSUYA_BIRAK`, `BENI_ARA`; bırakma tesliminde foto zorunlu, erteleme limiti 2’dir.

Routing sağlayıcı soyutlamalıdır: `ROUTING_PROVIDER=auto` self-hosted VROOM+OSRM’yi dener, kullanılamazsa nearest-neighbor+2-opt/çoklu araçta açısal bölümlendirme kullanan haversine fallback’e iner. Sonuç sıra, ETA, mesafe/süre, polyline ve `detour_km` üretebilir. Fallback yaklaşık hesaptır; gerçek geometri/kesin ETA gibi sunulmaz.

Canlı konum Redis’te yalnız son nokta, 180 saniye TTL ile tutulur; kalıcı iz yoktur ve Redis arızası ana akışı bozmaz. Saha yaklaşık 10 saniyede best-effort ping yollar, müşteri/admin yaklaşık 15 saniyede okur. Takip yüzeyi maskeli alıcı, whitelist timeline, nokta ETA yerine pencere, kurye kartı, durak sayacı, harita, sinyal yaşı ve kanıt taşır. `reason`/`changed_by` müşteriye asla sızmaz.

SMS katmanı sağlayıcı soyutlamalıdır: geliştirmede console, üretimde Netgsm; gönderim best-effort/fail-open’dır. OTP hash’li, süreli ve deneme limitlidir. Takip, yaklaşan kurye, başarısız ve erteleme SMS’leri vardır. Netgsm’de prod yanıt kodu doğrulaması/gönderici başlığı TODO’sunu denetle; başarısız gönderimi “gönderildi” sayma.

## İş hedefleri ve değişmez kısıtlar

Ana hedef; aynı gün sözünü ölçülebilir şekilde tutan, söz borcunu yeni satıştan önce yöneten, apartmanda kapı bulma/erişim kaybını azaltan, vardiya-mola-servis süresini hesaba katan, offline ve sağlayıcı arızalarında güvenli küçülen ve istisnayı önceden gösteren sistemdir.

- Söz gerçek araç+kurye+vardiya+mola+depo hazırlık+sürüş/servis kapasitesine rezervasyon koymalı; eşzamanlı ödemede overbooking olmamalı.
- FAILED/RESCHEDULED yeniden denemeleri yeni satıştan önce kapasite yemeli; açık, denetlenebilir öncelik kuralı olmalı.
- Söz günü/pencere sessizce kaymamalı. Risk/ihlal müşteriye ve operasyona ayrı güvenli projeksiyonla yansımalı.
- Kurye hız baskısına sokulmamalı; güvenlik ve mola rota puanından üstündür. `durak/saat` güvenlikle birlikte kapasite girdisidir.
- Adres kalitesi pin, il/ilçe, mahalle/sokak, bina, site/blok, kat/daire, zil ve erişim tarifini kapsamalı. Yeni zorunlu alan kararı belirsizse kullanıcıya sor.
- Kararlar audit edilebilir olmalı; PII/PoD minimizasyonu ve whitelist müşteri projeksiyonu korunmalı.
- Bölge dışına çalışmayan takip veya aynı-gün sözü verilmemeli.
- İlk 90 gün baseline’dır; kanıtsız SLA hedefi uydurulmaz.

## Faz 0 — Denetim ve güvenlik ağı (P0)

Ödeme→söz rezervasyonu, hazırlama→tur, tur→durak, QR→kanıt→sipariş, FAILED/RESCHEDULED→yeniden uygunluk, iptal/iade, takip ve bildirim state machine/transaction sınırlarını çıkar. PDS’deki 57 edge case’i “karşılanıyor/kısmi/yok/kapsam dışı” olarak kod/test bağlantısıyla işaretle; wireframe V2/V3 boşluklarını ekle.

Yarışları denetle: son kapasite slotuna eşzamanlı ödeme, aynı siparişi iki tura ekleme, durağı iki cihazdan sonuçlandırma, OTP tekrar kullanımı, foto/teslim yarışı, optimize/reorder sırasında start, başarısızlıkla yaklaşan bildirim yarışı, aynı araç/kurye için çakışan aktif tur. UI disable yeterli değildir; DB constraint, row lock, idempotency veya transaction kullan.

**Bitti:** Matris dosya/endpoint/test referanslıdır; kritik invariant’lar server-side ve testlidir; 57 vakanın her biri izlenebilir, cevapsız P0 yoktur; mevcut davranış regresyon testleriyle kilitlidir.

## Faz 1 — Kapasiteli söz ve SLA doğruluğu (P0)

Capacity reservation; aktif araçlar, atanabilir kurye, vardiya, mola, depo tamponu, tahmini sürüş/servis, mevcut vaatler, retry borcu ve operasyon tamponunu birleştirsin. LADA/COROLLA ve 12 durak davranışını koru; durak sayısını tek başına kapasite sanma.

Ödeme anındaki rezervasyon atomik olsun. Checkout rozetiyle PAID sözü aynı authoritative backend kararını kullansın. Arada kapasite dolarsa dürüst yeni söz göster. Ayar değişikliği etki önizlemesi+audit üretsin; mevcut vaatleri sessizce değiştirmesin. Tatil/özel gün, cutoff sınır saniyesi, kapalı hafta, kapasite ufku ve timezone testleri ekle.

`KULLANICIYA SOR: Çalışma/kapalı gün takvimi admin tarafından mı yönetilecek, yoksa hangi doğrulanmış kaynak kullanılacak?`

`KULLANICIYA SOR: LADA/COROLLA çalışma saatleri, kurye vardiyaları, zorunlu mola, depo tamponu ve apartman servis süresi başlangıç değerleri nedir?`

**Bitti:** Concurrency fazla vaat üretmez; checkout/ödeme tutarlıdır; retry öncelikli fakat starvation yaratmaz; admin en az 14 günlük kapasite/doluluk/söz borcu/risk görür; eksik veri/fallback sözü genişletir; unit+integration+concurrency testleri geçer.

## Faz 2 — Adres, hazırlama ve dispatch kalitesi (P0/P1)

Pin otoritesini koruyup yapılandırılmış adres/erişim kalitesi kur. Eksik veya çelişkili pin, bina, blok, kat, daire, zil/site girişini checkout’ta erken yakala. Kurye “adres bulunamadı/zil bozuk/güvenli değil” bilgisini PII-safe geri beslemeye çevir; müşteri onayı olmadan kalıcı adresi değiştirme. Bölge dışı adres değişiminde `OUT_OF_ZONE` ve explicit force davranışını koru.

PDS hazırlama istasyonunu gerçek implementasyona göre tamamla: PAID fiziksel sipariş→pick/pack→etiket→hazır; yalnız hazır/etiketi doğrulanmış paket tura girsin. Yeniden baskı, bozuk yazıcı, mükerrer etiket, yanlış/eksik paket ve yükleme sırasını ele al. Aynı müşteri/adres/gün siparişlerini timeline/kanıtı bozmadan tek durakta birleştir.

Dispatch Board’da kapasite sağlık şeridi ve hazır değil/pinsiz/retry/söz riski/rotayı bozan/dış kargo/atamasız istisnaları ayrıştır. VROOM ile fallback’i etiketle; fallback geometrisi yoksa kuş uçuşu çizgi çizme. Optimize diff’inde sıra, km, süre, risk ve araç dağılımı göster; onaysız aktif tur bozma.

**Bitti:** Eksik adres/etiket/hazırlıkla start server-side engelli; chain-of-custody auditli; birleşik durak kapasiteyi doğru tüketir; admin riskin nedenini tek ekranda görür; provider güven düzeyi dürüst görünür.

## Faz 3 — Vardiya, saha güvenilirliği ve offline-first (P1)

`/dagitim/:id` ekranına kurye/araç check-in, yükleme taraması, vardiya/mola, devir, araç değişimi, batarya/konum/bağlantı sağlığı ve gün sonu uzlaştırma ekle. ADMIN saha kullanımı mevcutsa kırma.

`KULLANICIYA SOR: Saha ekranı ADMIN ile mi kalacak, yoksa ayrı COURIER rolü ve minimum RBAC mı kurulacak?`

Tek el, ≥56 px hedef, açık hava kontrastı, ses/haptik ve kritik aksiyonda swipe/confirm sağla. Google Maps deep-link’i koru; turn-by-turn yazma.

Gerçek offline outbox kur: QR, foto metadata/yükleme, OTP sonucu, FAILED/RESCHEDULED ve ping işlemlerini risk bazlı ayır; client idempotency key, sıra ve conflict çözümü olsun. Server doğrulaması gereken teslim yerelde yalnız “bekliyor” olsun. SMS/Redis/routing fail-open olabilir; kanıt/state doğruluğu olamaz.

FAILED serbest metnini neden kodlarına taşı: evde yok, adres/pin, erişim/zil, müşteri ertelemesi, erken deneme, güvenlik, paket, araç vb. İç not sızmasın. PDS’deki 2 dakika, önce bildirim sonra arama, OTP devri/onay linki, genel vakada aynı gün dönmeme ve düzeltilen adresi sona atma kurallarını uygulamayla karşılaştırıp tamamla.

**Bitti:** Vardiya/mola dışında servis yok; devir auditli; offline replay kayıpsız/çiftsiz; güvenlik olayı kurye performansını düşürmez; FAILED deterministik; gün sonu paket/durak/kanıt farkı görünür.

## Faz 4 — Müşteri güveni ve bildirim (P1)

Tek takip yüzeyi söz→dağıtım→kanıt biçiminde adaptif olsun. Harita/sayaç yalnız son yaklaşık 8 durakta açılsın; sayı artarsa “sıra güncellendi” yazsın. 90 sn’de marker bayat, 180 sn’de yok olsun. Gerçek geometri yoksa çizgi çizme. Nokta ETA verme; provider güvenine göre pencere üret. Pencere yalnız daralsın; kayma nedenli olay+bildirim olsun.

Public token: maskeli alıcı, gizli adres, PoD foto yok, teslimle pasif. Kapıya/komşuya bırakma gibi yetki yükseltme public token’la yapılmasın; oturum veya OTP/onay gerekir. “Beni ara” öncesi bildirim ve SMS alternatifi olsun.

Bildirimleri idempotent outbox/log ile yönet; kanal, template sürümü, amaç, sonuç ve retry kaydı olsun. Ticari ve teslimat kanalı karışmasın. Sessiz saat 21:00–08:30, SMS tavanı ve zorunlu istisna ayrımı uygulansın. Netgsm HTTP ve iş cevabı doğrulansın. Console/prod aynı interface’te kalsın.

`KULLANICIYA SOR: PoD fotoğrafı, bildirim ve audit kayıtlarının hukuk/KVKK onaylı saklama süreleri nedir?`

**Bitti:** Kesinlik veri kaynağını aşmaz; public/session/admin projeksiyonları güvenlik testlidir; bildirim idempotent ve ölçülebilir; pencere kaçması proaktiftir; tracking tüm loading/empty/error/offline/stale/success ve dark-mode durumlarını taşır.

## Faz 5 — İstisna, retry ve telafi (P1)

Birleşik istisna kuyruğu kur: söz/kapasite riski, hazırlanmamış paket, pinsiz adres, routing arızası, bayat sinyal, araç arızası, güvenlik, tekrarlı FAILED, SMS hatası, PoD eksikliği, ihtilaf. Her vakada sahip, önem, yaş, SLA saati, önerilen aksiyon ve kapanış nedeni olsun. Telafiyi otomatik verme; sistem önerir, insan onaylar.

İlk FAILED ertesi gün öncelikli; ikincide operasyon araması; üçüncüde teslim alma/iade istisnası. Sonsuz PAID↔FAILED olmasın.

`KULLANICIYA SOR: Üçüncü başarısız denemede fiziksel teslim alma noktası var mı; yoksa iptal/iade prosedürü nedir?`

Erken varış, müşteri ertelemesi, güvenlik ve kurye kaynaklı başarısızlığı KPI’da ayır. Genel evde-yok vakasında aynı gün geri dönüş yapma.

**Bitti:** Kritik vaka sahipsiz kalmaz; retry borcu kapasitede görünür; üç deneme deterministik; telafi insan onaylı/auditli; timeline kötü olayı silmez ve iç not sızdırmaz.

## Faz 6 — Kontrol kulesi, KPI ve unit economics (P1/P2)

Önce immutable event/timestamp ve metric catalog, sonra dashboard. PDS §14: kuzey yıldızı sorunsuz sipariş; söz tutma, pencere isabeti, ilk deneme, WISMO, erteleme, pencere genişliği; maliyet/durak, SMS/sipariş, durak/saat, retry maliyeti, kapasite kullanımı. Payda, hariç tutma, timezone ve source merkezi olsun.

Bugün/yarın/7–14 gün; söz riski, kapasite/borç, araç/kurye ve vardiya/mola, provider sağlığı, planlanan-gerçekleşen süre, adres kalite ve FAILED Pareto’su göster. Kurye skorunu ham hızla üretme; rota zorluğu, apartman servisi, erken deneme, erteleme ve güvenliği ayır. İlk 90 gün hedef/kırmızı-yeşil yargı olmadan baseline+trend sun.

`KULLANICIYA SOR: Yakıt, amortisman/bakım, kurye saat maliyeti ve destek temas maliyeti hangi kaynak/periyotla girilecek?`

**Bitti:** KPI elle hesap örneğiyle testli; event’ten yeniden üretilebilir; sahte hedef yok; drill-down aksiyon alınabilir; maliyet varsayımı kod içine gömülü değil.

## Faz 7 — V2/V3 kontrollü ölçekleme (P2)

Faz 0’da gerçekten eksik kalanları yap; var olan rota/takip/kurye kartı/tercih/bildirimi yeniden yazma. Öncelik: teslimat 👍/👎 ve yapılandırılmış sorun; çoklu paket/birleşik durak; gerçek iş süreci varsa ücretsiz kargo iadesi+para timeline’ı; sonra kapasite bazlı slot, gün içi incremental multi-vehicle dispatch, ETA sapma alarmı, kapıdan pickup/değişim.

En az 90 günlük temiz baseline olmadan “AI/predictive” özellik açma; önce açıklanabilir eşik kullan. Slot gerçek rezervasyonsuz açılamaz. Gün içi sipariş mevcut pencereyi bozuyorsa otomatik eklenmez. Pickup/değişim outbound chain-of-custody’den ayrı modellenir. Ticari karar/credential yoksa entegrasyon uydurma; interface, dev console/fake ve blocked state bırak, kullanıcıya sor.

**Bitti:** V2/V3 matrisi güncel; her özellik kapasite, audit, flag, rollback ve observability taşır; prediction ölçüm+aksiyon olmadan yayımlanmaz; pickup outbound kanıtı bozmaz.

## Doğrulama ve test

- Unit: cutoff sınırı, Adana saati, Pazar/kapalı gün, 25 km sınırı, kapasite ufku, ETA yuvarlama, timeline whitelist, maskeleme, VROOM parse/fallback.
- DB/integration: eşzamanlı son slot, mükerrer durak/tur, transition/lock, offline replay, retry önceliği, audit/event/outbox atomikliği, soft-delete.
- Provider contract: routing auto/vroom/haversine; Redis yok/bayat; SMS console/Netgsm timeout/iş kodu; upload hatası. Fail-open gözlemlenir.
- API/security: RBAC, public token, IDOR, rate limit, PII/`reason`/`changed_by`, foto erişimi, invalid state 409.
- Frontend Vitest/React Query: loading/empty/error/offline/stale/retry/conflict/çift tıklama, Türkçe tarih-saat.
- E2E: ödeme→söz→hazırlık→dispatch→QR→OTP/foto→DELIVERED; FAILED→öncelikli retry; erteleme; iki araç; VROOM/Redis/SMS kesintisi; public token; offline replay.
- Görsel/a11y: saha mobil, admin desktop/tablet, müşteri mobil; iki tema; WCAG 2.2 AA, renk tek taşıyıcı değil, müşteri ≥44 px, kurye ≥56 px, %200 reflow, klavye/focus/reduced-motion.
- Yük: cutoff burst, dispatch listesi, 10 sn yazma/15 sn okuma, fan-out ve dashboard; N+1/sınırsız polling yok.

Her faz sonunda komutları, geçen/kalan testleri, migration etkisini, riskleri ve rollback’i yaz. Erişilemeyen OSRM/Netgsm testini geçmiş sayma; contract/fallback’i doğrula.

## Proje ve kalite kuralları

- Mock/sahte veri yok; UI gerçek API ve persist edilmiş veriye bağlı.
- Sağlayıcı interface arkasında: dev fake/console, prod real. Vendor çağrısını UI/service’e saçma.
- Fail-open yalnız SMS/canlı konum/routing gibi ikincil kabiliyette; kapasite, güvenlik, fiyat, ödeme ve teslim kanıtında değil. Degrade durum dürüst ve ölçülebilir.
- Fiyat ve parasal sonuç server-side; istemci tutarına güvenme.
- Model değişikliğinde Alembic migration; autogenerate’i incele, index/constraint/backfill tamamla. `models/__init__.py`, `__all__`, soft-delete ve baseline yaklaşımını koru; `create_all` kaçamağı yok.
- Yeni router ana router’a include; frontend yalnız React Query hook+mevcut axios; tip sözleşmesi güncel.
- Server-authoritative state machine, idempotency, transaction ve audit; iş kuralı yalnız React’te olmaz.
- Mevcut ayrı kullanıcı tabloları/RBAC’ı koru. Public token minimum yetkili, iptal edilebilir ve brute-force dayanıklı; OTP/token düz metin saklama/loglama. Kalıcı kurye izi yok.
- Dark-mode paritesi acceptance criterion’dır.
- Kullanıcı metni tam Türkçe ortografili (`İ/ı/Ş/ş/Ğ/ğ/Ü/ü/Ö/ö/Ç/ç`); mojibake, yarım çeviri, İngilizce placeholder yok.
- UI sakin, premium, operasyonel: gereksiz gradient/gölge/konfeti/sürekli pulse/emoji/alarm rengi yok. Renk yalnız aksiyon/istisna; bilgi ikon+metinle de anlaşılır.
- Google Maps deep-link korunur; turn-by-turn yazılmaz. OSM prod kapasite/attribution kararı belirsizse kullanıcıya sor.
- İlgisiz refactor yok. Faz A-H ve API tüketicileri korunur; kırılmada compatibility+rollout planı.
- Riskli özellik feature flag, observability ve rollback olmadan üretime hazır değildir.

## Her fazın ve nihai teslimin biçimi

Her faz sonunda:

1. `Denetlenen gerçekler`
2. `Yapılan değişiklikler`
3. `Invariant ve güvenlik kararları`
4. `Test/kanıt`
5. `Operasyon etkisi ve metrik`
6. `Migration/rollout/rollback`
7. `Kalan riskler`
8. Varsa `KULLANICIYA SOR:`

Son raporda Faz 0 matrisini güncelle; 57 edge case’in durumu, V2/V3 boşlukları, değişen dosyalar, migration zinciri, testler, feature flag’ler, runbook ve dış karar/credential işleri tek yerde olsun. “Profesyonel operasyon” iddiasını ekran sayısıyla değil; tutulan söz, güvenli saha, kapatılan istisna, yeniden üretilebilir metrik ve kanıtlanmış degrade davranışla göster.
