"""Business "today" is computed in APP_TIMEZONE, never from the server's local clock."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.config import get_settings


def now_utc() -> datetime:
    return datetime.now(ZoneInfo("UTC"))


def today() -> date:
    return datetime.now(ZoneInfo(get_settings().app_timezone)).date()
