"""
Utility functions for normalizing period formats.

The model is monthly: every statement, report and rule works on ``YYYY-MM``
periods. Imported spreadsheets write months in many ways, so
``normalize_period`` turns the common ones into ``YYYY-MM``:

=======================================  ==========
input                                    result
=======================================  ==========
``2027-01``, ``2027-1``, ``2027/01``     ``2027-01``
``1/2027``, ``01/2027``, ``1-2027``      ``2027-01``
``1/15/2027``, ``01/15/2027``, ``1/15/27``  ``2027-01`` (US month/day/year)
``2027-01-15``, ``2027-01-15T00:00:00``  ``2027-01``
``Jan-27``, ``Jan 2027``, ``Jan-2027``   ``2027-01``
``January 2027``, ``2027 Jan``           ``2027-01``
``46388`` (Excel serial date)            ``2027-01``
``datetime.date(2027, 1, 15)``           ``2027-01``
=======================================  ==========

Quarter (``YYYY-QX``) and week (``YYYY-WXX``) forms are still recognised and
returned unchanged, but they are not months: callers that write sales use
``period_kind`` / ``normalize_month`` to reject them with a clear message.
"""
import re
from datetime import date, datetime, timedelta
from typing import Any, Optional

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
# Excel stores dates as days since 1899-12-30 (this epoch absorbs Excel's
# 1900 leap-year bug for every date after February 1900).
_EXCEL_EPOCH = date(1899, 12, 30)
_EXCEL_SERIAL_MIN = 30000   # 1982-02-18
_EXCEL_SERIAL_MAX = 80000   # 2119-01-11

_MONTHLY_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_QUARTER_RE = re.compile(r"^(\d{4})-[Qq]([1-4])$")
_WEEK_RE = re.compile(r"^(\d{4}-W\d{2})(-\d{2})?$")

# 2027-01 / 2027-1 / 2027/01 / 2027.01
_YEAR_MONTH_RE = re.compile(r"^(\d{4})[-/.](\d{1,2})$")
# 2027-01-15 / 2027/01/15, optionally followed by a time (T00:00:00, " 00:00:00")
_YEAR_MONTH_DAY_RE = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$")
# 1/2027 / 01/2027 / 1-2027
_MONTH_YEAR_RE = re.compile(r"^(\d{1,2})[-/.](\d{4})$")
# 1/15/2027 / 01/15/2027 / 1/15/27 (US month/day/year), optionally followed by a time
_MONTH_DAY_YEAR_RE = re.compile(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:\s.*)?$")
# Jan-27 / Jan 2027 / January 2027 / Jan-2027 / Jan'27 / Sept. 2027
_NAME_YEAR_RE = re.compile(r"^([A-Za-z]{3,9})\.?[\s\-/,']*(\d{4}|\d{2})$")
# 2027 Jan / 2027-Jan / 2027 January
_YEAR_NAME_RE = re.compile(r"^(\d{4})[\s\-/,]*([A-Za-z]{3,9})\.?$")
# Excel serial date written as text: "46388" or "46388.0"
_SERIAL_TEXT_RE = re.compile(r"^\d{5}(\.0+)?$")


def _month_from_name(token: str) -> Optional[int]:
    """'Jan', 'jan', 'January', 'Sept' -> month number; None when not a month name."""
    text = token.strip().lower()
    if len(text) < 3:
        return None
    for name, number in _MONTHS.items():
        if name.startswith(text):
            return number
    return None


def month_from_name(value: Any) -> Optional[int]:
    """
    Month number for a bare month name ('Jan', 'january', 'Sept.'), else None.

    Used for spreadsheets whose month columns carry no year (Jan .. Dec with
    a separate Year column); combine with ``month_in_year``.
    """
    if not isinstance(value, str):
        return None
    text = value.strip().rstrip(".")
    if not text.isalpha():
        return None
    return _month_from_name(text)


