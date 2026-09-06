# Eğitmen alıcı sözleşmesi — mağazada TUTOR da müşteri olur

Bu belge **kod yazılmadan önce** yazıldı. Amacı, "eğitmen de mağazadan
alışveriş yapabilsin" isteğinin doğru davranışını tek yerde sabitlemek ve her
maddenin karşılığında gerçek HTTP + gerçek PostgreSQL testi bulunmasını
zorunlu kılmak.

Ürün kararı bağlamı: **ÜK-5** (bir e-posta = bir hesap) ve **ÜK-6**
(eğitmen de favorileyebilir) — `docs/urun-kararlari.md`.

---

## 0. Ölçülen başlangıç durumu

- Mağazanın alıcı uçlarının **tamamı** `require_roles(RoleType.CLIENT)` ile
  kapalı: `api/routers/store.py` içinde 26 uç, `api/routers/addresses.py`
  içinde 4 uç. TUTOR token'ı 403 `"Insufficient permissions"` alır.
- Veri modeli de kapalı: `Order.client_id` → `ForeignKey("clients.id")`,
  NOT NULL (`models/store.py`). Hesap tabloları ayrıdır (`api/deps.py`
  `_ROLE_MODELS`), ortak `users` tablosu yoktur; eğitmenin id'si `clients.id`
  yerine geçemez.
- Buna rağmen frontend eğitmene mağazayı gösteriyor (`lib/nav.ts` TUTOR_NAV),
  sepete eklemesine izin veriyor (`ProductDetailPage`, `ProductCard` — rol
  kontrolü yok) ve ödeme sayfasında **sessizce ana sayfaya atıyor**
  (`App.tsx` `ProtectedRoute allowedRoleId={ROLE_IDS.CLIENT}`).

Yani bugün satın alınabilir *görünen* ama 403 ile biten bir yüzey var.

---

## 1. Çekirdek karar: gölge satır bir kimlik değil, bir **yansıtma**

> Eğitmene bağlı `clients` satırı, `tutors` satırının kimlik alanlarının
> okuma anında tazelenen yansımasıdır. Tek yazıcısı `api/deps.py`
> içindeki `get_shopping_client` bağımlılığıdır. Gölge satır **asla** bir
> giriş öznesi (principal) değildir.

| # | Kural | Yaptırım |
|---|-------|----------|
| 1.1 | `clients.shadow_of_tutor_id` dolu olan satır bir gölgedir | kısmi UNIQUE: eğitmen başına en fazla bir gölge |
| 1.2 | Gölge ile giriş yapılamaz | `hashed_password` sentinel `"!"`, `is_active=False`, `_LOGIN_PRECEDENCE` CLIENT dalında dışlama |
| 1.3 | Şifre sıfırlama / e-posta doğrulama gölgeye **hiç** ulaşmaz | `find_by_email` gölgeyi döndürmez |
| 1.4 | Gölge, e-posta tekillik alanını tüketmez | `uq_clients_email_active` kısmi indeksine `shadow_of_tutor_id IS NULL` eklenir. *(5 Eyl 2026: `uq_clients_username_active` kolonla birlikte kaldırıldı.)* |
| 1.5 | Yansıtılan alanlar: ad, soyad, e-posta, telefon, telefon doğrulama zamanı, e-posta doğrulama zamanı, avatar | yalnız değer farklıysa yazılır |
| 1.6 | Yansıtma **tek yönlüdür**: `Tutor` → gölge. Ters yön yoktur | — |
| 1.7 | Gölge, `require_roles(RoleType.CLIENT)` kapısını açmaz — TUTOR token'ı hâlâ TUTOR'dur | kapsam dışı uçlar (ders, kütüphane, talep) kapalı kalır |

**Neden bu tasarım.** Ölçüldü: `clients.id`'ye FK veren 21 kolon ve 158
`.client_id` kullanımı var. Polimorfik alıcı (`buyer_role_id`+`buyer_id`)
kod tabanının en olgun para yolunu (İP-2a iade, İP-2b iptal, İP-5 fatura,
İP-19 dağıtım) yeniden açardı. "Hesap değiştirme" ucu ise eğitmen hesabının
`PayoutMixin`'i (şifreli IBAN, `sub_merchant_key`) yüzünden yanal geçiş
kapısı olurdu. Yansıtma, para yoluna **hiç dokunmadan** tek oturumda
kesintisiz alışverişi verir.

---

## 2. Kapsam

**Kapsam içi** — bu uçlar `get_shopping_client` ile açılır:

