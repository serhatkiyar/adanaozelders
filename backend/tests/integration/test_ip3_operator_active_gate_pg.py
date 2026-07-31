"""İP-3 / Bulgu 1b — Onaysız kütüphane operatörü yönetim uçlarına erişiyor.

## Neden İP-3 kapsamında (önce "kapsam dışı" diye raporlanmıştı)

Cevap anahtarı sızıntısı, operatör mesajlaşması ve bu bulgu **aynı eksikliğin**
üç yüzü: kütüphanenin ACTIVE olduğunu doğrulayan kapı hiçbir yerde
uygulanmıyor. `api/deps.py::get_current_active_operator` tam bu iş için yazılmış
ve docstring'i "Onaya bağlı yüzeyler bunu kullanmalı" diyor — ama **hiçbir
router'da çağrılmıyor** (tüm kod tabanında tek geçtiği yer kendi tanımı).
`backend/CLAUDE.md` onu "ör. deneme kataloğu listesi" diye örnekliyor; orada da
kullanılmıyor. Yani ortak dependency var, kablolaması yok.

Bugün yönetim uçları yalnız `require_roles_or_admin_permission("libraries.manage",
LIBRARY_OPERATOR)` + fonksiyon gövdesindeki `_assert_can_manage(user, library_id)`
ile korunuyor. İkisi de kütüphanenin **durumuna** bakmaz. `POST /libraries/register`
anında geçerli bir operatör token'ı ürettiğinden, onay beklemekte olan bir
başvurunun operatörü ücretli deneme oturumu yönetim yüzeyini açabiliyor.

## Güvenlik sözleşmesi

1. Kütüphanesi ACTIVE olmayan operatör yönetim uçlarını kullanamaz — durum
   ne olursa olsun (PENDING/REJECTED/HIDDEN ve **tanımlı olmayan/gelecekte
   eklenecek** durumlar dahil: kapı allowlist'tir, fail-closed).
2. Kütüphanesi silinmiş operatör 404; hesabı silinmiş operatör 401.
3. ACTIVE operatör yalnız KENDİ kütüphanesinin kaynaklarını yönetir.
4. Yabancı kaynakta varlık sızmaz: var olan yabancı oturum ile hiç olmayan
   oturum aynı yanıtı verir (proje sözleşmesi: 404 — `courier_account_service.
   ensure_run_access` deseni).
5. Kapı **ortak dependency'de** verilir ve gerçekten kablolanır; router
   gövdesine kopyalanmaz. Kapı endpoint gövdesinden ÖNCE çalışır — bu yüzden
   onaysız operatör var olmayan bir kaynağa istek attığında bile 403 alır
   (404 değil).

   Bu maddenin neden davranış testiyle yetinilmediğinin canlı örneği var:
   `library_exam_catalogs.py::_usable_viewer` ACTIVE kontrolünü **doğru
   yapıyor ama ortak dependency'yi kullanmadan, elle kopyalayarak**. Yani
   `/exam-catalogs/usable` HTTP davranış testinden geçer, yapısal testten
   geçmez — ve iki kopya zamanla ayrışır. Aşağıdaki iki test bilinçli olarak
   ayrı ayrı durur.
6. ACTIVE operatörün gördüğü yönetim yanıtlarında cevap anahtarı bulunmaz
   (bkz. `test_ip3_answer_key_pg.py`; burada mutasyon yüzeyi tekrar ölçülür).
7. Yetkili admin aynı kaynağa erişir ve cevap anahtarını görür.

## Kapı UYGULANMAYACAK yüzeyler (onboarding hakkı)

Onay beklemek, kilitlenmek değildir. Reddedilen bir başvurunun profilini
düzeltip yeniden gönderebilmesi gerekir; aksi halde ürün kendini kilitler.
Bu yüzden `GET /library-operators/me`, `POST /libraries/{id}/resubmit`,
`GET /libraries/admin/{id}` ve `PATCH /libraries/{id}` kapının DIŞINDA kalır —
ve bunu ölçen yeşil testler aşağıdadır. Onlar olmasa "her operatör ucuna ACTIVE
koy" biçiminde bir düzeltme yeşil görünürdü.
"""
from __future__ import annotations

