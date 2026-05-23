from app.core.role_utils import normalize_role
from app.models.entities import Role

ROLE_HIERARCHY = {
    Role.OWNER: 4,
    Role.ADMIN: 3,
    Role.OPERATOR: 2,
    Role.VIEWER: 1,
}

PERMISSIONS = {
    "org:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "org:manage": {Role.OWNER, Role.ADMIN},
    "org:invite": {Role.OWNER, Role.ADMIN},
    "org:billing": {Role.OWNER},
    "server:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "server:write": {Role.OWNER, Role.ADMIN, Role.OPERATOR},
    "server:delete": {Role.OWNER, Role.ADMIN},
    "backup:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "backup:write": {Role.OWNER, Role.ADMIN, Role.OPERATOR},
    "backup:delete": {Role.OWNER, Role.ADMIN},
    "backup:run": {Role.OWNER, Role.ADMIN, Role.OPERATOR},
    "restore:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "restore:execute": {Role.OWNER, Role.ADMIN, Role.OPERATOR},
    "policy:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "policy:write": {Role.OWNER, Role.ADMIN},
    "alert:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "alert:manage": {Role.OWNER, Role.ADMIN, Role.OPERATOR},
    "ai:use": {Role.OWNER, Role.ADMIN, Role.OPERATOR},
    "settings:read": {Role.OWNER, Role.ADMIN, Role.OPERATOR, Role.VIEWER},
    "settings:write": {Role.OWNER, Role.ADMIN},
    "audit:read": {Role.OWNER, Role.ADMIN},
}


def has_permission(role: Role | str, permission: str) -> bool:
    role_enum = normalize_role(role)
    allowed = PERMISSIONS.get(permission, set())
    return role_enum in allowed


def role_at_least(role: Role | str, minimum: Role | str) -> bool:
    r = normalize_role(role)
    m = normalize_role(minimum)
    return ROLE_HIERARCHY.get(r, 0) >= ROLE_HIERARCHY.get(m, 0)
