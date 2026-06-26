---
name: new-endpoint
description: Yeni bir API endpoint'ini/özelliğini bu projenin katmanlı desenine uyacak şekilde uçtan uca ekler — backend (model → models/__init__ → schema → service → router → api/router.py) ve frontend (types → api → hooks → component). Bir veri ucu eklerken veya mevcut bir kaynağa yeni işlem eklerken kullanın.
---

# Yeni Endpoint Ekleme (full-stack)

Bu proje katı bir katmanlı desen kullanır. Her uçta bir kayıt adımı unutulursa sessiz hata olur (Alembic tabloyu görmez, router include edilmez, React Query hook'u eksik kalır). Bu skill o adımları sırayla yürütür.

## 0. Kapsamı netleştir
Hangi kaynak, hangi işlem(ler) (GET/POST/PATCH/DELETE), hangi roller erişebilir, yeni tablo/kolon gerekiyor mu? Belirsizse kullanıcıya sor.

## Backend (`backend/`)

1. **Model** — Yeni tablo gerekiyorsa `models/` altında SQLAlchemy modeli yaz. İlgili mixin'leri kullan: `NameMixin`, `TimestampMixin`, `SoftDeleteMixin` (her tabloda `deleted_at`!). Sahiplik genelde `(user_id, role_id)`.
2. **models/__init__.py** — Modeli **import et** ve `__all__` listesine ekle. ⚠️ Atlanırsa Alembic autogenerate tabloyu görmez.
3. **Şema değişikliği** → `/create-migration` skill'ini kullan (model değiştiyse migration üret + gözden geçir).
4. **Pydantic şema** — `schemas/` altında `*In` (request) / `*Out` (response) şemaları. Backend `Out` ile frontend `types/index.ts` birebir eşleşmeli.
5. **Service** — İş kurallarını (validasyon, FSM, sahiplik, kota) `services/` altındaki fonksiyona yaz. **Router'a iş mantığı koyma.**
6. **Router** — `api/routers/` altında endpoint'i tanımla. Auth: `get_current_active_user` / `require_roles`. Yazma/maliyetli uçlarda kullanıcı bazlı rate-limit (`user_rate_limit`). Mesaj/yorum gibi metinlerde gerekiyorsa `mask_contact_info`.
7. **api/router.py** — Yeni router'ı `api_router.include_router(...)` ile kaydet. ⚠️ Atlanırsa uç hiç yayınlanmaz. Route sırasına dikkat (sabit path'ler `/{id_or_slug}`'dan ÖNCE).
8. **Test** — DB'siz çekirdek mantık için `backend/tests/` altına pytest ekle (FSM, saf hesaplama, maskeleme).

## Frontend (`frontend/src/`)

> Kesin kural: **MOCK veri yok.** Her şey gerçek API'ye bağlanır.

9. **types/index.ts** — Backend Pydantic `Out` şemasının TypeScript karşılığını ekle.
10. **api/** — İlgili modülde (`api/<kaynak>.ts`) axios fetch fonksiyonu yaz (`api/axios.ts` instance'ı kullan).
11. **hooks/** — `@tanstack/react-query` `useQuery`/`useMutation` hook'u tanımla. Mutasyonlarda cache invalidation (+ uygunsa optimistic update).
12. **Component** — Sayfa/bileşende hook'u çağır. Gezinme `Link`/`useNavigate` (sayfa yenileme yok), URL'ler `lib/routes.ts` (`ROUTES`/`PATHS`) üzerinden — ham literal yok. Hata/başarı için `toast`; 409/429'u kullanıcı dostu ele al. Loading'de Skeleton, dark-mode paritesi.
13. **Test** — Yeni saf yardımcı eklediysen `lib/*.test.ts` (Vitest) yaz.

## Bitiş
- Backend: `cd backend && pytest -q`. Frontend: `cd frontend && npx tsc -b` + `npm run test`.
- Auth/ödeme/PII dokunduysan **security-reviewer** subagent'ını çağır.
