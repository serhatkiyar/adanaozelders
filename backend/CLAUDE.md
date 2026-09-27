# Backend — çalışma notları

Router'ı ince tut; mevcut servis desenini kullan. Ancak sırf katman sayısını tamamlamak için tek kullanımlık soyutlama üretme.

## Kritik sınırlar

- Kullanıcı hesapları ayrıdır: Admin, Tutor, Client, LibraryOperator ve CourierAccount.
- Soft-delete her tabloda zorunlu değildir. Mevcut benzer modelin yaşam döngüsünü takip et; `deleted_at` varsa canlı sorguda filtrele.
- Yetkilendirmede rol kadar nesne sahipliği, admin izni ve operatör/kurye kapsamı önemlidir.
- Para ve fiyat sunucuda hesaplanır. Callback, refund/release ve outbox yollarında idempotensi koru.
- Auth/ödeme/PII/public-token değişikliklerinde mevcut guard ve servisleri atlama.
- Hassas objeler `private/` anahtarında kalır; public yanıta yalnız yetkili uç ve imzalı URL üzerinden çıkar.
- Yeni yazma veya maliyetli dış-servis ucunda mevcut rate-limit desenini kontrol et.
- Para, iade, iptal, vergi veya KVKK davranışı değişmeden önce ilgili sözleşmeye bak: `docs/ip1a-ders-para-sozlesme.md`, `docs/ip2a-magaza-iade-sozlesme.md`, `docs/ip2b-siparis-iptal-telafi-sozlesme.md`, `docs/ip5-kdv-fatura-sozlesme.md`, `docs/ip3-yetki-kvkk-sozlesme.md`.

## Migration

Model değişikliği şema değiştiriyorsa:

```bash
cd backend
python -m alembic revision --autogenerate -m "kısa açıklama"
```

Üretilen migration'ı modelle karşılaştır. Extension, PostgreSQL'e özel constraint/index, generated kolon ve enum değişikliklerinde autogenerate çıktısını özellikle gözden geçir; bunların eksik olduğunu peşinen varsayma. Zinciri `python -m alembic heads` ile kontrol edebilirsin; veritabanına uygulama yalnız uygun test DB'sinde yapılır.

## Çalıştırma ve doğrulama

```bash
cd backend
uvicorn main:app --reload
```

En küçük ilgili testi bir kez çalıştır:

```bash
pytest tests/test_ilgili_dosya.py -q
```

Tek bir hedef belirlenemiyorsa birim/kabul paketi:

```bash
pytest -q --ignore=tests/integration --ignore=tests/verify
```

`tests/integration`, `tests/verify`, coverage, mutation drill, tüm migration zinciri veya Docker doğrulaması yalnız değişiklik doğrudan o alanı etkiliyorsa ya da kullanıcı isterse çalıştırılır. Başarılı kontrolü sebepsiz tekrarlama.

`tests/integration` paralel koşar: `pytest tests/integration -q -n 5 --dist loadfile --no-loadscope-reorder` (CI `-n 4`; işçi başına `<POSTGRES_DB>_gwN` veritabanı ve Redis db 9-13; en fazla 5 işçi, bkz. kök `conftest.py`).
