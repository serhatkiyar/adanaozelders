"""F30 paket yaşam döngüsünün **saf** kuralları — DB'siz, HTTP'siz.

Sözleşme: `docs/f30-paketleme-sozlesmesi.md` (§3.2, §3.3, §3.5, §3.6).

## Neden saf bir modül

F29'un `inventory_rules.py`'siyle aynı gerekçe: FSM, fiziksel anlam tablosu ve
tarama kararı **veri olarak** durduğunda "HANDED_OVER'ı da işletmede say" gibi
tek satırlık bir sapma bir testte görünür. Servise gömülürse görünmez — ancak
envanter sayımı tutmadığında, aylar sonra fark edilir.

Bu modül `models`'i, `sqlalchemy`'yi ve `fastapi`'yi **import edemez**; bir
kabul testi (`test_f30_packing_contract.py::test_packing_rules_SAF_kalir`) bunu
korur. Sonuç olarak durum adları burada **ikinci kez** yazılıdır; iki kopyanın
ayrışmaması ayrı bir drift testiyle güvence altındadır
(`test_PAKET_DURUM_KUMESI_UCLU_AYNI`).

## İki QR uzayı ayrıktır

    paket : PKG1:{package_id}:{token}     ← F30
    durak : {stop_id}:{token}             ← mevcut, DEĞİŞMEZ

`delivery_service.parse_qr_token` payload'u ilk ``":"``'dan böler ve KALANI
token sayar. `PKG1:` öneki olmasaydı bir paket payload'u sessizce "durak
token'ı" gibi ayrıştırılır, DB'de bulunamaz ve hata mesajı yanlış yeri işaret
ederdi. `parse_package_qr` yalnız bu önekle çözer; aksi hâlde `None` döner ve
çağıran mevcut durak yoluna düşer (geriye uyum: basılmış eski etiketler
çalışmaya devam eder).
"""
from __future__ import annotations

import dataclasses
import hashlib

# ══════════════════ Durum kümesi ve FSM ═════════════════════════════════════

#: Paket FSM'inin bütün durumları. `models.packing.PACKAGE_STATUSES` ile
#: **aynı olmak zorundadır** (drift testi denetler); saf modül `models`'i
#: import edemediği için ikinci kez yazılıdır.
PACKAGE_STATUSES: tuple[str, ...] = (
    "OPEN",
    "PACKED",
    "HANDED_OVER",
    "RETURN_PENDING",
    "RETURNED",
    "DELIVERED",
    "VOID",
)

#: Terminal: paket artık hiçbir yola girmez, QR'ı geçersizdir (sözleşme §3.3).
TERMINAL_STATUSES: tuple[str, ...] = ("DELIVERED", "VOID")

#: Canlı küme — `uq_order_packages_live` kısmi index'inin kapsadığı durumlar.
LIVE_STATUSES: tuple[str, ...] = (
    "OPEN",
    "PACKED",
    "HANDED_OVER",
    "RETURN_PENDING",
    "RETURNED",
)

#: İzinli geçişler (sözleşme §3.2 diyagramı). **Liste kapalıdır**: burada
#: olmayan her geçiş yasaktır. Asıl risk izinli bir geçişin çalışmaması değil,
#: izinsiz bir geçişin sessizce açık kalmasıdır (ör. DELIVERED → PACKED ile
#: teslim edilmiş paketin yeniden dağıtıma verilmesi).
PACKAGE_TRANSITIONS: frozenset[tuple[str, str]] = frozenset(
    {
        ("OPEN", "PACKED"),             # complete — bütün kalemler doğrulandı
        ("OPEN", "VOID"),               # paketten vazgeçildi / sipariş iptal
        ("PACKED", "HANDED_OVER"),      # kurye zimmeti (QR)
        ("PACKED", "VOID"),
        ("HANDED_OVER", "DELIVERED"),   # kapıda teslim
        ("HANDED_OVER", "RETURN_PENDING"),  # fail/cancel_run/watchdog/postpone
        ("RETURN_PENDING", "RETURNED"),     # depoda okutuldu
        ("RETURNED", "PACKED"),         # repack — yeniden dağıtıma
        ("RETURNED", "VOID"),           # kutu zarar gördü
    }
)

