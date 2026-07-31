"""PK-1 kabul testi — kapıların FİİLEN kablolandığı (AST envanteri).

## Bu testin varlık sebebi

Bağımsız güvenlik denetimi şunu buldu: paketin bütün kapı testleri
`payment_gates` fonksiyonlarını **doğrudan** çağırıyordu; hiçbiri kapının bir
router'dan/servisten çağrıldığını doğrulamıyordu. Yani `payments.py`,
`bookings.py`, `library_exams.py`, `study_reservations.py` ve
`order_service.py` içindeki `assert_*` satırları **silinse tüm suite yeşil
kalıyordu** — kapı sessizce kalkardı.

HTTP seviyesinde test etmek burada zayıf bir çözüm: her para ucu kimlik
doğrulama + telefon doğrulama + varlık sahipliği istiyor, o yüzden testin
kurulumu kapının kendisinden daha kırılgan olur ve kapı 401/403'ün arkasında
kalıp hiç ölçülmez. Bunun yerine **kaynak kodun yapısı** doğrulanır: bu,
`tests/test_admin_permission_catalog.py`'nin izlediği yaklaşımın aynısıdır.

İki yönlü koruma:
  1. Envanterdeki her para yolu gerçekten bir `assert_*` çağırıyor mu?
  2. Envanterin DIŞINDA para alan yeni bir uç eklenmiş mi? (eklenmişse test
     kırılır ve envanteri güncellemeye zorlar — sessizce kapısız uç doğmaz)
"""
from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[2]

#: Kabul edilen kapı çağrıları.
GATE_CALLS = {
    "assert_branch_open",
    "assert_cart_branches_open",
    "assert_manual_payout_open",
}

#: Para tahsil eden / ödeme yükümlülüğü doğuran servis çağrıları. Bir router
#: fonksiyonu bunlardan birini çağırıyorsa kapılı OLMAK ZORUNDADIR.
MONEY_CALLS = {
    ("payment_service", "pay"),
    ("library_exam_service", "pay"),
    ("library_exam_service", "register"),
    ("study_reservation_service", "pay"),
    ("study_reservation_service", "reserve"),
    ("order_service", "create_order"),
    ("order_service", "pay"),
    ("payout_ledger", "record_payment"),
    ("booking_service", "accept"),
}

#: (dosya, fonksiyon) → kapının GÖVDESİNDE bulunması gerektiği yerler.
INVENTORY: list[tuple[str, str]] = [
    ("api/routers/payments.py", "pay_booking"),
    ("api/routers/bookings.py", "accept_booking"),
    ("api/routers/library_exams.py", "register"),
    ("api/routers/library_exams.py", "pay"),
    ("api/routers/study_reservations.py", "reserve"),
    ("api/routers/study_reservations.py", "pay"),
    ("api/routers/payouts.py", "record_payout"),
    ("services/order_service.py", "create_order"),
    ("services/order_service.py", "pay"),
]


def _tree(rel: str) -> ast.Module:
    return ast.parse((BACKEND / rel).read_text(encoding="utf-8"))


def _func(rel: str, name: str) -> ast.AST:
    for node in ast.walk(_tree(rel)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"{rel} içinde {name} bulunamadı — envanter eskimiş")


def _called_attrs(node: ast.AST) -> set[tuple[str, str]]:
    """Fonksiyon gövdesindeki `modul.fonksiyon(...)` çağrıları."""
    out: set[tuple[str, str]] = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute):
            owner = sub.func.value
            if isinstance(owner, ast.Name):
                out.add((owner.id, sub.func.attr))
    return out


#: Kapıyı kendisi çağırmayan, ama kapılı bir servis fonksiyonuna DELEGE eden
#: router uçları. Sipariş uçlarında kapı servistedir çünkü sepet içeriği (hangi
#: kolların gerektiği) orada çözülür — router'da tekrarlamak iki doğruluk
#: kaynağı üretirdi. Delege hedefinin kendisi INVENTORY'de olmak zorundadır.
DELEGATED: list[tuple[str, str, tuple[str, str]]] = [
    ("api/routers/store.py", "create_order", ("services/order_service.py", "create_order")),
    ("api/routers/store.py", "pay_order", ("services/order_service.py", "pay")),
]


@pytest.mark.parametrize("rel, func", INVENTORY, ids=[f"{r}::{f}" for r, f in INVENTORY])
def test_para_yolu_kapi_cagiriyor(rel: str, func: str):
    calls = _called_attrs(_func(rel, func))
    gates = {attr for owner, attr in calls if owner == "payment_gates"}
    assert gates & GATE_CALLS, (
        f"{rel}::{func} bir payment_gates.assert_* çağırmıyor — kapı kalkmış. "
        f"Bulunan payment_gates çağrıları: {sorted(gates) or 'YOK'}"
    )


@pytest.mark.parametrize(
    "rel, func, target",
    DELEGATED,
    ids=[f"{r}::{f}" for r, f, _t in DELEGATED],
)
def test_delege_edilen_ucun_hedefi_envanterde_ve_kapili(rel: str, func: str, target):
    """Delege eden uç, kapının bulunduğu servis fonksiyonunu gerçekten çağırıyor
    ve o hedef envanterde (yani kapılı olduğu ayrıca doğrulanıyor) olmalı."""
    assert target in {(r, f) for r, f in INVENTORY}, (
        f"{rel}::{func} delege hedefi {target} envanterde değil"
    )
    target_module = pathlib.Path(target[0]).stem
    calls = _called_attrs(_func(rel, func))
    assert (target_module, target[1]) in calls, (
        f"{rel}::{func} artık {target_module}.{target[1]} çağırmıyor — "
        "delege zinciri kopmuş, kapı atlanabilir"
    )


def test_envanter_disinda_kapisiz_para_ucu_YOK():
    """Router'larda para alan ama envanterde olmayan bir fonksiyon var mı?

    Yeni bir ödeme ucu eklenirse bu test kırılır. Kırıldığında doğru davranış
    kapıyı eklemek + envantere yazmaktır; testi gevşetmek değil.
    """
    envanter = {(r, f) for r, f in INVENTORY} | {(r, f) for r, f, _t in DELEGATED}
    ihlaller: list[str] = []

    for path in sorted((BACKEND / "api" / "routers").glob("*.py")):
        rel = f"api/routers/{path.name}"
        for node in ast.walk(_tree(rel)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not (_called_attrs(node) & MONEY_CALLS):
                continue
            if (rel, node.name) not in envanter:
                ihlaller.append(f"{rel}::{node.name}")

    assert not ihlaller, (
        "Para alan/yükümlülük doğuran ama envanterde olmayan uç(lar): "
        + ", ".join(ihlaller)
    )


def test_envanterdeki_dosyalar_gercekten_payment_gates_import_ediyor():
    """Kapı çağrısı isim olarak var ama import silinmişse ImportError yerine
    NameError alırdık; bunu erken yakala."""
    for rel, _func in INVENTORY:
        src = (BACKEND / rel).read_text(encoding="utf-8")
        assert "payment_gates" in src, f"{rel} payment_gates import etmiyor"
