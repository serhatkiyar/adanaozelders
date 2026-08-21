"""Sahte tedarikçi istemcisi — geliştirme ve testler.

`core/payments/fake.py` deseni: dış hesap olmadan tüm akış koşabilsin. Ayrıca
testler için **gözlem** taşır — hangi batch'ler istendi, çağrı sırasında
transaction açık mıydı — çünkü bu paketin iki değişmezi (D-9 batch sınırı,
D-9 açık transaction) ancak çağrı anında ölçülebilir.
"""
from __future__ import annotations

import datetime
from typing import Callable

from core.suppliers.base import (
    SupplierClient,
    SupplierFavorite,
    SupplierPrice,
)
from core.suppliers.yildirim import PRICE_BATCH_LIMIT, chunk_ids


class FakeSupplierClient(SupplierClient):
    """Verilen veriyi döndürür; istenirse verilen hatayı atar."""

    def __init__(
        self,
        *,
        favorites: list[SupplierFavorite] | None = None,
        prices: dict[int, SupplierPrice] | None = None,
        fail_with: Exception | None = None,
        on_call: Callable[[], None] | None = None,
        new_token: str = "eyJhbGciOiJIUzI1NiJ9.yenilenmis.imza",
    ) -> None:
        self._favorites = favorites or []
        self._prices = prices or {}
        self._fail_with = fail_with
        self._on_call = on_call
        self._new_token = new_token
        #: Gerçekten istenen batch'ler — batch sınırı testinin kanıtı.
        self.price_calls: list[list[int]] = []
        self.favorite_calls = 0
        self.refresh_calls = 0

    def _kontrol(self) -> None:
        if self._on_call is not None:
            self._on_call()
        if self._fail_with is not None:
            raise self._fail_with

    async def fetch_favorites(self) -> list[SupplierFavorite]:
        self.favorite_calls += 1
        self._kontrol()
        return list(self._favorites)

    async def fetch_prices(self, external_ids: list[int]) -> dict[int, SupplierPrice]:
        out: dict[int, SupplierPrice] = {}
        for parca in chunk_ids(list(external_ids), PRICE_BATCH_LIMIT):
            self.price_calls.append(parca)
            self._kontrol()
            out.update({i: self._prices[i] for i in parca if i in self._prices})
        return out

    async def refresh_token(self) -> tuple[str, datetime.datetime | None]:
        self.refresh_calls += 1
        self._kontrol()
        return self._new_token, datetime.datetime.now(
            datetime.timezone.utc
        ) + datetime.timedelta(days=30)
