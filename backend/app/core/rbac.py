from app.models.entities import Role

ROLE_HIERARCHY = {
<<<<<<< HEAD
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
=======
    "owner": 4,
    "admin": 3,
    "operator": 2,
    "viewer": 1,
}

PERMISSIONS = {
    "org:read": {"owner", "admin", "operator", "viewer"},
    "org:manage": {"owner", "admin"},
    "org:invite": {"owner", "admin"},
    "org:billing": {"owner"},
    "server:read": {"owner", "admin", "operator", "viewer"},
    "server:write": {"owner", "admin", "operator"},
    "server:delete": {"owner", "admin"},
    "backup:read": {"owner", "admin", "operator", "viewer"},
    "backup:write": {"owner", "admin", "operator"},
    "backup:delete": {"owner", "admin"},
    "backup:run": {"owner", "admin", "operator"},
    "restore:read": {"owner", "admin", "operator", "viewer"},
    "restore:execute": {"owner", "admin", "operator"},
    "policy:read": {"owner", "admin", "operator", "viewer"},
    "policy:write": {"owner", "admin"},
    "alert:read": {"owner", "admin", "operator", "viewer"},
    "alert:manage": {"owner", "admin", "operator"},
    "ai:use": {"owner", "admin", "operator"},
    "settings:read": {"owner", "admin", "operator", "viewer"},
    "settings:write": {"owner", "admin"},
    "audit:read": {"owner", "admin"},
>>>>>>> 4fc4a62 (initial commit)
}


def has_permission(role: Role, permission: str) -> bool:
    allowed = PERMISSIONS.get(permission, set())
    return role in allowed


def role_at_least(role: Role, minimum: Role) -> bool:
    return ROLE_HIERARCHY.get(role, 0) >= ROLE_HIERARCHY.get(minimum, 0)
