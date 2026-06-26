---
name: seed-data
description: backend/ kökünde bu projenin desenine uyan yeni bir seed/backfill script'i yazar veya mevcut birini düzenler (async session, soft-delete farkındalığı, idempotent upsert, models/__init__ üzerinden import). Demo/başlangıç verisi eklerken veya bir kolonu toplu doldururken kullanın.
disable-model-invocation: true
---

# Seed / Backfill Script'i Yaz

`backend/` kökünde çok sayıda tek-seferlik veri script'i var (`seed_libraries.py`, `seed_products.py`, `seed_live_lesson.py`, `add_books.py`, `backfill_book_specs.py`, `update_avatars.py`…). Bu skill yeni bir tanesini aynı desende üretir ya da mevcut birini güvenle düzenler. **Üretim verisine değil, dev/demo verisine yöneliktir.**

## Önce: amaç ve sınır
Hangi tablo(lar), kaç kayıt, gerçek mi demo mu, var olanı güncelliyor mu (backfill) yoksa yeni mi ekliyor (seed)? Belirsizse kullanıcıya sor. **Üretim DB'sine asla körlemesine çalıştırılmaz** — script'in hedef DB'si `.env`'deki `DATABASE_URL`'dir.

## Desen (mevcut script'lerle birebir tutarlı)

1. **Async session**: `core/database` üzerinden async engine/sessionmaker kullan; mevcut bir seed script'ini (`seed_libraries.py` iyi referans) örnek al. Modelleri **`from models import ...`** ile çek (tek tek `models.x` değil — `models/__init__.py` tek giriş).
2. **Idempotent (upsert)**: Tekrar çalıştırılınca duplicate üretme. Doğal anahtarla (slug/email/isim+konum) önce sorgula; varsa güncelle, yoksa ekle. Script iki kez çalışınca veri ikiye katlanmamalı.
3. **Soft-delete farkındalığı**: Sorgularda `deleted_at IS NULL` filtrele. "Var mı" kontrolünde silinmişleri canlı sayma; gerekiyorsa diriltmek yerine yeni ekle — niyeti kullanıcıyla netleştir.
4. **Sahiplik & ilişkiler**: Kullanıcıya bağlı veride sahiplik `(user_id, role_id)`. FK'leri (booking→client/tutor, library_exam→library) gerçek var olan kayıtlara bağla; uydurma id verme.
5. **Şifreler & sırlar**: Kullanıcı kaydı seed'liyorsan parolayı `core/security` ile **hash'le** (düz metin yazma). TCKN gibi PII varsa `core/crypto` ile şifrele.
6. **İdempotent commit & özet**: Sonunda `await session.commit()`, ve "eklendi: N, güncellendi: M, atlandı: K" diye konsola özet bas.
7. **Çalıştırılabilir giriş**: `if __name__ == "__main__": asyncio.run(main())`. Dosya adı `seed_*.py` (yeni veri) veya `backfill_*.py` / `add_*.py` (mevcut veriyi doldurma) kuralına uy.

## Yeni TABLO mu gerekiyor?
Script yeni bir model/kolona dayanıyorsa: önce modeli ekle → `models/__init__.py`'ye import + `__all__` → **`/create-migration`** ile migration üret. Şema hazır olmadan seed yazma.

## Bitiş
- Çalıştırmadan önce hedef `DATABASE_URL`'i kullanıcıya doğrulat (dev mi?).
- Çalıştır: `cd backend && python seed_<ad>.py` — özet çıktısını göster.
- İki kez çalıştırıp idempotent olduğunu (ikinci çalıştırmada "atlandı") doğrula.
