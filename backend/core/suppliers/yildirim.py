"""Yıldırım Dağıtım (Keep2B) B2B istemcisi.

Ölçüm kaynağı: `yildirim-b2b-rapor` (18 Ağustos 2026). Ağ davranışının her
sayısı oradan gelir ve keyfî değildir:

* **800 ms** istekler arası — origin sınırlı kapasiteli; keşifte 11 sn ve 4 sn
  süren 502'ler gözlendi.
* **2 → 4 → 8 → 16 sn**, 4 deneme — 502/503/504/429 için.
* **400 kalıcıdır** — istek biçimi yanlış; tekrar denemek kotayı yakar.
* **Batch 100** — 100 ID → HTTP 200, 200 ID → HTTP 400 (test edildi).

Ayrıştırma (`parse_*`) ağdan bilinçli olarak AYRIDIR ve saf fonksiyondur
(`core/payments/iyzico.build_auth_headers` deseni): gerçek yanıt şekli bir
fixture'da durur, dönüşüm pytest'lenir, ağ gerekmez.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
import re
from decimal import Decimal, InvalidOperation

import httpx

from core.config import settings
from core.suppliers.base import (
    PriceBreakdown,
    SupplierAuthError,
    SupplierBadRequest,
    SupplierBadResponse,
    SupplierClient,
    SupplierFavorite,
    SupplierPrice,
    SupplierUnavailable,
)

logger = logging.getLogger("adana.suppliers.yildirim")

#: Tek istekte gönderilebilecek en fazla ID (rapor §2.5: 100 → 200 OK,
#: 200 → 400 Bad Request).
PRICE_BATCH_LIMIT = 100

#: Yeniden denenen HTTP kodları. 400 ve 401/403 bilinçli olarak YOK.
_GECICI_KODLAR = frozenset({429, 500, 502, 503, 504})

#: Backoff merdiveni. Dördüncü hatadan sonra pes edilir (rapor §2.11).
_BACKOFF = (2, 4, 8)

_UA = "AdanaOzelDers-SupplierSync/1.0"


async def _uyu(saniye: float) -> None:
    """Testlerin yakalayabilmesi için ayrı fonksiyon.

    `asyncio.sleep`'i doğrudan çağırsaydık backoff'u ölçmenin tek yolu testi
    gerçekten 14 saniye bekletmek olurdu; kimse öyle bir testi koşmaz ve
    backoff sessizce bozulabilirdi."""
    await asyncio.sleep(saniye)


# ══════════════════ Saf ayrıştırıcılar ══════════════════


def _dec(x, *, varsayilan: Decimal | None = None) -> Decimal | None:
    """`Decimal(str(x))` — float ASLA. API `51.831900000000005` döndürüyor."""
    if x is None or x == "":
        return varsayilan
    try:
        return Decimal(str(x))
    except (InvalidOperation, ValueError):
        return varsayilan


def _oran(kdv) -> Decimal | None:
    """API yüzde verir (`kdv: 20`); bizde `tax_rate` ORANDIR (0.20).

    Dönüşüm SINIRDA yapılır: iki birim sistemi kod içinde yan yana yaşarsa
    biri ötekinin yerine geçtiğinde hata yalnız faturada görünür."""
    d = _dec(kdv)
    return None if d is None else d / Decimal("100")


def _tarih(x) -> datetime.datetime | None:
    if not x:
        return None
    try:
        return datetime.datetime.fromisoformat(str(x).replace("Z", "+00:00"))
    except ValueError:
        return None


def _urun_listesi(payload) -> list[dict]:
    """Zarf esnekliği.

    Rapor `/favoriler/urunler` için zarf şeklini açıkça yazmıyor: `/arama`
    `{"urunler": [...]}` döndürüyor, favoriler "aynı 16 alanı, sayfalama yok"
    diyor. İki olasılığı da kabul etmek maliyetsiz; yanlış tahmin ise
    "0 favori bulundu" diye SESSİZ bir başarı üretirdi.
    """
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for anahtar in ("urunler", "items", "data"):
            deger = payload.get(anahtar)
            if isinstance(deger, list):
                return [x for x in deger if isinstance(x, dict)]
    raise SupplierBadResponse(
        "Favori yanıtı beklenen şekilde değil (urunler listesi bulunamadı)"
    )


def parse_favorites(payload) -> list[SupplierFavorite]:
    """`GET /favoriler/urunler` → dataclass listesi. SAF."""
    out: list[SupplierFavorite] = []
    for ham in _urun_listesi(payload):
        dis_id = ham.get("id")
        if dis_id is None:
            continue
        birimler = ham.get("birimler") or []
        birim = birimler[0] if birimler and isinstance(birimler[0], dict) else {}
        barkod = ham.get("barkod")
        out.append(
            SupplierFavorite(
                external_id=int(dis_id),
                code=str(ham.get("kod") or "").strip(),
                name=str(ham.get("ad") or "").strip(),
                brand=(ham.get("marka") or None),
                list_price=_dec(ham.get("listeFiyat")),
                vat_rate=_oran(ham.get("kdv")),
                min_order=_dec(ham.get("minSiparis")),
                has_image=bool(ham.get("resimVar")),
                stock_status=(ham.get("stokDurum") or None),
                category_path=(ham.get("kategoriYolu") or None),
                opened_at=_tarih(ham.get("acilisTarihi")),
                stockless=bool(ham.get("stoksuz")),
                # KESİRLİ olabilir (12.5 ölçüldü) → Decimal, int değil.
                stock_qty=_dec(ham.get("stokBakiye"), varsayilan=Decimal("0")),
                unit_name=(birim.get("ad") or None),
                unit_multiplier=_dec(birim.get("carpan"), varsayilan=Decimal("1")),
                barcode=(str(barkod).strip() if barkod else None),
            )
        )
    return out


def parse_price_response(payload) -> dict[int, SupplierPrice]:
    """`POST /fiyat` → {external_id: SupplierPrice}. SAF."""
    if not isinstance(payload, dict):
        raise SupplierBadResponse("Fiyat yanıtı sözlük değil")
    fiyatlar = payload.get("fiyatlar")
    if not isinstance(fiyatlar, dict):
        raise SupplierBadResponse("Fiyat yanıtında `fiyatlar` yok")
    kirilimlar = payload.get("kirilim") or {}

    out: dict[int, SupplierPrice] = {}
    for anahtar, ham in fiyatlar.items():
        if not isinstance(ham, dict):
            continue
        try:
            dis_id = int(anahtar)
        except (TypeError, ValueError):
            continue

        kirilim_listesi: list[PriceBreakdown] = []
        for k in kirilimlar.get(anahtar) or kirilimlar.get(str(dis_id)) or []:
            if not isinstance(k, dict):
                continue
            net = _dec(k.get("net"))
            if net is None:
                continue
            kirilim_listesi.append(
                PriceBreakdown(
                    sub_account_id=int(k.get("altHesapId") or 0),
                    name=str(k.get("ad") or "").strip(),
                    is_default=bool(k.get("varsayilan")),
                    net=net,
                    discounts=tuple(
                        d for d in (_dec(x) for x in (k.get("iskontolar") or []))
                        if d is not None
                    ),
                    order=int(k.get("sira") or 0),
                )
            )

        out[dis_id] = SupplierPrice(
            external_id=dis_id,
            base=_dec(ham.get("taban")),
            vat_rate=_oran(ham.get("kdv")),
            currency_id=(
                int(ham["dovizId"]) if ham.get("dovizId") is not None else None
            ),
            campaign=bool(ham.get("kampanyali")),
            envelope_net=_dec(ham.get("net")),
            breakdowns=tuple(kirilim_listesi),
        )
    return out


def chunk_ids(ids: list[int], size: int = PRICE_BATCH_LIMIT) -> list[list[int]]:
    """ID listesini batch sınırına böler. SAF."""
    if size < 1:
        raise ValueError("batch boyutu en az 1 olmalı")
    return [list(ids[i : i + size]) for i in range(0, len(ids), size)]


def _maskele(metin: str, token: str | None) -> str:
    """Token'ı hata metninden söker (D-5).

    Sunucu hata gövdesinde token'ı geri yansıtabilir; o metin `last_error`'a
    yazılıyor ve PANELDE gösteriliyor. Ayrıca uzun JWT parçalarını genel bir
    desenle de temizleriz — bir gün başka bir alanda sızarsa diye.
    """
    temiz = metin
    if token:
        temiz = temiz.replace(token, "***")
        # JWT'nin gövde parçası tek başına da sızabilir.
        for parca in token.split("."):
            if len(parca) >= 12:
                temiz = temiz.replace(parca, "***")
    temiz = re.sub(r"eyJ[A-Za-z0-9_\-]{10,}(?:\.[A-Za-z0-9_\-]+){0,2}", "***", temiz)
    return temiz


# ══════════════════ İstemci ══════════════════


class YildirimClient(SupplierClient):
    def __init__(
        self,
        *,
        token: str | None,
        base_url: str,
        timeout: float | None = None,
        gap_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = token
        self._base_url = base_url.rstrip("/")
        self._timeout = (
            timeout if timeout is not None else settings.SUPPLIER_HTTP_TIMEOUT_SECONDS
        )
        self._gap = (
            gap_seconds
            if gap_seconds is not None
            else settings.SUPPLIER_REQUEST_GAP_SECONDS
        )
        #: Testlerde `httpx.MockTransport` enjekte etmek için. Üretimde `None`.
        self._transport = transport
        self._ilk_istek = True

    def __repr__(self) -> str:  # pragma: no cover - teşhis
        # D-5: `repr` bir hata izinde loglanabilir; token ASLA görünmemeli.
        return f"<YildirimClient base_url={self._base_url!r} token={'var' if self._token else 'yok'}>"

    # ── Genel istek ──

    def _basliklar(self) -> dict[str, str]:
        h = {"Accept": "application/json", "User-Agent": _UA}
        # Rapor auth'u çelişkili yazıyor (§2.3 gerekir / §2.10 gerekmez).
        # Fazladan başlık zarar vermez; eksik başlık sessiz 401 üretir.
        if self._token:
            h["Authorization"] = f"Bearer {self._token}"
        return h

    async def _istek(self, method: str, yol: str, *, json: dict | None = None):
        # Guard GERÇEK bağlantıyı engeller. Enjekte edilmiş bir taşıma (test
        # `MockTransport`'u) zaten soket açmaz — onu da reddetmek, guard'ı
        # "ağa çıkma" kuralından "istemciyi hiç kullanma" kuralına çevirir ve
        # ağ davranışının (backoff, aralık, başlık) testini imkânsız kılardı.
        if settings.SUPPLIER_NETWORK_DISABLED and self._transport is None:
            raise RuntimeError(
                "SUPPLIER_NETWORK_DISABLED açık — tedarikçi ağına çıkılamaz. "
                "(Testlerin varsayılanı; canlı doğrulama için açıkça kapatın.)"
            )

        # Bekleme İSTEKLER ARASINDA: baştan uyumak 60 saniyelik stok döngüsüne
        # her turda karşılıksız 800 ms ekler.
        if not self._ilk_istek and self._gap > 0:
            await _uyu(self._gap)
        self._ilk_istek = False

        url = f"{self._base_url}{yol}"
        son_hata: Exception | None = None
        for deneme in range(len(_BACKOFF) + 1):
            try:
                async with httpx.AsyncClient(
                    timeout=self._timeout, transport=self._transport
                ) as istemci:
                    yanit = await istemci.request(
                        method, url, headers=self._basliklar(), json=json
                    )
            except httpx.HTTPError as exc:
                son_hata = SupplierUnavailable(
                    f"Bağlantı hatası: {exc.__class__.__name__}"
                )
            else:
                if yanit.status_code in (401, 403):
                    raise SupplierAuthError(
                        f"Yetki reddedildi ({yanit.status_code}) — token geçersiz "
                        "veya süresi dolmuş olabilir"
                    )
                if yanit.status_code == 400:
                    raise SupplierBadRequest(
                        "İstek reddedildi (400): "
                        + _maskele(yanit.text[:200], self._token)
                    )
                if yanit.status_code in _GECICI_KODLAR:
                    son_hata = SupplierUnavailable(
                        f"Tedarikçi sunucusuna ulaşılamadı ({yanit.status_code})"
                    )
                elif yanit.status_code >= 400:
                    raise SupplierBadResponse(
                        f"Beklenmeyen yanıt kodu: {yanit.status_code}"
                    )
                else:
                    return self._govde(yanit)

            if deneme < len(_BACKOFF):
                logger.warning(
                    "Yıldırım isteği başarısız (%s), %s sn sonra yeniden denenecek",
                    son_hata.__class__.__name__ if son_hata else "?",
                    _BACKOFF[deneme],
                )
                await _uyu(_BACKOFF[deneme])

        raise son_hata or SupplierUnavailable("Tedarikçiye ulaşılamadı")

    def _govde(self, yanit: httpx.Response):
        tur = (yanit.headers.get("content-type") or "").lower()
        if "json" not in tur:
            # Cloudflare challenge sayfası 200 + HTML döndürür.
            raise SupplierBadResponse(
                f"Yanıt JSON değil (content-type: {tur or 'yok'}) — "
                "bot koruması devrede olabilir"
            )
        try:
            return yanit.json()
        except ValueError as exc:
            raise SupplierBadResponse("Yanıt gövdesi çözümlenemedi") from exc

    # ── Sözleşme ──

    async def fetch_favorites(self) -> list[SupplierFavorite]:
        govde = await self._istek("GET", "/favoriler/urunler")
        return parse_favorites(govde)

    async def fetch_prices(self, external_ids: list[int]) -> dict[int, SupplierPrice]:
        out: dict[int, SupplierPrice] = {}
        for parca in chunk_ids(list(external_ids)):
            govde = await self._istek(
                "POST", "/fiyat", json={"stokIds": parca, "kirilim": True}
            )
            out.update(parse_price_response(govde))
        return out

    async def refresh_token(self) -> tuple[str, datetime.datetime | None]:
        govde = await self._istek("POST", "/oturum/yenile")
        yeni = (govde or {}).get("token") if isinstance(govde, dict) else None
        if not yeni:
            raise SupplierBadResponse("Token yenileme yanıtında `token` yok")
        return str(yeni), decode_token_expiry(str(yeni))


def decode_token_expiry(token: str) -> datetime.datetime | None:
    """JWT `exp` claim'ini **imza doğrulamadan** okur.

    İmza bizim değil; doğrulayamayız ve doğrulamamıza gerek de yok. Tek amaç
    panelde "N gün sonra dolar" uyarısı basmak — 30 günlük bir token sessizce
    ölürse stok bilgisi bayatlar ve kimse fark etmez.
    """
    try:
        import base64
        import json as _json

        parcalar = token.split(".")
        if len(parcalar) < 2:
            return None
        govde = parcalar[1]
        govde += "=" * (-len(govde) % 4)
        veri = _json.loads(base64.urlsafe_b64decode(govde))
        exp = veri.get("exp")
        if not exp:
            return None
        return datetime.datetime.fromtimestamp(int(exp), tz=datetime.timezone.utc)
    except Exception:  # noqa: BLE001 - teşhis amaçlı, akışı bozmaz
        return None
