from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

_YEAR_MIN = 1950
_YEAR_MAX = 2100


class EducationCreate(BaseModel):
    school_name: str = Field(min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=100)
    field_of_study: str | None = Field(default=None, max_length=150)
    start_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)
    end_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)

    @model_validator(mode="after")
    def _check_years(self):
        if (
            self.start_year is not None
            and self.end_year is not None
            and self.end_year < self.start_year
        ):
            raise ValueError("end_year cannot be earlier than start_year")
        return self


class EducationUpdate(BaseModel):
    school_name: str | None = Field(default=None, min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=100)
    field_of_study: str | None = Field(default=None, max_length=150)
    start_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)
    end_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)


class EducationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_name: str
    degree: str | None = None
    field_of_study: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    # Yalnız eğitmen eğitimlerinde dolu (diploma/belge). Client'ta her zaman None.
    document_url: str | None = None
    document_name: str | None = None
