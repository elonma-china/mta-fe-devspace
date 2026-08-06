# tests/test_login_username_norm.py
"""Story 83: login resolves a username tolerantly (trim + case-insensitive).

The decision of WHICH user a typed username maps to is a pure function,
``_pick_username_match(input_username, rows)``, where ``rows`` are the users
whose username matches case-insensitively (the repository runs that one query).
Extracting it keeps the rule unit-testable without a database:

* an EXACT (case-sensitive) match always wins — so when both ``User1`` and
  ``user1`` exist, each logs into its own account;
* otherwise the SOLE case-insensitive match is used (the common "typed the
  wrong case / added a space" case);
* an ambiguous case-variant set (≥2 rows, no exact) resolves to None → the route
  returns 401 rather than logging into the wrong account.

Password matching is unchanged (exact bcrypt, in the route) and is covered by
``test_auth_login.py``.
"""

from __future__ import annotations

from app.repositories.postgres import _pick_username_match


def _row(username: str, uid: int) -> dict:
    return {"id": uid, "username": username, "password": "x"}


def test_pick_exactMatch_wins_evenWithCaseVariants() -> None:
    rows = [_row("User1", 1), _row("user1", 2)]
    # typing the exact case logs into THAT account, not the other variant.
    assert _pick_username_match("user1", rows)["id"] == 2
    assert _pick_username_match("User1", rows)["id"] == 1


def test_pick_caseInsensitive_singleMatch() -> None:
    rows = [_row("user1", 2)]
    # wrong case, only one candidate → resolves to it.
    assert _pick_username_match("USER1", rows)["id"] == 2
    assert _pick_username_match("User1", rows)["id"] == 2


def test_pick_trimsInput_thenMatches() -> None:
    rows = [_row("user1", 2)]
    assert _pick_username_match("  user1  ", rows)["id"] == 2
    # exact match is computed on the trimmed input too.
    rows2 = [_row("User1", 1), _row("user1", 2)]
    assert _pick_username_match(" user1 ", rows2)["id"] == 2


def test_pick_ambiguousCaseVariants_noExact_returnsNone() -> None:
    rows = [_row("User1", 1), _row("user1", 2)]
    # typed neither exact case + ≥2 variants → cannot safely choose → None.
    assert _pick_username_match("USER1", rows) is None


def test_pick_emptyOrNoRows_returnsNone() -> None:
    assert _pick_username_match("user1", []) is None
    assert _pick_username_match("", [_row("user1", 2)]) is None
    assert _pick_username_match("   ", [_row("user1", 2)]) is None
    assert _pick_username_match(None, [_row("user1", 2)]) is None
