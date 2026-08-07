"""İP-1b · bilet kodlarına tekillik kısıtı (qr_token / short_code)

Denetim P2-40 kapatılır. `verify_attendance` bir bileti YALNIZ koda bakarak
bulur (`or_(qr_token == token, short_code == code)`) ve `.first()` ile alır;
iki canlı satır aynı kodu taşırsa hangisinin döneceği belirsizdir — yanlış
öğrencinin katılımı doğrulanır ve **yanlış emanet serbest bırakılır**. Teslimat
tarafı aynı riski `unique=True` ile kapatmıştı (`models/delivery.py`).

## Neden KISMİ (deleted_at IS NULL)

Doğrulama da yalnız canlı satırlara bakar; soft-delete edilmiş bir kaydın kodu
kimseyi bulamaz, dolayısıyla kısıtın onu kapsaması gereksiz yere silme+yeniden
oluşturma akışlarını kırardı. NULL kodlar Postgres'te birbirine çakışmaz —
ödeme öncesi kayıtların hepsi NULL taşır ve kısıt onlara dokunmaz.

## Statü filtresi neden YOK

Eski `_unique_short_code` yalnız PAID/ATTENDED satırlara karşı tekillik
arıyordu; oysa `verify_attendance` statüye BAKMADAN arar. Yani iptal edilmiş
bir kaydın kodu canlı bir bilete yeniden dağıtılabiliyordu. Kısıt bu yüzden
statüden bağımsızdır.

## Mevcut veri

Uygulama öncesi geliştirme veritabanında çakışma ÖLÇÜLDÜ: deneme biletlerinde
2/2, çalışma rezervasyonlarında 7/7 ve 6/6 tekil (çakışma yok). Yine de
migration savunmacıdır: çakışan satır bulunursa kısıt kurulamaz ve `upgrade`
NE OLDUĞUNU SÖYLEYEN bir hatayla durur — sessizce indexi atlayıp "kural var"
sanılmasındansa gürültülü başarısızlık yeğdir.

Revision ID: ip1b_bilet_kodu_tekilligi
Revises: ip1b_kontenjan_kilidi
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "ip1b_bilet_kodu_tekilligi"
down_revision: Union[str, Sequence[str], None] = "ip1b_kontenjan_kilidi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_HEDEFLER = (
    ("exam_registrations", "uq_exam_reg_qr_token", "qr_token"),
    ("exam_registrations", "uq_exam_reg_short_code", "short_code"),
    ("study_reservations", "uq_study_res_qr_token", "qr_token"),
    ("study_reservations", "uq_study_res_short_code", "short_code"),
)


def _cakisma_kontrolu(tablo: str, kolon: str) -> None:
    baglanti = op.get_bind()
    cakisan = baglanti.execute(
        sa.text(
            f"SELECT {kolon}, count(*) AS n FROM {tablo} "  # noqa: S608 (sabit isimler)
            f"WHERE {kolon} IS NOT NULL AND deleted_at IS NULL "
            f"GROUP BY {kolon} HAVING count(*) > 1 LIMIT 5"
        )
    ).all()
    if cakisan:
        ornek = ", ".join(f"{r[0]!r}×{r[1]}" for r in cakisan)
        raise RuntimeError(
            f"{tablo}.{kolon} tekil değil; kısıt kurulamıyor. Çakışan kodlar: "
            f"{ornek}. Bu kodlar bilet doğrulamasında belirsizlik üretir ve elle "
            "çözülmelidir (etkilenen bilete yeni kod atayın)."
        )


def upgrade() -> None:
    for tablo, index_adi, kolon in _HEDEFLER:
        _cakisma_kontrolu(tablo, kolon)
        op.create_index(
            index_adi,
            tablo,
            [kolon],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
        )


def downgrade() -> None:
    for tablo, index_adi, _kolon in reversed(_HEDEFLER):
        op.drop_index(
            index_adi,
            table_name=tablo,
            postgresql_where=sa.text("deleted_at IS NULL"),
        )
