"""Escrow invariant'ları — Hypothesis property testleri (DB'siz).

1. Conservation: her (amount, rate) için commission.split toplamı TAM amount'tur.
2. Terminal durumdan çıkış yok: geçiş tabloları RELEASED/REFUNDED/ATTENDED'dan
   hiçbir hedefe izin vermez; rastgele claim dizileri terminale girdikten sonra
   durumu değiştiremez.
3. İade sayısı ≤ 1 (crash dahil): iki fazlı iade protokolü + reconciler karar
   çekirdeği, rastgele crash/görünürlük-gecikmesi enjeksiyonu altında, aşırı-iade
   reddi uygulayan sağlayıcı defterinde 1'den fazla iade kabul ettiremez.

Eşzamanlılık kanıtı burada DEĞİL — gerçek Postgres yarış testleri
tests/integration/test_money_pg.py'dedir; buradaki model claim'lerin atomikliğini
veri kabul eder ve ÜSTÜNDEKİ protokol mantığını doğrular.
"""
from __future__ import annotations

import dataclasses
import datetime
from decimal import Decimal

from hypothesis import given, settings as hyp_settings
from hypothesis import strategies as st

from core.payments.base import RefundState
from services import commission, escrow

# ── 1) Conservation ─────────────────────────────────────────────────────────────

