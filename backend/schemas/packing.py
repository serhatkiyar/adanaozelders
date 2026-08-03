"""F30 paketleme uçlarının istek/yanıt şemaları.

## Sözleşme

* **İç ORM modeli doğrudan dönmez.** Her yanıt açık alan listesiyle kurulur;
  `order_packages` tablosuna yarın eklenen bir kolon uçtan sessizce sızmaz.
* **İstemci sunucuya ait alan gönderemez.** İstek şemaları `extra="forbid"`
  taşır; `packed_at`, `status`, `actor` gibi bir alan 422 ile reddedilir —
  paket durumunu istemcinin yazabilmesi bütün FSM'i anlamsız kılardı.
* **Tarama sonucu bir İŞ sonucudur.** `PackageScanOut.result` (`OK` ·
  `OK_MANUAL` · `WRONG_SKU` · `OVER_QTY`) 200 ile döner; red de bir olaydır ve
  `package_scan_events`'e yazılabilmesi için transaction commit edilmelidir
  (sözleşme §6). Yapısal hatalar 4xx'tir.
* **Sayfalama zorunlu ve tavanlı** — F29 `schemas/inventory.py` disiplini. Bu
  kural `/packing/packages` kadar `/packing/queue` için de geçerlidir: kuyruk
  "bugünün işi" olduğu için küçük kalacağı VARSAYILAMAZ (bir kampanya günü
  yüzlerce satır demektir) ve tavansız uç, sayfalı kardeşiyle aynı sözleşmeyi
  konuşmadığı sürece istemci iki farklı biçim taşımak zorunda kalır.
* **İş akışı tahmin ETTİRİLMEZ.** Kuyruk satırı `next_action` ile hangi eylemin
  doğru olduğunu AÇIKÇA söyler; istemci durum dizgilerinden kural türetmez
  (`RETURNED` → "Paketle" çıkarımı commit 5 denetiminin bulduğu çıkmazdı).
* **`qr_payload` yalnız paketleme yetkisi olanlara gider.** Etiket basımı için
  gereklidir; kalıcı olduğu için (sözleşme §3.3) çalınan etiket riski §7 S4'te
  kayıtlıdır ve zimmet ayrıca durak sahipliği arar.
"""
from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: Liste uçlarının tek istekte dönebileceği EN FAZLA satır (F29 ile aynı tavan).
MAX_LIMIT = 200

#: Paket durumu — çıplak `str` DEĞİL. Şema katmanı `services`'i import EDEMEZ
#: (bağımlılık yönü `services → schemas`'tır; ters yön döngü kurar), bu yüzden
#: sözlük burada ÜÇÜNCÜ kez yazılıdır — `models.packing.PACKAGE_STATUSES` ve
#: `services.packing_rules.PACKAGE_STATUSES` ile birlikte. Kopyanın bedeli
#: ayrışma riskidir ve bir drift testiyle ödenir
#: (`test_f30_guards_pg.py::test_C7_KUYRUK_DURUM_LITERALI_KURALLARDAN_AYRISAMAZ`).
#: Kazancı: uçtan çıkan durum kümesi OpenAPI şemasında görünür ve istemci
#: (TypeScript) kendi birleşim tipini uydurmak zorunda kalmaz.
PackageStatus = Literal[
    "OPEN",
    "PACKED",
    "HANDED_OVER",
    "RETURN_PENDING",
    "RETURNED",
    "DELIVERED",
    "VOID",
]

#: Kuyruk satırının operatöre önerdiği TEK eylem. `null` = eyleme dönüşmeyen
#: satır: ekran hiçbir YAZMA eylemi sunmamalıdır (fail-closed). Sessizce "yeni
#: paket aç" demek, tanınmayan bir durumda aynı ürünleri ikinci kez raftan
#: toplatabilirdi.
PackingNextAction = Literal[
    "OPEN_NEW_PACKAGE",
    "CONTINUE_PACKING",
    "REPACK_RETURNED",
]

#: `offset` tavanı — sınırsız offset her istekte tam tarama maliyeti üretir.
MAX_OFFSET = 100_000

#: Serbest metin alanların üst sınırları. Gerekçe bir cümledir, deneme değil.
REASON_MAX = 200
NOTE_MAX = 500
CODE_MAX = 64
IDEM_MAX = 80


