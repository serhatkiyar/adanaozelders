# Adana Özel Ders — Claude çalışma notları

Bu depo iki uygulamalı bir monorepodur: `backend/` ve `frontend/`.

API kökü: `/api/v1`; geliştirme portları backend `8000`, frontend `5173`.

## Önce kapsamı daralt

- İstenen değişikliği yap; yakın özellikleri kendiliğinden yeniden tasarlama.
- Mevcut kirli worktree'yi ve kullanıcı dosyalarını koru.
- Gerçek kodu talimat metninden üstün kabul et. Bir bilgi eskimiş görünüyorsa ilgili model, router, servis, test ve CI dosyasına bak.
- Ürün davranışı değişmeden önce `docs/urun-kararlari.md`, teknik borca dokunmadan önce `docs/teknik-borc.md` okunur. `docs/README.md` hangi belgenin geçerli, hangisinin arşiv (`docs/arsiv/`) olduğunu listeler; arşiv belgeleri karar kaynağı değildir.
- Mock/placeholder ürün verisi ekleme. Gereken veri gerçek API akışından gelsin.
- Yeni soyutlama, agent, hook veya test ancak somut bir ihtiyacı çözüyor ise eklenir.

## Kullanıcıyla çalışma

- Teknik uygulama ayrıntılarında mevcut koddan makul seçimi yap; kullanıcıdan framework, desen veya test türü seçmesini bekleme.
- Yalnız ürün davranışını, maliyeti, güvenliği veya geri döndürülmesi zor bir kararı değiştirecek belirsizlikte soru sor.
- Sonuçları sade Türkçe anlat: ne değişti, kullanıcı ne görecek, ne doğrulandı ve bilinen bir risk kaldı mı.
- Uzun kod dökümü, test günlüğü veya iç muhakeme verme; önemli noktaları özetle.

## Değişmez mimari sınırlar

- Giriş hesapları ayrıdır: ADMIN(1), TUTOR(2), CLIENT(3), LIBRARY_OPERATOR(4), COURIER(5).
- Şema değişikliklerinin kaynağı Alembic'dir. Model değişince migration gerekir; yeni model `backend/models/__init__.py` içinde import ve `__all__` kaydı alır.
- Yeni backend router `backend/api/router.py` içinde kaydedilir.
- Yetkilendirme yalnız role değil sahipliğe/izinlere de bakar. Para, auth, PII ve public token uçlarında mevcut servis desenini takip et.
- Fiyat ve ödeme tutarı istemciden güvenilir kabul edilmez; sunucuda hesaplanır.
- Hassas dosyalar `private/` altında kalır ve kısa ömürlü imzalı URL ile sunulur.
- Frontend API çağrıları `frontend/src/api/axios.ts` üzerinden, server state React Query hook'larıyla yönetilir.
- Frontend rotalarının kaynağı `frontend/src/lib/routes.ts` dosyasıdır.

## Çalıştırma

Yerel sürümler CI ile aynı olmalıdır: Python 3.12 ve Node 20. Varsayılan `docker compose up` yalnız destek servislerini (Redis, MinIO vb.) açar; backend ve frontend host üzerinde çalıştırılır. Tüm sistemi Docker'da açmak için `docker compose --profile tamdocker up --build`. Backend ortam değişkenlerinin örneği `backend/.env.example` dosyasındadır.

## Doğrulama politikası

Değişikliğin riskine göre en küçük ilgili kontrolü bir kez çalıştır.

- Doküman/Claude ayarı değişikliğinde ürün testleri çalıştırma; yalnız dosya biçimini veya script sözdizimini kontrol et.
- Backend ve frontend için ayrıntılı minimum kontroller kendi `CLAUDE.md` dosyalarındadır.
- `tests/integration`, `tests/verify`, tam Docker build, coverage ve mutasyon provalarını yalnız değişiklik doğrudan o alanı etkiliyorsa ya da kullanıcı açıkça isterse çalıştır.
- Her değişiklik için yeni test yazma. Bug düzeltmesi, kritik iş kuralı veya kolayca geri dönebilecek saf davranış varsa test ekle.
- Aynı kontrolü sonuç değişmeden tekrar tekrar çalıştırma.
