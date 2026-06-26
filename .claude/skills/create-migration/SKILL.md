---
name: create-migration
description: SQLAlchemy modeli değiştikten sonra Alembic ile migration üretir ve autogenerate'in kaçırdıklarını elle tamamlayıp gözden geçirir. Yeni tablo/kolon/index/constraint eklerken kullanın.
disable-model-invocation: true
---

# Alembic Migration Üret & Gözden Geçir

Bu projede **Alembic tek doğruluk kaynağıdır** (`create_all`/`_ADDED_COLUMNS_DDL` yok). Tek baseline `532b1fa8771d` boş DB'yi kurar; sonraki her şema değişikliği yeni bir migration ister.

## Adımlar

1. **Ön kontrol** — Değişen model `models/__init__.py`'de import + `__all__`'da mı? Değilse ekle, yoksa autogenerate tabloyu/kolonu **görmez**.

2. **Üret**:
   ```bash
   cd backend
   alembic revision --autogenerate -m "<kısa açıklama>"
   ```

3. **Üretileni GÖZDEN GEÇİR** — `migrations/versions/` içindeki yeni dosyayı aç. Autogenerate şunları **kaçırır, elle ekle**:
   - **Extension**: `op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")` / `btree_gist` (yeni trigram/GiST yapısı varsa).
   - **GiST Exclusion Constraint** (booking çakışma tarzı): `ExcludeConstraint` / `op.execute`.
   - **Computed/Generated kolon** ve **TSVECTOR** (`search_vector`): `GENERATED ALWAYS AS ...`.
   - **Partial index** (`postgresql_where=...WHERE deleted_at IS NULL`) ve **GIN** (`postgresql_using="gin"`).
   - **PG enum yeni değeri**: `op.execute("ALTER TYPE ... ADD VALUE ...")`.
   - `upgrade()`/`downgrade()` simetrisi.

4. **Denetle** — `migration-reviewer` subagent'ını çağır (kör nokta + `__init__` kaydı denetimi).

5. **Doğrula** (mümkünse boş bir DB'de):
   ```bash
   cd backend && alembic upgrade head
   ```
   Açılışta `ensure_schema` zaten `upgrade head` çalıştırır.

## Not
`down_revision`'ın mevcut head'e zincirlendiğini ve tek head kaldığını doğrula. Şüphede `alembic history`/`alembic heads`.