import pytest

from tests.integration.ip3_factory import yetki_basligi

PDF = ("cevap.pdf", b"%PDF-1.4 ip3", "application/pdf")

#: ACTIVE zorunlu olan yönetim yüzeyi. Liste **davranışsal** nöbetçidir: yeni
#: bir yönetim ucu eklenip kapı unutulursa buraya satır eklenmesi gerekir ve
#: eksik kalırsa gerçek istek 200/404 dönerek testi kırar.
#:
#: Kaynak id'leri bilinçli olarak VAR OLMAYAN değerler: kapı endpoint
#: gövdesinden önce çalışmalı, yani "kaynak yok" cevabı bile verilmemeli.
def _yonetim_ucları(library_id: int) -> list[tuple[str, str, dict]]:
    yok = 2_000_000_000
    return [
        ("GET", "/api/v1/exam-sessions/manage", {"params": {"library_id": library_id}}),
        (
            "POST",
            "/api/v1/exam-sessions",
            {
                "params": {"library_id": library_id},
                "json": {
                    "exam_type": "TYT",
                    "title": "IP3 kapı denemesi",
                    "starts_at": "2027-01-01T09:00:00Z",
                    "duration_minutes": 120,
                    "capacity": 10,
                    "price": 100,
                },
            },
        ),
        ("PATCH", f"/api/v1/exam-sessions/{yok}", {"json": {"title": "yeni"}}),
        ("POST", f"/api/v1/exam-sessions/{yok}/cancel", {}),
        ("GET", f"/api/v1/exam-sessions/{yok}/roster", {}),
        ("GET", f"/api/v1/exam-sessions/{yok}/results/reference", {}),
        (
            "PUT",
            f"/api/v1/exam-sessions/{yok}/results/{yok}/summary",
            {"json": {"score_summary": "TYT 80 net"}},
        ),
        (
            "POST",
            f"/api/v1/exam-sessions/{yok}/results/{yok}/document",
            {"files": {"file": PDF}},
        ),
        (
            "POST",
            f"/api/v1/exam-sessions/{yok}/results/bulk",
            {"files": {"files": PDF}},
        ),
        ("POST", f"/api/v1/exam-sessions/{yok}/results/publish", {}),
        ("POST", f"/api/v1/exam-sessions/{yok}/answer-key", {"files": {"file": PDF}}),
        ("POST", "/api/v1/exam-attendance/verify", {"json": {"payload": "1:sahte"}}),
        ("POST", f"/api/v1/exam-registrations/{yok}/attend", {}),
        (
            "GET",
            "/api/v1/study-reservations/manage",
            {"params": {"library_id": library_id}},
        ),
        ("POST", f"/api/v1/study-reservations/{yok}/attend", {}),
        # Katalog listesi: `backend/CLAUDE.md` ACTIVE kapısının örnek yeri
        # olarak tam bunu gösteriyor ("ör. deneme kataloğu listesi").
        ("GET", "/api/v1/exam-catalogs/usable", {}),
        # Para yüzeyi: onaylanmamış işletmenin ödeme hesabı olmaz.
        ("GET", f"/api/v1/libraries/admin/{library_id}/payout", {}),
        (
            "POST",
            f"/api/v1/libraries/admin/{library_id}/payout",
            {
                # Gövde GEÇERLİ olmalı: 422 de "kapı yok" anlamına gelirdi ama
                # sebebi gövde doğrulaması olurdu; testin ölçtüğü şey bulanıklaşır.
                "json": {
                    "iban": "TR330006100519786457841326",
                    "tckn": "10000000146",
                    "contact_name": "IP3 Sorumlu",
                    "contact_email": "ip3-sorumlu@ip3kutuphane.example.com",
                }
            },
        ),
        ("GET", f"/api/v1/libraries/{library_id}/earnings", {}),
    ]