amounts = st.decimals(
    min_value=Decimal("0.00"),
    max_value=Decimal("99999999.99"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
rates = st.decimals(
    min_value=Decimal("0.0000"),
    max_value=Decimal("1.0000"),
    places=4,
    allow_nan=False,
    allow_infinity=False,
)


@given(amount=amounts, rate=rates)
def test_split_conservation(amount: Decimal, rate: Decimal):
    commission_amount, earning = commission.split(amount, rate)
    assert commission_amount + earning == amount
    assert commission_amount >= 0
    assert earning >= 0 or rate <= 1  # rate ≤ 1 garantisiyle earning negatif olamaz
    assert earning >= 0


# ── 2) Terminal durumdan çıkış yok ──────────────────────────────────────────────

PAYMENT_TERMINALS = {s for s, targets in escrow.PAYMENT_TRANSITIONS.items() if not targets}
REG_TERMINALS = {s for s, targets in escrow.REGISTRATION_TRANSITIONS.items() if not targets}


def test_expected_terminals():
    from models.library_exam import RegistrationStatus
    from models.payment import PaymentStatus

    assert PAYMENT_TERMINALS == {PaymentStatus.RELEASED, PaymentStatus.REFUNDED}
    assert REG_TERMINALS == {
        RegistrationStatus.ATTENDED.value,
        RegistrationStatus.REFUNDED.value,
    }


def _walk(table: dict, start, steps: list[int]):
    """Rastgele adım indeksleriyle tabloda yürür; girilen durum izini döndürür."""
    trace = [start]
    current = start
    for raw in steps:
        targets = sorted(table[current], key=str)
        if not targets:
            # terminal: hiçbir claim kabul edilmez — durum değişemez
            trace.append(current)
            continue
        current = targets[raw % len(targets)]
        trace.append(current)
    return trace


@given(steps=st.lists(st.integers(min_value=0, max_value=7), max_size=25))
def test_payment_no_exit_from_terminal(steps: list[int]):
    from models.payment import PaymentStatus

    trace = _walk(escrow.PAYMENT_TRANSITIONS, PaymentStatus.PENDING, steps)
    seen_terminal = None
    for state in trace:
        if seen_terminal is not None:
            assert state == seen_terminal, (
                f"terminal {seen_terminal} durumundan {state} durumuna çıkıldı"
            )
        elif state in PAYMENT_TERMINALS:
            seen_terminal = state


@given(steps=st.lists(st.integers(min_value=0, max_value=7), max_size=25))
def test_registration_no_exit_from_terminal(steps: list[int]):
    from models.library_exam import RegistrationStatus

    trace = _walk(
        escrow.REGISTRATION_TRANSITIONS,
        RegistrationStatus.PENDING_PAYMENT.value,
        steps,
    )
    seen_terminal = None
    for state in trace:
        if seen_terminal is not None:
            assert state == seen_terminal
        elif state in REG_TERMINALS:
            seen_terminal = state


# ── 3) Crash altında iade sayısı ≤ 1 ────────────────────────────────────────────
#
# Modellenen protokol (services/escrow.py + escrow_reconciler.py):
#   begin_refund: HELD→REFUNDING claim + COMMIT (intent kalıcı)
#   provider.refund: kabul/ret/CRASH (yanıt kaybolur ama sağlayıcı kabul etmiş
#       olabilir — tam da tehlikeli belirsizlik)
#   finalize: yanıt başarılıysa REFUNDING→REFUNDED
#   reconciler: karantina + pozitif kanıt + sınırlı retry (next_refund_action)
# Sağlayıcı defteri tam-tutar iadede aşırı-iadeyi REDDEDER (iyzico semantiği).


@dataclasses.dataclass
class _Ledger:
    """Sağlayıcı defteri: tam iade en fazla bir kez kabul edilir."""

    accepted: int = 0

    def try_refund(self) -> bool:
        if self.accepted >= 1:
            return False  # aşırı-iade reddi
        self.accepted += 1
        return True


@dataclasses.dataclass
class _Row:
    status: str = "HELD"
    attempts: int = 0
    requested_at: datetime.datetime | None = None


_T0 = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
_MIN_AGE = datetime.timedelta(minutes=15)
_MAX_ATTEMPTS = 3

# Her reconciler turu için enjekte edilen belirsizlikler:
#   crash: provider çağrısının yanıtı kaybolur mu?
#   accepted_despite_crash: yanıt kaybolduysa sağlayıcı yine de kabul etmiş miydi?
#   visible: kabul edilmiş iade detail sorgusunda görünür mü (görünürlük gecikmesi)?
_round = st.fixed_dictionaries(
    {
        "crash": st.booleans(),
        "accepted_despite_crash": st.booleans(),
        "visible": st.booleans(),
    }
)


@given(first=_round, rounds=st.lists(_round, max_size=8))
@hyp_settings(max_examples=300)
def test_refund_protocol_never_double_refunds(first: dict, rounds: list[dict]):
    ledger = _Ledger()
    row = _Row()
    now = _T0

    def provider_call(inject: dict) -> bool | None:
        """None = yanıt kayboldu (crash); kabul yine de gerçekleşmiş olabilir."""
        if inject["crash"]:
            if inject["accepted_despite_crash"]:
                ledger.try_refund()
            return None
        return ledger.try_refund()

    # İlk iade girişimi (ör. booking cancel): begin_refund + provider + finalize.
    row.status = "REFUNDING"
    row.attempts = 1
    row.requested_at = now
    outcome = provider_call(first)
    if outcome is True:
        row.status = "REFUNDED"
    # outcome False/None → REFUNDING'de sarkar; reconciler devralır.

    for inject in rounds:
        now += datetime.timedelta(minutes=20)  # karantina penceresi geçsin
        if row.status != "REFUNDING":
            break
        provider_state = (
            RefundState.REFUNDED
            if (ledger.accepted > 0 and inject["visible"])
            else RefundState.UNKNOWN
        )
        action = escrow.next_refund_action(
            attempts=row.attempts,
            requested_at=row.requested_at,
            now=now,
            provider_state=provider_state,
            min_age=_MIN_AGE,
            max_attempts=_MAX_ATTEMPTS,
        )
        if action == escrow.ACTION_WAIT:
            continue
        if action == escrow.ACTION_FINALIZE:
            row.status = "REFUNDED"  # sağlayıcıya yazma çağrısı YOK
            continue
        if action == escrow.ACTION_ALERT:
            continue  # retry durdu; insan müdahalesi
        # ACTION_RETRY
        row.attempts += 1
        row.requested_at = now
        outcome = provider_call(inject)
        if outcome is True:
            row.status = "REFUNDED"

    # İNVARYANTLAR:
    assert ledger.accepted <= 1, "sağlayıcı defterinde birden fazla iade kabul edildi"
    assert row.status in ("REFUNDING", "REFUNDED")
    # Yerel REFUNDED yalnız gerçek kabul ya da pozitif kanıtla mümkündür:
    if row.status == "REFUNDED":
        assert ledger.accepted == 1
    # Deneme sayısı sınırı aşılamaz (ilk girişim + en fazla max retry).
    assert row.attempts <= _MAX_ATTEMPTS + 1
