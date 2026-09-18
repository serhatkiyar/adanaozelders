"""kök SEO adresleri (seo_slugs)

Modül 6 (18 Eyl 2026): ilan, ders ve ilçe sayfaları kökte yaşar
(`/lgs-yks-matematik-seyhan`, `/matematik-ozel-ders`, `/seyhan/...`).
Kökteki bütün dinamik adresler tek tabloda; `slug` global benzersiz (tarihçe
satırları dahil), böylece bir adres başka kayda asla geçmez.

Veri taşıması:
  * silinmemiş her ders için `<slug>-ozel-ders` satırı,
  * Adana'nın 15 ilçesi için ilçe satırı,
  * YAYINDAKİ her eğitmen için ilan başlığından üretilmiş ilan adresi
    (kural `core/seo_adres.py`; sonraki ilanlar ilk yayında adres alır).

Elle yazıldı: kısmi benzersiz indeksler ve veri taşıması autogenerate'in
kapsamı dışında.
"""
from alembic import op
import sqlalchemy as sa

revision = "m11_seo_adresleri"
down_revision = "m10_ek_aralik_haftalik"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seo_slugs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column(
            "tutor_id",
            sa.Integer(),
            sa.ForeignKey("tutors.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "subject_id",
            sa.Integer(),
            sa.ForeignKey("subjects.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("district", sa.String(80), nullable=True),
        sa.Column(
            "is_current", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('ilan', 'ders', 'ilce')", name="ck_seo_slugs_kind"),
        sa.CheckConstraint(
            "(kind = 'ilan' AND tutor_id IS NOT NULL)"
            " OR (kind = 'ders' AND subject_id IS NOT NULL)"
            " OR (kind = 'ilce' AND district IS NOT NULL)",
            name="ck_seo_slugs_hedef",
        ),
    )
    op.create_index("uq_seo_slugs_slug", "seo_slugs", ["slug"], unique=True)
    op.create_index(
        "uq_seo_slugs_ilan_guncel",
        "seo_slugs",
        ["tutor_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'ilan' AND is_current"),
    )
    op.create_index(
        "uq_seo_slugs_ders_guncel",
        "seo_slugs",
        ["subject_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'ders' AND is_current"),
    )
    op.create_index("ix_seo_slugs_tutor_id", "seo_slugs", ["tutor_id"])
    op.create_index("ix_seo_slugs_subject_id", "seo_slugs", ["subject_id"])

    # ── Veri: ders ve ilçe adresleri ──
    op.execute(
        "INSERT INTO seo_slugs (slug, kind, subject_id, is_current) "
        "SELECT s.slug || '-ozel-ders', 'ders', s.id, true FROM subjects s "
        "WHERE s.deleted_at IS NULL AND s.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' "
        "ON CONFLICT (slug) DO NOTHING"
    )

    # Saf kural modülü (DB'siz, yalnız standart kütüphane + slugify): üretim
    # kuralıyla BİREBİR aynı adresi üretmek için kopyalanmadı, içe alındı.
    from core import seo_adres

    bind = op.get_bind()
    for ad in seo_adres.ADANA_ILCELERI:
        bind.execute(
            sa.text(
                "INSERT INTO seo_slugs (slug, kind, district, is_current) "
                "VALUES (:s, 'ilce', :d, true) ON CONFLICT (slug) DO NOTHING"
            ),
            {"s": seo_adres.ilce_slugu(ad), "d": ad},
        )

    # ── Veri: yayındaki eğitmenlerin ilan adresleri ──
    dolu = set(bind.execute(sa.text("SELECT slug FROM seo_slugs")).scalars())
    egitmenler = bind.execute(
        sa.text(
            "SELECT id, headline, district FROM tutors "
            "WHERE status = 'APPROVED' AND is_active AND deleted_at IS NULL "
            "ORDER BY id"
        )
    ).all()
    for tid, baslik, ilce in egitmenler:
        slug = seo_adres.benzersiz_yap_kume(
            seo_adres.ilan_slug_tabani(baslik, ilce), dolu
        )
        dolu.add(slug)
        bind.execute(
            sa.text(
                "INSERT INTO seo_slugs (slug, kind, tutor_id, is_current) "
                "VALUES (:s, 'ilan', :t, true)"
            ),
            {"s": slug, "t": tid},
        )


def downgrade() -> None:
    op.drop_index("ix_seo_slugs_subject_id", table_name="seo_slugs")
    op.drop_index("ix_seo_slugs_tutor_id", table_name="seo_slugs")
    op.drop_index("uq_seo_slugs_ders_guncel", table_name="seo_slugs")
    op.drop_index("uq_seo_slugs_ilan_guncel", table_name="seo_slugs")
    op.drop_index("uq_seo_slugs_slug", table_name="seo_slugs")
    op.drop_table("seo_slugs")