def _uc_kimligi(uc) -> str:
    return f"{uc[0]} {uc[1]}"


async def _iste(http, uc, baslik: dict):
    method, path, kw = uc
    return await http.request(method, path, headers=baslik, **kw)


# ── 1. Onaysız durumlar ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pending_operator_exam_sessions_manage_erisemez(ip3, http):
    """Kullanıcının açıkça istediği çekirdek senaryo."""
    lib = await ip3.library(status="PENDING")
    op = await ip3.operator(lib)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )

    assert r.status_code == 403, (
        f"PENDING kütüphane operatörü deneme oturumu yönetim listesini aldı "
        f"({r.status_code}): {r.text[:200]}"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("durum", ["PENDING", "REJECTED", "HIDDEN", "SUSPENDED"])
async def test_active_olmayan_her_durum_reddedilir(ip3, http, durum):
    """Kapı allowlist'tir.

    `SUSPENDED` bugün `LibraryStatus` enum'unda YOKTUR; kolon `String(10)`
    olduğu için veriye girebilir. Bilinmeyen bir durumun sessizce "yetkili"
    sayılması, denylist mantığının klasik hatasıdır — bu satır fail-closed
    davranışı ölçer.
    """
    lib = await ip3.library(status=durum)
    op = await ip3.operator(lib)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )

    assert r.status_code == 403, f"{durum} kütüphane operatörü yönetime girdi ({r.status_code})"


