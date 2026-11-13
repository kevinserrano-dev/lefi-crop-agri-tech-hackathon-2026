"""Audit trail: append-only, hash-chained record of every mutating action (brief §11).

Layers (ADR-002): `domain` (entries, hashing, chain verification) ← `application`
(service + repository port) ← `infrastructure` (SQLAlchemy table and repository).
"""
