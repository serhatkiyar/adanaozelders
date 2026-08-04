"""İP-3 §6 yapısal nöbetçi — her access token üretim yolu `auth_version` geçer.

## Bu testin varlık sebebi

`api/deps.get_current_user` `auth_ver` claim'ini BÜTÜN roller için denetler:
claim yoksa `payload.get("auth_ver")` `None` döner, DB'deki `auth_version`
(varsayılan `1`) ile eşleşmez ve token **her uçta 401** alır.

Bu, token üreten her çağrı yerini sessiz bir tuzağa çevirir. Tuzağa fiilen
düşüldü: `POST /libraries/register` `auth_version` geçmiyordu → uç `201` +
geçerli görünen bir access token dönüyor, ama o token hiçbir yerde çalışmıyordu
(kullanıcı ancak `/auth/refresh`'ten sonra oturum açabiliyordu). Hata sessizdi
çünkü kayıt ucunun kendi testi 201'i görüp geçiyordu.

Davranış testleri (bkz. `tests/integration/test_ip3_session_invalidation_pg.py`)
bilinen yolları kanıtlar; bu test **yeni eklenecek** bir token üretim yolunun
aynı hatayı tekrarlamasını engeller. AST kullanılır — yorum ve docstring
içindeki `create_access_token` metni testi kandıramaz.

Üç yönlü koruma:
  1. Üretim kodundaki HER `create_access_token(...)` çağrısı `auth_version=`
     keyword'ü geçiyor mu?
  2. Geçilen değer **gerçek hesabın sürümü** mü? (sabit `auth_version=1`
     denetimi anlamsız kılar: sürüm artınca token bayatlamaz — kabul EDİLMEZ.)
  3. Envanterdeki bilinen yollar hâlâ duruyor mu? (biri silinir/yeniden
     adlandırılırsa test kırılır ve envanteri güncellemeye zorlar; aksi hâlde
     "hiç çağrı bulamadım" yalancı yeşili doğardı)

Kaynak sözleşmesi testi DÜŞÜK GÜÇLÜDÜR (kök `CLAUDE.md` → C). Bu yüzden yanında
gerçek HTTP davranış testleri durur; bu dosya onların yerine geçmez.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]

#: Taranan üretim paketleri. `tests/` ve `migrations/` üretim davranışı değildir.
PAKETLER = ("api", "core", "services", "scripts")

#: Kök seviyedeki modüller de taranır (`main.py`, `seed_*.py` …). Bunlar bir
#: pakete ait olmadığı için `PAKETLER` yürüyüşüne düşmez; dışarıda bırakılırsa
#: kök seviyeye eklenen bir token üretimi nöbetçiyi hiç uyandırmaz.
KOK_HARIC = {"conftest.py"}  # test altyapısı, üretim değil

#: Açık muafiyetler — gerekçesiyle. Bir dosyayı buraya koymak, oradaki sabit
#: sürümün oturum geçersizleştirmesini zayıflatmadığını iddia etmektir.
MUAF: dict[str, str] = {
    # Yük ölçüm betiği. DİKKAT — token'ları gerçek uygulamaya gönderilir
    # (`httpx.ASGITransport(app=app)` + `Authorization` başlığı), yani
    # `get_current_user`'dan GEÇER; muafiyetin sebebi "istek atmıyor" değil,
    # betiğin bir kullanıcı oturumu açmaması ve ölçüm hesabının sürümünün
    # sabit varsayılmasıdır. Seed hesabının sürümü bir kez artarsa ölçüm 401
    # duvarına çarpar — bu, betiğin bilinçli olarak kabul ettiği kırılganlık.
    # Muafiyet YALNIZ (2) kuralı içindir; (1) kuralı burada da geçerlidir.
    "scripts/scale/probe.py": "yük ölçüm betiği; sürümü sabit varsayılan seed hesabı",
}

#: (dosya, fonksiyon) → burada bir token üretimi BULUNMAK ZORUNDA. Envanter,
#: "çağrı bulunamadı → hiç assert koşmadı" yalancı yeşilini engeller.
ENVANTER: list[tuple[str, str]] = [
    ("api/routers/auth.py", "login"),
    ("api/routers/auth.py", "refresh_token"),
    ("api/routers/auth.py", "change_my_password"),
    ("api/routers/libraries.py", "register_library"),
]

CAGRI_ADI = "create_access_token"


def _kaynak_dosyalar() -> list[pathlib.Path]:
    dosyalar: list[pathlib.Path] = []
    for paket in PAKETLER:
        dosyalar.extend(sorted((BACKEND / paket).rglob("*.py")))
    dosyalar.extend(
        sorted(p for p in BACKEND.glob("*.py") if p.name not in KOK_HARIC)
    )
    return dosyalar


def _rel(yol: pathlib.Path) -> str:
    return yol.relative_to(BACKEND).as_posix()


def _yerel_adlar(agac: ast.Module) -> set[str]:
    """Bu dosyada `create_access_token`'ı hangi isimler gösteriyor?

    `from core.security import create_access_token as mint` yazılırsa çağrı
    `mint(...)` görünür ve düz isim eşlemesi onu SESSİZCE atlar — nöbetçinin
    tek gerçek kaçış yolu buydu.
    """
    adlar = {CAGRI_ADI}
    for n in ast.walk(agac):
        if isinstance(n, ast.ImportFrom):
            for a in n.names:
                if a.name == CAGRI_ADI and a.asname:
                    adlar.add(a.asname)
    return adlar


def _cagri_mi(node: ast.AST, adlar: set[str] | None = None) -> bool:
    """`create_access_token(...)` çağrısı mı? (`x.create_access_token(...)` ve
    dosya içi import alias'ları dahil)"""
    if not isinstance(node, ast.Call):
        return False
    f = node.func
    return (isinstance(f, ast.Name) and f.id in (adlar or {CAGRI_ADI})) or (
        isinstance(f, ast.Attribute) and f.attr == CAGRI_ADI
    )


def _kapsayan_fonksiyon(agac: ast.Module, adlar: set[str]) -> dict[int, str]:
    """Satır no → onu içeren en iç fonksiyonun adı (AST ile; `find()` + sabit
    karakter penceresi KULLANILMAZ — o yöntem sınıf/fonksiyon sınırını kaçırır)."""
    harita: dict[int, str] = {}
    for n in ast.walk(agac):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for c in ast.walk(n):
                if _cagri_mi(c, adlar):
                    # En iç fonksiyon kazanır: dıştaki yürüyüş önce yazdıysa
                    # iç fonksiyon üzerine yazar (walk dıştan içe ilerler).
                    harita[c.lineno] = n.name
    return harita


def _token_cagrilari() -> list[tuple[str, str, ast.Call]]:
    """(dosya, fonksiyon, çağrı) üçlüleri — üretim kodunun tamamından."""
    bulunan: list[tuple[str, str, ast.Call]] = []
    for yol in _kaynak_dosyalar():
        agac = ast.parse(yol.read_text(encoding="utf-8"))
        adlar = _yerel_adlar(agac)
        fonksiyonlar = _kapsayan_fonksiyon(agac, adlar)
        for n in ast.walk(agac):
            if _cagri_mi(n, adlar):
                bulunan.append(
                    (_rel(yol), fonksiyonlar.get(n.lineno, "<modül>"), n)
                )
    return bulunan


def _keyword(cagri: ast.Call, ad: str) -> ast.expr | None:
    for kw in cagri.keywords:
        if kw.arg == ad:
            return kw.value
    return None


def _gercek_surum_mu(deger: ast.expr) -> bool:
    """Değer, hesabın DB'deki sürümünden mi geliyor?

    Kabul: `getattr(x, "auth_version", ...)` · `x.auth_version` ·
    `x.auth_version or 1` gibi bileşikler (içinde gerçek erişim olduğu sürece).
    Ret: `1` gibi sabitler — sürüm artınca token bayatlamaz, denetim ölür.
    """
    for n in ast.walk(deger):
        if isinstance(n, ast.Attribute) and n.attr == "auth_version":
            return True
        if (
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "getattr"
            and len(n.args) >= 2
            and isinstance(n.args[1], ast.Constant)
            and n.args[1].value == "auth_version"
        ):
            return True
    return False


def test_envanterdeki_token_yollari_hala_duruyor():
    """Bilinen üretim yolları kaybolmadı (yoksa aşağıdaki testler boşa koşar)."""
    bulunan = {(d, f) for d, f, _ in _token_cagrilari()}
    eksik = [e for e in ENVANTER if e not in bulunan]
    assert not eksik, (
        "Beklenen token üretim yolu bulunamadı (taşındı/yeniden adlandırıldı mı?): "
        f"{eksik}. Envanteri güncelleyin — aksi hâlde bu dosya hiçbir şeyi ölçmez."
    )


def test_her_token_uretimi_auth_version_geciyor():
    """Kural (1): `auth_ver` claim'siz token hiçbir uçta çalışmaz."""
    eksik = [
        f"{dosya}::{fn} (satır {cagri.lineno})"
        for dosya, fn, cagri in _token_cagrilari()
        if _keyword(cagri, "auth_version") is None
    ]
    assert not eksik, (
        "`create_access_token` çağrısı `auth_version=` geçmiyor — üretilen token "
        "`get_current_user`'da 401 alır (İP-3 §6). Yerler: " + ", ".join(eksik)
    )


def test_auth_version_degeri_gercek_hesap_surumunden_gelir():
    """Kural (2): sabit sürüm, oturum geçersizleştirmeyi sessizce kapatır."""
    sahte = [
        f"{dosya}::{fn} (satır {cagri.lineno})"
        for dosya, fn, cagri in _token_cagrilari()
        if dosya not in MUAF
        and (deger := _keyword(cagri, "auth_version")) is not None
        and not _gercek_surum_mu(deger)
    ]
    assert not sahte, (
        "`auth_version` gerçek hesap nesnesinden değil sabitten geliyor — şifre "
        "değişimi/sıfırlaması token'ı ÖLDÜREMEZ. Yerler: " + ", ".join(sahte)
    )


# ── Nöbetçinin kendi nöbetçileri ────────────────────────────────────────────
#
# Kaynak taraması sessizce körleşebilir: bir isim değişir, tarayıcı hiçbir şey
# bulamaz ve üç test de boş listeyle YEŞİL kalır. Aşağıdaki senaryolar
# tarayıcının ayırt etme gücünü SENTETİK kaynak üzerinde sabitler — üretim
# dosyalarına dokunmadan, "yeni bir çağrı eklenirse gerçekten kırılır mı?"
# sorusunu her koşumda yeniden cevaplar.

_SENTETIK = '''
"""Docstring içinde create_access_token(subject=1, role="X", role_id=1) geçer."""
# Yorumda da create_access_token(subject=2) geçer.
METIN = "create_access_token(subject=3)"

from core.security import create_access_token
from core.security import create_access_token as mint


def dogru(u):
    return create_access_token(subject=u.id, role="X", role_id=1,
                               auth_version=getattr(u, "auth_version", None))


def eksik(u):
    return create_access_token(subject=u.id, role="X", role_id=1)


def sabit(u):
    return create_access_token(subject=u.id, role="X", role_id=1, auth_version=1)


def bos(u):
    return create_access_token(subject=u.id, role="X", role_id=1, auth_version=None)


def takma_ad(u):
    return mint(subject=u.id, role="X", role_id=1)


def dis():
    def ic(u):
        return create_access_token(subject=u.id, role="X", role_id=1)
    return ic
'''


def _sentetik_cagrilar() -> dict[str, ast.Call]:
    agac = ast.parse(_SENTETIK)
    adlar = _yerel_adlar(agac)
    fonksiyonlar = _kapsayan_fonksiyon(agac, adlar)
    return {
        fonksiyonlar[n.lineno]: n
        for n in ast.walk(agac)
        if _cagri_mi(n, adlar) and n.lineno in fonksiyonlar
    }


def test_tarayici_yorum_docstring_ve_metni_yakalamaz():
    """Kaynak taramasının klasik yalancı pozitifi: metin eşleşmesi."""
    cagrilar = _sentetik_cagrilar()
    # 6 gerçek çağrı var; docstring/yorum/string sabiti sayılmamalı.
    assert set(cagrilar) == {"dogru", "eksik", "sabit", "bos", "takma_ad", "ic"}, (
        f"tarayıcı yanlış küme buldu: {sorted(cagrilar)}"
    )


def test_tarayici_eksik_sabit_ve_takma_adli_cagrilari_ayirt_eder():
    """Nöbetçinin ASIL iddiası: bozuk çağrı gerçekten kırar mı?"""
    c = _sentetik_cagrilar()

    assert _keyword(c["dogru"], "auth_version") is not None
    assert _gercek_surum_mu(_keyword(c["dogru"], "auth_version"))

    # (1) kuralı: keyword hiç yok → kırar.
    assert _keyword(c["eksik"], "auth_version") is None
    assert _keyword(c["takma_ad"], "auth_version") is None, (
        "import alias'lı çağrı taramadan kaçıyor"
    )
    assert _keyword(c["ic"], "auth_version") is None, "iç fonksiyondaki çağrı kaçıyor"

    # (2) kuralı: sabit/None → gerçek sürüm değil.
    assert not _gercek_surum_mu(_keyword(c["sabit"], "auth_version"))
    assert not _gercek_surum_mu(_keyword(c["bos"], "auth_version")), (
        "`auth_version=None` claim'i HİÇ yazmaz — sabit kadar tehlikelidir"
    )


@pytest.mark.parametrize("dosya", sorted(MUAF))
def test_muafiyet_listesi_bayatlamadi(dosya):
    """Muaf tutulan dosya silinmişse liste temizlenmeli (ölü muafiyet bırakılmaz)."""
    assert (BACKEND / dosya).exists(), (
        f"MUAF listesindeki dosya yok: {dosya} — muafiyeti kaldırın"
    )