@pytest.mark.asyncio
async def test_silinmis_kutuphanenin_operatoru_404(ip3, http):
    lib = await ip3.library()
    op = await ip3.operator(lib)
    await ip3.soft_delete_library(lib)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )

    assert r.status_code == 404, (
        f"silinmiş kütüphanenin operatörü yönetime girdi ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_silinmis_operator_hesabi_401(ip3, http):
    """Hesap kapatma anında etkili olmalı (token hâlâ imzalı ve süresi dolmamış)."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    baslik = yetki_basligi(op)
    assert (
        await http.get(
            "/api/v1/exam-sessions/manage",
            params={"library_id": lib.id},
            headers=baslik,
        )
    ).status_code == 200, "kurulum bozuk: ACTIVE operatör baştan giremiyor"

    await ip3.soft_delete_operator(op)

    r = await http.get(
        "/api/v1/exam-sessions/manage", params={"library_id": lib.id}, headers=baslik
    )

    assert r.status_code == 401, (
        f"silinmiş operatör hesabı hâlâ yönetime giriyor ({r.status_code})"
    )


# ── 2. Kapının BÜTÜN yönetim yüzeyinde olduğu (kopya kontrol bırakılmadı) ──────


@pytest.mark.asyncio
async def test_pending_operator_hicbir_yonetim_ucunu_kullanamaz(ip3, http):
    """Tek tek uç gezerek ölçer: kapı bir yerde unutulursa burada görünür.

    Kaynak id'leri var olmayan değerlerdir — kapı endpoint gövdesinden ÖNCE
    çalıştığı için "kaynak yok" (404) cevabı bile verilmemeli. 404 dönen bir uç,
    kapının gövdeye kopyalandığının (ya da hiç olmadığının) kanıtıdır.
    """
    lib = await ip3.library(status="PENDING")
    op = await ip3.operator(lib)
    baslik = yetki_basligi(op)

    gecenler: list[str] = []
    for uc in _yonetim_ucları(lib.id):
        r = await _iste(http, uc, baslik)
        if r.status_code != 403:
            gecenler.append(f"{_uc_kimligi(uc)} → {r.status_code}")

    assert not gecenler, (
        "onaysız operatör şu yönetim uçlarında 403 ALMADI (kapı eksik ya da "
        "endpoint gövdesine kopyalanmış):\n  " + "\n  ".join(gecenler)
    )


@pytest.mark.asyncio
async def test_ortak_operator_dependencysi_gercekten_kablolanmis(ip3, http):
    """Kapı gerçekten `get_current_active_operator` üzerinden mi veriliyor?

    Bu, kaynak taraması DEĞİL: çalışan uygulamanın FastAPI bağımlılık ağacı
    (`route.dependant`) geziliyor. Davranış testi "sonuç doğru" der; bu test
    "karar ORTAK yerde veriliyor" der. İkisi birlikte, router'a kopyalanmış bir
    kontrolün sonradan sessizce ayrışmasını engeller.
    """
    from api.deps import get_current_active_operator

    operator_rotalari = _operator_rotalari()
    assert operator_rotalari, (
        "operatör rolü kabul eden hiçbir rota bulunamadı — test hiçbir şey "
        "ölçmüyor (rota tablosu okunamadı ya da tanıma mantığı bozuldu)"
    )

    eksik = sorted(
        f"{sorted(r.methods)[0]} {r.path}"
        for r in operator_rotalari
        if not _muaf(r.path)
        and get_current_active_operator not in _bagimlilik_cagrilari(r.dependant)
    )

    assert not eksik, (
        f"operatör rolünü kabul eden {len(operator_rotalari)} rotadan şunlar "
        "ortak ACTIVE dependency'sini KULLANMIYOR (kontrol ya yok ya da router "
        "gövdesine kopyalanmış):\n  " + "\n  ".join(eksik)
    )


#: Onay beklerken de kullanılabilmesi GEREKEN uçlar (bkz. modül docstring'i).
#: Liste dar tutulur: buraya eklenen her yol, onaysız operatöre açık kalır.
#:
#: Muafiyet ölçütü dar: "başvurusunu görüp düzeltip yeniden gönderebilmek".
#: Kazanç (`/earnings`) ve ödeme hesabı (`/payout`) bilinçli olarak DIŞARIDA:
#: onaylanmamış bir işletmenin para yüzeyi yoktur, onboarding'i de kilitlemez.
MUAF_YOLLAR = (
    "/library-operators/me",
    "/libraries/{library_id}/resubmit",
    "/libraries/admin/{library_id}",
    "/libraries/{library_id}",
    "/libraries/{library_id}/logo",
    "/libraries/{library_id}/cover",
    "/libraries/{library_id}/images",
    "/libraries/{library_id}/images/reorder",
    "/libraries/{library_id}/images/{image_id}",
)


def _muaf(path: str) -> bool:
    return path in MUAF_YOLLAR


def _operator_rotalari() -> list:
    """LIBRARY_OPERATOR rolünü kabul eden GERÇEK rotalar.

    Liste elle yazılmaz, **rota tablosundan türetilir**: elle yazılan bir liste
    yeni eklenen bir yönetim ucunu kaçırır ve tam da bu işin konusu olan
    "unutulan uç" hatasını tekrarlar.

    Tanıma yöntemi: `require_roles` / `require_roles_or_admin_permission`
    kapanışlarında (closure) izin verilen rol id kümesi saklanır; hücrelerde
    operatör rol id'sini içeren bir küme arıyoruz. Kaynak taraması değil —
    çalışan uygulamanın nesneleri okunuyor.
    """
    from models.role import ROLE_IDS, RoleType

    op_rol = ROLE_IDS[RoleType.LIBRARY_OPERATOR]

    def kabul_ediyor(fn) -> bool:
        for hucre in getattr(fn, "__closure__", None) or ():
            try:
                deger = hucre.cell_contents
            except ValueError:  # henüz bağlanmamış hücre
                continue
            if isinstance(deger, (set, frozenset)) and op_rol in deger:
                return True
        return False

    return [
        r
        for r in _kayitli_rotalar()
        if any(kabul_ediyor(c) for c in _bagimlilik_cagrilari(r.dependant))
    ]


def _kayitli_rotalar() -> list:
    """Uygulamanın GERÇEK rota tablosu (kaynak taraması değil).

    FastAPI `include_router`'ı `_IncludedRouter` sarmalıyla tutuyor; kayıtlı
    `APIRoute` nesnelerine `original_router` üzerinden iniliyor ve `route.path`
    `/api/v1` öneki OLMADAN saklanıyor.
    """
    from fastapi.routing import APIRoute

    from main import app

    def gez(kok):
        for x in getattr(kok, "routes", []):
            if isinstance(x, APIRoute):
                yield x
            else:
                yield from gez(getattr(x, "original_router", x))

    return list(gez(app))


def _bagimlilik_cagrilari(dependant) -> set:
    bulunan = set()
    yigin = [dependant]
    while yigin:
        d = yigin.pop()
        if d.call is not None:
            bulunan.add(d.call)
        yigin.extend(d.dependencies)
    return bulunan


def _ayni_uc(route_path: str, hedef_yol: str) -> bool:
    """`/exam-sessions/{session_id}/roster` (kayıtlı, öneksiz) ile
    `/api/v1/exam-sessions/2000000000/roster` (istek yolu) aynı ucu mu gösteriyor?"""
    r = [p for p in route_path.split("/") if p]
    h = [p for p in hedef_yol.split("/") if p]
    if h[:2] == ["api", "v1"]:
        h = h[2:]
    if len(r) != len(h):
        return False
    return all(a.startswith("{") or a == b for a, b in zip(r, h, strict=True))


# ── 3. ACTIVE operatör: kendi kaynağı serbest, yabancı kaynak gizli ───────────


@pytest.mark.asyncio
async def test_active_operator_kendi_kutuphanesini_yonetir(ip3, http):
    """Kapı kapanırken meşru kullanım kaybolmamalı."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    await ip3.exam_session(lib)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )

    assert r.status_code == 200, f"ACTIVE operatör kendi listesini alamadı: {r.text[:200]}"
    assert r.json(), "kendi oturumu listede yok — test hiçbir şey ölçmüyor"


@pytest.mark.asyncio
async def test_active_operator_baska_kutuphanenin_listesini_alamaz(ip3, http):
    lib_a = await ip3.library()
    lib_b = await ip3.library()
    op_a = await ip3.operator(lib_a)
    await ip3.exam_session(lib_b)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib_b.id},
        headers=yetki_basligi(op_a),
    )

    assert r.status_code == 404, (
        f"ACTIVE operatör başka kütüphanenin oturum listesini aldı ({r.status_code})"
    )


