"""PK-1 kabul testleri — ürün kolu bazlı ödeme kapıları.

Neden kol bazlı: 6493 sayılı Kanun tartışması yalnız **başkası adına** toplanan
parada doğar (eğitmen dersi, eğitmen dijital ürünü, kütüphane bileti). Platformun
kendi kitabını satması kendi cirosudur; o kolun kapatılması için hukuki bir sebep
yoktur. Bu yüzden tek bir `payments_live` bayrağı ve tek bir global "launch gate"
YANLIŞTIR: pazaryeri beklerken mağaza satmaya devam etmelidir.

Kapının iki bileşeni vardır ve **ikisi de** gerekir:
  1. bayrak (işletme kararı, DB'de),
  2. sağlayıcı yeteneği (`supports_marketplace` — alt üye işyeri desteği).
Bayrak açık ama sağlayıcı pazaryeri desteklemiyorsa kol KAPALIDIR. Üretimde
sağlayıcı iyzico olmak zorundadır (config guard) ve iyzico alt üye entegrasyonu
PK-2'de yazılacaktır; dolayısıyla bu kural fiilî lansman kapısıdır.

Bayrak okuması **fail-CLOSED**'dır. Bu, rate-limit'in bilinçli fail-OPEN
davranışının tersidir ve tersi olması gerekir: "bayrağı okuyamadım" hâlinde para
tahsil etmek, tahsil etmemekten çok daha pahalıdır.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _temiz_onbellek():
    """Bayrak okuması süreç-içi TTL cache kullanır; testler arası sızmasın."""
    from core import flags

    flags.reset_cache()
    yield
    flags.reset_cache()


class _StubDb:
    """`is_enabled` yalnız `execute` çağırır; gerçek oturuma ihtiyaç yok."""

    def __init__(self, values: dict[str, bool] | None = None, *, raise_on_execute=False):
        self._values = values or {}
        self._raise = raise_on_execute
        self.calls = 0

    async def execute(self, stmt):  # noqa: ANN001
        self.calls += 1
        if self._raise:
            raise RuntimeError("DB down")
        key = _key_from_stmt(stmt)
        value = self._values.get(key)

        class _Result:
            def scalar_one_or_none(_self):  # noqa: ANN001, N805
                return value

        return _Result()


def _key_from_stmt(stmt) -> str:  # noqa: ANN001
    """Derlenmiş SQL'in parametrelerinden bayrak anahtarını çıkarır."""
    params = stmt.compile().params
    for value in params.values():
        if isinstance(value, str):
            return value
    raise AssertionError("sorguda bayrak anahtarı bulunamadı")


# ── 1. Bayrak okuması ────────────────────────────────────────────────────────


async def test_bayrak_db_satiri_yoksa_spec_varsayilanini_kullanir():
    from core import flags

    db = _StubDb({})
    # Mağaza kolu 6493 kapsamı dışıdır → varsayılanı AÇIK.
    assert await flags.is_enabled(db, flags.FLAG_STORE_PAYMENTS_LIVE) is True
    # Pazaryeri kolları varsayılan olarak KAPALI.
    assert await flags.is_enabled(db, flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE) is False
    assert await flags.is_enabled(db, flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE) is False


async def test_bayrak_db_satiri_varsa_onu_kullanir():
    from core import flags

    db = _StubDb({flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE: True})
    assert await flags.is_enabled(db, flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE) is True


async def test_bayrak_okunamazsa_FAIL_CLOSED_kapali_sayilir():
    """DB patlarsa varsayılanı DEĞİL, kapalıyı döndürür — mağaza kolu dahil."""
    from core import flags

    db = _StubDb(raise_on_execute=True)
    assert await flags.is_enabled(db, flags.FLAG_STORE_PAYMENTS_LIVE) is False
    assert await flags.is_enabled(db, flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE) is False


