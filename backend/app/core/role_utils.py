from app.models.entities import Role

def normalize_role(value) -> Role:
    if isinstance(value, Role):
        return value

    if not isinstance(value, str):
        raise ValueError("Invalid role type")

    value = value.strip().lower()

    try:
        return Role(value)
    except Exception:
        raise ValueError(f"Invalid role: {value}")