@pytest.mark.asyncio
async def test_yabanci_oturumda_varlik_sizmaz(ip3, http):
    """`_get_session_or_404` önce, `_assert_can_manage` sonra çalışıyor:
    var olan yabancı oturum 403, olmayan 404 → operatör id tarayarak "bu
    oturum var mı" sorusunu cevaplayabiliyor. İkisi de 404 olmalı."""
    lib_a = await ip3.library()
    lib_b = await ip3.library()
    op_a = await ip3.operator(lib_a)
    yabanci = await ip3.exam_session(lib_b)

    var_olan = await http.get(
        f"/api/v1/exam-sessions/{yabanci.id}/roster", headers=yetki_basligi(op_a)
    )
    olmayan = await http.get(
        "/api/v1/exam-sessions/2000000000/roster", headers=yetki_basligi(op_a)
    )

    assert var_olan.status_code == olmayan.status_code == 404, (
        "yabancı oturumun VARLIĞI sızıyor: var olan "
        f"{var_olan.status_code}, olmayan {olmayan.status_code} (ikisi de 404 olmalı)"
    )


@pytest.mark.asyncio
async def test_yabanci_oturum_patch_ile_degistirilemez(ip3, http):
    """Okuma kapanırken yazma açık kalmamalı."""
    lib_a = await ip3.library()
    lib_b = await ip3.library()
    op_a = await ip3.operator(lib_a)
    yabanci = await ip3.exam_session(lib_b)

    r = await http.patch(
        f"/api/v1/exam-sessions/{yabanci.id}",
        headers=yetki_basligi(op_a),
        json={"title": "ele gecirildi"},
    )

    assert r.status_code == 404, (
        f"ACTIVE operatör yabancı oturumu değiştirebildi ({r.status_code})"
    )


