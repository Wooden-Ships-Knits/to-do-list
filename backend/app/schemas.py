import uuid
from datetime import date, datetime
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.clock import today
from app.deadline import DeadlineStatus, deadline_status, effective_deadline
from app.models import (
    MAX_DATE,
    MIN_DATE,
    ActivityLog,
    Category,
    Priority,
    Project,
    Task,
    User,
)


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
    priority: Priority | None = None
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
    """Fields that are omitted stay unchanged; date fields may be set to null (= TBD) and
    priority to null (= no priority)."""

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
    priority: Priority | None = None
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


class ActorRef(BaseModel):
    """The user behind a change or a creation; `name` is the linked person's name."""

    id: uuid.UUID
    username: str
    name: str

    @classmethod
    def of(cls, user: User | None) -> "ActorRef | None":
        if user is None:
            return None
        return cls(id=user.id, username=user.username, name=user.person.name)


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
    priority: Priority | None
    pics: list[PersonRef]
    created_by: ActorRef | None
    version: int
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    effective_deadline: date | None
    deadline_status: DeadlineStatus
    # 1-based position inside the category (manual order); independent of filters.
    number: int | None = None
    # Non-deleted subtasks at every level, and how many of them are done.
    subtask_total: int = 0
    subtask_done: int = 0
    # Subtasks that matched the search / PIC filter (list responses only), so the
    # client can expand and highlight them.
    matching_task_ids: list[uuid.UUID] = Field(default_factory=list)

    @classmethod
    def from_model(
        cls,
        p: Project,
        today_: date,
        number: int | None = None,
        counts: tuple[int, int] = (0, 0),
        matching_task_ids: list[uuid.UUID] | None = None,
    ) -> "ProjectOut":
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
            priority=p.priority,
            pics=[PersonRef.model_validate(x) for x in p.pics],
            created_by=ActorRef.of(p.created_by),
            version=p.version,
            deleted_at=p.deleted_at,
            created_at=p.created_at,
            updated_at=p.updated_at,
            effective_deadline=effective_deadline(p.plan_date, p.adjusted_plan_date),
            deadline_status=deadline_status(
                p.actual_date, p.plan_date, p.adjusted_plan_date, today_
            ),
            number=number,
            subtask_total=counts[0],
            subtask_done=counts[1],
            matching_task_ids=matching_task_ids or [],
        )


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
    has_more: bool


class ActivityOut(BaseModel):
    id: int
    project_id: uuid.UUID
    # Set when the entry is about a subtask; task_name is the subtask's current name.
    task_id: uuid.UUID | None = None
    task_name: str | None = None
    field: str
    old_value: str | None
    new_value: str | None
    changed_at: datetime
    # None for entries written before logins existed.
    actor: ActorRef | None = None

    @classmethod
    def from_model(cls, a: ActivityLog) -> "ActivityOut":
        return cls(
            id=a.id,
            project_id=a.project_id,
            task_id=a.task_id,
            task_name=a.task.name if a.task is not None else None,
            actor=ActorRef.of(a.actor),
            field=a.field,
            old_value=a.old_value,
            new_value=a.new_value,
            changed_at=a.changed_at,
        )


class TaskCreate(BaseModel):
    """parent_id = None puts the subtask directly under the project."""

    model_config = ConfigDict(extra="forbid")

    name: ProjectName
    parent_id: uuid.UUID | None = None
    notes: LongText = ""
    stage_id: int | None = None  # default: Not Started
    plan_date: OptDate = None
    adjusted_plan_date: OptDate = None
    actual_date: ActualDate = None
    priority: Priority | None = None
    pic_ids: list[uuid.UUID] = Field(default_factory=list)


TASK_NON_NULLABLE_PATCH_FIELDS = ("name", "notes", "stage_id", "pic_ids")


