"""İP-16 migration zinciri — main'in ağacıyla BİRLEŞİK doğrulama (GERÇEK PG).

## Neden bu dosya var (denetçi B1 + B7)

İP-16 dalında `ip12_urun_arama_vektoru` revizyonu **yoktu**: İP-12 bu dal
açıldıktan sonra main'e girdi. Head sayımı dalın kendi `versions/` ağacında
yapıldığı için yanıltıcı biçimde "tek head" veriyordu — oysa merge sonrası
ağaçta `ip12_urun_arama_vektoru` ve İP-16'nın izin revizyonu **iki ayrı head**
oluşuyordu (ikisi de `ip5_siparis_vergi_kirilimi`'ye bağlıydı).

Bu yüzden buradaki fixture ölçümü dalın ağacında YAPMAZ: `main`'in
`migrations/versions/` ağacını geçici bir dizine açar, dalın İP-16
revizyonlarını **aynı dizine** koyar ve alembic'i o dizinle koşturur. Ölçüm
böylece "merge edilmiş ağaç" üzerinde olur.

B7 ayrı bir tuzağı kapatır: izin kodları geliştirme sırasında
`srs.platform.*` → `srs_platform.*` olarak yeniden adlandırıldı ama revizyon
kimliği değişmedi. Alembic aynı revizyonu ikinci kez koşmadığı için, yeniden
adlandırmadan ÖNCE bu revizyonu uygulamış bir veritabanında **eski kodlar
kalır** ve admin platform uçları SUPER_ADMIN'e dahi 403 döner (menü öğesi de
gizlendiğinden hata görünmez). `test_B7_*` tam bu veritabanını kurar ve
`upgrade head`'in kodları düzelttiğini ölçer.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from core.config import settings

BACKEND = Path(__file__).resolve().parents[2]
REPO = BACKEND.parent

#: Sabit kodlu ve içinde `test` geçiyor — kaza payı bırakmamak için parametre DEĞİL.
DISPOSABLE_DB = "adana_ip16_migration_test"

#: Dalın kendi revizyonları (main'de yok, çalışma ağacından alınır).
IP16_REVIZYONLARI = ("ip16_araliklitekrar.py", "ip16_srs_izin_kodu_hizalama.py")

#: İzin migration'ının vaktiyle taşıdığı ve ARTIK KULLANILMAYAN kimlikler.
#:
#: İkisi de gerçek: `ip16_srs_izin_kodlari` bir kez kullanılıp terk edildi,
#: sonra `ip16_srs_izinleri` oldu, sonra içerik değişince kimlik yine
#: değiştirildi. Makinede her iki damgayı da taşıyan veritabanları görüldü.
#: Yeni kimlik ikisinden de farklı olmalıdır: terk edilmiş bir kimliği geri
#: DİRİLTMEK, o damgayı taşıyan veritabanını "zaten head" konumuna sokar ve
#: migration'ı sessizce atlatır — düzeltilmek istenen tuzağın aynısı.
TERK_EDILMIS_KIMLIKLER = ("ip16_srs_izinleri", "ip16_srs_izin_kodlari")

SRS_TABLOLARI = (
    "srs_decks",
    "srs_notes",
    "srs_cards",
    "srs_progress",
    "srs_review_logs",
    "srs_deck_assignments",
    "srs_tags",
    "srs_note_tags",
)

BAYAT_KODLAR = ("srs.platform.view", "srs.platform.manage")
DOGRU_KODLAR = ("srs_platform.view", "srs_platform.manage")


def _url(dbname: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{dbname}"
    )


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=str(REPO), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )


@pytest.fixture(scope="module")
def birlesik_agac(tmp_path_factory) -> Path:
    """`main`'in versions ağacı + dalın İP-16 revizyonları AYNI dizinde.

    Dönen değer, alembic'e `-c` ile verilecek geçici `alembic.ini` yoludur.
    """
    kok = tmp_path_factory.mktemp("ip16_birlesik")
    mig = kok / "migrations"
    (mig / "versions").mkdir(parents=True)

    # env.py / script.py.mako dalın kendisinden: alembic ortamı burada değişmedi,
    # değişen YALNIZ revizyon ağacıdır.
    for ad in ("env.py", "script.py.mako"):
        kaynak = BACKEND / "migrations" / ad
        if kaynak.exists():
            shutil.copy2(kaynak, mig / ad)

    listele = _git("ls-tree", "--name-only", "main", "backend/migrations/versions/")
    if listele.returncode != 0:
        pytest.skip(f"main dalı okunamadı: {listele.stderr.strip()}")
    yollar = [
        y for y in listele.stdout.splitlines() if y.endswith(".py")
    ]
    assert yollar, "main'in versions ağacı boş görünüyor — ölçüm anlamsız olurdu"
    for yol in yollar:
        icerik = _git("show", f"main:{yol}")
        assert icerik.returncode == 0, f"{yol} okunamadı"
        (mig / "versions" / Path(yol).name).write_text(
            icerik.stdout, encoding="utf-8"
        )

    # Dalın İP-16 revizyonları — çalışma ağacından (düzeltmeler burada yaşıyor).
    for ad in IP16_REVIZYONLARI:
        shutil.copy2(BACKEND / "migrations" / "versions" / ad, mig / "versions" / ad)

    # main'de ip12 var, dalda yok: birleşik ağacın gerçekten "merge sonrası"
    # olduğunu burada doğrula, yoksa test yine dalın ağacını ölçerdi.
    adlar = {p.name for p in (mig / "versions").glob("*.py")}
    assert "ip12_urun_arama_vektoru.py" in adlar, "main'in ip12 revizyonu gelmedi"
    assert set(IP16_REVIZYONLARI) <= adlar

    ini = kok / "alembic.ini"
    ini.write_text(
        (BACKEND / "alembic.ini")
        .read_text(encoding="utf-8")
        .replace(
            "script_location = %(here)s/migrations",
            f"script_location = {mig.as_posix()}",
        ),
        encoding="utf-8",
    )
    return ini


def _alembic(ini: Path, *args: str, bekle_hata: bool = False):
    env = {
        **os.environ,
        "POSTGRES_DB": DISPOSABLE_DB,
        "AUTO_CREATE_DB": "false",
    }
    res = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ini), *args],
        cwd=str(BACKEND), capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=env,
    )
    if not bekle_hata:
        assert res.returncode == 0, (
            f"alembic {' '.join(args)} başarısız:\n{res.stdout}\n{res.stderr}"
        )
    return res


@pytest.fixture
async def taze_db():
    """Boş, tek kullanımlık veritabanı (her testte yeniden kurulur)."""
    if settings.ENVIRONMENT == "production":
        pytest.fail("Üretimde migration testi koşulamaz")
    assert "test" in DISPOSABLE_DB
    assert DISPOSABLE_DB != settings.POSTGRES_DB

    bakim = create_async_engine(_url("postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with bakim.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except (OSError, ConnectionRefusedError) as exc:
        await bakim.dispose()
        pytest.skip(f"Bakım veritabanına ulaşılamıyor ({exc.__class__.__name__})")

    async with bakim.connect() as conn:
        await conn.execute(
            text(f'DROP DATABASE IF EXISTS "{DISPOSABLE_DB}" WITH (FORCE)')
        )
        await conn.execute(text(f'CREATE DATABASE "{DISPOSABLE_DB}"'))

    engine = create_async_engine(_url(DISPOSABLE_DB))
    try:
        yield engine
    finally:
        await engine.dispose()
        async with bakim.connect() as conn:
            await conn.execute(
                text(f'DROP DATABASE IF EXISTS "{DISPOSABLE_DB}" WITH (FORCE)')
            )
        await bakim.dispose()


async def _srs_tablo_sayisi(engine) -> int:
    async with engine.connect() as conn:
        row = await conn.execute(
            text(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = ANY(:adlar)"
            ),
            {"adlar": list(SRS_TABLOLARI)},
        )
        return int(row.scalar_one())


async def _izin_kodlari(engine, desen: str) -> list[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("SELECT code FROM admin_permissions WHERE code LIKE :d ORDER BY code"),
            {"d": desen},
        )
        return [r[0] for r in rows]


async def _rol_izinleri(engine, kod: str) -> list[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT r.code FROM admin_role_permissions rp "
                "JOIN admin_roles r ON r.id = rp.admin_role_id "
                "JOIN admin_permissions p ON p.id = rp.permission_id "
                "WHERE p.code = :kod AND rp.deleted_at IS NULL ORDER BY r.code"
            ),
            {"kod": kod},
        )
        return [r[0] for r in rows]


# ── B1: merge sonrası ağaçta tek head ───────────────────────────────────────


def test_B1_BIRLESIK_AGACTA_TEK_HEAD(birlesik_agac):
    """main + İP-16 aynı dizindeyken `alembic heads` TEK revizyon vermeli.

    `ip16_araliklitekrar` `ip5_siparis_vergi_kirilimi`'ye bağlı kaldığı sürece
    burası iki head görür (ip12 ile kardeş olur) ve `upgrade head` çalışmaz.
    """
    res = _alembic(birlesik_agac, "heads")
    satirlar = [s for s in res.stdout.splitlines() if s.strip()]
    assert len(satirlar) == 1, f"tek head bekleniyordu, çıktı:\n{res.stdout}"
    assert "ip16" in satirlar[0], f"head İP-16 revizyonu olmalı: {satirlar[0]}"


def test_B1_ZINCIR_IP12_UZERINE_KURULU(birlesik_agac):
    """Doğrusal geçmiş: İP-16 şeması İP-12'nin ÜSTÜNDE durmalı (merge revision yok)."""
    res = _alembic(birlesik_agac, "history", "-r", "ip12_urun_arama_vektoru:head")
    metin = res.stdout
    assert "ip12_urun_arama_vektoru -> ip16_araliklitekrar" in metin.replace(
        ", ", " -> "
    ) or "ip12_urun_arama_vektoru -> ip16_araliklitekrar" in metin, (
        f"ip16_araliklitekrar doğrudan ip12'nin üstünde olmalı:\n{metin}"
    )
    assert "merge" not in metin.lower(), "merge revision üretilmemeli"