- Sepet doğrulama, sipariş oluşturma, sipariş listesi/detayı
- Ödeme başlatma, sipariş iptali, iade talebi, fatura
- Teslimat tercihi, erteleme, adres değiştirme, teslimat geri bildirimi, takip
- Kayıtlı adresler (dört uç)
- Mağaza favorileri, koleksiyonlar ("Listelerim"), stok bildirimi
- **Ürün yorumu / puanı** — satın alma şartı (`store_service._has_purchased`) korunur

**Kapsam dışı** — CLIENT'a özel kalır:

- Ders rezervasyonu ve ders ödemesi (`bookings.py`, `payments.py`)
- Kütüphane koltuk rezervasyonu, deneme sınavı bileti, kütüphane yorumu
- Talepler (`demands.py`), deneme sınavı araçları

Gerekçe: bu yüzeyler "eğitmen eğitmenden ders alır" gibi çözülmemiş ürün
sorularını ve `_assert_party` / `_can_message_client_tutor` gibi görmediği
tarafları doğurur.

---

## 3. Self-dealing yasağı (güvenlik)

**Ölçülen zarar.** `order_service._finalize_paid` `item.tutor_id`'ye komisyon
ve kazanç yazar; `payout_ledger` bunu ödeme kuyruğuna alır. Engel olmadan
eğitmen kartla öder ve kesinti düşülmüş tutarı kendi IBAN'ına geri alır —
çalıntı kartı nakde çevirme kanalı. Ayrıca kendi ürününe "doğrulanmış alıcı"
yorumu yazıp `products.rating_sum/rating_count` şişirebilir.

| # | Kural | Yaptırım |
|---|-------|----------|
| 3.1 | Eğitmen kendi ürününü sepette doğrulayamaz | `validate_cart` uyarısı |
| 3.2 | Eğitmen kendi ürününü sipariş edemez | `create_order` → **409** |
| 3.3 | Kapı aşılsa bile kazanç yazılmaz | `_finalize_paid` son savunması + ALERT log |
| 3.4 | Kendi ürününe yorum yazamaz | 3.2 zaten satın almayı engeller |

**Bilinçli kapsam dışı:** iki eğitmenin karşılıklı alım yapması (wash
trading) bu kapıyı dolanır. Tespiti raporlamaya bırakıldı; ürün kararıdır.

---

## 4. Bildirim

Sipariş ve teslimat bildirimleri 15+ çağrı yerinde
`user_id=order.client_id, role_id=ROLE_IDS[CLIENT]` olarak sabit yazılmış.
Çağrı yerleri **değişmez**; yeniden adresleme tek noktada yapılır.

| # | Kural | Yaptırım |
|---|-------|----------|
| 4.1 | Gölgeye giden bildirim, sahibi eğitmene yeniden adreslenir | `notification_service.notify` |
| 4.2 | Canlı (WS) bildirim de aynı yeniden adreslemeyi görür | `ws_outbox.enqueue` aynı fonksiyonun içinde |
| 4.3 | `Notification(...)` `notify()` dışında kurulamaz | nöbetçi test |
| 4.4 | Gölge kimliğine ait okunmamış bildirim **hiç** oluşmaz | 4.1'in sonucu |

---

## 5. Kişisel veri ve hesap kapatma

| # | Kural | Yaptırım |
|---|-------|----------|
| 5.1 | Gölge, admin kullanıcı dizininde ve sayaçlarında görünmez | `admin_service` üç sorguda `shadow_of_tutor_id IS NULL` |
| 5.2 | Gölge id'si için kullanıcı detayı 404 | `admin_service.get_user_detail` |
| 5.3 | Eğitmen hesabını kapatınca gölge de anonimleşir ve silinir | `account_deletion_service.anonymize_account` aynı yolu geçer |
| 5.4 | Yolda kargosu olan eğitmen hesabını kapatamaz | `can_delete` gölge üzerinden açık sipariş arar |
| 5.5 | Veri dökümüne gölge üzerinden kayıtlı adresler girer — öğrenciyle tam parite | `export_personal_data` (KVKK m.20) |
| 5.6 | PII çoğaltması kabul edilmiştir | fatura ve ödeme sağlayıcısı gerçek ad ister; senkron tek yönlü ve tek yazıcılı |

---

## 6. Askıya alma

`TutorStatus.SUSPENDED` alışverişi **durdurmaz** — askıya alma satıcılığı ve
öğretmenliği hedefler, tüketiciliği değil. Hesap tamamen kapatıldığında
(`is_active=False`) `get_current_active_user` zaten her şeyi keser.

---

## 7. Kırmızı test matrisi

Her satır, üretim kodu değişmeden **kırmızı** olmalı.