#: Paketin FİZİKSEL konumu (sözleşme §3.2). Envanterin "işletmede mi" sorusu
#: bunun üstünde durur; konumu tanımsız bir durum o soruyu cevapsız bırakır.
PACKAGE_LOCATION: dict[str, str] = {
    "OPEN": "ON_PREMISE",            # raftan toplanıyor
    "PACKED": "ON_PREMISE",          # hazır, çıkış bekliyor — kurye ALMADI
    "HANDED_OVER": "OFF_PREMISE",    # kuryede
    "RETURN_PENDING": "OFF_PREMISE",  # kuryede, geri bekleniyor
    "RETURNED": "ON_PREMISE",        # geri geldi, OKUTULARAK doğrulandı
    "DELIVERED": "CUSTOMER",
    "VOID": "DISSOLVED",             # paket yok; içerik rafta
}

_ON_PREMISE = "ON_PREMISE"


def can_transition(kaynak: str, hedef: str) -> bool:
    """Geçiş izinli mi? (saf) Terminal durumdan çıkış YOKTUR."""
    return (kaynak, hedef) in PACKAGE_TRANSITIONS


def is_terminal(status: str) -> bool:
    return status in TERMINAL_STATUSES


def is_live(status: str) -> bool:
    """Sipariş başına tekil olması gereken küme (`uq_order_packages_live`)."""
    return status in LIVE_STATUSES


def is_on_premise(status: str) -> bool:
    """Paket işletmenin fiziksel kontrolünde mi?

    `PACKED` **evet**'tir: hazırlanmış ama kurye almamış paket hâlâ depodadır.
    `HANDED_OVER`/`RETURN_PENDING` **hayır**'dır — araçtadır.
    """
    return PACKAGE_LOCATION.get(status) == _ON_PREMISE


# ══════════════════ İşlem tablosu ═══════════════════════════════════════════


@dataclasses.dataclass(frozen=True, slots=True)
class ActionRule:
    """Bir paket işleminin sözleşmesi — veri olarak.

    Servis bu tabloyu **okur**; "hangi durumdan yapılabilir" kararı if
    yığınlarına dağılmaz. Yeni bir işlem eklenirken buraya bir satır yazmayı
    unutmak imkânsızdır: servis tablodan okuduğu için satırsız işlem çalışmaz.
    """

    event_type: str
    #: İşlemin başlayabileceği durumlar. Boşsa durum ön koşulu yoktur (`open`).
    from_statuses: tuple[str, ...]
    #: İşlem sonunda paketin durumu; `None` = durum değişmez (scan/unpack).
    to_status: str | None
    #: Gerekçe zorunlu mu (boş dizgi de reddedilir)?
    requires_reason: bool
    #: Aktör (admin/kurye) zorunlu mu? `False` olanlar sistem kancasından da
    #: gelebilir ve o hâlde olay `actor_role/actor_id = NULL` yazılır.
    requires_actor: bool


#: `packing_service` (ve `delivery_service.handover_scan`) bu tabloyu kullanır.
PACKAGE_ACTIONS: dict[str, ActionRule] = {
    "open": ActionRule("OPEN", (), "OPEN", False, True),
    "scan": ActionRule("SCAN", ("OPEN",), None, False, True),
    "undo_scan": ActionRule("UNDO_SCAN", ("OPEN",), None, True, True),
    "complete": ActionRule("COMPLETE", ("OPEN",), "PACKED", False, True),
    "handover": ActionRule("HANDOVER", ("PACKED",), "HANDED_OVER", False, True),
    # Teslim ve geri-dönüş işaretlemesi SAHA olaylarıdır; aktörü teslimat
    # tarafındaki durak kaydı taşır, paket olayı sistem olayı olabilir.
    "deliver": ActionRule("DELIVER", ("HANDED_OVER",), "DELIVERED", False, False),
    "return_pending": ActionRule(
        "RETURN_PENDING", ("HANDED_OVER",), "RETURN_PENDING", True, False
    ),
    "return_in": ActionRule("RETURN_IN", ("RETURN_PENDING",), "RETURNED", False, True),
    "repack": ActionRule("REPACK", ("RETURNED",), "PACKED", False, True),
    # `void` hem operatör kararı (admin) hem sipariş terminal kancası (sistem)
    # olabilir; bu yüzden aktör zorunlu DEĞİL, gerekçe ZORUNLUDUR.
    "void": ActionRule("VOID", ("OPEN", "PACKED", "RETURNED"), "VOID", True, False),
    "unpack": ActionRule("UNPACK", ("VOID",), None, False, True),
}


