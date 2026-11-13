"""Identity use cases: bootstrap admin, users, login, sessions. Every change is audited."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor, ActorType, Outcome
from lefi_brain.modules.identity.domain import (
    IdentityError,
    Principal,
    Role,
    Session,
    SessionPolicy,
    User,
    UserStatus,
    check_password_policy,
    clean_display_name,
    clean_email,
    normalise_username,
    permissions_for,
)

# --------------------------------------------------------------------------- errors


class InvalidCredentialsError(IdentityError):
    """Unknown user, wrong password or disabled account — never say which."""

    code = "INVALID_CREDENTIALS"


class LoginLockedError(IdentityError):
    code = "LOGIN_LOCKED"

    def __init__(self, retry_after_s: int) -> None:
        super().__init__(f"too many failed attempts; try again in {retry_after_s} s")
        self.retry_after_s = retry_after_s


class UserNotFoundError(IdentityError):
    code = "USER_NOT_FOUND"


class UserExistsError(IdentityError):
    code = "USER_EXISTS"


class LastAdminError(IdentityError):
    code = "LAST_ADMIN"


class WrongPasswordError(IdentityError):
    code = "WRONG_PASSWORD"


class SelfChangeError(IdentityError):
    """An administrator cannot take away their own access from Lefi Desktop."""

    code = "SELF_CHANGE"


def temporary_password() -> str:
    """16 characters from an unambiguous alphabet (about 82 bits); changed at first sign-in."""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(16))
    return "-".join(raw[i : i + 4] for i in range(0, 16, 4))


# --------------------------------------------------------------------------- ports


class PasswordHasher(Protocol):
    def hash(self, password: str) -> str: ...

    def verify(self, password_hash: str, password: str) -> bool: ...

    def needs_rehash(self, password_hash: str) -> bool: ...


class UserRepository(Protocol):
    async def count(self) -> int: ...

    async def count_active_admins(self) -> int: ...

    async def get(self, user_id: UUID) -> User | None: ...

    async def by_username(self, username: str) -> User | None: ...

    async def password_hash(self, user_id: UUID) -> str | None: ...

    async def add(self, user: User, password_hash: str) -> None:
        """Raise UserExistsError on a duplicate username."""
        ...

    async def save(self, user: User) -> None: ...

    async def set_password(self, user_id: UUID, password_hash: str, must_change: bool) -> None: ...

    async def list(self) -> list[User]: ...


class SessionRepository(Protocol):
    async def add(self, session: Session, token_hash: str) -> None: ...

    async def by_token_hash(self, token_hash: str) -> Session | None: ...

    async def touch(self, session_id: UUID, at: datetime) -> None: ...

    async def revoke(self, session_id: UUID, at: datetime, reason: str) -> None: ...

    async def revoke_user(
        self, user_id: UUID, at: datetime, reason: str, keep: UUID | None = None
    ) -> int: ...

    async def active_for(self, user_id: UUID, now: datetime) -> list[Session]: ...

    async def active_counts(self, now: datetime) -> dict[UUID, int]: ...

    async def count_active(self, now: datetime) -> int: ...

    async def prune(self, before: datetime) -> int: ...


# --------------------------------------------------------------------------- service


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def user_actor(user: User) -> Actor:
    return Actor(ActorType.USER, str(user.id))


@dataclass(frozen=True)
class LoginResult:
    principal: Principal
    token: str


class IdentityService:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        audit: AuditService,
        clock: Clock,
        policy: SessionPolicy,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._hasher = hasher
        self._audit = audit
        self._clock = clock
        self.policy = policy
        # Verified when the username does not exist, so timing does not reveal it.
        self._dummy_hash = hasher.hash(secrets.token_urlsafe(16))

    # ---------------------------------------------------------------- users

    async def user_count(self) -> int:
        return await self._users.count()

    async def list_users(self) -> list[User]:
        return await self._users.list()

    async def get_user(self, username: str) -> User:
        user = await self._users.by_username(normalise_username(username))
        if user is None:
            raise UserNotFoundError(f"no user '{username}'")
        return user

    async def create_user(
        self,
        username: str,
        *,
        display_name: str,
        role: Role,
        password: str,
        actor: Actor,
        email: str | None = None,
        must_change_password: bool = True,
    ) -> User:
        name = normalise_username(username)
        check_password_policy(password, username=name)
        now = self._clock.now()
        user = User(
            id=new_id(),
            username=name,
            display_name=clean_display_name(display_name, name),
            email=clean_email(email),
            role=role,
            status=UserStatus.ACTIVE,
            must_change_password=must_change_password,
            failed_logins=0,
            locked_until=None,
            created_at=now,
            last_login_at=None,
        )
        await self._users.add(user, self._hasher.hash(password))
        await self._audit.record(
            "user.created",
            actor,
            target_type="user",
            target_id=str(user.id),
            details={"username": name, "role": role.value},
        )
        return user

    async def bootstrap_admin(self, username: str | None, password: str | None) -> User | None:
        """First start: create the installer's administrator if no user exists yet."""
        if await self._users.count() > 0 or not username or not password:
            return None
        return await self.create_user(
            username,
            display_name="Administrator",
            role=Role.ADMIN,
            password=password,
            actor=Actor.system(),
            must_change_password=True,
        )

    async def set_role(self, username: str, role: Role, actor: Actor) -> User:
        user = await self.get_user(username)
        if user.role is role:
            return user
        await self._guard_last_admin(user, losing_admin=user.role is Role.ADMIN)
        updated = replace(user, role=role)
        await self._users.save(updated)
        revoked = await self._sessions.revoke_user(user.id, self._clock.now(), "role changed")
        await self._audit.record(
            "user.role_changed",
            actor,
            target_type="user",
            target_id=str(user.id),
            details={"from": user.role.value, "to": role.value, "sessions_revoked": revoked},
        )
        return updated

    async def set_status(self, username: str, status: UserStatus, actor: Actor) -> User:
        user = await self.get_user(username)
        if user.status is status:
            return user
        if status is UserStatus.DISABLED:
            await self._guard_last_admin(user, losing_admin=user.role is Role.ADMIN)
        updated = replace(user, status=status, failed_logins=0, locked_until=None)
        await self._users.save(updated)
        revoked = 0
        if status is UserStatus.DISABLED:
            revoked = await self._sessions.revoke_user(user.id, self._clock.now(), "disabled")
        await self._audit.record(
            "user.disabled" if status is UserStatus.DISABLED else "user.enabled",
            actor,
            target_type="user",
            target_id=str(user.id),
            details={"username": user.username, "sessions_revoked": revoked},
        )
        return updated

    async def reset_password(self, username: str, password: str, actor: Actor) -> User:
        """Administrative reset: the user must choose a new password at next login."""
        user = await self.get_user(username)
        check_password_policy(password, username=user.username)
        await self._users.set_password(user.id, self._hasher.hash(password), must_change=True)
        await self._users.save(replace(user, failed_logins=0, locked_until=None))
        revoked = await self._sessions.revoke_user(user.id, self._clock.now(), "password reset")
        await self._audit.record(
            "user.password_reset",
            actor,
            target_type="user",
            target_id=str(user.id),
            details={"sessions_revoked": revoked},
        )
        return await self._reload(user.id)

    async def revoke_sessions(self, username: str, actor: Actor) -> int:
        user = await self.get_user(username)
        revoked = await self._sessions.revoke_user(user.id, self._clock.now(), "revoked by admin")
        await self._audit.record(
            "user.sessions_revoked",
            actor,
            target_type="user",
            target_id=str(user.id),
            details={"sessions_revoked": revoked},
        )
        return revoked

    async def active_sessions(self, username: str) -> list[Session]:
        user = await self.get_user(username)
        return await self._sessions.active_for(user.id, self._clock.now())

    async def count_active_sessions(self) -> int:
        return await self._sessions.count_active(self._clock.now())

    # ---------------------------------------------------------------- administration over HTTP

    async def get_user_by_id(self, user_id: UUID) -> User:
        user = await self._users.get(user_id)
        if user is None:
            raise UserNotFoundError("no such user")
        return user

    async def active_session_counts(self) -> dict[UUID, int]:
        return await self._sessions.active_counts(self._clock.now())

    async def update_user(
        self,
        user_id: UUID,
        *,
        by: User,
        actor: Actor,
        display_name: str | None = None,
        email: str | None = None,
        clear_email: bool = False,
        role: Role | None = None,
        status: UserStatus | None = None,
    ) -> User:
        """Profile, role and status changes made by an administrator. A change to one's own
        role or status is refused: it could lock the only person able to undo it out."""
        user = await self.get_user_by_id(user_id)
        if user.id == by.id and (
            (role is not None and role is not user.role)
            or (status is not None and status is not user.status)
        ):
            raise SelfChangeError(
                "you cannot change your own role or deactivate yourself; ask another administrator"
            )
        new_name = user.display_name
        if display_name is not None:
            new_name = clean_display_name(display_name, user.username)
        new_email = user.email
        if clear_email:
            new_email = None
        elif email is not None:
            new_email = clean_email(email)
        fields = [
            f
            for f, changed in (
                ("display_name", new_name != user.display_name),
                ("email", new_email != user.email),
            )
            if changed
        ]
        if fields:
            await self._users.save(replace(user, display_name=new_name, email=new_email))
            await self._audit.record(
                "user.updated",
                actor,
                target_type="user",
                target_id=str(user.id),
                details={"username": user.username, "fields": fields},
            )
        if role is not None:
            await self.set_role(user.username, role, actor)
        if status is not None:
            await self.set_status(user.username, status, actor)
        return await self._reload(user.id)

    async def admin_reset_password(
        self, user_id: UUID, password: str | None, actor: Actor
    ) -> tuple[User, str | None]:
        """Set a temporary password (typed by the administrator, or made here and returned once).
        The person must choose their own at the next sign-in; every session ends."""
        user = await self.get_user_by_id(user_id)
        generated = None if password else temporary_password()
        updated = await self.reset_password(user.username, password or generated or "", actor)
        return updated, generated

    async def revoke_sessions_of(self, user_id: UUID, actor: Actor) -> int:
        user = await self.get_user_by_id(user_id)
        return await self.revoke_sessions(user.username, actor)

    async def unlock(self, user_id: UUID, actor: Actor) -> User:
        """Clear a lock left by too many failed sign-ins."""
        user = await self.get_user_by_id(user_id)
        if user.failed_logins == 0 and user.locked_until is None:
            return user
        await self._users.save(replace(user, failed_logins=0, locked_until=None))
        await self._audit.record(
            "user.unlocked",
            actor,
            target_type="user",
            target_id=str(user.id),
            details={"username": user.username},
        )
        return await self._reload(user.id)

    async def _guard_last_admin(self, user: User, *, losing_admin: bool) -> None:
        if losing_admin and user.active and await self._users.count_active_admins() <= 1:
            raise LastAdminError("this is the last active administrator; add another one first")

    # ---------------------------------------------------------------- authentication

    async def login(
        self,
        username: str,
        password: str,
        *,
        ip: str | None,
        user_agent: str | None,
        request_id: str | None = None,
    ) -> LoginResult:
        now = self._clock.now()
        try:
            name = normalise_username(username)
        except IdentityError:
            name = None
        user = await self._users.by_username(name) if name else None
        if user is None:
            self._hasher.verify(self._dummy_hash, password)
            await self._login_failed(None, name or username[:64], ip, request_id, "unknown user")
            raise InvalidCredentialsError("invalid username or password")
        if user.locked_until is not None and user.locked(now):
            retry = max(1, int((user.locked_until - now).total_seconds()))
            await self._login_failed(user, user.username, ip, request_id, "locked")
            raise LoginLockedError(retry)
        stored = await self._users.password_hash(user.id)
        ok = stored is not None and self._hasher.verify(stored, password)
        if not ok or not user.active:
            if user.active:
                failures = user.failed_logins + 1
                locked_until = (
                    now + self.policy.lock_for if failures >= self.policy.max_failures else None
                )
                await self._users.save(
                    replace(
                        user,
                        failed_logins=0 if locked_until else failures,
                        locked_until=locked_until,
                    )
                )
            reason = "disabled" if not user.active else "wrong password"
            await self._login_failed(user, user.username, ip, request_id, reason)
            raise InvalidCredentialsError("invalid username or password")

        if stored is not None and self._hasher.needs_rehash(stored):
            await self._users.set_password(
                user.id, self._hasher.hash(password), must_change=user.must_change_password
            )
        user = replace(user, failed_logins=0, locked_until=None, last_login_at=now)
        await self._users.save(user)
        token = secrets.token_urlsafe(32)
        session = Session(
            id=new_id(),
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + self.policy.absolute,
            revoked_at=None,
            ip=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
        await self._sessions.add(session, hash_token(token))
        await self._audit.record(
            "auth.login",
            user_actor(user),
            target_type="session",
            target_id=str(session.id),
            request_id=request_id,
            details={"ip": ip},
        )
        return LoginResult(self._principal(user, session), token)

    async def _login_failed(
        self, user: User | None, username: str, ip: str | None, request_id: str | None, reason: str
    ) -> None:
        await self._audit.record(
            "auth.login",
            user_actor(user) if user else Actor(ActorType.USER, f"unknown:{username}"[:128]),
            outcome=Outcome.DENIED,
            request_id=request_id,
            details={"ip": ip, "reason": reason},
        )

    async def authenticate(self, token: str) -> Principal | None:
        """Resolve a session token; slides the idle timeout. None = not authenticated."""
        if not token or len(token) > 128:
            return None
        session = await self._sessions.by_token_hash(hash_token(token))
        now = self._clock.now()
        if session is None or not session.valid(now, self.policy.idle):
            return None
        user = await self._users.get(session.user_id)
        if user is None or not user.active:
            return None
        if now - session.last_seen_at >= self.policy.touch_every:
            await self._sessions.touch(session.id, now)
            session = replace(session, last_seen_at=now)
        return self._principal(user, session)

    async def logout(self, principal: Principal, request_id: str | None = None) -> None:
        await self._sessions.revoke(principal.session.id, self._clock.now(), "logout")
        await self._audit.record(
            "auth.logout",
            user_actor(principal.user),
            target_type="session",
            target_id=str(principal.session.id),
            request_id=request_id,
        )

    async def change_password(
        self, principal: Principal, current: str, new: str, request_id: str | None = None
    ) -> User:
        stored = await self._users.password_hash(principal.user.id)
        if stored is None or not self._hasher.verify(stored, current):
            await self._audit.record(
                "user.password_changed",
                user_actor(principal.user),
                outcome=Outcome.DENIED,
                request_id=request_id,
                details={"reason": "wrong current password"},
            )
            raise WrongPasswordError("current password is wrong")
        check_password_policy(new, username=principal.user.username)
        if self._hasher.verify(stored, new):
            raise IdentityError("the new password must differ from the current one")
        await self._users.set_password(principal.user.id, self._hasher.hash(new), must_change=False)
        revoked = await self._sessions.revoke_user(
            principal.user.id, self._clock.now(), "password changed", keep=principal.session.id
        )
        await self._audit.record(
            "user.password_changed",
            user_actor(principal.user),
            target_type="user",
            target_id=str(principal.user.id),
            request_id=request_id,
            details={"other_sessions_revoked": revoked},
        )
        return await self._reload(principal.user.id)

    async def prune_sessions(self, older_than_days: int = 30) -> int:
        from datetime import timedelta

        return await self._sessions.prune(self._clock.now() - timedelta(days=older_than_days))

    async def _reload(self, user_id: UUID) -> User:
        user = await self._users.get(user_id)
        if user is None:
            raise UserNotFoundError(f"user {user_id} disappeared")
        return user

    @staticmethod
    def _principal(user: User, session: Session) -> Principal:
        return Principal(
            user=user, session=session, permissions=frozenset(permissions_for(user.role))
        )