| # | Senaryo | Beklenen |
|---|---------|----------|
| K-1 | TUTOR token'ı ile adres ekle | 201 |
| K-2 | TUTOR token'ı ile sepet doğrula → sipariş → ödeme | 201 / redirect |
| K-3 | Sipariş `orders.client_id` gölgeyi gösterir, gölge `shadow_of_tutor_id` = eğitmen | doğru |
| K-4 | Telefonu doğrulanmamış eğitmen sipariş açar | 403; doğruladıktan sonra 201 |
| K-5 | `GET /store/orders/mine` yalnız kendi siparişini döndürür | başka eğitmenin gölgesininki YOK |
| K-6 | Başka eğitmenin sipariş id'si ile detay | 404 (IDOR deseni) |
| K-7 | Fatura alıcı adı = eğitmenin gerçek adı | doğru |
| K-8 | Sipariş bildirimi `(tutor_id, role 2)` satırına düşer | gölgeye bildirim YOK |
| K-9 | Eğitmen kendi dijital ürününü sipariş eder | 409 |
| K-10 | K-9 kapısı devre dışıyken bile `tutor_earning` yazılmaz | son savunma |
| K-11 | Gölge e-postası + herhangi bir şifre ile giriş | 401 |
| K-12 | Şifre sıfırlama eğitmen satırına gider, gölgeye değil | doğru |
| ~~K-13~~ | ~~Gölge kullanıcı adı global tekillikte yer tutmaz~~ | **DÜŞTÜ (5 Eyl 2026):** `username` alanı şemadan kaldırıldı, madde konusuz kaldı. Testi de silindi. |
| K-14 | **DEĞİŞTİ (6 Eyl 2026):** bir e-posta = bir hesap. Eğitmenin e-postasıyla ayrı bir üye hesabı AÇILAMAZ | 409 — engel eğitmenin KENDİ satırı |
| K-14b | Gölge tekillik alanını hâlâ tüketmez — 409 gölge yokken de aynı | sebep izole edilir |

> **K-14 neden tersine döndü.** Madde zaten *"(bugünkü davranış)"* diye
> kaydedilmişti: ürün kuralı değil, mevcut davranışın karakterizasyonuydu.
> Asıl şart hep ikinci sütundaydı — *gölge bunu kırmaz* — ve o şart korunuyor.
>
> Gerçek Postgres'te ölçülen tehlike: aynı e-posta iki tabloda birden
> olabildiğinde, kişi iki hesapta AYNI parolayı kullanırsa (ki "üyeyim, bir de
> eğitmen olayım" diyen herkes bunu yapar) `authenticate`
> `_LOGIN_PRECEDENCE`te TUTOR'ı önce görür, giriş eğitmeni açar ve ÜYE
> HESABINA — siparişleri, rezervasyonları, favorileri, mesajlarıyla —
> hiçbir parolayla ULAŞILAMAZ. Sessiz hesap kaybı.
>
> Nöbetçi: `tests/integration/test_ayni_eposta_iki_tablo_pg.py`.
| K-15 | Eğitmen adını değiştirir → sonraki alışverişte gölge adı güncel | drift yok |
| K-16 | Admin kullanıcı dizini ve `total_clients` gölgeyi saymaz | doğru |
| K-17 | Eğitmen hesabını kapatır → gölge de anonimleşir | doğru |
| K-18 | Yolda kargosu olan eğitmen hesap kapatma ister | reddedilir |
| K-19 | Mağaza alıcı uçlarının hiçbirinde `require_roles(RoleType.CLIENT)` kalmaz | rota tablosundan ölçülür, uç başına ayrı test |
| K-20 | Kapsam dışı uçlar (ders, kütüphane, talep) TUTOR'a kapalı kalır | 403 |
| K-21 | ADMIN / operatör / kurye `get_shopping_client`'a girerse | 403 |

---

## 8. Kabul edilen riskler

1. **PII çoğaltma** — 5.6.
2. **Kupon kotası**: kupon limitleri `client_id` bazlı; eğitmenin gölgesi ayrı
   bir kupon kotası kazanır.
3. **Ödeme sağlayıcısı alıcı geçmişi**: `buyer_from_client` `client-{gölge_id}`
   öneki üretir; eğitmenin promosyon alımlarındaki `tutor-{id}` geçmişinden
   ayrışır.
4. **Wash trading** — §3.
5. **Rakip ürün yorumu**: eğitmen, rakibin dijital ürününü satın alıp düşük
   puan verebilir. Satın alma şartı maliyet yaratıyor; kabul edildi.
6. **Yansıtma yazımı okuma yolunda**: `get_shopping_client` bir GET isteğinde
   UPDATE üretebilir. Yalnız değer farklıysa yazılır.
