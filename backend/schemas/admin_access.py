from __future__ import annotations

from pydantic import BaseModel, Field


class AdminPermissionOut(BaseModel):
    id: int
    code: str
    name: str
    group: str
    description: str | None = None


class AdminRoleOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None = None
    is_system: bool
    permission_codes: list[str]
    assignment_count: int = 0


class AdminRoleCreate(BaseModel):
    code: str = Field(min_length=3, max_length=50, pattern=r"^[A-Z][A-Z0-9_]*$")
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permission_codes: list[str] = Field(default_factory=list, max_length=100)


class AdminRoleUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permission_codes: list[str] = Field(default_factory=list, max_length=100)


class AdminRoleAssignmentOut(BaseModel):
    admin_id: int
    admin_name: str
    admin_email: str
    role_id: int | None = None
    role_code: str | None = None
    role_name: str | None = None


class AdminRoleAssignmentUpdate(BaseModel):
    role_id: int
