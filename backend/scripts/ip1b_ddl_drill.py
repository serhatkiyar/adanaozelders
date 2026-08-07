"""İP-1b · DB kısıtı mutasyon provası (DDL) — GÜVENLİ.

## Neden ayrı bir sürücü

`scripts/mutation_drill.py` **dosya yaması** yapar. İP-1b'nin iki koruması ise
kaynak dosyada değil **veritabanı şemasında** yaşar:

- `ex_study_res_client_no_overlap` (GiST exclusion) → K-7 düğümü,
- bilet kodu kısmi unique index'leri → C-1 düğümleri.

Model dosyasını değiştirmek zaten uygulanmış bir migration'ı geri almaz, yani
dosya yaması bu iki korumayı SÖKEMEZ ve prova sessizce "yakalandı" der. Kuralın
gerçekten DB'de olduğunu göstermenin tek yolu kısıtı geçici olarak düşürmektir.

## Güvenlik

- `tests/integration/db_guard.assert_test_database()` — adında `test` geçmeyen
  bir veritabanında koşmayı REDDEDER (geliştirme verisi korunur).
- Kısıt tanımı düşürülmeden ÖNCE `pg_get_constraintdef` / `pg_get_indexdef` ile
  okunur ve geri yükleme **tam olarak o metinle** yapılır — elle yeniden yazılan
  bir tanım sessizce farklı olabilirdi.
- Geri yükleme `finally` içindedir ve **davranışla** doğrulanır: kısıt yeniden
  kurulduktan sonra hedef test tekrar koşturulur ve YEŞİL olması beklenir.
  (Metin karşılaştırması bilinçli olarak yeterli sayılmaz: PostgreSQL kısıtı
  yeniden oluştururken WHERE ifadesinin parantezlemesini normalize edebiliyor
  ve birebir eşitlik, kural aynı olduğu hâlde YANLIŞ alarm veriyor — ilk koşumda
  tam olarak bu oldu. Metin farkı yine de raporlanır, ama karar davranışındır.)

## Kullanım

    cd backend
    . .\\scripts\\ip1b_test_env.ps1
    python -m scripts.ip1b_ddl_drill
"""
from __future__ import annotations

import asyncio
import pathlib
import subprocess
import sys

from sqlalchemy import text

KOK = pathlib.Path(__file__).resolve().parents[2]
BACKEND = KOK / "backend"

#: (ad, tür, tablo, testler) — tür: "constraint" | "index"
HEDEFLER = (
    (
        "ex_study_res_client_no_overlap",
        "constraint",
        "study_reservations",
        ("tests/integration/test_ip1b_kontenjan_pg.py::"
         "test_K7_ayni_ogrencinin_cakisan_rezervasyonu_db_de_engellenir",),
    ),
    (
        "uq_exam_reg_qr_token",
        "index",
        "exam_registrations",
        ("tests/integration/test_ip1b_bilet_kodu_pg.py::"
         "test_C1_deneme_bileti_qr_token_db_de_tekil",),
    ),
    (
        "uq_exam_reg_short_code",
        "index",
        "exam_registrations",
        ("tests/integration/test_ip1b_bilet_kodu_pg.py::"
         "test_C1b_deneme_bileti_short_code_db_de_tekil",),
    ),
    (
        "uq_study_res_qr_token",
        "index",
        "study_reservations",
        ("tests/integration/test_ip1b_bilet_kodu_pg.py::"
         "test_C1c_calisma_rezervasyonu_kodlari_db_de_tekil",),
    ),
)


async def _tanim(conn, ad: str, tur: str) -> str:
    if tur == "constraint":
        sql = "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = :a"
    else:
        sql = "SELECT pg_get_indexdef(indexrelid) FROM pg_index i "\
              "JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = :a"
    return (await conn.execute(text(sql), {"a": ad})).scalar_one_or_none()


async def _var_mi(conn, ad: str, tur: str) -> bool:
    return await _tanim(conn, ad, tur) is not None


def _pytest(testler) -> tuple[bool, str]:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--no-header", "-p", "no:cacheprovider", *testler],
        cwd=str(BACKEND), capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return r.returncode == 0, (r.stdout + r.stderr)


async def _drill(ad: str, tur: str, tablo: str, testler) -> bool:
    from core.database import engine

    print(f"\n{'=' * 72}\nDDL-{ad} ({tur} @ {tablo})\n{'=' * 72}")
    async with engine.begin() as conn:
        tanim = await _tanim(conn, ad, tur)
    if tanim is None:
        print(f"!!! {ad} ZATEN YOK — migration uygulanmamış olabilir")
        return False

    # Sağlık kontrolü: mutasyondan ÖNCE test yeşil mi? Zaten kırmızı bir test,
    # kısıt düşürülünce de kırmızı kalır ve prova hiçbir şey kanıtlamaz.
    onceki_yesil, _ = _pytest(testler)
    if not onceki_yesil:
        print("!!! HEDEF TEST MUTASYONDAN ÖNCE DE KIRMIZI — prova geçersiz")
        return False

    try:
        async with engine.begin() as conn:
            if tur == "constraint":
                await conn.execute(text(f"ALTER TABLE {tablo} DROP CONSTRAINT {ad}"))
            else:
                await conn.execute(text(f"DROP INDEX {ad}"))
        yesil, cikti = _pytest(testler)
        yakalandi = not yesil
    finally:
        async with engine.begin() as conn:
            if not await _var_mi(conn, ad, tur):
                if tur == "constraint":
                    await conn.execute(
                        text(f"ALTER TABLE {tablo} ADD CONSTRAINT {ad} {tanim}")
                    )
                else:
                    await conn.execute(text(tanim))
        async with engine.begin() as conn:
            geri = await _tanim(conn, ad, tur)
        if geri is None:
            print(f"!!! GERİ YÜKLENEMEDİ ({ad}) — DUR !!!")
            raise SystemExit(3)
        if geri != tanim:
            # Kural aynı, metin normalize edilmiş olabilir; karar davranışta.
            print(f"NOT: {ad} tanım metni normalize edildi.\n  önce: {tanim}\n  sonra: {geri}")
        geri_yesil, _ = _pytest(testler)
        if not geri_yesil:
            print(f"!!! GERİ YÜKLEME DAVRANIŞLA DOĞRULANAMADI ({ad}) — DUR !!!")
            raise SystemExit(3)
        print(f"geri yüklendi ve DAVRANIŞLA doğrulandı: {ad}")

    if yakalandi:
        son = [x for x in cikti.strip().splitlines() if x.strip()][-1:]
        print("YAKALANDI:", " ".join(son))
    else:
        print("!!! YAKALANMADI — kural DB'de değil, test onu ölçmüyor !!!")
    return yakalandi


async def main() -> int:
    sys.path.insert(0, str(BACKEND))
    from tests.integration.db_guard import assert_test_database

    assert_test_database()
    from core.database import engine

    sonuc = {}
    try:
        for ad, tur, tablo, testler in HEDEFLER:
            sonuc[ad] = await _drill(ad, tur, tablo, testler)
    finally:
        await engine.dispose()

    print(f"\n{'=' * 72}")
    for ad, ok in sonuc.items():
        print(f"  {'YAKALANDI ' if ok else 'KAÇTI     '} {ad}")
    return 0 if all(sonuc.values()) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