class _Istek(BaseModel):
    """Bütün istek gövdelerinin ortak tabanı — bilinmeyen alan 422."""

    model_config = ConfigDict(extra="forbid")


# ════════════════════════ İstek şemaları ════════════════════════


class PackageScanIn(_Istek):
    """Kalem doğrulama isteği.

    `manual=True` **kaçış kapısıdır** ve `manual_reason` ZORUNLUDUR (servis ve
    DB CHECK'i de aynı şeyi söyler): ürünü kataloğdan silinmiş, kodu okunmayan
    satır ancak gerekçeli ve izli biçimde kapanır (sözleşme §3.6).
    """

    code: str | None = Field(default=None, max_length=CODE_MAX)
    manual: bool = False
    manual_reason: str | None = Field(default=None, max_length=REASON_MAX)
    #: Manuel doğrulamada hangi satırın kapatıldığı; kod eşleşmiyorsa zorunlu.
    order_item_id: int | None = Field(default=None, ge=1)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=IDEM_MAX)


class PackageUndoScanIn(_Istek):
    """Gerekçeli düzeltme. `idempotency_key` **önerilir**: geri alma
    durum-idempotan değildir, ağ tekrarı adedi iki kez düşürür (§7 S7)."""

    order_item_id: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=REASON_MAX)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=IDEM_MAX)


class PackageVoidIn(_Istek):
    """Paketten vazgeçme. Gerekçe boş dizgi olarak da geçemez — `min_length`
    yalnız uzunluğa bakar, boşluk kırpma kontrolü serviste (422)."""

    reason: str = Field(min_length=1, max_length=REASON_MAX)


class PackageReturnInIn(_Istek):
    note: str | None = Field(default=None, max_length=NOTE_MAX)


class HandoverScanIn(_Istek):
    payload: str = Field(min_length=1, max_length=200)


# ════════════════════════ Yanıt şemaları ════════════════════════


class PackageItemOut(BaseModel):
    id: int
    order_item_id: int
    product_id: int | None
    #: Ürünü okunamayan satırda `sku`/`barcode` NULL'dır ve satır TARANAMAZ;
    #: yalnız gerekçeli manuel doğrulamayla kapanır (sözleşme §3.6).
    sku: str | None
    barcode: str | None
    title: str
    expected_qty: int
    scanned_qty: int
    remaining: int


class PackageOut(BaseModel):
    id: int
    order_id: int
    package_no: int
    #: `PKT-000042` — türetilmiş insan okunur kod (kolon değil).
    code: str
    status: str
    #: Etikete basılan `PKG1:{id}:{token}` yükü.
    qr_payload: str
    items_fingerprint: str
    packed_at: datetime.datetime | None = None
    packed_by_admin_id: int | None = None
    handed_over_at: datetime.datetime | None = None
    handed_to_courier_id: int | None = None
    handed_over_by_actor: str | None = None
    delivered_at: datetime.datetime | None = None
    returned_at: datetime.datetime | None = None
    return_note: str | None = None
    void_at: datetime.datetime | None = None
    void_reason: str | None = None
    unpacked_at: datetime.datetime | None = None
    created_at: datetime.datetime | None = None
    items: list[PackageItemOut] = []


class PackageScanOut(PackageOut):
    """Tarama yanıtı = iş sonucu + paketin GÜNCEL hâli.

    Paketin tamamı bilinçli olarak döner: ekran her taramadan sonra satır
    adetlerini yeniden çizmek zorunda ve ayrı bir `GET` isteği, iki isteğin
    arasında değişen bir satırı gösteremezdi.
    """

    result: str
    qty_delta: int
    order_item_id: int | None = None
    #: `True` ise bu yanıt kayıtlı bir sonucun TEKRARIDIR; hiçbir yan etki
    #: üretilmemiştir (aynı `idempotency_key`).
    replayed: bool = False


class PackagePage(BaseModel):
    items: list[PackageOut]
    total: int
    limit: int
    offset: int


