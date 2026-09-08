"""Sunucunun ÜRETTİĞİ frontend yolları — tek kaynak.

Bildirim satırlarının `link` alanı, e-posta gövdeleri ve ödeme sağlayıcısının
dönüş adresleri istemci yollarını taşır. Bu yollar bugüne kadar çağrı yerine
gömülü düz dizelerdi: sekiz dosyada on iki yer.

8 Eyl 2026'da panel şeridi kurulunca altı yol `/pano/*` altına taşındı ve
on iki yerin hepsi elle bulunmak zorunda kaldı. Biri atlanmış olsaydı sessizce
yanlış kalırdı — istemcide kalıcı yönlendirme var, yani eski link ÇALIŞMAYA
devam ederdi ve kimse fark etmezdi. Sabitler bu yüzden tek yerde durur.

Değerler `frontend/src/lib/routes.ts`teki `PATHS` ile aynı olmalıdır; orası
istemcinin tek kaynağıdır, burası sunucunun ona bakan yüzü. Nöbetçi:
`backend/tests/test_frontend_yollari.py`.
"""

# ── Panel şeridi (`/pano/*`) ──
PANO = "/pano"
MESAJLAR = "/pano/mesajlar"
ILANIM = "/pano/ilanim"
DEGERLENDIRMELER = "/pano/degerlendirmeler"
BAKIYEM = "/pano/bakiyem"
HESABIM = "/pano/hesabim"
REZERVASYON_DETAY = "/pano/rezervasyon"

# ── Şeride girmeyen, düz kalan yollar ──
DERS_TALEPLERI = "/ders-talepleri"
SIPARISLERIM = "/siparislerim"
# Ödeme bilgileri (IBAN + kimlik) Ayarlar'ın bir sekmesidir.
AYARLAR = "/ayarlar"
ONE_CIKAR = "/ilanimi-one-cikar"
