"""
Utility functions for normalizing period formats
"""
import re
from typing import Optional


def normalize_period(period: str) -> Optional[str]:
    """
    Normalize period strings to standard format.
    
    Accepts:
    - YYYY-MM-DD -> YYYY-MM
    - YYYY-MM -> YYYY-MM (no change)
    - YYYY-WXX-DD -> YYYY-WXX
    - YYYY-WXX -> YYYY-WXX (no change)
    - YYYY-QX -> YYYY-QX (no change)
    
    Returns normalized period or None if invalid
    """
    if not period:
        return None
    
    period_str = str(period).strip()
    
    # Monthly format: YYYY-MM-DD or YYYY-MM
    monthly_match = re.match(r'^(\d{4}-\d{2})(-\d{2})?$', period_str)
    if monthly_match:
        return monthly_match.group(1)  # Return YYYY-MM part
    
    # Quarterly format: YYYY-QX
    quarterly_match = re.match(r'^(\d{4}-Q[1-4])$', period_str)
    if quarterly_match:
        return quarterly_match.group(1)
    
    # Weekly format: YYYY-WXX-DD or YYYY-WXX
    weekly_match = re.match(r'^(\d{4}-W\d{2})(-\d{2})?$', period_str)
    if weekly_match:
        return weekly_match.group(1)  # Return YYYY-WXX part
    
    # If no match, return None (invalid format)
    return None


def is_valid_period(period: str) -> bool:
    """
    Check if a period string is in a valid format (can be normalized).
    """
    return normalize_period(period) is not None