# ── B1: taze DB'de upgrade → downgrade ×2 → upgrade → check ─────────────────


async def test_B1_TAZE_DB_UPGRADE_DOWNGRADE_UPGRADE(birlesik_agac, taze_db):
    _alembic(birlesik_agac, "upgrade", "head")
    assert await _srs_tablo_sayisi(taze_db) == 8
    assert await _izin_kodlari(taze_db, "srs%") == sorted(DOGRU_KODLAR)

    _alembic(birlesik_agac, "downgrade", "-1")
    assert await _izin_kodlari(taze_db, "srs%") == []
    _alembic(birlesik_agac, "downgrade", "-1")
    assert await _srs_tablo_sayisi(taze_db) == 0

    _alembic(birlesik_agac, "upgrade", "head")
    assert await _srs_tablo_sayisi(taze_db) == 8
    assert await _izin_kodlari(taze_db, "srs%") == sorted(DOGRU_KODLAR)

    res = _alembic(birlesik_agac, "check")
    assert "No new upgrade operations detected" in res.stdout + res.stderr, (
        f"model ile şema sapmış:\n{res.stdout}\n{res.stderr}"
    )


# ── B7: bayat izin kodu taşıyan veritabanı düzelir ──────────────────────────


async def test_B7_BAYAT_IZIN_KODLARI_UPGRADE_ILE_DUZELIR(birlesik_agac, taze_db):
    """`srs.platform.*` taşıyan bir DB `upgrade head` sonrası `srs_platform.*` olmalı.

    Kurgu, yeniden adlandırmadan ÖNCEKİ dünyayı birebir taklit eder: izin
    satırları eski kodla açılır ve SUPER_ADMIN'e bağlanır. Revizyon kimliği
    değişmediği sürece alembic bu DB'de hiçbir şey koşmaz; kodlar bayat kalır
    ve admin uçları herkese 403 döner.
    """
    _alembic(birlesik_agac, "upgrade", "ip16_araliklitekrar")

    await _bayat_dunyayi_kur(taze_db)
    assert await _izin_kodlari(taze_db, "srs.platform%") == sorted(BAYAT_KODLAR)

    _alembic(birlesik_agac, "upgrade", "head")

    assert await _izin_kodlari(taze_db, "srs.platform.%") == [], (
        "bayat kodlar temizlenmedi — panel bu satırları görüp doğru kodu ıskalar"
    )
    assert await _izin_kodlari(taze_db, "srs\\_platform.%") == sorted(DOGRU_KODLAR)
    for kod in DOGRU_KODLAR:
        roller = await _rol_izinleri(taze_db, kod)
        assert "SUPER_ADMIN" in roller and "EDUCATION_MANAGER" in roller, (
            f"{kod} rollere bağlanmadı: {roller}"
        )


