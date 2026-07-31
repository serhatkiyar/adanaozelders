"""Parola hash'leme — doğruluk ve **event loop'u bloklamama**.

bcrypt kasıtlı olarak yavaştır (güvenliğinin kaynağı bu). Saf Python'dan
çağrıldığında event loop'u ~250 ms boyunca bloklar: bir kullanıcı giriş
yaparken o anki TÜM isteklerin yanıtı bekler. İstek yollarında bu yüzden
`*_async` sarmalayıcılar kullanılır.
"""
import asyncio

import pytest

from core.security import (
    hash_password,
    hash_password_async,
    verify_password,
    verify_password_async,
)

PAROLA = "GucluParola123!"


def test_hash_dogrulanabilir_ve_her_seferinde_farkli():
    h1 = hash_password(PAROLA)
    h2 = hash_password(PAROLA)
    assert h1 != h2, "salt kullanılmıyor — aynı parola aynı hash'i üretiyor"
    assert verify_password(PAROLA, h1)
    assert verify_password(PAROLA, h2)


def test_yanlis_parola_reddedilir():
    assert not verify_password("BaskaParola1!", hash_password(PAROLA))


def test_bcrypt_72_bayt_siniri_asilmaz():
    """bcrypt 72 bayttan sonrasını yok sayar; kesme yapılmazsa bazı sürümler
    hata fırlatır. Uzun parola kabul edilmeli ve doğrulanabilmeli."""
    uzun = "a" * 200
    assert verify_password(uzun, hash_password(uzun))


@pytest.mark.asyncio
async def test_async_hash_dogrulanabilir():
    h = await hash_password_async(PAROLA)
    assert await verify_password_async(PAROLA, h)
    # Senkron ve async sürümler aynı şemayı üretir (biri diğerini doğrulayabilir).
    assert verify_password(PAROLA, h)
    assert await verify_password_async(PAROLA, hash_password(PAROLA))


@pytest.mark.asyncio
async def test_async_hash_event_loop_BLOKLAMAZ():
    """Asıl iddia: bcrypt çalışırken başka coroutine'ler ilerleyebilmeli.

    Sayaç, hash süresince tick atamıyorsa loop bloke olmuş demektir — yani
    sarmalayıcı iş parçacığına taşımayı bırakmış (regresyon).
    """
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.001)
            ticks += 1

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0)  # ticker başlasın
    await hash_password_async(PAROLA)
    task.cancel()

    assert ticks > 0, "bcrypt event loop'u bloklıyor — istek yolları donar"


@pytest.mark.asyncio
async def test_es_zamanli_hashler_seri_beklemez():
    """Birkaç giriş aynı anda gelirse hash'ler paralel ilerlemeli."""
    sonuclar = await asyncio.gather(*(hash_password_async(PAROLA) for _ in range(3)))
    assert len(set(sonuclar)) == 3, "aynı hash üretildi (salt yok?)"
    dogrulamalar = await asyncio.gather(
        *(verify_password_async(PAROLA, h) for h in sonuclar)
    )
    assert all(dogrulamalar)