class PackageSummaryOut(BaseModel):
    """Kuyruk satırındaki paketin özeti — `qr_payload` BİLİNÇLİ OLARAK YOK.

    Etiket yükü yalnız paket detayında döner (sözleşme §7 S4: kalıcı QR
    çalınabilir; token'ı liste ekranlarında yaymak riski büyütür).
    """

    id: int
    code: str
    #: `PackageOut.status` bilinçli olarak çıplak `str` kalır: orada durum
    #: yalnız GÖSTERİLİR. Kuyruk satırında ise ekran ona bakıp eylem seçer, yani
    #: kümenin sözleşmesi istemciyi bağlar.
    status: PackageStatus


class PackingQueueItemOut(BaseModel):
    """Toplanacak kalem — başlık + adet. Operatör NE toplayacağını görmeli."""

    title: str
    quantity: int


class PackingQueueRowOut(BaseModel):
    """Paketleme kuyruğunun bir satırı.

    `package` alanı olmadan ekran yanlış eylemi önerir: `RETURNED` paketli
    sipariş için "Paketle" demek operatörü çıkışsız bir döngüye sokar
    (commit 5 denetimi). Doğru eylem `repack`'tir ve ancak paket durumu
    satırda taşınırsa gösterilebilir.
    """

    order_id: int
    recipient: str | None = None
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    district: str | None = None
    item_count: int
    items: list[PackingQueueItemOut] = []
    promised_delivery_date: datetime.date | None = None
    created_at: datetime.datetime | None = None
    prepared_at: datetime.datetime | None = None
    package: PackageSummaryOut | None = None
    #: Sunucunun kararı: bu satırda hangi işlem doğru? `None` ise ekran hiçbir
    #: yazma eylemi göstermez (bilinmeyen durum → fail-closed).
    next_action: PackingNextAction | None = None


class PackingQueuePage(BaseModel):
    """Kuyruğun BİR sayfası.

    `total` **süzülmüş toplam** kayıt sayısıdır, sayfanın uzunluğu değil.
    Ayrım önemlidir: eskiden uç `total = len(items)` döndürüyordu ve bunu
    doğrulayan test totolojikti — ekran "23 iş var" derken 23'ün nereden
    geldiğini kimse denetlemiyordu.
    """

    items: list[PackingQueueRowOut]
    total: int
    limit: int
    offset: int


class PackageLabelItemOut(BaseModel):
    """Etiketteki kalem satırı.

    **Beklenen** adet taşınır, taranan DEĞİL: kâğıt kutunun ne içermesi
    gerektiğini söyler. Yarım kalmış bir paketin etiketi alınırsa taranan adet
    eksik içeriği "doğru"muş gibi gösterirdi.

    `sku` paket satırının SNAPSHOT'ıdır (sözleşme §3.6) — ürünü okunamayan
    satırda `null`'dır ve etiket bunu açıkça yazar ("SKU yok"); sessiz boşluk
    hatayı gizlerdi.
    """

    order_item_id: int
    sku: str | None = None
    title: str
    expected_qty: int


