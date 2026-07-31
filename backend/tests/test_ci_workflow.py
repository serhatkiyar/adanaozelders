"""CI iş akışı sözleşmesi — test sınıflarının ayrımı bozulamaz.

## Neden bu test var

`pytest.ini` içinde `testpaths = tests` olduğundan, **yol verilmeyen** her
pytest çağrısı üç paketi birden toplar:

    tests/            → birim + kabul (altyapı gerektirmez)
    tests/integration → gerçek Postgres (yıkıcı; adı `test` içeren DB ister)
    tests/verify      → izole `adana_verify` DB + gerçek servis katmanı

`ci.yml`'deki birim adımı 30 Tem 2026'ya kadar yalnız `--ignore=tests/integration`
veriyordu; `tests/verify` toplanıyor, paketin session guard'ı
`POSTGRES_DB != adana_verify` görüp `pytest.exit(returncode=1)` ediyordu. Aynı
commit kapsama adımına `--ignore=tests/verify` eklemiş, birim adımına eklemeyi
atlamıştı — yani **CI ilk push'ta bu adımda kırılacaktı** ve ardındaki
integration + verify adımları hiç koşmayacaktı.

Bu, gözle kolayca kaçan ve yalnız GitHub Actions koşarken görülen bir sınıf
hata. Burada YAML sözleşme olarak doğrulanır, böylece aynı sapma yerelde
kırmızıya döner.

## Bu testin gücü ve sınırı

CLAUDE.md §C uyarınca bu bir **kaynak/yapılandırma sözleşmesi** testidir; düşük
güçlüdür ve "CI gerçekten yeşil" iddiasının kanıtı DEĞİLDİR. Kanıtladığı tek
şey: iş akışındaki test sınıfı ayrımı ve servis kablolaması sessizce
bozulamaz. Testlerin gerçekten koştuğu, Actions çıktısıyla doğrulanır.
"""
from __future__ import annotations

import pathlib
import shlex

import pytest
import yaml

CI_YOLU = (
    pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"
)

#: Yol verilmeden koşan bir pytest çağrısının dışlaması ZORUNLU paketler.
AYRI_KOSAN_PAKETLER = {"tests/integration", "tests/verify"}