async def test_bayrak_hatasi_onbellege_YAZILMAZ():
    """Geçici arıza kalıcı kapanmaya dönüşmemeli: hata sonrası ilk başarılı
    okuma doğru değeri vermeli."""
    from core import flags

    bozuk = _StubDb(raise_on_execute=True)
    assert await flags.is_enabled(bozuk, flags.FLAG_STORE_PAYMENTS_LIVE) is False

    saglam = _StubDb({flags.FLAG_STORE_PAYMENTS_LIVE: True})
    assert await flags.is_enabled(saglam, flags.FLAG_STORE_PAYMENTS_LIVE) is True


async def test_onbellek_ayni_istek_icin_tekrar_sorgu_atmaz():
    from core import flags

    db = _StubDb({flags.FLAG_STORE_PAYMENTS_LIVE: True})
    await flags.is_enabled(db, flags.FLAG_STORE_PAYMENTS_LIVE)
    await flags.is_enabled(db, flags.FLAG_STORE_PAYMENTS_LIVE)
    assert db.calls == 1


async def test_tanimsiz_bayrak_anahtari_programlama_hatasidir():
    from core import flags

    with pytest.raises(KeyError):
        await flags.is_enabled(_StubDb(), "uydurma_bayrak")


def test_bayrak_katalogu_uygulanan_ve_uygulanmayanlari_ayirir():
    """Henüz kod tarafında karşılığı olmayan bayraklar (`minor_bookings_live`,
    `invoicing_live`, `marketing_messages_enabled`) katalogda `enforced=False`
    işaretlenir — panelde "henüz uygulanmıyor" olarak gösterilebilsin ve sahte
    bir kontrol izlenimi vermesin."""
    from core import flags

    by_key = {s.key: s for s in flags.FLAG_SPECS}
    assert by_key[flags.FLAG_STORE_PAYMENTS_LIVE].enforced is True
    assert by_key[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE].enforced is True
    assert by_key[flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE].enforced is True
    assert by_key[flags.FLAG_MANUAL_PAYOUT_ENABLED].enforced is True
    assert by_key[flags.FLAG_MINOR_BOOKINGS_LIVE].enforced is False
    assert by_key[flags.FLAG_INVOICING_LIVE].enforced is False
    assert by_key[flags.FLAG_MARKETING_MESSAGES_ENABLED].enforced is False


# ── 2. Kolların bağımsızlığı ─────────────────────────────────────────────────


@pytest.fixture
def acik_kollar(monkeypatch):
    """Bayrakları doğrudan yönetmek için `is_enabled`'ı değiştirir."""
    from core import flags

    state: dict[str, bool] = {}

    async def _fake(db, key):  # noqa: ANN001
        return state.get(key, False)

    monkeypatch.setattr(flags, "is_enabled", _fake)
    return state


@pytest.fixture
def pazaryeri_yetenegi_var(monkeypatch):
    from services import payment_gates

    monkeypatch.setattr(payment_gates, "marketplace_capability_ok", lambda: True)


@pytest.fixture
def pazaryeri_yetenegi_yok(monkeypatch):
    from services import payment_gates

    monkeypatch.setattr(payment_gates, "marketplace_capability_ok", lambda: False)


async def test_pazaryeri_kapaliyken_magaza_kolu_ETKILENMEZ(
    acik_kollar, pazaryeri_yetenegi_var
):
    """Senaryo 1: `tutor_marketplace_payments_live=false`,
    `store_payments_live=true` → ders ödemesi kapalı, kitap satışı ÇALIŞIR."""
    from core import flags
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = False

    await payment_gates.assert_branch_open(None, PaymentBranch.STORE)  # patlamamalı

    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_branch_open(None, PaymentBranch.TUTOR_MARKETPLACE)
    assert exc.value.status_code == 503


async def test_magaza_kapaliyken_pazaryeri_kolu_ETKILENMEZ(
    acik_kollar, pazaryeri_yetenegi_var
):
    from core import flags
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = False
    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = True

    await payment_gates.assert_branch_open(None, PaymentBranch.TUTOR_MARKETPLACE)
    with pytest.raises(HTTPException):
        await payment_gates.assert_branch_open(None, PaymentBranch.STORE)