class PackageLabelOut(BaseModel):
    """Tek paketin basılabilir etiketi — **kâğıdın tamamı, tek istekte**.

    ## Neden ayrı bir uç (alanları `PackageOut`'a eklemek yerine)

    Etiket alıcı + adres + teslimat tercihi ister; bunlar pakette değil
    **siparişte** yaşar. İki çözüm vardı ve ayrı uç şu üç ölçüte göre seçildi:

    1. **Tek istek.** Kuyruk satırı (`PackingQueueRowOut`) bu kimliği zaten
       taşıyor ama paket `PACKED` olduğu anda kuyruktan DÜŞÜYOR — yani tam da
       basma anında elde değil. Etiketi iki uçtan tahminle birleştirmek, F26'da
       yaşanan "etiket bomboş basıldı, kimse fark etmedi" hatasının yolu.
    2. **Kişisel veri her yanıtta dolaşmasın.** `PackageOut` yalnız detay değil;
       liste (`PackagePage`, tek istekte 200 satıra kadar), açma, tarama,
       tamamlama, çözme, `repack`, `unpack` ve `return-in` yanıtlarının da
       gövdesidir. Sevkiyat kimliğini oraya koymak, alıcı adını ve açık adresi
       paketleme ekranının HER isteğine yayardı; oysa etiket günde paket başına
       bir kez basılır.
    3. **Yetki yüzeyi değişmiyor.** `qr_payload` zaten `PackageOut`'ta ve
       `packing.view` ile korunuyor; bu uç da aynı izne bağlıdır.

    ## Telefon BİLİNÇLİ OLARAK YOK

    Kuryenin numaraya ihtiyacı vardır ama kâğıttan değil: saha ekranı numarayı
    zaten taşıyor (`DeliveryStopOut.phone`, `delivery_service.py:175`) ve orası
    yetki denetimli, **taze** kaynaktır. Etiket paketleme anında basılır; teslim
    gününe kadar değişen bir numarayı kâğıt sessizce eskitir. Dahası kâğıt
    teslimattan sonra da yaşar (kutunun üstünde çöpe, kapıya, komşuya gider) —
    geri alınamayan tek kopyaya kişisel veri basmamak veri minimizasyonunun
    kendisidir.

    ## NULL sözleşmesi

    Adres alanları (`recipient` · `address` · `city` · `district`) **opsiyonel**
    ve `null` olabilir. Sunucu yer tutucu ÜRETMEZ: `"—"` ya da `""` dönmez;
    boş/yalnız-boşluk değerler `null`'a indirgenir. Böylece istemci "veri yok"
    (null → ekranda "—" **ve** eksik veri uyarısı) ile gerçek değeri ayırt eder;
    boş dizgi dönseydi ekran veriyi var sanar, hata sessiz kalırdı.

    `delivery_pref` NOT NULL kolondur (varsayılan `ADRESIMDEYIM`) ve her zaman
    doludur; `delivery_pref_note` yalnız `KOMSUYA_BIRAK` gibi tercihlerde dolar.
    """

    #: `id` DEĞİL: gövdede `order_id` de var ve çıplak bir `id` basma anında
    #: "hangi kimlik" sorusunu doğururdu (kuyruk satırı da `package_id` der).
    package_id: int
    #: `PKT-000042` — QR okunamazsa kâğıttan insanın okuyacağı kod.
    code: str
    status: str
    #: `PKG1:{id}:{token}` — QR'a basılan GERÇEK yük.
    qr_payload: str
    order_id: int
    recipient: str | None = None
    address: str | None = None
    city: str | None = None
    district: str | None = None
    delivery_pref: str
    delivery_pref_note: str | None = None
    items: list[PackageLabelItemOut] = []


class ReturnQueueRowOut(BaseModel):
    """"Geri dönüş bekleniyor" satırı (sözleşme §3.5 / TB-7).

    `waiting_days` görünürlüğün kendisidir: hiçbir yerde görünmeyen paket
    aranmaz ve süresiz kaybolur.
    """

    package_id: int
    package_code: str
    order_id: int
    courier_id: int | None = None
    courier_name: str | None = None
    handed_over_at: datetime.datetime | None = None
    waiting_days: int


class ReturnQueuePage(BaseModel):
    """Geri dönüş kuyruğunun BİR sayfası — kardeş uçlarla aynı sözleşme.

    Uç eskiden tavansız düz bir liste dönüyordu. Tehlikesi kuyruğun bugünkü
    boyutu değil, **büyüdüğü gün**: geri dönüş kuyruğu tam olarak "kimsenin
    kapatmadığı" satırların biriktiği yerdir (TB-7 sapması süresiz sürebilir),
    yani sınırsız büyümeye en yatkın kuyruktur ve tavansız uç o gün tek istekte
    bütün tabloyu çeker.

    `total` **süzülmüş toplam** kayıt sayısıdır, `len(items)` değil — ekran
    "N paket geri bekleniyor" derken N'in sayfa uzunluğu olması, sayacı
    sessizce yalancı yapardı.
    """

    items: list[ReturnQueueRowOut]
    total: int
    limit: int
    offset: int


class HandoverManifestRowOut(BaseModel):
    stop_id: int
    order_id: int
    sequence: int
    package_id: int | None = None
    package_code: str | None = None
    package_status: str | None = None
    handed_over: bool


class HandoverManifestOut(BaseModel):
    """Kurye zimmet ekranının N/M çubuğu + eksik paket listesi (sözleşme §6)."""

    run_id: int
    run_status: str
    total: int
    handed_over: int
    rows: list[HandoverManifestRowOut] = []
