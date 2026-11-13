from __future__ import annotations

import re
from pathlib import Path

import pytest

from lefi_brain.modules.identity.domain import (
    PERMISSIONS,
    Role,
    WeakPasswordError,
    check_password_policy,
    normalise_username,
    permissions_for,
    role_has,
)

REPO = Path(__file__).resolve().parents[3]
DESIGN = REPO / "packages" / "mock-brain" / "src" / "design-data.ts"
ACTUATOR_PERMISSIONS = {"env.pump", "device.power"}


def _design_matrix() -> dict[str, set[str]]:
    """Parse the clients' RBAC matrix (`PERMS` in the mock Brain's design data)."""
    text = DESIGN.read_text()
    block = text[text.index("export const PERMS") :]
    block = block[: block.index("};")]
    every = {r.value for r in Role}
    matrix: dict[str, set[str]] = {}
    for key, value in re.findall(r"'([\w.]+)':\s*(\[[^\]]*\]|ALL|NOTW)", block):
        if value == "ALL":
            matrix[key] = every
        elif value == "NOTW":
            matrix[key] = every - {"worker"}
        else:
            matrix[key] = set(re.findall(r"'(\w+)'", value))
    return matrix


@pytest.mark.skipif(not DESIGN.exists(), reason="mock Brain design data not in this checkout")
def test_matrix_matches_the_clients_minus_actuators() -> None:
    design = _design_matrix()
    assert design, "could not parse the design matrix"
    expected = {k: v for k, v in design.items() if k not in ACTUATOR_PERMISSIONS}
    actual = {k: {r.value for r in roles} for k, roles in PERMISSIONS.items()}
    assert actual == expected


def test_no_actuator_permission_exists() -> None:
    assert not ACTUATOR_PERMISSIONS & set(PERMISSIONS)
    assert not [p for p in PERMISSIONS if "pump" in p or "valve" in p or "irrigat" in p]


@pytest.mark.parametrize("role", list(Role))
def test_every_role_gets_its_matrix_row(role: Role) -> None:
    granted = set(permissions_for(role))
    for permission, roles in PERMISSIONS.items():
        assert (permission in granted) == (role in roles) == role_has(role, permission)
    assert "nav.tasks" in granted  # everyone can see their tasks


def test_the_system_administrator_holds_every_permission() -> None:
    """ADR-081: the admin can do everything a role can; actuator permissions still do not exist."""
    assert set(permissions_for(Role.ADMIN)) == set(PERMISSIONS)


def test_only_admin_manages_users() -> None:
    assert {r for r in Role if role_has(r, "user.manage")} == {Role.ADMIN}
    assert not role_has(Role.WORKER, "nav.dashboard")
    assert not role_has(Role.MANAGER, "nonexistent.permission")


def test_username_and_password_rules() -> None:
    assert normalise_username("  Ana.Gomez ") == "ana.gomez"
    for bad in ("", "a", "ana gomez", "-ana", "ana@x", "x" * 65):
        with pytest.raises(ValueError):
            normalise_username(bad)
    check_password_policy("correct horse", username="ana")
    with pytest.raises(WeakPasswordError):
        check_password_policy("short")
    with pytest.raises(WeakPasswordError):
        check_password_policy("anagomez10", username="anagomez10")