async def test_kutuphane_kolu_ayri_bayrakla_yonetilir(
    acik_kollar, pazaryeri_yetenegi_var
):
    from core import flags
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE] = False

    await payment_gates.assert_branch_open(None, PaymentBranch.TUTOR_MARKETPLACE)
    with pytest.raises(HTTPException):
        await payment_gates.assert_branch_open(None, PaymentBranch.LIBRARY_MARKETPLACE)


# ── 3. Sağlayıcı yeteneği kapının parçası ────────────────────────────────────


async def test_bayrak_acik_ama_saglayici_pazaryeri_desteklemiyorsa_kol_KAPALI(
    acik_kollar, pazaryeri_yetenegi_yok
):
    """Fiilî lansman kapısı: iyzico alt üye entegrasyonu (PK-2) yazılmadan
    işletme bayrağı açmak yetmez."""
    from core import flags
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_LIBRARY_MARKETPLACE_PAYMENTS_LIVE] = True

    for branch in (PaymentBranch.TUTOR_MARKETPLACE, PaymentBranch.LIBRARY_MARKETPLACE):
        with pytest.raises(HTTPException) as exc:
            await payment_gates.assert_branch_open(None, branch)
        assert exc.value.status_code == 503


async def test_saglayici_yetenegi_magaza_kolunu_ETKILEMEZ(
    acik_kollar, pazaryeri_yetenegi_yok
):
    """Kendi malını satmak alt üye işyeri gerektirmez."""
    from core import flags
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = True
    await payment_gates.assert_branch_open(None, PaymentBranch.STORE)


def test_fake_saglayici_pazaryeri_destekler_iyzico_HENUZ_desteklemez():
    """`supports_marketplace` gerçeği söylemek zorundadır: iyzico alt üye
    metotları şu an stub (`core/payments/iyzico.py`) — True dönmesi kapıyı
    sessizce açardı."""
    from core.payments.fake import FakePaymentProvider
    from core.payments.iyzico import IyzicoProvider

    assert FakePaymentProvider.supports_marketplace is True
    assert IyzicoProvider.supports_marketplace is False


# ── 4. 503 gövdesi makinece okunabilir ──────────────────────────────────────


async def test_kapali_kol_yapilandirilmis_hata_dondurur(
    acik_kollar, pazaryeri_yetenegi_yok
):
    from core import flags
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = True
    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_branch_open(None, PaymentBranch.TUTOR_MARKETPLACE)

    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "PAYMENT_BRANCH_CLOSED"
    assert detail["branch"] == PaymentBranch.TUTOR_MARKETPLACE.value
    assert detail["message"]
    # Neyin eksik olduğu makinece okunabilir olmalı (panel bunu listeler).
    assert "provider_marketplace_support" in detail["blockers"]


async def test_bayrak_kapaliysa_blocker_bayragi_gosterir(
    acik_kollar, pazaryeri_yetenegi_var
):
    from services import payment_gates
    from services.payment_gates import PaymentBranch

    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_branch_open(None, PaymentBranch.TUTOR_MARKETPLACE)
    assert "flag_disabled" in exc.value.detail["blockers"]


# ── 5. Karışık sepet kuralı ─────────────────────────────────────────────────


def test_sepet_satirlari_kollara_dogru_eslenir():
    from services.payment_gates import PaymentBranch, branches_for_seller_types

    assert branches_for_seller_types(["PLATFORM"]) == {PaymentBranch.STORE}
    assert branches_for_seller_types(["TUTOR"]) == {PaymentBranch.TUTOR_MARKETPLACE}
    assert branches_for_seller_types(["PLATFORM", "TUTOR"]) == {
        PaymentBranch.STORE,
        PaymentBranch.TUTOR_MARKETPLACE,
    }
    assert branches_for_seller_types([]) == set()