def month_in_year(month: int, year: Any) -> Optional[str]:
    """'YYYY-MM' for a month number and a year (2027, '2027', 2027.0, '27'); None when the year is unusable."""
    if year is None or isinstance(year, bool):
        return None
    text = str(year).strip()
    if re.match(r"^\d{4}(\.0+)?$", text):
        return _format(int(float(text)), month)
    if re.match(r"^\d{2}$", text):
        return _format(2000 + int(text), month)
    return None


def _year(token: str) -> int:
    value = int(token)
    return 2000 + value if len(token) == 2 else value


def _format(year: int, month: int) -> Optional[str]:
    if 1 <= month <= 12 and 1900 <= year <= 2999:
        return f"{year:04d}-{month:02d}"
    return None


def _from_excel_serial(serial: float) -> Optional[str]:
    if not (_EXCEL_SERIAL_MIN <= serial <= _EXCEL_SERIAL_MAX):
        return None
    d = _EXCEL_EPOCH + timedelta(days=int(serial))
    return f"{d.year:04d}-{d.month:02d}"


def normalize_period(period: Any) -> Optional[str]:
    """
    Normalize a period to the model's format.

    Monthly inputs in any of the forms listed in the module docstring become
    ``YYYY-MM``. ``YYYY-QX`` and ``YYYY-WXX`` (optionally ``YYYY-WXX-DD``) are
    returned as ``YYYY-QX`` / ``YYYY-WXX``. Excel serial dates are accepted
    as int / float values or digit strings between 30000 and 80000. Returns
    None when the value is blank or not a recognisable period.
    """
    if period is None or isinstance(period, bool):
        return None
    if isinstance(period, (datetime, date)):
        return _format(period.year, period.month)
    if isinstance(period, (int, float)):
        if period != period:  # NaN
            return None
        return _from_excel_serial(float(period))

    period_str = str(period).strip()
    if not period_str:
        return None

    # Already a month
    if _MONTHLY_RE.match(period_str):
        return period_str

    if _SERIAL_TEXT_RE.match(period_str):
        return _from_excel_serial(float(period_str))

    # Quarterly format: YYYY-QX (kept as a quarter)
    quarterly_match = _QUARTER_RE.match(period_str)
    if quarterly_match:
        return f"{quarterly_match.group(1)}-Q{quarterly_match.group(2)}"

    # Weekly format: YYYY-WXX-DD or YYYY-WXX (kept as a week)
    weekly_match = _WEEK_RE.match(period_str)
    if weekly_match:
        return weekly_match.group(1)

    match = _YEAR_MONTH_RE.match(period_str)
    if match:
        return _format(int(match.group(1)), int(match.group(2)))

    match = _YEAR_MONTH_DAY_RE.match(period_str)
    if match:
        if not 1 <= int(match.group(3)) <= 31:
            return None
        return _format(int(match.group(1)), int(match.group(2)))

    match = _MONTH_YEAR_RE.match(period_str)
    if match:
        return _format(int(match.group(2)), int(match.group(1)))

    match = _MONTH_DAY_YEAR_RE.match(period_str)
    if match:
        if not 1 <= int(match.group(2)) <= 31:
            return None
        return _format(_year(match.group(3)), int(match.group(1)))

    match = _NAME_YEAR_RE.match(period_str)
    if match:
        month = _month_from_name(match.group(1))
        return _format(_year(match.group(2)), month) if month else None

    match = _YEAR_NAME_RE.match(period_str)
    if match:
        month = _month_from_name(match.group(2))
        return _format(int(match.group(1)), month) if month else None

    # If no match, return None (invalid format)
    return None


def period_kind(period: Optional[str]) -> Optional[str]:
    """'month', 'quarter' or 'week' for an already-normalized period; None otherwise."""
    if not period:
        return None
    if _MONTHLY_RE.match(period):
        return "month"
    if _QUARTER_RE.match(period):
        return "quarter"
    if _WEEK_RE.match(period):
        return "week"
    return None


def normalize_month(period: Any) -> Optional[str]:
    """normalize_period restricted to months: quarters, weeks and junk give None."""
    normalized = normalize_period(period)
    return normalized if period_kind(normalized) == "month" else None


def is_valid_period(period: str) -> bool:
    """
    Check if a period string is in a valid format (can be normalized).
    """
    return normalize_period(period) is not None
