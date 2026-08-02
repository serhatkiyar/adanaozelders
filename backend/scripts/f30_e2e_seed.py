"""F30 gerçek tarayıcı kabulü için veri tohumu.

Neden ayrı bir betik: F30'un baskı ve zimmet sözleşmeleri **JSDOM'da
kanıtlanamaz**. `@media print` kuralları, QR modül boyutu, uzun başlığın kareyi
ezmesi ve kameranın olmadığı bir telefonda manuel kod girişi ancak gerçek bir
tarayıcıda görülür (kök `CLAUDE.md` §F). Bu betik o kabulün ihtiyaç duyduğu
gerçek veriyi üretir.

**Veri, testlerin kullandığı fabrikayla üretilir** (`tests/integration/
f30_factory.py`). Elle `Product(...)`/`Order(...)` kurmak ilk denemede zaten
patladı (`is_digital` diye bir kolon yok) ve patlamasaydı daha kötü olurdu:
ikinci bir kurulum yolu er ya da geç şemadan sessizce ayrışır ve kabul,
üretimin görmediği bir veriyle "geçer". Fabrikanın kurmadığı tek şey **giriş
yapılabilir kurye hesabı**dır — kabul akışı UI'dan giriş yapar, token enjekte
etmek oturum katmanını atlayıp "çalışıyor" sanmaktır.

**Yalnız adı `test` içeren bir veritabanında çalışır** (§G).

Çıktısı **tek satır JSON**'dur; tarayıcı sürücüsü (`frontend/scripts/
f30_browser_acceptance.mjs`) onu okur.

Kullanım:

    POSTGRES_DB=adana_f30_e2e_test ... python -m scripts.f30_e2e_seed
"""
from __future__ import annotations

import asyncio
import json
import sys
import uuid

from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from core.security import hash_password

E2E_PAROLA = "F30-e2e-kabul-2026"

#: Etiket kabulünün girdisi. Uzun ve çok satırlı: `truncate`/`line-clamp` ile
#: kırpılmış bir adres ancak GERÇEK baskıda görülür ve kâğıttan okunamayan
#: adres kuryeyi yanlış kapıya gönderir.
UZUN_ADRES = (
    "Reşatbey Mahallesi Atatürk Caddesi Gülbahçe Sitesi B Blok "
    "Kat 7 Daire 21 (eczanenin üst katı, zilin ikincisi)"
)
ALICI = "Ayşe Nur Yılmazoğlu Karadeniz"

#: Uzun başlık QR'ı yatay olarak ezebiliyor mu — F26'da yaşanan bozulma.
UZUN_URUN = "Palme TYT Matematik Soru Bankası (yeni baskı, 2026 müfredatı)"
KISA_URUN = "AYT Fizik Konu Anlatımı"


def _test_db_zorunlu() -> None:
    ad = (settings.POSTGRES_DB or "").lower()
    if "test" not in ad:
        raise SystemExit(
            f"REDDEDİLDİ: '{settings.POSTGRES_DB}' adı 'test' içermiyor. "
            "Bu betik geliştirme kataloğuna veri yazmaz."
        )


async def _kurye_hesabi(courier_id: int) -> tuple[int, str]:
    """Gerçek parolayla giriş yapılabilen kurye hesabı. (account_id, e-posta)

    Fabrikanın `kurye_hesabi`'si token üretir ve parolayı `"test-only"` bırakır;
    burada UI'dan giriş yapılacağı için parola gerçekten `bcrypt`'lenir.
    """
    from models.courier_account import CourierAccount

    u = uuid.uuid4().hex[:12]
    eposta = f"kurye-{u}@f30kabul.test"
    async with AsyncSessionLocal() as s:
        hesap = CourierAccount(
            email=eposta,
            hashed_password=hash_password(E2E_PAROLA),
            first_name="Kabul",
            last_name="Kuryesi",
            username=f"kk{u}",
            role_id=5,
            courier_id=courier_id,
            is_active=True,
            auth_version=1,
        )
        s.add(hesap)
        await s.flush()
        hid = hesap.id
        await s.commit()
    return hid, eposta


async def ana() -> None:
    _test_db_zorunlu()
    from tests.integration.f30_factory import PaketFabrikasi

    fab = PaketFabrikasi()

    pid1, sku1, barkod1 = await fab.barkodlu_urun(stock=20)
    pid2, sku2, barkod2 = await fab.barkodlu_urun(stock=20)
    order_id = await fab.fiziksel_siparis(kalemler=[(pid1, 2), (pid2, 1)])

    # Fabrika kendi kısa adresini yazar; etiket kabulünün girdisi uzun adres,
    # gerçek alıcı adı, ürün başlıkları ve KOMŞUYA_BIRAK tercihidir.
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE orders SET ship_recipient = :r, ship_address = :a, "
                "delivery_pref = 'KOMSUYA_BIRAK', "
                "delivery_pref_note = 'kapıcı Ahmet Bey, B blok zemin' "
                "WHERE id = :o"
            ),
            {"r": ALICI, "a": UZUN_ADRES, "o": order_id},
        )
        await s.execute(
            text("UPDATE order_items SET title = :t WHERE order_id = :o AND product_id = :p"),
            {"t": UZUN_URUN, "o": order_id, "p": pid1},
        )
        await s.execute(
            text("UPDATE order_items SET title = :t WHERE order_id = :o AND product_id = :p"),
            {"t": KISA_URUN, "o": order_id, "p": pid2},
        )
        await s.commit()

    courier_id = await fab.kurye()
    hesap_id, kurye_eposta = await _kurye_hesabi(courier_id)
    run_id = await fab.tur(courier_id=courier_id)

    print(
        json.dumps(
            {
                "order_id": order_id,
                "run_id": run_id,
                "courier_id": courier_id,
                "courier_account_id": hesap_id,
                "courier_email": kurye_eposta,
                "courier_password": E2E_PAROLA,
                "recipient": ALICI,
                "address": UZUN_ADRES,
                "products": [
                    {"id": pid1, "sku": sku1, "barcode": barkod1, "qty": 2, "title": UZUN_URUN},
                    {"id": pid2, "sku": sku2, "barcode": barkod2, "qty": 1, "title": KISA_URUN},
                ],
                "admin_email": settings.ADMIN_EMAIL,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        asyncio.run(ana())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - betik; hata metni operatöre gider
        print(f"TOHUMLAMA BAŞARISIZ: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