# ── 4. ACTIVE olmak cevap anahtarı hakkı vermez ──────────────────────────────


@pytest.mark.asyncio
async def test_active_operator_patch_yanitinda_cevap_anahtari_yok(ip3, http):
    """Liste dışı yüzey: `PATCH` de `_session_out` döndürüyor.

    `test_ip3_answer_key_pg.py` liste uçlarını ölçüyor; tek kaynağa taşınmayan
    bir düzeltme (yalnız listede filtreleme) burada yakalanır.
    """
    lib = await ip3.library()
    op = await ip3.operator(lib)
    sess = await ip3.exam_session(lib, results_published=True)

    r = await http.patch(
        f"/api/v1/exam-sessions/{sess.id}",
        headers=yetki_basligi(op),
        json={"title": "Guncellenmis IP3 Deneme"},
    )

    assert r.status_code == 200, f"operatör kendi oturumunu güncelleyemedi: {r.text[:200]}"
    assert r.json().get("answer_key_url") is None, (
        f"PATCH yanıtında OPERATÖRe cevap anahtarı döndü: {r.json().get('answer_key_url')!r}"
    )


@pytest.mark.asyncio
async def test_yetkili_admin_ayni_kaynaga_erisir_ve_anahtari_gorur(ip3, http):
    """Kapı admin'i engellemez ve admin anahtarı görmeye devam eder."""
    lib = await ip3.library(status="PENDING")
    admin = await ip3.admin(permissions=["libraries.manage"])
    await ip3.exam_session(lib, results_published=True)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(admin),
    )

    assert r.status_code == 200, (
        f"libraries.manage izinli admin yönetim listesini alamadı ({r.status_code}): "
        f"{r.text[:200]}"
    )
    oturumlar = r.json()
    assert oturumlar, "admin listesi boş — test hiçbir şey ölçmüyor"
    assert any(o.get("answer_key_url") for o in oturumlar), (
        "yetkili ADMIN cevap anahtarını göremedi — kapı meşru erişimi de kapattı"
    )


# ── 5. Onboarding hakkı: kapı bu uçlara UYGULANMAZ ───────────────────────────


@pytest.mark.asyncio
async def test_onaysiz_operator_kendi_hesabini_gorebilir(ip3, http):
    lib = await ip3.library(status="PENDING")
    op = await ip3.operator(lib)

    r = await http.get("/api/v1/library-operators/me", headers=yetki_basligi(op))

    assert r.status_code == 200, (
        f"onay bekleyen operatör kendi hesabını göremedi ({r.status_code}) — "
        "kapı onboarding'i kilitliyor"
    )


@pytest.mark.asyncio
async def test_reddedilen_basvuru_profilini_duzeltip_yeniden_gonderebilir(ip3, http):
    """REJECTED başvuru düzeltilemezse ürün kendini kilitler."""
    lib = await ip3.library(status="REJECTED")
    op = await ip3.operator(lib)
    baslik = yetki_basligi(op)

    duzelt = await http.patch(
        f"/api/v1/libraries/{lib.id}", headers=baslik, json={"description": "Duzeltildi"}
    )
    assert duzelt.status_code == 200, (
        f"reddedilen başvurunun operatörü profilini düzeltemedi ({duzelt.status_code}): "
        f"{duzelt.text[:200]}"
    )

    yeniden = await http.post(f"/api/v1/libraries/{lib.id}/resubmit", headers=baslik)
    assert yeniden.status_code == 200, (
        f"reddedilen başvuru yeniden gönderilemedi ({yeniden.status_code}): "
        f"{yeniden.text[:200]}"
    )
