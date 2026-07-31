"""Yanıtlardaki private depolama adreslerini imzalayan ASGI katmanı.

Hassas dosyalar (diploma, karne, cevap anahtarı, dijital ürün, teslim kanıtı
fotoğrafı) bucket'ta ``private/`` öneki altında durur ve anonim okunamaz
(bkz. ``core/storage.PUBLIC_PREFIXES``). Veritabanında **kalıcı** adres saklanır;
istemciye giderken kısa ömürlü imzalı adrese çevrilmesi gerekir.

Bu dönüşüm neden tek tek uçlarda değil de burada yapılıyor: adresler iç içe
yapılarda taşınıyor (sipariş kalemleri, yoklama listesi, durak listesi, oturum
çıktısı). Her yüzeye elle imzalama koymak hem tekrar üretir hem de unutmaya
açıktır — unutulduğunda hata sessizdir: dosya çalışmaz ya da (tersi durumda)
imzasız kalıp kırık görünür. Katman kuralı tek cümleye indirir:
**yanıt gövdesinden çıkan hiçbir private adres imzasız değildir.**

Bu bir YETKİ katmanı DEĞİLDİR: adresin o yanıtta olup olmaması kararı uca aittir
(ör. cevap anahtarı operatöre hiç dönmez, kanıt fotoğrafı public takip token'ına
dönmez). Katman yalnızca "yanıta konmuş adres kullanılabilir olsun" der.
"""

import logging
import re

from starlette.datastructures import Headers

from core import storage
from core.config import settings

logger = logging.getLogger(__name__)

# Gövdedeki adres adaylarını yakalar. Kasıtlı olarak GENİŞ: kesin filtre
# `storage.key_from_url` — bizim bucket'ımıza ait olmayan (ör. kullanıcının
# girdiği `https://baska-site/private/...` gibi) adresler elenir ve dokunulmaz.
_URL_RE = re.compile(rb'https?://[^"\s\\]*/private/[^"\s\\]*')

# Ön eleme: gövdede bu dizge yoksa hiçbir şey ayrıştırılmaz.
_MARKER = b"/private/"


def sign_body(body: bytes) -> bytes:
    """Gövdedeki private adresleri imzalı adreslerle değiştirir."""
    if _MARKER not in body:
        return body
    matches = _URL_RE.findall(body)
    if not matches:
        return body
    raw = [m.decode("utf-8", "ignore") for m in matches]
    signed = storage.presign_many(raw)
    for original, new in zip(raw, signed, strict=True):
        if new and new != original:
            body = body.replace(original.encode(), new.encode())
    return body


class PresignPrivateUrls:
    """Pure-ASGI middleware — yalnız JSON gövdelerine dokunur.

    JSON dışı yanıtlar (dosya akışı, sitemap, yönlendirme) hiç tamponlanmaz;
    streaming davranışı korunur.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        state: dict = {"start": None, "json": False, "chunks": []}

        async def send_wrapper(message):
            kind = message["type"]
            if kind == "http.response.start":
                ctype = Headers(raw=message["headers"]).get("content-type", "")
                state["json"] = ctype.startswith("application/json")
                if not state["json"]:
                    return await send(message)
                state["start"] = message
                return
            if kind != "http.response.body" or not state["json"]:
                return await send(message)

            state["chunks"].append(message.get("body", b""))
            if message.get("more_body"):
                return

            body = b"".join(state["chunks"])
            try:
                body = sign_body(body)
            except Exception:
                # İmzalama yanıtı düşürmez: kırık bağlantı, boş sayfadan iyidir.
                logger.warning("private URL imzalama başarısız", exc_info=True)

            start = state["start"]
            headers = [
                (k, v)
                for (k, v) in start["headers"]
                if k.lower() != b"content-length"
            ]
            headers.append((b"content-length", str(len(body)).encode()))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, send_wrapper)


def install(app) -> None:
    """Depolama yapılandırılmışsa katmanı kurar."""
    if not settings.AWS_BUCKET_NAME:
        return
    app.add_middleware(PresignPrivateUrls)