class TaskPatch(BaseModel):
    """Fields that are omitted stay unchanged; date fields may be set to null (= TBD)."""

    model_config = ConfigDict(extra="forbid")

    version: int
    name: ProjectName | None = None
    notes: LongText | None = None
    stage_id: int | None = None
    plan_date: OptDate = None
    adjusted_plan_date: OptDate = None
    actual_date: ActualDate = None
    priority: Priority | None = None
    pic_ids: list[uuid.UUID] | None = None

    @model_validator(mode="after")
    def _no_null_for_required(self) -> "TaskPatch":
        for field in TASK_NON_NULLABLE_PATCH_FIELDS:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TaskOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    parent_id: uuid.UUID | None
    depth: int
    name: str
    notes: str
    stage_id: int
    stage: StageOut
    plan_date: date | None
    adjusted_plan_date: date | None
    actual_date: date | None
    priority: Priority | None
    pics: list[PersonRef]
    created_by: ActorRef | None
    version: int
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    effective_deadline: date | None
    deadline_status: DeadlineStatus

    @classmethod
    def from_model(cls, t: Task, today_: date) -> "TaskOut":
        return cls(
            id=t.id,
            project_id=t.project_id,
            parent_id=t.parent_id,
            depth=t.depth,
            name=t.name,
            notes=t.notes,
            stage_id=t.stage_id,
            stage=StageOut.model_validate(t.stage),
            plan_date=t.plan_date,
            adjusted_plan_date=t.adjusted_plan_date,
            actual_date=t.actual_date,
            priority=t.priority,
            pics=[PersonRef.model_validate(x) for x in t.pics],
            created_by=ActorRef.of(t.created_by),
            version=t.version,
            deleted_at=t.deleted_at,
            created_at=t.created_at,
            updated_at=t.updated_at,
            effective_deadline=effective_deadline(t.plan_date, t.adjusted_plan_date),
            deadline_status=deadline_status(
                t.actual_date, t.plan_date, t.adjusted_plan_date, today_
            ),
        )


class TaskReorderRequest(BaseModel):
    """Move a subtask (with its children) under parent_id (None = directly under the project),
    next to a sibling. No anchor = end of that parent's subtasks."""

    model_config = ConfigDict(extra="forbid")

    task_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    before_id: uuid.UUID | None = None
    after_id: uuid.UUID | None = None
    version: int

    @model_validator(mode="after")
    def _one_anchor(self) -> "TaskReorderRequest":
        if self.before_id is not None and self.after_id is not None:
            raise ValueError("send either before_id or after_id, not both")
        return self


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


USERNAME_PATTERN = r"^[a-z0-9._-]+$"
PASSWORD_MIN = 8
PASSWORD_MAX = 128


def _normalise_username(value: object) -> object:
    # Before the constraints: pydantic checks `pattern` before applying to_lower.
    return value.strip().lower() if isinstance(value, str) else value


Username = Annotated[
    str,
    BeforeValidator(_normalise_username),
    StringConstraints(min_length=2, max_length=50, pattern=USERNAME_PATTERN),
]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]
    new_password: Annotated[
        str, StringConstraints(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    ]


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    person: PersonRef
    is_admin: bool
    must_change_password: bool

    @classmethod
    def from_model(cls, u: User) -> "UserOut":
        return cls(
            id=u.id,
            username=u.username,
            person=PersonRef.model_validate(u.person),
            is_admin=u.is_admin,
            must_change_password=u.must_change_password,
        )


class UserAdminOut(UserOut):
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None
    password_changed_at: datetime | None

    @classmethod
    def from_model(cls, u: User) -> "UserAdminOut":
        return cls(
            **UserOut.from_model(u).model_dump(),
            is_active=u.is_active,
            created_at=u.created_at,
            last_login_at=u.last_login_at,
            password_changed_at=u.password_changed_at,
        )


class UserCreate(BaseModel):
    """The starting password is the username; it must be changed at the first login."""

    model_config = ConfigDict(extra="forbid")

    username: Username
    person_name: PersonName


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_admin: bool | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _no_null(self) -> "UserPatch":
        for field in ("is_admin", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self
