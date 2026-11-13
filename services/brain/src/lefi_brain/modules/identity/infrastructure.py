"""SQLAlchemy tables, repositories and the argon2id password hasher."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher as Argon2
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import (
    Boolean,
    ColumnElement,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Uuid,
    delete,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.identity.application import UserExistsError
from lefi_brain.modules.identity.domain import Role, Session, User, UserStatus


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False)
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SessionRow(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _req(moment: datetime | None) -> datetime:
    value = _utc(moment)
    if value is None:
        raise ValueError("required timestamp is NULL")
    return value


def to_user(row: UserRow) -> User:
    return User(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        email=row.email,
        role=Role(row.role),
        status=UserStatus(row.status),
        must_change_password=row.must_change_password,
        failed_logins=row.failed_logins,
        locked_until=_utc(row.locked_until),
        created_at=_req(row.created_at),
        last_login_at=_utc(row.last_login_at),
    )


def to_session(row: SessionRow) -> Session:
    return Session(
        id=row.id,
        user_id=row.user_id,
        created_at=_req(row.created_at),
        last_seen_at=_req(row.last_seen_at),
        expires_at=_req(row.expires_at),
        revoked_at=_utc(row.revoked_at),
        ip=row.ip,
        user_agent=row.user_agent,
    )


class SqlUserRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def count(self) -> int:
        async with self._db() as s:
            return int(await s.scalar(select(func.count()).select_from(UserRow)) or 0)

    async def count_active_admins(self) -> int:
        async with self._db() as s:
            query = select(func.count()).where(
                UserRow.role == Role.ADMIN.value, UserRow.status == UserStatus.ACTIVE.value
            )
            return int(await s.scalar(query) or 0)

    async def get(self, user_id: uuid.UUID) -> User | None:
        async with self._db() as s:
            row = await s.get(UserRow, user_id)
            return to_user(row) if row else None

    async def by_username(self, username: str) -> User | None:
        async with self._db() as s:
            row = await s.scalar(select(UserRow).where(UserRow.username == username))
            return to_user(row) if row else None

    async def password_hash(self, user_id: uuid.UUID) -> str | None:
        async with self._db() as s:
            value = await s.scalar(select(UserRow.password_hash).where(UserRow.id == user_id))
            return str(value) if value is not None else None

    async def add(self, user: User, password_hash: str) -> None:
        async with self._db() as s:
            s.add(
                UserRow(
                    id=user.id,
                    username=user.username,
                    display_name=user.display_name,
                    email=user.email,
                    role=user.role.value,
                    status=user.status.value,
                    password_hash=password_hash,
                    must_change_password=user.must_change_password,
                    failed_logins=user.failed_logins,
                    locked_until=user.locked_until,
                    created_at=user.created_at,
                    last_login_at=user.last_login_at,
                )
            )
            try:
                await s.commit()
            except IntegrityError as exc:
                raise UserExistsError(f"user '{user.username}' already exists") from exc

    async def save(self, user: User) -> None:
        async with self._db() as s:
            await s.execute(
                update(UserRow)
                .where(UserRow.id == user.id)
                .values(
                    display_name=user.display_name,
                    email=user.email,
                    role=user.role.value,
                    status=user.status.value,
                    failed_logins=user.failed_logins,
                    locked_until=user.locked_until,
                    last_login_at=user.last_login_at,
                )
            )
            await s.commit()

    async def set_password(self, user_id: uuid.UUID, password_hash: str, must_change: bool) -> None:
        async with self._db() as s:
            await s.execute(
                update(UserRow)
                .where(UserRow.id == user_id)
                .values(password_hash=password_hash, must_change_password=must_change)
            )
            await s.commit()

    async def list(self) -> list[User]:
        async with self._db() as s:
            rows = await s.scalars(select(UserRow).order_by(UserRow.username))
            return [to_user(r) for r in rows]


class SqlSessionRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], idle_seconds: int) -> None:
        self._db = sessions
        self._idle = idle_seconds

    async def add(self, session: Session, token_hash: str) -> None:
        async with self._db() as s:
            s.add(
                SessionRow(
                    id=session.id,
                    user_id=session.user_id,
                    token_hash=token_hash,
                    created_at=session.created_at,
                    last_seen_at=session.last_seen_at,
                    expires_at=session.expires_at,
                    revoked_at=None,
                    ip=session.ip,
                    user_agent=session.user_agent,
                )
            )
            await s.commit()

    async def by_token_hash(self, token_hash: str) -> Session | None:
        async with self._db() as s:
            row = await s.scalar(select(SessionRow).where(SessionRow.token_hash == token_hash))
            return to_session(row) if row else None

    async def touch(self, session_id: uuid.UUID, at: datetime) -> None:
        async with self._db() as s:
            await s.execute(
                update(SessionRow).where(SessionRow.id == session_id).values(last_seen_at=at)
            )
            await s.commit()

    async def revoke(self, session_id: uuid.UUID, at: datetime, reason: str) -> None:
        async with self._db() as s:
            await s.execute(
                update(SessionRow)
                .where(SessionRow.id == session_id, SessionRow.revoked_at.is_(None))
                .values(revoked_at=at, revoked_reason=reason)
            )
            await s.commit()

    async def revoke_user(
        self, user_id: uuid.UUID, at: datetime, reason: str, keep: uuid.UUID | None = None
    ) -> int:
        async with self._db() as s:
            query = update(SessionRow).where(
                SessionRow.user_id == user_id,
                SessionRow.revoked_at.is_(None),
                SessionRow.expires_at > at,
            )
            if keep is not None:
                query = query.where(SessionRow.id != keep)
            result = await s.execute(query.values(revoked_at=at, revoked_reason=reason))
            await s.commit()
            return int(getattr(result, "rowcount", 0) or 0)

    def _active(self, now: datetime) -> list[ColumnElement[bool]]:
        return [
            SessionRow.revoked_at.is_(None),
            SessionRow.expires_at > now,
            SessionRow.last_seen_at > now - timedelta(seconds=self._idle),
        ]

    async def active_for(self, user_id: uuid.UUID, now: datetime) -> list[Session]:
        async with self._db() as s:
            rows = await s.scalars(
                select(SessionRow)
                .where(SessionRow.user_id == user_id, *self._active(now))
                .order_by(SessionRow.created_at)
            )
            return [to_session(r) for r in rows]

    async def active_counts(self, now: datetime) -> dict[uuid.UUID, int]:
        async with self._db() as s:
            rows = await s.execute(
                select(SessionRow.user_id, func.count())
                .where(*self._active(now))
                .group_by(SessionRow.user_id)
            )
            return {user_id: int(n) for user_id, n in rows.all()}

    async def count_active(self, now: datetime) -> int:
        async with self._db() as s:
            query = select(func.count()).select_from(SessionRow).where(*self._active(now))
            return int(await s.scalar(query) or 0)

    async def prune(self, before: datetime) -> int:
        """Delete sessions that ended (expired or revoked) before `before`."""
        async with self._db() as s:
            result = await s.execute(
                delete(SessionRow).where(
                    or_(SessionRow.expires_at < before, SessionRow.revoked_at < before)
                )
            )
            await s.commit()
            return int(getattr(result, "rowcount", 0) or 0)


class Argon2PasswordHasher:
    """argon2id (argon2-cffi defaults: RFC 9106 low-memory profile)."""

    def __init__(self, hasher: Argon2 | None = None) -> None:
        self._argon = hasher or Argon2()

    def hash(self, password: str) -> str:
        return self._argon.hash(password)

    def verify(self, password_hash: str, password: str) -> bool:
        try:
            return self._argon.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    def needs_rehash(self, password_hash: str) -> bool:
        try:
            return self._argon.check_needs_rehash(password_hash)
        except InvalidHashError:
            return True