def action_rule(islem: str) -> ActionRule:
    kural = PACKAGE_ACTIONS.get(islem)
    if kural is None:
        raise ValueError(f"tanımsız paket işlemi: {islem}")
    return kural


def allows(islem: str, status: str) -> bool:
    """`status` durumundaki paket üzerinde `islem` yapılabilir mi? (saf)"""
    kural = action_rule(islem)
    return not kural.from_statuses or status in kural.from_statuses


# ══════════════════ QR uzayı ════════════════════════════════════════════════

#: Sürüm öneki. Formatı ileride değiştirebilmek için (PKG2…) ve durak
#: uzayından yapısal olarak ayırmak için.
QR_PREFIX = "PKG1"


def build_package_qr(package_id: int, token: str) -> str:
    """Etikete basılan payload (sözleşme §3.3)."""
    return f"{QR_PREFIX}:{package_id}:{token}"


def parse_package_qr(payload: str | None) -> tuple[int, str] | None:
    """`PKG1:{id}:{token}` → `(id, token)`; paket payload'u değilse **None**.

    `None` dönmek zorunludur: `/delivery/scan` bu değere bakıp mevcut durak
    yoluna düşer. İstisna fırlatmak geriye uyumu kırardı.
    """
    if not payload:
        return None
    parcalar = payload.strip().split(":")
    if len(parcalar) != 3:
        return None
    onek, ham_id, token = parcalar
    if onek != QR_PREFIX or not token:
        return None
    try:
        package_id = int(ham_id)
    except ValueError:
        return None
    if package_id <= 0:
        return None
    return package_id, token


def package_code(package_id: int) -> str:
    """İnsan okunur paket kodu — **türetilmiş**, kolon değil. Tekilliği `id`
    sağlar; etikette ve telefonda okunan budur."""
    return f"PKT-{package_id:06d}"


# ══════════════════ Kod eşleştirme ve tarama kararı ═════════════════════════


@dataclasses.dataclass(frozen=True, slots=True)
class ScanLine:
    """Paket satırının saf görünümü — ORM'siz, karar verilebilir hâli."""

    order_item_id: int
    product_id: int | None
    sku: str | None
    barcode: str | None
    expected_qty: int
    scanned_qty: int

    @property
    def remaining(self) -> int:
        return self.expected_qty - self.scanned_qty

    @property
    def scannable(self) -> bool:
        """Ürünü okunabilen satır. `product_id IS NULL` → kod da yoktur
        (`ck_order_package_items_scannable`), yalnız manuel doğrulama kapatır."""
        return bool(self.sku or self.barcode)


@dataclasses.dataclass(frozen=True, slots=True)
class ScanOutcome:
    """Tarama kararı. `result` sözlüğü `models.packing.SCAN_RESULTS` ile aynıdır.

    NOT (§I — gizlenmez): `ALREADY_COMPLETE` ve `UNSCANNABLE` sözlükte VARDIR
    (DB CHECK'i onları kabul eder) ama bu saf katman onları ÜRETMEZ. Sebep
    kabul testlerinden gelir: tek satırlı dolu pakette beklenen sonuç
    `OVER_QTY`'dir (`ALREADY_COMPLETE` değil) ve kodu olmayan satırda kod
    taraması `WRONG_SKU` döner (`UNSCANNABLE` değil). İkisi de HTTP katmanının
    (commit 4) daha bağışlayıcı yollarına ayrılmıştır; burada uydurulmaları
    testlerin ölçtüğü davranışı bozardı.
    """

    result: str
    qty_delta: int
    line: ScanLine | None = None
    reason: str | None = None


