"""Role normalization — always use lowercase DB enum values (owner, admin, ...)."""

from app.models.entities import Role

VALID_ROLES = frozenset({r.value for r in Role})


def normalize_role(value: Role | str) -> Role:
    """Parse and validate a role; rejects uppercase names like OWNER."""
    if isinstance(value, Role):
        return value

    if not isinstance(value, str):
        raise ValueError("Invalid role type")

    cleaned = value.strip().lower()
    if not cleaned:
        raise ValueError("Role cannot be empty")

    # Reject enum member names accidentally passed as strings
    if cleaned.upper() in {"OWNER", "ADMIN", "OPERATOR", "VIEWER"} and cleaned not in VALID_ROLES:
        raise ValueError(f"Use lowercase role value, not enum name: {value}")

    try:
        return Role(cleaned)
    except ValueError as e:
        raise ValueError(f"Invalid role: {value}. Must be one of: {', '.join(sorted(VALID_ROLES))}") from e


def role_to_str(value: Role | str) -> str:
    """API responses always return lowercase role strings."""
    return normalize_role(value).value
