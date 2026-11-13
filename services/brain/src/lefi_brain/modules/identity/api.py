"""HTTP layer for identity: login/logout/session, `/me`, password change, role matrix, and
the `current_principal` / `require(permission)` dependencies every other router uses.

Tokens travel in the `lefi_session` cookie (HttpOnly, SameSite=Strict) — what Lefi Desktop
keeps in Rust — or as `Authorization: Bearer <token>` for clients that ask for it at login.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_responses
from lefi_brain.core.net import client_ip, reached_over_https
from lefi_brain.modules.audit.application import AuditQuery, AuditService
from lefi_brain.modules.audit.domain import AuditEntry, Outcome
from lefi_brain.modules.identity.application import (
    IdentityService,
    InvalidCredentialsError,
    LastAdminError,
    LoginLockedError,
    SelfChangeError,
    UserExistsError,
    UserNotFoundError,
    WrongPasswordError,
    temporary_password,
    user_actor,
)
from lefi_brain.modules.identity.domain import (
    LOCKOUT_PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSIONS,
    ROLE_NAMES,
    IdentityError,
    InvalidProfileError,
    InvalidUsernameError,
    Principal,
    Role,
    User,
    UserStatus,
    WeakPasswordError,
    permissions_for,
)

COOKIE_NAME = "lefi_session"
COOKIE_PATH = "/api"

router = APIRouter(prefix="/api/v1", tags=["identity"], responses=error_responses(422))


# --------------------------------------------------------------------------- wiring


def identity_service(request: Request) -> IdentityService:
    service: IdentityService = request.app.state.identity
    return service


def audit_service(request: Request) -> AuditService:
    service: AuditService = request.app.state.audit
    return service


def _cookie_secure(request: Request) -> bool:
    """`Secure` whenever the client reached us over TLS (ADR-025), or when forced by settings."""
    forced = bool(getattr(request.app.state, "session_cookie_secure", False))
    return forced or reached_over_https(request)


def token_from(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(COOKIE_NAME) or None


class NotAuthenticated(Exception):
    pass


class PermissionDenied(Exception):
    def __init__(self, permission: str) -> None:
        super().__init__(permission)
        self.permission = permission


class PasswordChangeRequired(Exception):
    """The account must change its password before anything else (bootstrap admin, reset)."""


async def current_principal(
    request: Request, identity: Annotated[IdentityService, Depends(identity_service)]
) -> Principal:
    token = token_from(request)
    principal = await identity.authenticate(token) if token else None
    if principal is None:
        raise NotAuthenticated()
    request.state.user_id = str(principal.user.id)
    return principal


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def require(permission: str) -> Callable[..., Awaitable[Principal]]:
    """Dependency factory: `Depends(require("alerts.ack"))`. Denials are audited."""
    if permission not in PERMISSIONS:
        raise ValueError(f"unknown permission {permission!r}")  # typo guard at import time

    async def dependency(
        request: Request,
        principal: CurrentPrincipal,
        audit: Annotated[AuditService, Depends(audit_service)],
    ) -> Principal:
        if principal.user.must_change_password:
            raise PasswordChangeRequired()
        if not principal.can(permission):
            await audit.record(
                "authz.denied",
                user_actor(principal.user),
                outcome=Outcome.DENIED,
                request_id=getattr(request.state, "request_id", None),
                details={"permission": permission, "path": request.url.path},
            )
            raise PermissionDenied(permission)
        return principal

    return dependency


async def signed_in(principal: CurrentPrincipal) -> Principal:
    """Anyone signed in who has already chosen their own password (personal data: notifications)."""
    if principal.user.must_change_password:
        raise PasswordChangeRequired()
    return principal


SignedIn = Annotated[Principal, Depends(signed_in)]


# --------------------------------------------------------------------------- schemas


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255, description="Username (work email later)")
    password: str = Field(min_length=1, max_length=256)
    token_transport: Literal["cookie", "bearer"] = "cookie"  # noqa: S105 - not a secret


class SessionUserOut(BaseModel):
    id: str
    username: str
    email: str | None
    display_name: str


class RoleOut(BaseModel):
    id: str
    name: str
    short: str


class SessionInfo(BaseModel):
    id: str
    expires_at: datetime
    idle_timeout_s: int


class SessionOut(BaseModel):
    user: SessionUserOut
    role: RoleOut
    permissions: list[str]
    must_change_password: bool
    session: SessionInfo
    token: str | None = Field(default=None, description="Only with token_transport=bearer")


class PermissionsOut(BaseModel):
    role: str
    permissions: list[str]


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class PermissionOut(BaseModel):
    id: str
    label: str
    roles: list[str]
    lockout: bool = Field(description="The last active administrator can never lose it")


class PermissionGroupOut(BaseModel):
    name: str
    permissions: list[PermissionOut]


class RoleMatrixOut(BaseModel):
    roles: list[RoleOut]
    permissions: dict[str, list[str]]
    groups: list[PermissionGroupOut]
    editable: Literal[False] = Field(
        default=False,
        description="The matrix is part of Lefi Brain (ADR-025); it changes only with a release",
    )


def role_out(role: Role) -> RoleOut:
    name, short = ROLE_NAMES[role]
    return RoleOut(id=role.value, name=name, short=short)


def session_out(principal: Principal, idle_s: int, token: str | None = None) -> SessionOut:
    user = principal.user
    return SessionOut(
        user=SessionUserOut(
            id=str(user.id),
            username=user.username,
            email=user.email,
            display_name=user.display_name,
        ),
        role=role_out(user.role),
        permissions=sorted(principal.permissions),
        must_change_password=user.must_change_password,
        session=SessionInfo(
            id=str(principal.session.id),
            expires_at=principal.session.expires_at,
            idle_timeout_s=idle_s,
        ),
        token=token,
    )


# --------------------------------------------------------------------------- routes


@router.post(
    "/auth/login",
    response_model=SessionOut,
    response_model_exclude_none=True,
    responses=error_responses(401, 429),
)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> SessionOut:
    result = await identity.login(
        body.username,
        body.password,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", None),
    )
    request.state.user_id = str(result.principal.user.id)
    idle_s = int(identity.policy.idle.total_seconds())
    if body.token_transport == "bearer":  # noqa: S105 - not a secret
        return session_out(result.principal, idle_s, token=result.token)
    response.set_cookie(
        COOKIE_NAME,
        result.token,
        httponly=True,
        samesite="strict",
        secure=_cookie_secure(request),
        path=COOKIE_PATH,
        max_age=int(identity.policy.absolute.total_seconds()),
    )
    return session_out(result.principal, idle_s)


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> None:
    token = token_from(request)
    principal = await identity.authenticate(token) if token else None
    if principal is not None:
        await identity.logout(principal, getattr(request.state, "request_id", None))
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH)


@router.get(
    "/auth/session",
    response_model=SessionOut,
    response_model_exclude_none=True,
    responses=error_responses(401),
)
@router.get(
    "/me",
    response_model=SessionOut,
    response_model_exclude_none=True,
    responses=error_responses(401),
)
async def me(
    principal: CurrentPrincipal, identity: Annotated[IdentityService, Depends(identity_service)]
) -> SessionOut:
    return session_out(principal, int(identity.policy.idle.total_seconds()))


@router.get("/me/permissions", response_model=PermissionsOut, responses=error_responses(401))
async def my_permissions(principal: CurrentPrincipal) -> PermissionsOut:
    return PermissionsOut(role=principal.user.role.value, permissions=sorted(principal.permissions))


@router.post(
    "/auth/password",
    response_model=SessionOut,
    response_model_exclude_none=True,
    responses=error_responses(401, 403),
)
async def change_password(
    body: PasswordChange,
    request: Request,
    principal: CurrentPrincipal,
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> SessionOut:
    user = await identity.change_password(
        principal,
        body.current_password,
        body.new_password,
        getattr(request.state, "request_id", None),
    )
    updated = Principal(user=user, session=principal.session, permissions=principal.permissions)
    return session_out(updated, int(identity.policy.idle.total_seconds()))


@router.get("/roles", response_model=RoleMatrixOut, responses=error_responses(401, 403))
async def roles(_: Annotated[Principal, Depends(require("admin.roles"))]) -> RoleMatrixOut:
    return RoleMatrixOut(
        roles=[role_out(r) for r in Role],
        permissions={p: sorted(r.value for r in roles) for p, roles in sorted(PERMISSIONS.items())},
        groups=[
            PermissionGroupOut(
                name=name,
                permissions=[
                    PermissionOut(
                        id=pid,
                        label=label,
                        roles=[r.value for r in Role if r in PERMISSIONS[pid]],
                        lockout=pid in LOCKOUT_PERMISSIONS,
                    )
                    for pid, label in rows
                ],
            )
            for name, rows in PERMISSION_GROUPS
        ],
    )


# --------------------------------------------------------------------------- users (Workforce)


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    role: RoleOut
    status: Literal["active", "disabled"]
    must_change_password: bool = Field(description="Signs in with a temporary password")
    locked_until: datetime | None = Field(description="Too many failed sign-ins")
    created_at: datetime
    last_login_at: datetime | None
    active_sessions: int
    is_you: bool


class UserListOut(BaseModel):
    users: list[UserOut]
    roles: list[RoleOut]
    can_manage: bool = Field(description="The caller holds `user.manage`")


class UserSessionOut(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool = Field(description="The session making this request")


class UserChangeOut(BaseModel):
    at: datetime
    action: str
    outcome: str
    by: str
    details: dict[str, Any]


class UserDetailOut(UserOut):
    permissions: list[str]
    sessions: list[UserSessionOut] | None = Field(description="Only for `user.manage`")
    recent: list[UserChangeOut] | None = Field(description="Only for `admin.audit`")


class UserIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    display_name: str = Field(default="", max_length=128)
    email: str | None = Field(default=None, max_length=255)
    role: Role
    password: str | None = Field(
        default=None,
        max_length=256,
        description="Temporary password; omitted = Lefi Brain makes one and returns it once",
    )


class UserPatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=128)
    email: str | None = Field(default=None, max_length=255, description="Empty string removes it")
    role: Role | None = None
    status: Literal["active", "disabled"] | None = None


class PasswordResetIn(BaseModel):
    password: str | None = Field(
        default=None,
        max_length=256,
        description="Temporary password; omitted = Lefi Brain makes one and returns it once",
    )


class UserWithPasswordOut(BaseModel):
    user: UserOut
    temporary_password: str | None = Field(
        description="Shown once, only when Lefi Brain made it; never stored in clear"
    )


class RevokedOut(BaseModel):
    revoked: int


def user_out(user: User, sessions: int, me: Principal) -> UserOut:
    return UserOut(
        id=str(user.id),
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        role=role_out(user.role),
        status="active" if user.active else "disabled",
        must_change_password=user.must_change_password,
        locked_until=user.locked_until,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        active_sessions=sessions,
        is_you=user.id == me.user.id,
    )


def _user_id(raw: str) -> UUID:
    try:
        return UUID(raw)
    except ValueError as exc:
        raise UserNotFoundError("no such user") from exc


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


async def _one(identity: IdentityService, user: User, me: Principal) -> UserOut:
    counts = await identity.active_session_counts()
    return user_out(user, counts.get(user.id, 0), me)


def _change(entry: AuditEntry, names: dict[str, str]) -> UserChangeOut:
    by = names.get(entry.actor.id) or (
        "Lefi Brain" if entry.actor.type.value == "system" else entry.actor.id
    )
    return UserChangeOut(
        at=entry.at,
        action=entry.action,
        outcome=entry.outcome.value,
        by=by,
        details=entry.details,
    )


@router.get("/users", response_model=UserListOut, responses=error_responses(401, 403))
async def list_users(
    principal: Annotated[Principal, Depends(require("nav.workforce"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> UserListOut:
    counts = await identity.active_session_counts()
    users = await identity.list_users()
    return UserListOut(
        users=[user_out(u, counts.get(u.id, 0), principal) for u in users],
        roles=[role_out(r) for r in Role],
        can_manage=principal.can("user.manage"),
    )


@router.post(
    "/users", status_code=201, response_model=UserWithPasswordOut, responses=error_responses(409)
)
async def create_user(
    body: UserIn,
    principal: Annotated[Principal, Depends(require("user.manage"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> UserWithPasswordOut:
    generated = None if body.password else temporary_password()
    user = await identity.create_user(
        body.username,
        display_name=body.display_name,
        email=body.email,
        role=body.role,
        password=body.password or generated or "",
        actor=user_actor(principal.user),
        must_change_password=True,
    )
    return UserWithPasswordOut(user=user_out(user, 0, principal), temporary_password=generated)


@router.get("/users/{user_id}", response_model=UserDetailOut, responses=error_responses(404))
async def get_user(
    user_id: str,
    principal: Annotated[Principal, Depends(require("nav.workforce"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
    audit: Annotated[AuditService, Depends(audit_service)],
) -> UserDetailOut:
    user = await identity.get_user_by_id(_user_id(user_id))
    base = await _one(identity, user, principal)
    sessions = None
    if principal.can("user.manage"):
        sessions = [
            UserSessionOut(
                id=str(s.id),
                created_at=s.created_at,
                last_seen_at=s.last_seen_at,
                expires_at=s.expires_at,
                ip=s.ip,
                user_agent=s.user_agent,
                current=s.id == principal.session.id,
            )
            for s in await identity.active_sessions(user.username)
        ]
    recent = None
    if principal.can("admin.audit"):
        names = {str(u.id): u.display_name for u in await identity.list_users()}
        entries = await audit.page(AuditQuery(limit=15, subject=str(user.id)))
        recent = [_change(e, names) for e in entries]
    return UserDetailOut(
        **base.model_dump(),
        permissions=permissions_for(user.role),
        sessions=sessions,
        recent=recent,
    )


@router.patch("/users/{user_id}", response_model=UserOut, responses=error_responses(404, 409))
async def update_user(
    user_id: str,
    body: UserPatch,
    principal: Annotated[Principal, Depends(require("user.manage"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> UserOut:
    email = body.email.strip() if body.email is not None else None
    user = await identity.update_user(
        _user_id(user_id),
        by=principal.user,
        actor=user_actor(principal.user),
        display_name=body.display_name,
        email=email or None,
        clear_email=body.email is not None and not email,
        role=body.role,
        status=UserStatus(body.status) if body.status else None,
    )
    return await _one(identity, user, principal)


@router.post(
    "/users/{user_id}/password",
    response_model=UserWithPasswordOut,
    responses=error_responses(404),
)
async def reset_user_password(
    user_id: str,
    body: PasswordResetIn,
    principal: Annotated[Principal, Depends(require("user.manage"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> UserWithPasswordOut:
    target = _user_id(user_id)
    if target == principal.user.id:
        raise SelfChangeError("change your own password with your current one instead")
    user, generated = await identity.admin_reset_password(
        target, body.password, user_actor(principal.user)
    )
    return UserWithPasswordOut(
        user=await _one(identity, user, principal), temporary_password=generated
    )


@router.post(
    "/users/{user_id}/sessions/revoke",
    response_model=RevokedOut,
    responses=error_responses(404, 409),
)
async def revoke_user_sessions(
    user_id: str,
    principal: Annotated[Principal, Depends(require("user.manage"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> RevokedOut:
    target = _user_id(user_id)
    if target == principal.user.id:
        raise SelfChangeError("sign out instead of ending your own sessions here")
    return RevokedOut(revoked=await identity.revoke_sessions_of(target, user_actor(principal.user)))


@router.post("/users/{user_id}/unlock", response_model=UserOut, responses=error_responses(404))
async def unlock_user(
    user_id: str,
    principal: Annotated[Principal, Depends(require("user.manage"))],
    identity: Annotated[IdentityService, Depends(identity_service)],
) -> UserOut:
    user = await identity.unlock(_user_id(user_id), user_actor(principal.user))
    return await _one(identity, user, principal)


# --------------------------------------------------------------------------- errors

_STATUS: dict[type[IdentityError], int] = {
    InvalidCredentialsError: 401,
    LoginLockedError: 429,
    InvalidUsernameError: 422,
    WeakPasswordError: 422,
    InvalidProfileError: 422,
    SelfChangeError: 409,
    UserExistsError: 409,
    LastAdminError: 409,
    UserNotFoundError: 404,
    WrongPasswordError: 403,
}


def _body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def install_identity_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotAuthenticated)
    async def _unauthenticated(_: Request, __: NotAuthenticated) -> JSONResponse:
        return JSONResponse(_body("NOT_AUTHENTICATED", "sign in first"), status_code=401)

    @app.exception_handler(PermissionDenied)
    async def _denied(_: Request, exc: PermissionDenied) -> JSONResponse:
        return JSONResponse(
            _body("FORBIDDEN", "your role does not allow this", {"permission": exc.permission}),
            status_code=403,
        )

    @app.exception_handler(PasswordChangeRequired)
    async def _must_change(_: Request, __: PasswordChangeRequired) -> JSONResponse:
        return JSONResponse(
            _body("PASSWORD_CHANGE_REQUIRED", "change your password before continuing"),
            status_code=403,
        )

    @app.exception_handler(IdentityError)
    async def _identity(_: Request, exc: IdentityError) -> JSONResponse:
        status = _STATUS.get(type(exc), 400)
        headers = {}
        details: dict[str, Any] = {}
        if isinstance(exc, LoginLockedError):
            headers["Retry-After"] = str(exc.retry_after_s)
            details["retry_after_s"] = exc.retry_after_s
        return JSONResponse(_body(exc.code, str(exc), details), status_code=status, headers=headers)