def normalize_code(code: str | None) -> str:
    """Okuyucu artıklarını temizler: USB barkod okuyucular sonda boşluk/CR
    bırakır, operatör küçük harf yazabilir."""
    return (code or "").strip().upper()


def match_code(lines, code: str | None) -> ScanLine | None:
    """Okunan kodu bir satıra eşler (saf).

    Sıra sözleşme §3.6'dandır ve **önce barkod**'dur: fiziksel kalemin üstünde
    okunan dizgi barkoddur; SKU bizim iç kimliğimizdir. İki geçiş yapılır —
    önce bütün satırların barkodu, sonra bütün satırların SKU'su — çünkü bir
    ürünün SKU'su başka bir ürünün barkoduna eşit olabilir ve o durumda doğru
    cevap barkod eşleşmesidir.
    """
    aranan = normalize_code(code)
    if not aranan:
        return None
    for satir in lines:
        if satir.barcode and normalize_code(satir.barcode) == aranan:
            return satir
    for satir in lines:
        if satir.sku and normalize_code(satir.sku) == aranan:
            return satir
    return None


def scan_outcome(lines, code: str | None) -> ScanOutcome:
    """Kod taramasının sonucu (saf): OK · WRONG_SKU · OVER_QTY.

    Red de bir OLAYDIR ve `qty_delta = 0` ile döner — çağıran onu ize yazar
    ("hangi rafta yanlış kitap duruyor" sorusunun cevabı tam da redlerdedir).
    """
    satir = match_code(lines, code)
    if satir is None:
        return ScanOutcome("WRONG_SKU", 0)
    if satir.remaining <= 0:
        return ScanOutcome("OVER_QTY", 0, satir)
    return ScanOutcome("OK", 1, satir)


def manual_outcome(line: ScanLine, *, reason: str | None) -> ScanOutcome:
    """Kontrollü manuel doğrulama (kaçış kapısı) — gerekçe ZORUNLU.

    Gerekçesiz çağrı `ValueError` ile reddedilir; servis onu 422'ye çevirir.
    DB tarafında da `ck_package_scan_events_manual_reason` aynı şeyi söyler:
    kaçış kapısı akışın içindedir ama izsiz değildir.
    """
    if not (reason or "").strip():
        raise ValueError("manuel doğrulama gerekçesi zorunludur")
    if line.remaining <= 0:
        return ScanOutcome("OVER_QTY", 0, line)
    return ScanOutcome("OK_MANUAL", 1, line, reason.strip())


def is_complete(lines) -> bool:
    """Bütün satırlar tam mı? Boş paket **tamamlanmış sayılmaz** — sıfır
    satırlı bir paketi PACKED yapmak, hiçbir şey doğrulamadan "hazır" demektir."""
    satirlar = list(lines)
    return bool(satirlar) and all(s.remaining <= 0 for s in satirlar)


def missing_lines(lines) -> list[ScanLine]:
    """Eksik kalan satırlar — ekranın "neyi bekliyoruz" bandı ve `complete`
    409 gövdesi bunu kullanır."""
    return [s for s in lines if s.remaining > 0]


# ══════════════════ STALE parmak izi ════════════════════════════════════════


def items_fingerprint(rows) -> str:
    """Sipariş kalem listesinin sha256 özeti (saf, 64 karakter).

    `rows`: `(order_item_id, product_id, quantity)` üçlüleri.

    **Sıradan bağımsızdır** (sıralanır): aksi hâlde SQL'in satır sırası değişince
    her `complete` yalancı STALE üretirdi. Adet değişirse ya da kalem eklenir/
    çıkarılırsa özet değişir — sözleşme §7 S5'in istediği tam olarak budur.
    """
    parcalar = sorted(
        f"{order_item_id}:{product_id}:{quantity}"
        for order_item_id, product_id, quantity in rows
    )
    return hashlib.sha256("|".join(parcalar).encode("utf-8")).hexdigest()
