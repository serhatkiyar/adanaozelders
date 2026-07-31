"""Admin izin kataloğu — tek doğruluk kaynağı.

NEDEN VAR: izinler yalnız migration'larda seed ediliyordu. Yeni bir yönetim
ekranı `require_admin_permission("payments.view")` yazdığında izin kataloğa
eklenmezse uç HİÇBİR admin için çalışmaz — SUPER_ADMIN dahil, çünkü yetki
"o role bağlı izin satırı" üzerinden okunur ve olmayan izin kimseye bağlanamaz.
Bu sessizce olur: uç 403 döner, menü öğesi de gizlendiği için kimse tıklamaz.
(Hakediş defteri tam olarak böyle erişilemez kalmıştı.)

Bundan sonra: yeni izin önce buraya eklenir, sonra migration'la DB'ye yazılır.
`tests/test_admin_permission_catalog.py` router'larda kullanılan her izin
kodunun burada olduğunu, doğrulama paketi de buradakilerin DB'de olduğunu
denetler.
"""
from __future__ import annotations

# (kod, görünen ad, grup)
PERMISSION_CATALOG: tuple[tuple[str, str, str], ...] = (
    ("dashboard.view", "Dashboard görüntüleme", "Platform"),
    ("users.view", "Kullanıcı görüntüleme", "Platform"),
    ("users.manage", "Kullanıcı yönetimi", "Platform"),
    ("settings.view", "Platform ayarlarını görüntüleme", "Platform"),
    ("settings.manage", "Platform ayarlarını değiştirme", "Platform"),
    ("tutors.view", "Eğitmen görüntüleme", "Eğitim"),
    ("tutors.manage", "Eğitmen yönetimi", "Eğitim"),
    ("bookings.view", "Rezervasyon görüntüleme", "Eğitim"),
    ("bookings.manage", "Rezervasyon yönetimi", "Eğitim"),
    ("demands.view", "Öğrenci talebi görüntüleme", "Eğitim"),
    ("demands.manage", "Öğrenci talebi yönetimi", "Eğitim"),
    ("libraries.view", "Kütüphane görüntüleme", "Operasyon"),
    ("libraries.manage", "Kütüphane yönetimi", "Operasyon"),
    ("catalogs.view", "Deneme kataloğu görüntüleme", "Operasyon"),
    ("catalogs.manage", "Deneme kataloğu yönetimi", "Operasyon"),
    ("products.view", "Ürün görüntüleme", "Ticaret"),
    ("products.manage", "Ürün yönetimi", "Ticaret"),
    ("orders.view", "Sipariş görüntüleme", "Ticaret"),
    ("orders.manage", "Sipariş yönetimi", "Ticaret"),
    ("returns.view", "İade görüntüleme", "Ticaret"),
    ("returns.manage", "İade yönetimi", "Ticaret"),
    ("coupons.view", "Kupon görüntüleme", "Ticaret"),
    ("coupons.manage", "Kupon yönetimi", "Ticaret"),
    ("delivery.view", "Dağıtım görüntüleme", "Ticaret"),
    ("delivery.manage", "Dağıtım yönetimi", "Ticaret"),
    # Hakediş defteri: kime ne kadar borçluyuz + ödeme kaydı (para çıkışı).
    ("payments.view", "Hakediş görüntüleme", "Ticaret"),
    ("payments.manage", "Hakediş ödemesi kaydetme", "Ticaret"),
    # Envanter (F29). `products.*` bilinçli olarak YENİDEN KULLANILMADI: ürün
    # metnini düzenlemek ile envanteri değiştirmek aynı yetki kutusunda
    # olmamalıdır. Üç kademe görev ayrılığına da izin verir — sayan kişi tek
    # başına envanteri değiştiremez.
    ("inventory.view", "Envanter ve sayım görüntüleme", "Ticaret"),
    ("inventory.count", "Sayım oturumu açma ve miktar girme", "Ticaret"),
    ("inventory.apply", "Sayım farkı uygulama ve hasar işlemi", "Ticaret"),
    ("reports.view", "Şikâyet görüntüleme", "Güvenlik"),
    ("reports.manage", "Şikâyet yönetimi", "Güvenlik"),
    ("audit.view", "Denetim kayıtlarını görüntüleme", "Güvenlik"),
    ("admin_roles.view", "Admin yetkilerini görüntüleme", "Güvenlik"),
    ("admin_roles.manage", "Admin yetkilerini yönetme", "Güvenlik"),
)

PERMISSION_CODES: frozenset[str] = frozenset(code for code, _n, _g in PERMISSION_CATALOG)
