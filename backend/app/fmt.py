"""Date display format used everywhere: "Tue, Oct 06, 26"."""

import re
from datetime import date

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DISPLAY = re.compile(r"^(?:[A-Za-z]{3},\s*)?([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{2}|\d{4})$")


def format_date(value: date | None, empty: str = "TBD") -> str:
    if value is None:
        return empty
    day, month = DAYS[value.weekday()], MONTHS[value.month - 1]
    return f"{day}, {month} {value.day:02d}, {value.year % 100:02d}"


def parse_date(text: str) -> date | None:
    """Accepts ISO (2026-10-06) or display format. Blank / TBD -> None. Raises ValueError."""
    value = text.strip()
    if value == "" or value.upper() == "TBD":
        return None
    iso = _ISO.match(value)
    if iso:
        return date(int(iso[1]), int(iso[2]), int(iso[3]))
    disp = _DISPLAY.match(value)
    if disp:
        month_name = disp[1].capitalize()
        if month_name not in MONTHS:
            raise ValueError(f"Unrecognised month '{disp[1]}'")
        year = int(disp[3])
        if year < 100:
            year += 2000
        return date(year, MONTHS.index(month_name) + 1, int(disp[2]))
    raise ValueError(f"Invalid date '{value}'. Use YYYY-MM-DD or 'Tue, Oct 06, 26', or TBD")