def test_bilinmeyen_satici_tipi_PAZARYERI_sayilir():
    """Fail-safe: yeni bir satıcı tipi eklenip eşleme güncellenmezse kalem
    sessizce kapısız kalmamalı — en kısıtlı kola (pazaryeri) atanır.

    Bu testin varlık sebebi bir guard mutasyon provasıdır: kural kodda vardı ama
    hiçbir test onu korumuyordu; eşlemeyi "bilinmeyeni atla" biçimine çeviren bir
    mutasyon tüm testleri yeşil geçmişti.
    """
    from services.payment_gates import PaymentBranch, branches_for_seller_types

    assert branches_for_seller_types(["YENI_SATICI_TIPI"]) == {
        PaymentBranch.TUTOR_MARKETPLACE
    }
    # Küçük/büyük harf ve boşluk normalize edilir (bilinen tip yanlış eşlenmesin).
    assert branches_for_seller_types([" platform "]) == {PaymentBranch.STORE}


async def test_bilinmeyen_satici_tipi_iceren_sepet_pazaryeri_kapaliyken_REDDEDILIR(
    acik_kollar, pazaryeri_yetenegi_var
):
    from core import flags
    from services import payment_gates

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = False

    with pytest.raises(HTTPException):
        await payment_gates.assert_cart_branches_open(None, ["BILINMEYEN"])


async def test_karisik_sepet_HER_IKI_bayragi_ister(acik_kollar, pazaryeri_yetenegi_var):
    """Senaryo 2: platform kitabı + eğitmen dijital ürünü aynı sepette;
    pazaryeri kapalıysa sepet ödenemez."""
    from core import flags
    from services import payment_gates

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = False

    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_cart_branches_open(None, ["PLATFORM", "TUTOR"])
    assert exc.value.detail["code"] == "PAYMENT_BRANCH_CLOSED"
    assert exc.value.detail["branch"] == "tutor_marketplace"

    # Yalnız platform malı varsa aynı sepet geçer.
    await payment_gates.assert_cart_branches_open(None, ["PLATFORM"])


async def test_kapali_kollar_odeme_denemesinden_ONCE_raporlanir(
    acik_kollar, pazaryeri_yetenegi_var
):
    """`cart/validate` müşteriye hangi kalemin engellendiğini ödeme denemesinden
    önce söylemek zorundadır — 503'ü checkout'ta görmek kötü deneyimdir."""
    from core import flags
    from services import payment_gates

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = False

    blocked = await payment_gates.blocked_branches_for_seller_types(
        None, ["PLATFORM", "TUTOR"]
    )
    assert blocked == ["tutor_marketplace"]

    blocked_only_store = await payment_gates.blocked_branches_for_seller_types(
        None, ["PLATFORM"]
    )
    assert blocked_only_store == []


# ── 6. Kol bazlı durum raporu (global gate YOK) ─────────────────────────────


async def test_durum_raporu_kol_basina_ayri_verilir(
    acik_kollar, pazaryeri_yetenegi_yok
):
    """Tek bir "hazır mı" boolean'ı YOKTUR; her kol kendi bayrağı, yeteneği ve
    engelleyicileriyle raporlanır."""
    from core import flags
    from services import payment_gates

    acik_kollar[flags.FLAG_STORE_PAYMENTS_LIVE] = True
    acik_kollar[flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE] = True

    report = await payment_gates.branches_status(None)
    by_branch = {r["branch"]: r for r in report}

    assert by_branch["store"]["open"] is True
    assert by_branch["store"]["blockers"] == []
    assert by_branch["tutor_marketplace"]["open"] is False
    assert by_branch["tutor_marketplace"]["flag_enabled"] is True
    assert by_branch["tutor_marketplace"]["blockers"] == ["provider_marketplace_support"]
    assert by_branch["library_marketplace"]["open"] is False


async def test_public_rapor_teshis_alanlarini_GIZLER(acik_kollar, pazaryeri_yetenegi_yok):
    """`/health` ve müşteri uygunluk ucu anonimdir: hangi altyapının eksik
    olduğu (engelleyici adları, bayrak durumu) iç bilgidir, sızmamalıdır.
    Müşteriye yazılmış `message` kalır.
    """
    from services import payment_gates

    public = await payment_gates.branches_status(None, include_diagnostics=False)
    for row in public:
        assert set(row) == {"branch", "label", "open", "message"}

    admin = await payment_gates.branches_status(None, include_diagnostics=True)
    assert "blockers" in admin[0] and "flag_enabled" in admin[0]
