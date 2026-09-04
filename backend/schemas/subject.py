from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SubjectOut(BaseModel):
    """Public ders kaydı.

    Ağaç iç içe JSON olarak DEĞİL, düz liste + `parent_id` ile döner: 846
    kalemde iç içe yapı yükü büyütür ve istemcinin gruplama/arama işini
    zorlaştırır. Ağaç kurulumu istemcide tek geçişte yapılır.

    `aliases` yanıta DAHİLDİR: değeri tam olarak yazarken-süzme anındadır —
    "matemetik" yazan kullanıcı Matematik'i görmeli.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    parent_id: int | None = None
    group_code: str
    sort_order: int
    #: Bu derste geçerli seviye merdivenleri (OKUL / CEFR / SANAT / KONSERVATUVAR).
    scales: list[str] = []
    aliases: list[str] = []
    #: Bu dersi bildiren yayındaki eğitmen sayısı. Öneri sıralamasında
    #: arkasında arz olan dersler öne alınır — "aratıp hiçbir şey bulamama"
    #: ile "tıklayıp boş sayfa görme" arasındaki dengeyi bu kurar.
    tutor_count: int = 0


class LevelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scale_code: str
    code: str
    name: str
    sort_order: int


class LevelScaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    sort_order: int
    levels: list[LevelOut] = []
