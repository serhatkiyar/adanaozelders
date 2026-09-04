"""Ders taksonomisi — platformun kanonik ders/branş sözlüğü.

NEDEN VAR: taksonomi bugüne kadar yalnız frontend'te, İKİ AYRI ve birbirinden
ayrışmış TypeScript sabitinde yaşadı (`examTree.ts` yazma tarafını,
`dersTaksonomisi.ts` arama tarafını besliyordu). `tutor_subjects.subject`
doğrulanmamış serbest metin olduğu için iki liste sessizce ayrıştı: ölçüldüğünde
arama listesindeki 85+ kalemin arkasında hiçbir eğitmen yoktu (garantili sıfır
sonuç), ters yönde 5 kalem seçilebiliyor ama aranamıyordu. Bu tablolar o iki
listenin yerine geçen TEK KAYNAKTIR.

Veri kaynağı `backend/data/dersler_v1.json` (bkz. `scripts/dersler_disa_aktar.py`);
yükleyici `scripts/dersler_yukle.py`.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Computed,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

#: Ders grupları. Vitrindeki üst kırılım ve panel filtreleri bunları kullanır.
SUBJECT_GROUPS = (
    "OKUL",
    "SINAV",
    "DIL",
    "BILISIM",
    "MUZIK",
    "SANAT",
    "SPOR",
    "KOCLUK",
)

#: Seviye merdivenleri. Hangi dersin hangi merdiveni kullandığı
#: `subject_level_scales` ile veridir — koda gömülü kural DEĞİLDİR, çünkü
#: `İngilizce` hem okul kademesi hem A1–C2 ister ve istisnalar admin işidir.
LEVEL_SCALES = ("OKUL", "CEFR", "SANAT", "KONSERVATUVAR")


class Subject(Base, TimestampMixin, SoftDeleteMixin):
    """Kanonik ders. İki seviyeli ağaç: kök ders + alt ders.

    ``is_active`` kritik bir üründür, kozmetik bayrak değil: katalog 846 ders
    taşıyor ama vitrinde yalnız arkasında gerçek arz olan ~113'ü açılır. Hepsini
    açmak, düzeltmeye çalıştığımız "aratılınca sıfır sonuç" hastalığını on
    katına çıkarırdı. Pasif ders veritabanında DURUR (eğitmen bildirmişse
    bağı kopmaz), yalnız public listede görünmez.
    """

    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: URL ve API sözleşmesi: `/egitmenler?subject=matematik`.
    slug: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=True
    )
    group_code: Mapped[str] = mapped_column(String(24), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    parent: Mapped["Subject | None"] = relationship(
        remote_side="Subject.id", back_populates="children"
    )
    children: Mapped[list["Subject"]] = relationship(back_populates="parent")
    aliases: Mapped[list["SubjectAlias"]] = relationship(
        back_populates="subject", cascade="all, delete-orphan"
    )
    level_scales: Mapped[list["SubjectLevelScale"]] = relationship(
        back_populates="subject", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_subjects_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_subjects_parent", "parent_id"),
        Index("ix_subjects_active_group", "is_active", "group_code"),
    )


class SubjectAlias(Base, TimestampMixin):
    """Eşanlamlı / yazım hatası / sınav terimi → ders.

    Üç işi birden yapar ve bu bilinçlidir:
      1. Kaynaktan gelen gerçek kullanıcı aramaları (`matemetik`, `piano`),
      2. Bugün `tutor_subjects`'te yazılı kısa değerlerin kanonike bağlanması
         (`fen` → Fen Bilimleri) — geri uyum bunun üzerinden yürür,
      3. Sınav terimleri (`tyt matematik` → Matematik). Sınav AYRI DERS
         DEĞİLDİR: `TYT Matematik` diye bir düğüm açmak, tam da düzeltmeye
         çalıştığımız `Fen` / `Fen Bilgisi` ayrışmasının tekrarı olurdu.

    ``normalized`` GENERATED kolondur ve `tr_normalize()`'dan geçer — arama
    sorgusu da aynı fonksiyonu kullanır. İki tarafın ayrılması aramayı sessizce
    boş sonuca düşürür; bu yüzden normalizasyon uygulamaya değil veritabanına
    bırakılmıştır.

    Benzersizlik GLOBALDİR: bir metin iki derse birden bağlanamaz. Belirsiz
    eşanlamlı, arama sonucunu hata vermeden bozar.
    """

    __tablename__ = "subject_aliases"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False
    )
    alias: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized: Mapped[str] = mapped_column(
        String(160), Computed("tr_normalize(alias)", persisted=True), nullable=False
    )
    #: IMPORT (türetme betiği) | ADMIN (panelden elle) | MIGRATION (göç eşlemesi).
    #: Yükleyici yalnız IMPORT satırlarına dokunur — admin'in elle eklediği
    #: eşanlamlı yeniden yüklemede silinmez.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'IMPORT'")
    )

    subject: Mapped["Subject"] = relationship(back_populates="aliases")

    __table_args__ = (
        Index("uq_subject_aliases_normalized", "normalized", unique=True),
        Index("ix_subject_aliases_subject", "subject_id"),
    )


class LevelScale(Base):
    """Seviye merdiveni (OKUL / CEFR / SANAT / KONSERVATUVAR).

    Referans veridir: kod `level.code` dizelerine (`lise`, `b1`) bağlanır, bu
    yüzden betiğe değil MIGRATION'a seed edilir. Tablo boşsa seviye filtresi
    hata vermez, sessizce hiç sonuç döndürmez.
    """

    __tablename__ = "level_scales"

    code: Mapped[str] = mapped_column(String(24), primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    levels: Mapped[list["Level"]] = relationship(back_populates="scale")


class Level(Base):
    """Merdivendeki tek basamak (`lise`, `b1`, `baslangic`)."""

    __tablename__ = "levels"

    id: Mapped[int] = mapped_column(primary_key=True)
    scale_code: Mapped[str] = mapped_column(
        ForeignKey("level_scales.code", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    scale: Mapped["LevelScale"] = relationship(back_populates="levels")

    __table_args__ = (
        Index("uq_levels_scale_code", "scale_code", "code", unique=True),
    )


class SubjectLevelScale(Base):
    """Bu derste hangi seviye MERDİVENİ geçerli.

    Tek tek basamak değil merdiven bağlanır: 846 ders × ~7 basamak ≈ 5.500
    satır ve admin'in tek tek yöneteceği bir yüzey doğardı. Ürün sorusu
    "hangi basamaklar" değil, "hangi merdiven". İstisna gerekirse (ör. Piyano'da
    doktora istemiyoruz) override tablosu bu şemayı bozmadan sonradan eklenir.
    """

    __tablename__ = "subject_level_scales"

    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), primary_key=True
    )
    scale_code: Mapped[str] = mapped_column(
        ForeignKey("level_scales.code", ondelete="RESTRICT"), primary_key=True
    )

    subject: Mapped["Subject"] = relationship(back_populates="level_scales")
