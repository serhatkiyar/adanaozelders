"""ip2b: terminal siparis gecisleri icin DB savunma katmani

Revision ID: ip2b_terminal_history_guard
Revises: f30_paketleme_semasi
Create Date: 2026-08-03

İP-2b R5 — **savunma derinliği** (erişilebilir bir kusurun düzeltmesi değil).

Uygulama katmanında sipariş durumunun tek yazıcısı `order_fsm.transition_order`
ve o, her terminal geçişte bir `order_status_history` satırı yazar. Ama DB'de
hiçbir koruma yoktu: elle SQL, ileride yazılacak bir betik ya da FSM'i atlayan
yeni bir servis yolu `UPDATE orders SET status='CANCELLED'` diyebiliyor ve
para (iade yok) + stok (SALE_CANCEL yok) + denetim (geçmiş yok) zincirinin
TAMAMI sessizce atlanabiliyordu. Karşılaştırma: `stock_movements` çoktan
append-only trigger'lıdır — iz tablosu korunurken sipariş yaşam döngüsünün
korumasız kalması asimetriydi.

## Neden CONSTRAINT TRIGGER (DEFERRABLE INITIALLY DEFERRED)

Sıradan bir `BEFORE UPDATE` trigger'ı işe YARAMAZDI: SQLAlchemy, `orders`
UPDATE'i ile `order_status_history` INSERT'ünü aynı transaction'da ama
belirsiz sırayla flush eder; UPDATE önce giderse trigger geçmiş satırını
göremez ve MEŞRU FSM geçişini reddederdi.

Ertelenmiş kısıt trigger'ı COMMIT anında çalışır ve transaction'ın TAMAMINI
görür: FSM yolu (UPDATE + INSERT birlikte) geçer, çıplak UPDATE (geçmiş satırı
yok) COMMIT'te `check_violation` ile reddedilir.

## Bilinçli sınır

Kontrol "bu terminal duruma ait bir geçmiş satırı VAR MI" der; satırın bu
transaction'da yazıldığını doğrulamaz. Terminal durumlar FSM'de çıkışsız
olduğundan (CANCELLED/REFUNDED → {}) pratikte aynı kapıya çıkar. Bu bir FSM
kopyası değil, son savunma hattıdır.
"""
from collections.abc import Sequence
from typing import Union

from alembic import op

revision: str = "ip2b_terminal_history_guard"
down_revision: Union[str, Sequence[str], None] = "f30_paketleme_semasi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FONKSIYON = """
CREATE OR REPLACE FUNCTION orders_terminal_requires_history() RETURNS trigger AS $$
BEGIN
    IF NEW.status IN ('CANCELLED', 'REFUNDED')
       AND OLD.status IS DISTINCT FROM NEW.status THEN
        IF NOT EXISTS (
            SELECT 1 FROM order_status_history h
            WHERE h.order_id = NEW.id AND h.new_status = NEW.status
        ) THEN
            RAISE EXCEPTION
                'FSM disi terminal yazim reddedildi: order % -> % '
                '(order_status_history satiri yok)', NEW.id, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

TRIGGER = """
CREATE CONSTRAINT TRIGGER orders_terminal_history_guard
    AFTER UPDATE ON orders
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION orders_terminal_requires_history();
"""


def upgrade() -> None:
    op.execute(FONKSIYON)
    op.execute("DROP TRIGGER IF EXISTS orders_terminal_history_guard ON orders")
    op.execute(TRIGGER)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS orders_terminal_history_guard ON orders")
    op.execute("DROP FUNCTION IF EXISTS orders_terminal_requires_history()")
