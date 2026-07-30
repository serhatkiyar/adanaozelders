"""PK-1 kabul testleri — elle havale (manuel payout) yolunun kapatılması.

Mevcut hâlde para iyzico'dan platform hesabına geliyor, "emanet" olarak
bekletiliyor ve eğitmene **elle banka havalesiyle** ödeniyor (`POST /payouts`
defteri). Kullanıcı kararı: bu yol üretimde **fallback dâhil tamamen kapalı**
olacak. Sebep, 6493 sayılı Kanun kapsamında "başkası adına para tahsil edip
dağıtmak" nitelendirmesi riskidir (risk hipotezi; avukat teyidine tabi) — ve
m.28/1'in yaptırımı idari para cezası değil hapis cezasıdır.

Bu yüzden iki ayrı savunma vardır:
  1. **Çalışma zamanı:** üretimde uç bayrağa BAKILMAKSIZIN reddeder.
  2. **Açılış:** üretimde bayrak açık bırakılmışsa uygulama AÇILMAZ — yanlış
     yapılandırmayla sessizce çalışmaktansa açılmamak doğru davranıştır
     (`core/config.py::_guard_production` ile aynı felsefe).

Geçmiş `payout_records` satırları silinmez: mali kayıttır, salt-okunur kalır.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _temiz_onbellek():
    from core import flags

    flags.reset_cache()
    yield
    flags.reset_cache()


@pytest.fixture
def bayrak(monkeypatch):
    from core import flags

    state: dict[str, bool] = {}

    async def _fake(db, key):  # noqa: ANN001
        return state.get(key, False)

    monkeypatch.setattr(flags, "is_enabled", _fake)
    return state


def _uretim(monkeypatch, value: bool) -> None:
    from core.config import settings

    monkeypatch.setattr(type(settings), "is_production", property(lambda _self: value))


# ── Çalışma zamanı ───────────────────────────────────────────────────────────


async def test_uretimde_elle_havale_bayraga_bakilmaksizin_reddedilir(bayrak, monkeypatch):
    from core import flags
    from services import payment_gates

    _uretim(monkeypatch, True)
    bayrak[flags.FLAG_MANUAL_PAYOUT_ENABLED] = True  # açık bırakılmış olsa bile

    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_manual_payout_open(None)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "MANUAL_PAYOUT_DISABLED"


async def test_uretim_disinda_bayrak_kapaliysa_reddedilir(bayrak, monkeypatch):
    from services import payment_gates

    _uretim(monkeypatch, False)

    with pytest.raises(HTTPException) as exc:
        await payment_gates.assert_manual_payout_open(None)
    assert exc.value.status_code == 403


async def test_uretim_disinda_bayrak_acikken_gecer(bayrak, monkeypatch):
    """Geliştirme/staging'de mevcut defter akışı test edilebilir kalmalı."""
    from core import flags
    from services import payment_gates

    _uretim(monkeypatch, False)
    bayrak[flags.FLAG_MANUAL_PAYOUT_ENABLED] = True

    await payment_gates.assert_manual_payout_open(None)  # patlamamalı


# ── Açılış guard'ı ───────────────────────────────────────────────────────────


def test_uretimde_bayrak_acikken_acilis_problemi_bildirilir():
    from services.payment_gates import manual_payout_startup_problem

    problem = manual_payout_startup_problem(is_production=True, flag_enabled=True)
    assert problem is not None
    assert "manual_payout_enabled" in problem


def test_uretimde_bayrak_kapaliysa_acilis_sorunsuz():
    from services.payment_gates import manual_payout_startup_problem

    assert manual_payout_startup_problem(is_production=True, flag_enabled=False) is None


def test_uretim_disinda_bayrak_acik_olsa_bile_acilis_sorunsuz():
    from services.payment_gates import manual_payout_startup_problem

    assert manual_payout_startup_problem(is_production=False, flag_enabled=True) is None


# ── Katalog varsayılanı ──────────────────────────────────────────────────────


def test_elle_havale_bayraginin_varsayilani_KAPALI():
    """Yeni bir kurulum, kimse hiçbir şey yapmadan bu yolu açmamalıdır."""
    from core import flags

    spec = next(s for s in flags.FLAG_SPECS if s.key == flags.FLAG_MANUAL_PAYOUT_ENABLED)
    assert spec.default is False


# ── Panelden açılamaz (üretimde) ─────────────────────────────────────────────


async def test_uretimde_panelden_ACILAMAZ(monkeypatch):
    """Bu testin varlık sebebi bir tasarım denetimi bulgusudur: panel bu satır
    için normal bir "Aç" butonu gösteriyordu. Çalışma zamanı kapısı yolu zaten
    reddediyor, AMA bayrağı açık bırakmak sonraki yeniden başlatmada uygulamayı
    hiç açtırmıyor (`manual_payout_startup_problem`). Yani panelden açılabilir
    bırakmak, operatöre "servisi kaldıramaz hâle getir" düğmesi vermekti.
    """
    from fastapi import HTTPException as HE

    from core import flags
    from services import feature_flag_service

    _uretim(monkeypatch, True)

    with pytest.raises(HE) as exc:
        await feature_flag_service.set_flag(
            None,  # DB'ye hiç gidilmeden reddedilmeli
            key=flags.FLAG_MANUAL_PAYOUT_ENABLED,
            enabled=True,
            admin_id=1,
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "FLAG_LOCKED_IN_PRODUCTION"


def test_uretimde_kilit_sebebi_panele_bildirilir(monkeypatch):
    """Panel butonu kilitleyebilmek için sebebi sunucudan öğrenir."""
    from core import flags
    from services.feature_flag_service import _lock_reason

    _uretim(monkeypatch, True)
    assert _lock_reason(flags.FLAG_MANUAL_PAYOUT_ENABLED)
    # Diğer bayraklar üretimde de değiştirilebilir (kol açmak işletme kararıdır).
    assert _lock_reason(flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE) is None

    _uretim(monkeypatch, False)
    assert _lock_reason(flags.FLAG_MANUAL_PAYOUT_ENABLED) is None
