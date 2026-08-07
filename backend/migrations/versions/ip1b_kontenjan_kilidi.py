"""İP-1b · kütüphane kolu kontenjanını DB seviyesinde zorla

Denetim P1-20 kapatılır. İki ayrı yapı gerekir çünkü iki kolun kontenjanı
farklı biçimlerde:

1. **Koltuk tutma damgası** (`hold_expires_at`, iki tabloda) — ödeme bekleyen
   kayıt süreli olarak koltuk tutar. Kolon olmadan `PENDING_PAYMENT` ya hiç
   koltuk tutmaz (kapasitenin üzerinde tahsilat) ya da süresiz tutar
   (kontenjanı sonsuza dek kilitleyen terk edilmiş ödeme).

2. **Aralık çakışması** (`study_reservations.time_slot` + GiST exclusion) —
   aynı öğrencinin aynı kütüphanede çakışan iki ÖDENMİŞ rezervasyonu DB
   seviyesinde imkânsızlaşır; ders tarafındaki `ex_bookings_no_overlap`
   deseninin birebir kardeşi.

## Exclusion neden kapasiteyi zorlayamaz

Exclusion kısıtı "hiçbir iki satır çakışmasın" der, yani N koltuklu bir salonu
değil yalnız kapasite=1'i ifade edebilir. Sayı tabanlı kontenjan bu yüzden
uygulama katmanında **advisory kilit + sayım** ile serileştirilir
(`services/library_capacity.py`). İkisi birbirinin yerine geçmez.

## btree_gist

`client_id`/`library_id` eşitliğini GiST içinde kullanabilmek için `btree_gist`
gerekir; baseline migration'da zaten kuruludur (ders tarafı aynı deseni
kullanıyor). Yine de idempotent `CREATE EXTENSION IF NOT EXISTS` ile garanti
altına alınır — autogenerate extension'ları GÖRMEZ (backend/CLAUDE.md).

## `down_revision` neden `ip2a` DEĞİL

Bu revizyon `ip2a_iade_para_guvenligi` üzerinde yazıldı; ama paket açıkken
İP-4 (`ip4_operasyon_izinleri`) main'e girdi ve o da aynı revizyona bağlıydı →
iki Alembic head. Zincir **doğrusal** hâle getirildi:

    ip2a_iade_para_guvenligi → ip4_operasyon_izinleri
                             → ip1b_kontenjan_kilidi → ip1b_bilet_kodu_tekilligi

Sıralamanın veri anlamını değiştirmediği koddan doğrulandı:

* İP-4 migration'ı **DDL içermez** — yalnız `admin_permissions` ve
  `admin_role_permissions` tablolarına `NOT EXISTS` korumalı satır ekler.
* İP-1b migration'ları yalnız `exam_registrations` / `study_reservations`
  şemasına dokunur (+ idempotent `btree_gist`). **Ortak tablo, kolon, index,
  kısıt ya da trigger yoktur.**
* İP-1b'nin tek okuması (`ip1b_bilet_kodu_tekilligi::_cakisma_kontrolu`) bu iki
  tabloyla sınırlıdır; İP-4'ün tablolarını okumaz.
* Dolayısıyla iki sıralama da aynı son durumu üretir; Alembic merge revizyonu
  gereksizdir ve gövdelerde başka değişiklik gerekmemiştir.

Revision ID: ip1b_kontenjan_kilidi
Revises: ip4_operasyon_izinleri
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "ip1b_kontenjan_kilidi"
down_revision: Union[str, Sequence[str], None] = "ip4_operasyon_izinleri"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # ── 1) Koltuk tutma damgası ────────────────────────────────────────────
    for tablo in ("exam_registrations", "study_reservations"):
        op.add_column(
            tablo,
            sa.Column("hold_expires_at", sa.DateTime(timezone=True), nullable=True),
        )

    # Kontenjan sayımı (oturum, durum) — kilit altında koşar, sıralı tarama olmasın.
    op.create_index(
        "ix_exam_reg_session_status",
        "exam_registrations",
        ["session_id", "status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ── 2) Aralık kolonu + exclusion ───────────────────────────────────────
    # Üretilmiş (generated) kolon: `bookings.time_slot` ile aynı ifade biçimi.
    op.execute(
        "ALTER TABLE study_reservations "
        "ADD COLUMN time_slot tstzrange "
        "GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED"
    )
    op.execute("ALTER TABLE study_reservations ALTER COLUMN time_slot SET NOT NULL")
    op.execute(
        "ALTER TABLE study_reservations ADD CONSTRAINT ex_study_res_client_no_overlap "
        "EXCLUDE USING gist ("
        "  client_id WITH =, library_id WITH =, time_slot WITH &&"
        ") WHERE (status IN ('PAID', 'ATTENDED') AND deleted_at IS NULL)"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE study_reservations "
        "DROP CONSTRAINT IF EXISTS ex_study_res_client_no_overlap"
    )
    op.execute("ALTER TABLE study_reservations DROP COLUMN IF EXISTS time_slot")
    op.drop_index(
        "ix_exam_reg_session_status",
        table_name="exam_registrations",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    for tablo in ("exam_registrations", "study_reservations"):
        op.drop_column(tablo, "hold_expires_at")
    # `btree_gist` DÜŞÜRÜLMEZ: baseline'dan beri var ve ders tarafındaki
    # `ex_bookings_no_overlap` ona bağlı.
