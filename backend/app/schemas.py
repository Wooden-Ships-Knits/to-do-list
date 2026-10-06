import uuid
from datetime import date, datetime
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.clock import today
from app.deadline import DeadlineStatus, deadline_status, effective_deadline
from app.models import MAX_DATE, MIN_DATE, Category, Project


def _check_range(value: date | None) -> date | None:
    if value is not None and not (MIN_DATE <= value <= MAX_DATE):
        raise ValueError(f"Date must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}")
    return value


def _not_future(value: date | None) -> date | None:
    if value is not None and value > today():
        raise ValueError("Actual date cannot be in the future")
    return value


OptDate = Annotated[date | None, AfterValidator(_check_range)]
ActualDate = Annotated[date | None, AfterValidator(_check_range), AfterValidator(_not_future)]
ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20000)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ProjectName
    description: LongText = ""
    category: Category
    stage_id: int
    status_notes: LongText = ""
    ongoing_issue: LongText = ""
    plan_date: OptDate = None
    adjusted_plan_date: OptDate = None
    actual_date: ActualDate = None
    projected_start_date: OptDate = None
    deadline_note: ShortText = ""
    pic_ids: list[uuid.UUID] = Field(default_factory=list)


NON_NULLABLE_PATCH_FIELDS = (
    "name",
    "description",
    "category",
    "stage_id",
    "status_notes",
    "ongoing_issue",
    "deadline_note",
    "pic_ids",
)


class ProjectPatch(BaseModel):
    """Fields that are omitted stay unchanged; date fields may be set to null (= TBD)."""

    model_config = ConfigDict(extra="forbid")

    version: int
    name: ProjectName | None = None
    description: LongText | None = None
    category: Category | None = None
    stage_id: int | None = None
    status_notes: LongText | None = None
    ongoing_issue: LongText | None = None
    plan_date: OptDate = None
    adjusted_plan_date: OptDate = None
    actual_date: ActualDate = None
    projected_start_date: OptDate = None
    deadline_note: ShortText | None = None
    pic_ids: list[uuid.UUID] | None = None

    @model_validator(mode="after")
    def _no_null_for_required(self) -> "ProjectPatch":
        for field in NON_NULLABLE_PATCH_FIELDS:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class PersonRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_active: bool = True


class StageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    category: Category
    stage_id: int
    stage: StageOut
    status_notes: str
    ongoing_issue: str
    plan_date: date | None
    adjusted_plan_date: date | None
    actual_date: date | None
    projected_start_date: date | None
    deadline_note: str
    pics: list[PersonRef]
    version: int
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    effective_deadline: date | None
    deadline_status: DeadlineStatus
    # 1-based position inside the category (manual order); independent of filters.
    number: int | None = None

    @classmethod
    def from_model(cls, p: Project, today_: date, number: int | None = None) -> "ProjectOut":
        return cls(
            id=p.id,
            name=p.name,
            description=p.description,
            category=p.category,
            stage_id=p.stage_id,
            stage=StageOut.model_validate(p.stage),
            status_notes=p.status_notes,
            ongoing_issue=p.ongoing_issue,
            plan_date=p.plan_date,
            adjusted_plan_date=p.adjusted_plan_date,
            actual_date=p.actual_date,
            projected_start_date=p.projected_start_date,
            deadline_note=p.deadline_note,
            pics=[PersonRef.model_validate(x) for x in p.pics],
            version=p.version,
            deleted_at=p.deleted_at,
            created_at=p.created_at,
            updated_at=p.updated_at,
            effective_deadline=effective_deadline(p.plan_date, p.adjusted_plan_date),
            deadline_status=deadline_status(
                p.actual_date, p.plan_date, p.adjusted_plan_date, today_
            ),
            number=number,
        )


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
    has_more: bool


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: uuid.UUID
    field: str
    old_value: str | None
    new_value: str | None
    changed_at: datetime


class PersonCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PersonName
    is_active: bool = True


class PersonPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PersonName | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _no_null(self) -> "PersonPatch":
        for field in ("name", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class StageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PersonName


class PicCount(BaseModel):
    person_id: uuid.UUID
    name: str
    count: int


class Summary(BaseModel):
    total: int
    by_category: dict[str, int]
    by_deadline_status: dict[str, int]
    by_pic: list[PicCount]
    unassigned: int


class Meta(BaseModel):
    today: date
    timezone: str
    due_soon_days: int


class ImportFieldError(BaseModel):
    field: str | None
    message: str


class ImportRow(BaseModel):
    row: int
    valid: bool
    data: dict[str, Any]
    errors: list[ImportFieldError]


class ImportReport(BaseModel):
    dry_run: bool
    total_rows: int
    valid_rows: int
    error_rows: int
    imported: int
    ignored_columns: list[str]
    rows: list[ImportRow]
    errors: list[dict[str, Any]]


class ReorderRequest(BaseModel):
    """Place a project relative to a neighbour. No anchor = append to the end of the category."""

    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    target_category: Category
    before_id: uuid.UUID | None = None
    after_id: uuid.UUID | None = None
    version: int

    @model_validator(mode="after")
    def _one_anchor(self) -> "ReorderRequest":
        if self.before_id is not None and self.after_id is not None:
            raise ValueError("send either before_id or after_id, not both")
        return self