@pytest.fixture(scope="module")
def is_akisi() -> dict:
    assert CI_YOLU.is_file(), f"CI iş akışı bulunamadı: {CI_YOLU}"
    return yaml.safe_load(CI_YOLU.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def backend_isi(is_akisi) -> dict:
    return is_akisi["jobs"]["backend"]


def _adimlar(is_: dict) -> list[dict]:
    return [a for a in is_["steps"] if isinstance(a, dict)]


def _adim(is_: dict, parca: str) -> dict:
    """Adı `parca` içeren TEK adım (yoksa/birden çoksa test kırılır)."""
    bulunan = [a for a in _adimlar(is_) if parca.lower() in (a.get("name") or "").lower()]
    assert len(bulunan) == 1, f"{parca!r} içeren adım sayısı 1 değil: {len(bulunan)}"
    return bulunan[0]


def _pytest_komutlari(is_: dict) -> list[list[str]]:
    """İş akışındaki bütün pytest çağrılarını token listesi olarak döner."""
    komutlar: list[list[str]] = []
    for adim in _adimlar(is_):
        for satir in (adim.get("run") or "").splitlines():
            satir = satir.strip()
            if not satir or satir.startswith("#"):
                continue
            try:
                tokenlar = shlex.split(satir)
            except ValueError:  # kapanmamış tırnak (çok satırlı python -c bloğu)
                continue
            if _pytest_cagrisi_mi(tokenlar):
                komutlar.append(tokenlar)
    return komutlar


def _pytest_cagrisi_mi(tokenlar: list[str]) -> bool:
    """`pytest ...` ya da `python -m pytest ...` mı?

    `pip install pytest` gibi pytest'in ARGÜMAN olduğu satırlar sayılmaz —
    yoksa bağımlılık kurulum adımı da sözleşmeye tabi görünürdü.
    """
    if not tokenlar:
        return False
    if tokenlar[0] == "pytest":
        return True
    return (
        tokenlar[0].startswith("python")
        and "-m" in tokenlar
        and tokenlar[tokenlar.index("-m") + 1 : tokenlar.index("-m") + 2] == ["pytest"]
    )


def _hedefler(tokenlar: list[str]) -> list[str]:
    """Komuta açıkça verilmiş test yolları (`--ignore=` seçenekleri HARİÇ)."""
    return [t for t in tokenlar if t.startswith("tests/")]


def _yoksayilanlar(tokenlar: list[str]) -> set[str]:
    return {
        t.split("=", 1)[1].rstrip("/")
        for t in tokenlar
        if t.startswith("--ignore=")
    }


# ── Asıl sözleşme: sınıf ayrımı ────────────────────────────────────────────────


def test_yolsuz_pytest_cagrilari_ayri_paketleri_dislar(backend_isi) -> None:
    """`testpaths = tests` yüzünden yol verilmeyen çağrı HER ŞEYİ toplar.

    Kural adım adına değil komutun şekline bakar: ileride eklenecek yeni bir
    "yolsuz" pytest adımı da aynı sözleşmeye tabidir.
    """
    yolsuz = [k for k in _pytest_komutlari(backend_isi) if not _hedefler(k)]
    assert yolsuz, "iş akışında yol vermeyen hiçbir pytest çağrısı yok — beklenmedik"
    for tokenlar in yolsuz:
        eksik = AYRI_KOSAN_PAKETLER - _yoksayilanlar(tokenlar)
        assert not eksik, (
            f"pytest çağrısı ayrı koşan paketleri dışlamıyor: {sorted(eksik)}\n"
            f"komut: {' '.join(tokenlar)}"
        )


def test_uc_test_sinifi_da_kendi_adiminda_kosuyor(backend_isi) -> None:
    """Birim / integration / verify: üçü de gerçekten çağrılıyor mu?"""
    komutlar = _pytest_komutlari(backend_isi)
    hedefler = {h for k in komutlar for h in _hedefler(k)}
    assert "tests/integration" in hedefler, "integration paketi hiç koşmuyor"
    assert "tests/verify" in hedefler, "verify paketi hiç koşmuyor"
    assert any(not _hedefler(k) for k in komutlar), "birim adımı yok"


def test_verify_adimi_izole_veritabani_kullaniyor(backend_isi) -> None:
    """Verify paketi yazdığı satırları FİZİKSEL siler; DB adı yanlışsa felaket.

    `tests/verify/conftest.py::VERIFY_DB_NAME` ile aynı ad olmalı — aksi hâlde
    adım guard'a takılıp kırılır (ya da daha kötüsü, başka bir DB'yi siler).
    """
    from tests.verify.conftest import VERIFY_DB_NAME

    adim = _adim(backend_isi, "Doğrulama paketi")
    assert (adim.get("env") or {}).get("POSTGRES_DB") == VERIFY_DB_NAME, (
        "verify adımı POSTGRES_DB'yi guard'ın beklediği değere ayarlamıyor"
    )


def test_veritabani_adlari_yikici_test_allowlistinde(backend_isi, is_akisi) -> None:
    """CI'daki her POSTGRES_DB değeri `db_guard` allowlist'inden geçmeli."""
    from tests.integration.db_guard import assert_test_database

    adlar = {backend_isi["env"]["POSTGRES_DB"]}
    adlar |= {
        (a.get("env") or {})["POSTGRES_DB"]
        for a in _adimlar(backend_isi)
        if "POSTGRES_DB" in (a.get("env") or {})
    }
    for ad in adlar:
        assert_test_database(environment="ci", database=ad)


def test_altyapi_eksikse_test_atlanmiyor(backend_isi) -> None:
    """`CI_REQUIRE_SERVICES` olmadan Postgres/Redis/MinIO düşünce suite yeşil kalır."""
    assert backend_isi["env"].get("CI_REQUIRE_SERVICES") == "1", (
        "CI_REQUIRE_SERVICES=1 yok — servis konteyneri düşerse ilgili testler "
        "sessizce SKIP olur ve iş akışı yeşil görünür"
    )
