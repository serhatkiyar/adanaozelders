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
    # Kodlar geriye uyumluluk için sabit; izin artık metin şeridini değil
    # mağaza hero carousel'ini yönetir.
    ("announcements.view", "Vitrin görsellerini görüntüleme", "Platform"),
    ("announcements.manage", "Vitrin görsellerini yönetme", "Platform"),
    ("tutors.view", "Eğitmen görüntüleme", "Eğitim"),
    ("tutors.manage", "Eğitmen yönetimi", "Eğitim"),
    ("bookings.view", "Rezervasyon görüntüleme", "Eğitim"),
    ("bookings.manage", "Rezervasyon yönetimi", "Eğitim"),
    ("demands.view", "Öğrenci talebi görüntüleme", "Eğitim"),
    ("demands.manage", "Öğrenci talebi yönetimi", "Eğitim"),
    # İP-16 aralıklı tekrar: platform destesi küratörlüğü (sözleşme §7.1 D-12).
    # DİKKAT: bu izinler yalnız platform DESTE İÇERİĞİNİ kapsar — hiçbir admin
    # izni kullanıcı ilerlemesi (srs_progress/srs_review_logs) OKUTMAZ (D-7/K-6).
    ("srs_platform.view", "Platform tekrar destelerini görüntüleme", "Eğitim"),
    ("srs_platform.manage", "Platform tekrar destesi yönetimi", "Eğitim"),
    ("libraries.view", "Kütüphane görüntüleme", "Operasyon"),
    ("libraries.manage", "Kütüphane yönetimi", "Operasyon"),
    ("catalogs.view", "Deneme kataloğu görüntüleme", "Operasyon"),
    ("catalogs.manage", "Deneme kataloğu yönetimi", "Operasyon"),
    ("products.view", "Ürün görüntüleme", "Ticaret"),
    ("products.manage", "Ürün yönetimi", "Ticaret"),
    # Vitrin içeriği (landing page / koleksiyon / medya). `products.*` bilinçli
    # olarak YENİDEN KULLANILMADI: ürün metnini düzenlemek ile mağaza ana
    # sayfasını YAYINLAMAK farklı işlerdir — ikincisi tüm ziyaretçilerin
    # gördüğü yüzeyi değiştirir. Ürüne öznitelik ATAMAK ise ürün verisidir ve
    # `products.manage`'de kalır (tedarikçi anahtarı ayrımıyla aynı gerekçe).
    ("content.view", "Vitrin içeriğini görüntüleme", "Ticaret"),
    ("content.manage", "Vitrin içeriği ve yayın yönetimi", "Ticaret"),
    ("orders.view", "Sipariş görüntüleme", "Ticaret"),
    ("orders.manage", "Sipariş yönetimi", "Ticaret"),
    ("returns.view", "İade görüntüleme", "Ticaret"),
    ("returns.manage", "İade yönetimi", "Ticaret"),
    ("coupons.view", "Kupon görüntüleme", "Ticaret"),
    ("coupons.manage", "Kupon yönetimi", "Ticaret"),
    ("delivery.view", "Dağıtım görüntüleme", "Ticaret"),
    ("delivery.manage", "Dağıtım yönetimi", "Ticaret"),
    # Tedarikçi senkronu (Yıldırım B2B). `products.*` bilinçli olarak YENİDEN
    # KULLANILMADI: bu yüzey bir SIR (API token'ı) ve "vitrin neyi otomatik
    # satar" kararı taşır. Ürün metnini düzenleyen kişinin token'ı
    # değiştirebilmesi, `inventory.*` ve `packing.*` için verilen görev
    # ayrılığı gerekçesinin aynısıyla yanlıştır.
    #
    # NOT: ürün başına "tedarikçiden temin" anahtarı bir ÜRÜN özniteliğidir ve
    # `products.manage` ile düzenlenir — o ayrım bilinçlidir.
    ("suppliers.view", "Tedarikçi senkronu görüntüleme", "Ticaret"),
    ("suppliers.manage", "Tedarikçi ayarı ve eşleştirme yönetimi", "Ticaret"),
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
    # Paketleme (F30). `delivery.*` bilinçli olarak YENİDEN KULLANILMADI: turu
    # planlamak ile depoda paket toplamak farklı kişilerin işidir ve paketleme
    # istasyonu depo personeline açılacaktır. Üç kademe, envanterle aynı
    # gerekçeyle: paketleyen kişi kendi hatasını tek başına kapatamamalı —
    # `packing.manage` (void / unpack / return-in / repack) ayrı durur.
    ("packing.view", "Paketleme kuyruğu ve paket görüntüleme", "Ticaret"),
    ("packing.pack", "Paket açma, kalem tarama ve tamamlama", "Ticaret"),
    ("packing.manage", "Paket çözme ve geri dönüş yönetimi", "Ticaret"),
    # Operasyon kurtarma (İP-4/P1-4): sıkışmış para (deneme tavanı dolmuş iade,
    # MANUAL_REVIEW) + ölü iş (outbox dead-letter) kuyruğu. `payments.*`
    # bilinçli olarak YENİDEN KULLANILMADI: hakediş ödemesi kaydetmek ile
    # sarkan bir sağlayıcı iadesini incelemek farklı işlerdir ve ikincisi
    # SMS/e-posta yeniden gönderimini de kapsar. Görev ayrılığı iki kademe:
    # kuyruğu GÖREN kişi tek başına dış yan etki TETİKLEYEMEZ.
    ("operations.view", "Sıkışmış para ve ölü iş kuyruğunu görüntüleme", "Platform"),
    ("operations.manage", "Ölü işi yeniden kuyruğa alma", "Platform"),
    ("reports.view", "Şikâyet görüntüleme", "Güvenlik"),
    ("reports.manage", "Şikâyet yönetimi", "Güvenlik"),
    ("audit.view", "Denetim kayıtlarını görüntüleme", "Güvenlik"),
    ("admin_roles.view", "Admin yetkilerini görüntüleme", "Güvenlik"),
    ("admin_roles.manage", "Admin yetkilerini yönetme", "Güvenlik"),
)

PERMISSION_CODES: frozenset[str] = frozenset(code for code, _n, _g in PERMISSION_CATALOG)
