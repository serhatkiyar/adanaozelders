"""Vitrin (G4 merchandising) mutasyon provası kataloğu.

`scripts/mutation_drill` sürücüsünün güvenlik makinesini YENİDEN KULLANIR
(bayt yedeği + SHA-256 doğrulamalı geri alma, kirli ağaç reddi, HEAD/status
karşılaştırması, seçilen-test sayacı, yeşil taban kapısı). Katalog buraya ait.

## Kapsam ve kapsam DIŞI

Beş mutasyon KAYNAK kodunu bozar ve bu sürücüyle koşar. İki garanti ise
veritabanı nesnesidir (GiST exclusion ve tek-HOME partial unique index);
onları bir dosya yamasıyla bozmak mümkün değildir. Onların provası ayrı ve
elle yapılır — `docs/vitrin-p0/mutasyon.md`'de kayıtlıdır:

    ALTER TABLE store_landing_page_publications
      DROP CONSTRAINT ex_store_landing_page_publication_window;
    -- ilgili test koşulur, KIRILMALI, sonra constraint geri eklenir.

Bu ayrımı yazmak şart: "7 mutasyonun 7'si yakalandı" cümlesi, ikisinin
sürücüyle değil elle yapıldığını gizlerse ölçüm dürüst olmaz.

## Kullanım

    cd backend
    python -m scripts.mutation_drill_vitrin --list
    POSTGRES_DB=adana_vitrin_test python -m scripts.mutation_drill_vitrin V1
    POSTGRES_DB=adana_vitrin_test python -m scripts.mutation_drill_vitrin
"""
from __future__ import annotations

import argparse
import sys

from scripts.mutation_drill import (
    Mutasyon,
    _on_kontrol,
    calistir,
)

SERVIS = "backend/services/store_merchandising_service.py"
ROUTER = "backend/api/routers/store_merchandising.py"
PG = "tests/integration/test_store_merchandising_pg.py"


MUTASYONLAR: list[Mutasyon] = [
    Mutasyon(
        "V1", "yayın penceresinin BİTİŞ koşulu kaldırıldı",
        SERVIS,
        "        or_(StoreLandingPagePublication.ends_at.is_(None), "
        "StoreLandingPagePublication.ends_at > now),\n",
        "",
        (PG,),
    ),
    Mutasyon(
        "V2", "süresi dolmuş yayın (ENDED) yine public sayıldı",
        SERVIS,
        '        state in {"DRAFT", "UPCOMING", "ARCHIVED", "ENDED"} '
        "and preview_revision_id is None",
        '        state in {"DRAFT", "UPCOMING", "ARCHIVED"} '
        "and preview_revision_id is None",
        (PG,),
    ),
    Mutasyon(
        "V3", "attribution token imza doğrulaması kaldırıldı",
        SERVIS,
        """        if not hmac.compare_digest(expected, supplied):
            return None
""",
        "",
        (PG,),
    ),
    Mutasyon(
        "V4", "taslak YAYINDAKİ revizyonun üzerine yazıyor (değişmezlik yok)",
        SERVIS,
        """        StoreLandingPageRevision.status == "DRAFT",
    ).order_by(StoreLandingPageRevision.version.desc()).limit(1)"""
        """.with_for_update())).scalar_one_or_none()
    latest = (await db.execute(select(func.max(StoreLandingPageRevision.version)).where(""",
        """    ).order_by(StoreLandingPageRevision.version.desc()).limit(1)"""
        """.with_for_update())).scalar_one_or_none()
    latest = (await db.execute(select(func.max(StoreLandingPageRevision.version)).where(""",
        (PG,),
    ),
    Mutasyon(
        # Yetki KALDIRILMAZ, DÜŞÜRÜLÜR. Dekoratörü tamamen silmek `Admin`
        # bağımlılığını da götürüp import/NameError üretirdi; test o zaman
        # "kırıldı" görünür ama kırılma sebebi yetki değil çöken modüldür —
        # yani prova, ölçmek istediği şeyi ölçmez. `manage` yerine `view`
        # yazmak tam olarak korunmak istenen ayrımı hedefler.
        "V5", "yayınlama ucu products.manage yerine products.view istiyor",
        ROUTER,
        """    payload: LandingPagePublishIn,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await service.publish_page(db, page_id, revision_id, payload, admin.id)""",
        """    payload: LandingPagePublishIn,
    admin: Admin = Depends(require_admin_permission("products.view")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await service.publish_page(db, page_id, revision_id, payload, admin.id)""",
        (PG,),
    ),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("hedef", nargs="?", help="mutasyon no (ör. V3); boşsa hepsi")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true")
    a = ap.parse_args()

    if a.list:
        for m in MUTASYONLAR:
            print(f"{m.no}  {m.ad}   ({m.rel})")
        return 0

    head0, durum0 = _on_kontrol(a.allow_dirty)
    secili = [m for m in MUTASYONLAR if not a.hedef or m.no == a.hedef]
    if not secili:
        print(f"bilinmeyen mutasyon: {a.hedef}")
        return 2

    sonuc = [(m.no, calistir(m, head0, durum0)) for m in secili]
    print(f"\n{'=' * 72}")
    yakalanan = sum(1 for _no, ok in sonuc if ok)
    print(f"VİTRİN MUTASYON PROVASI: {yakalanan}/{len(sonuc)} yakalandı")
    for no, ok in sonuc:
        print(f"  {'YAKALANDI  ' if ok else 'YAKALANMADI'} {no}")
    return 0 if yakalanan == len(sonuc) else 1


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    sys.exit(main())
