"""Notifications: one record per person, made by Lefi Brain from alert transitions (ADR-072).
Pure: no I/O, no framework imports.

Lefi Brain is the only one that emits them: it holds the alerts, knows who may see them and
what each person asked for. Clients only fetch and show their own. Nothing leaves the LAN: no
cloud push; a phone or a PC gets them while its app is connected to Lefi Brain.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

# The same alert pings a person at most once in this window (repeats, flapping), except when it
# becomes critical or is assigned to them.
QUIET_FOR = timedelta(minutes=30)
KEEP_FOR = timedelta(days=30)  # read notifications older than this are pruned
MAX_LIST = 100


class Kind(StrEnum):
    ALERT_RAISED = "alert_raised"  # a rule raised it, or it came back
    ALERT_ESCALATED = "alert_escalated"  # became critical
    INCIDENT_REPORTED = "incident_reported"  # a person reported it
    ASSIGNED = "assigned"  # assigned to you
    INCIDENT_RESOLVED = "incident_resolved"  # the incident you reported was resolved
    TASK_WAITING = "task_waiting"  # a task nobody of its role can take: assign it (ADR-092)
    HANDOVER = "handover"  # the outgoing shift signed its handover for you (ADR-095)
    ESCALATION = "escalation"  # you are a level of an alert's escalation chain (ADR-096)


class MinSeverity(StrEnum):
    """What a person wants to hear about (assignments to them always arrive)."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    OFF = "off"


DEFAULT_MIN = MinSeverity.WARNING
_RANK = {"info": 0, "warning": 1, "critical": 2}


def wants(pref: MinSeverity, severity: str) -> bool:
    if pref is MinSeverity.OFF:
        return False
    return _RANK.get(severity, 0) >= _RANK[pref.value]


@dataclass(frozen=True)
class Notification:
    id: UUID
    user_id: UUID
    kind: Kind
    severity: str  # info | warning | critical (the alert's)
    title: str
    body: str
    alert_id: UUID | None
    origin: str  # LIVE | SIMULATED (ADR-012)
    created_at: datetime
    read_at: datetime | None = None
