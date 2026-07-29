"""Refresh token çerezi — tek kaynak.

Neden çerez, neden gövde değil: refresh token 30 gün geçerlidir ve tek başına
yeni access token üretir; yani hesabın kendisi kadar değerlidir. Gövdede
dönerse JavaScript onu okur ve ``localStorage``'a yazmak zorunda kalırız —
o noktada tek bir XSS, saldırgana 30 günlük kalıcı hesap devri verir.
``httpOnly`` çerez JavaScript'e görünmez: aynı XSS o oturumda istek yapabilir
ama token'ı **dışarı çıkaramaz**.

Ayarların gerekçeleri:

``httponly``   JS erişimi kapalı — bu değişikliğin tüm amacı.
``samesite``   ``lax``: CSRF'e karşı yeterli. ``/auth/refresh`` bir POST'tur ve
               Lax çerezleri site-dışı POST'ta GÖNDERİLMEZ; ayrı bir CSRF
               token'ı gerekmez. ``strict`` seçilmedi çünkü kullanıcı dışarıdan
               (e-postadaki linkten) geldiğinde oturumu düşmüş görünürdü.
``secure``     Üretimde zorunlu. Geliştirmede ``http://localhost`` kullanıldığı
               için ortama bağlı: ``secure`` çerez düz HTTP'de hiç gönderilmez
               ve yerelde oturum sessizce çalışmaz hale gelirdi.
``path``       Yalnız kimlik uçlarına gönderilir; her API isteğinde ağda
               dolaşmasının bir faydası yok, saldırı yüzeyi ise büyür.

Alan adı ayrımı: üretimde ön yüz ve API aynı origin'dedir (Caddy ``/api/*``
yolunu backend'e proxy'ler), geliştirmede ise ``localhost:5173`` ve
``localhost:8000``. Çerezlerde **port site tanımına dahil değildir**, ikisi de
``localhost`` sayılır — bu yüzden Lax her iki ortamda da çalışır.
"""

from fastapi import Request, Response

from core.config import settings

COOKIE_NAME = "refresh_token"
COOKIE_PATH = "/api/v1/auth"


def set_refresh_cookie(response: Response, token: str, *, remember: bool) -> None:
    """Refresh token'ı çereze yazar.

    ``remember=False`` iken **oturum çerezi** yazılır (``max_age`` verilmez):
    tarayıcı kapanınca silinir. "Beni hatırla" işaretlenmediğinde kullanıcının
    beklediği davranış budur ve bunu tarayıcıya söylemenin doğru yolu çerezin
    ömrüdür — istemcinin token'ı saklamamayı "seçmesi" değil.
    """
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path=COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600 if remember else None,
    )


def get_refresh_cookie(request: Request) -> str | None:
    return request.cookies.get(COOKIE_NAME)


def clear_refresh_cookie(response: Response) -> None:
    """Çerezi siler. Silme ancak aynı ``path`` ile yapılırsa tutar."""
    response.delete_cookie(key=COOKIE_NAME, path=COOKIE_PATH)


def clear_refresh_cookie_headers() -> dict[str, str]:
    """Çerez silme başlığını ``HTTPException`` ile göndermek için.

    Neden ayrı bir yol: bir uç ``HTTPException`` fırlattığında, imzasındaki
    ``Response`` nesnesine yazılmış başlıklar YANITA GİTMEZ — hata yanıtını
    exception handler sıfırdan üretir. Yani "geçersiz çerezi temizle" niyeti,
    tam da temizlenmesi gereken durumda (401) sessizce kaybolur; tarayıcı ölü
    token'ı her istekte taşımaya devam eder.
    """
    probe = Response()
    clear_refresh_cookie(probe)
    return {"set-cookie": probe.headers["set-cookie"]}