async def _bayat_dunyayi_kur(engine) -> None:
    """Yeniden adlandırma ÖNCESİ durum: eski kodlar, SUPER_ADMIN'e bağlı."""
    async with engine.begin() as conn:
        for kod in BAYAT_KODLAR:
            await conn.execute(
                text(
                    'INSERT INTO admin_permissions (code, name, "group") '
                    "VALUES (:kod, :ad, 'Eğitim')"
                ),
                {"kod": kod, "ad": f"eski {kod}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO admin_role_permissions (admin_role_id, permission_id) "
                    "SELECT r.id, p.id FROM admin_roles r, admin_permissions p "
                    "WHERE r.code = 'SUPER_ADMIN' AND p.code = :kod"
                ),
                {"kod": kod},
            )


@pytest.mark.parametrize("eski_kimlik", TERK_EDILMIS_KIMLIKLER)
async def test_B7_ESKI_KIMLIGE_STAMPLI_DB_SESSIZCE_BAYAT_KALMAZ(
    birlesik_agac, taze_db, eski_kimlik
):
    """Terk edilmiş kimliğe damgalanmış + bayat kodlu DB sessizce geçilemez.

    Bu, B7'nin asıl zararını ölçer: revizyon kimliği değişmediğinde (ya da
    terk edilmiş bir kimliğe geri dönüldüğünde) alembic aynı revizyonu ikinci
    kez koşmaz, `upgrade head` **başarıyla** döner ve veritabanı bayat
    kodlarla kalır — kimse fark etmez. Kabul edilen iki sonuç vardır: (a)
    migration yeniden koşup kodları düzeltir, ya da (b) alembic revizyonu
    bulamayıp GÜRÜLTÜLÜ hata verir (ortam elle onarılır). Yasak olan üçüncü
    hâldir: sessiz başarı + bayat kod.

    Her iki eski kimlik için ayrı ayrı koşulur: yeni kimliğin ikisinden de
    farklı olduğu ancak böyle nöbet altına alınır.
    """
    _alembic(birlesik_agac, "upgrade", "ip16_araliklitekrar")
    await _bayat_dunyayi_kur(taze_db)
    async with taze_db.begin() as conn:
        await conn.execute(
            text("UPDATE alembic_version SET version_num = :k"), {"k": eski_kimlik}
        )

    res = _alembic(birlesik_agac, "upgrade", "head", bekle_hata=True)

    if res.returncode == 0:
        assert await _izin_kodlari(taze_db, "srs.platform.%") == [], (
            f"'{eski_kimlik}' damgalı DB'de upgrade sessizce başarılı oldu ama "
            "bayat kodlar duruyor — admin platform uçları herkese 403 döner (B7)"
        )
    else:
        assert eski_kimlik in (res.stdout + res.stderr), (
            f"beklenmeyen hata:\n{res.stdout}\n{res.stderr}"
        )


def test_B7_YENI_KIMLIK_TERK_EDILMISLERDEN_FARKLI(birlesik_agac):
    """Yeni kimlik, vaktiyle kullanılmış hiçbir kimliğe eşit olmamalı.

    Yapısal sözleşme (düşük güçlü — yanında yukarıdaki davranış testi durur):
    terk edilmiş bir kimliği geri diriltmek, o damgayı taşıyan veritabanlarını
    sessizce "zaten head" yapar. Bu tam olarak bir kez yaşandı.
    """
    res = _alembic(birlesik_agac, "heads")
    head = [s.strip() for s in res.stdout.splitlines() if s.strip()][0].split(" ")[0]
    assert head not in TERK_EDILMIS_KIMLIKLER, (
        f"head terk edilmiş bir kimliği geri diriltiyor: {head}"
    )
