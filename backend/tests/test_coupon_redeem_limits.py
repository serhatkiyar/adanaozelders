"""coupon_service.redeem — limitler kilit altında YENİDEN doğrulanır (ekspertiz P0-5).

``evaluate`` sipariş *oluşturulurken* çalışır; ``CouponRedemption`` satırı ise
ancak ödeme kesinleşince yazılır. Arada geniş bir pencere vardır ve önceden
``redeem`` limiti hiç kontrol etmeden ``used_count``'u artırıyordu.

Sömürü (kapatıldı): ``per_user_limit=1`` bir kuponla arka arkaya N sipariş aç
(hiçbiri redemption yazmaz → ``evaluate`` hepsini geçirir), sonra N'ini de öde
→ N kez indirim. Aynı şekilde global ``max_uses`` da aşılabiliyordu.
"""
from __future__ import annotations

import pytest

from services import coupon_service


class _FakeCoupon:
    def __init__(
        self,
        *,
        used_count: int = 0,
        max_uses: int | None = None,
        per_user_limit: int | None = None,
    ) -> None:
        self.id = 7
        self.code = "YKS20"
        self.used_count = used_count
        self.max_uses = max_uses
        self.per_user_limit = per_user_limit


class _Result:
    """SQLAlchemy Result'ın testte kullanılan iki yüzeyi."""

    def __init__(self, value) -> None:
        self._value = value

    def scalars(self):
        return self

    def first(self):
        return self._value

    def scalar(self):
        return self._value


class _FakeDb:
    """İlk execute → kupon satırı; ikinci execute → kullanıcının kullanım sayısı."""

    def __init__(self, coupon: _FakeCoupon | None, per_user_used: int = 0) -> None:
        self._results = [_Result(coupon), _Result(per_user_used)]
        self.added: list = []

    async def execute(self, *_a, **_kw):
        return self._results.pop(0) if self._results else _Result(None)

    def add(self, obj) -> None:
        self.added.append(obj)


async def _redeem(db: _FakeDb) -> bool:
    return await coupon_service.redeem(db, coupon_id=7, client_id=42, order_id=100)


@pytest.mark.asyncio
async def test_limitsiz_kupon_sayilir() -> None:
    coupon = _FakeCoupon()
    db = _FakeDb(coupon)
    assert await _redeem(db) is True
    assert coupon.used_count == 1
    assert len(db.added) == 1  # redemption satırı yazıldı


@pytest.mark.asyncio
async def test_global_limit_dolmussa_sayilmaz() -> None:
    coupon = _FakeCoupon(used_count=100, max_uses=100)
    db = _FakeDb(coupon)
    assert await _redeem(db) is False
    assert coupon.used_count == 100  # artırılmadı
    assert db.added == []  # redemption YAZILMADI


@pytest.mark.asyncio
async def test_global_limitin_son_hakki_kullanilabilir() -> None:
    coupon = _FakeCoupon(used_count=99, max_uses=100)
    db = _FakeDb(coupon)
    assert await _redeem(db) is True
    assert coupon.used_count == 100


@pytest.mark.asyncio
async def test_kullanici_limiti_dolmussa_sayilmaz() -> None:
    coupon = _FakeCoupon(per_user_limit=1)
    db = _FakeDb(coupon, per_user_used=1)
    assert await _redeem(db) is False
    assert coupon.used_count == 0
    assert db.added == []


@pytest.mark.asyncio
async def test_kullanici_limiti_altindaysa_sayilir() -> None:
    coupon = _FakeCoupon(per_user_limit=3)
    db = _FakeDb(coupon, per_user_used=2)
    assert await _redeem(db) is True
    assert coupon.used_count == 1


@pytest.mark.asyncio
async def test_silinmis_kupon_false_doner() -> None:
    db = _FakeDb(None)
    assert await _redeem(db) is False
    assert db.added == []
