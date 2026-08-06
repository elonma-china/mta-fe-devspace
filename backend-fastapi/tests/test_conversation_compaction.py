"""Gateway-owned conversation compaction (stateless STM, part 2).

The gateway owns the durable conversation, so it owns the compacted view of it:
a rolling `summary` plus `absorbed_upto`, the count of leading messages that
summary already accounts for. Turns that age out of the forwarded window are
folded into the summary **after** a turn is stored, so the next query pays
nothing for it — the AI service used to re-summarise the window inside every
request, ahead of retrieval, and throw the result away.

These cover the pure helpers; the HTTP fold itself is exercised on the AI side
(mta-ai-intramind/tests/test_conversation_compact.py).
"""

import pytest

from app.routes.llm import _apply_verified_identity, _forwarded_context, _turns_to_absorb
from app.models.access import Principal


def _msgs(n: int) -> list[dict]:
    return [{"q": f"hỏi {i}", "a": f"đáp {i}"} for i in range(n)]


# ── what gets forwarded ───────────────────────────────────────────────────────

def test_unabsorbed_turns_only_are_forwarded():
    """Anything already folded into the summary must not ride along as raw text."""
    ds = {"messages": _msgs(5), "summary": "TÓM TẮT", "absorbed_upto": 3}

    summary, history = _forwarded_context(ds, window=10)

    assert summary == "TÓM TẮT"
    assert [turn["content"] for turn in history] == [
        "hỏi 3", "đáp 3", "hỏi 4", "đáp 4",
    ]


def test_window_still_caps_the_unabsorbed_tail():
    """Compaction lagging behind must not let the forwarded window grow."""
    ds = {"messages": _msgs(9), "summary": "S", "absorbed_upto": 0}

    _, history = _forwarded_context(ds, window=2)

    assert [turn["content"] for turn in history] == ["hỏi 7", "đáp 7", "hỏi 8", "đáp 8"]


def test_a_conversation_with_no_summary_behaves_as_before():
    ds = {"messages": _msgs(2)}

    summary, history = _forwarded_context(ds, window=10)

    assert summary == ""
    assert len(history) == 4


# ── what gets folded ──────────────────────────────────────────────────────────

def test_only_turns_that_aged_out_of_the_window_are_absorbed():
    absorb = _turns_to_absorb(_msgs(5), absorbed_upto=1, window=2)

    # 5 stored, 2 kept recent, 1 already absorbed -> messages[1:3].
    assert [turn["content"] for turn in absorb] == ["hỏi 1", "đáp 1", "hỏi 2", "đáp 2"]


def test_nothing_to_absorb_while_the_window_still_holds_everything():
    assert _turns_to_absorb(_msgs(2), absorbed_upto=0, window=10) == []


def test_half_turns_are_never_absorbed():
    """A half-turn would break strict user/assistant alternation downstream."""
    messages = [{"q": "hỏi 0", "a": "đáp 0"}, {"q": "hỏi 1", "a": ""}, {"q": "hỏi 2", "a": "đáp 2"}]

    absorb = _turns_to_absorb(messages, absorbed_upto=0, window=1)

    assert [turn["content"] for turn in absorb] == ["hỏi 0", "đáp 0"]


# ── the identity/trust boundary keeps applying ────────────────────────────────

def test_client_supplied_summary_is_overwritten_by_the_gateways_own():
    body = {"history_summary": "BỊA ĐẶT"}

    _apply_verified_identity(
        body, Principal(id=1, unit_id=None, is_admin=False), [], summary="THẬT"
    )

    assert body["history_summary"] == "THẬT"


def test_client_supplied_summary_is_dropped_when_the_gateway_has_none():
    body = {"history_summary": "BỊA ĐẶT"}

    _apply_verified_identity(
        body, Principal(id=1, unit_id=None, is_admin=False), [], summary=""
    )

    assert "history_summary" not in body


# ── the marker advances by stored slots, not by emitted messages ──────────────

def test_marker_advances_past_half_turns_so_compaction_cannot_stall():
    """Regression: deriving the marker from len(turns)//2 stalls the loop.

    `_turns_to_absorb` drops half-turns, so a conversation containing one
    errored turn emits fewer messages than the slots it examined. A marker
    derived from the emitted count would land short, and every later attempt
    would re-absorb the same turns forever while the summary kept growing.
    The marker is `len(messages) - window`, which is what was examined.
    """
    messages = [
        {"q": "hỏi 0", "a": "đáp 0"},
        {"q": "hỏi 1", "a": ""},          # errored stream: stored, never forwarded
        {"q": "hỏi 2", "a": "đáp 2"},
        {"q": "hỏi 3", "a": "đáp 3"},
    ]
    window = 1

    absorb = _turns_to_absorb(messages, absorbed_upto=0, window=window)
    naive_marker = len(absorb) // 2
    correct_marker = len(messages) - window

    assert naive_marker == 2 and correct_marker == 3, "the two must genuinely disagree"

    # With the correct marker, the next pass has nothing left to do.
    assert _turns_to_absorb(messages, absorbed_upto=correct_marker, window=window) == []
    # With the naive one it re-absorbs a turn that is already in the summary.
    assert _turns_to_absorb(messages, absorbed_upto=naive_marker, window=window) != []


# ── the fold must not be able to lose a turn ──────────────────────────────────

class _Repo:
    """Records which write the fold chose."""

    def __init__(self, ds: dict):
        self.ds = ds
        self.whole_document_writes = 0
        self.compaction_writes: list[tuple[str, int]] = []

    async def get_data_source(self, principal, conv_id):
        return dict(self.ds)

    async def update_data_source(self, principal, conv_id, data):
        self.whole_document_writes += 1

    async def set_compaction(self, principal, conv_id, summary, absorbed_upto):
        self.compaction_writes.append((summary, absorbed_upto))


@pytest.mark.asyncio
async def test_fold_uses_the_narrow_write_so_a_concurrent_turn_survives(monkeypatch):
    """Regression: writing the whole ds back erases turns appended during the LLM call.

    The fold reads the conversation, spends seconds summarising, then writes.
    `update_data_source` `$set`s the entire document — including `messages` —
    so a turn stored in that window would be silently destroyed. Only the two
    compaction fields may be written.
    """
    from app.services import conversation_compaction as cc

    repo = _Repo({"messages": _msgs(5), "summary": "", "absorbed_upto": 0})

    class _Response:
        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return {"summary": "ĐÃ GỘP", "absorbed": 6}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            return _Response()

    monkeypatch.setattr(cc.httpx, "AsyncClient", lambda **kw: _Client())

    await cc._compact_with(repo, Principal(id=1, unit_id=None, is_admin=False), 1, window=2)

    assert repo.whole_document_writes == 0, "must never write the message list back"
    assert repo.compaction_writes == [("ĐÃ GỘP", 3)]


@pytest.mark.asyncio
async def test_a_failed_fold_leaves_the_marker_untouched(monkeypatch):
    """The turns are still in `messages`; a later attempt retries them."""
    from app.services import conversation_compaction as cc

    repo = _Repo({"messages": _msgs(5), "summary": "CŨ", "absorbed_upto": 1})

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            raise RuntimeError("AI service down")

    monkeypatch.setattr(cc.httpx, "AsyncClient", lambda **kw: _Client())

    await cc._compact_with(repo, Principal(id=1, unit_id=None, is_admin=False), 1, window=2)

    assert repo.compaction_writes == []
    assert repo.whole_document_writes == 0


def test_background_task_does_not_receive_the_request_scoped_repository():
    """Regression: FastAPI closes yield-dependencies before background tasks run.

    `get_session` yields a request-scoped AsyncSession, so a repository built
    from it is dead by the time the task executes (FastAPI >= 0.106). The entry
    point must therefore take only plain values and open its own session.
    """
    import inspect

    from app.services.conversation_compaction import compact_conversation

    params = list(inspect.signature(compact_conversation).parameters)
    assert params == ["principal", "conv_id"], (
        f"compact_conversation must not accept a request-scoped repo, got {params}"
    )


# ── the forwarded payload must be bounded ─────────────────────────────────────

def test_a_pathological_answer_cannot_dominate_the_forwarded_window():
    """Measured on this store: answers run p50 770 chars, p90 15,921, max 46,908.

    Everything in the window is re-sent on every query. The AI reads only the
    last 4 messages of it, each capped at 90 words (`compact_assistant_for_rewrite`),
    so an uncapped answer is transmitted and JSON-parsed to be thrown away —
    conv 52 forwards ~51,700 chars at 5 turns, of which ~95% is dead weight.
    """
    from app.routes.llm import _FORWARD_MAX_MESSAGE_WORDS

    huge = " ".join(["phạt"] * 12000)
    ds = {"messages": [{"q": "mức phạt?", "a": huge}], "absorbed_upto": 0}

    _, history = _forwarded_context(ds, window=10)

    answer = history[1]["content"]
    assert len(answer.split()) <= _FORWARD_MAX_MESSAGE_WORDS + 1  # +1 for the ellipsis
    assert answer.endswith("...")


def test_an_ordinary_answer_crosses_the_wire_unchanged():
    """p50 is 770 chars — the cap must be invisible in the common case."""
    answer = "Mức phạt tối đa với tổ chức là 2 tỷ đồng theo Nghị định 179/2024/NĐ-CP."
    ds = {"messages": [{"q": "mức phạt?", "a": answer}], "absorbed_upto": 0}

    _, history = _forwarded_context(ds, window=10)

    assert history[1]["content"] == answer


def test_turns_sent_to_the_fold_are_bounded_too():
    """The fold POST carries the whole backlog, so it is the larger payload."""
    from app.routes.llm import _FORWARD_MAX_MESSAGE_WORDS

    huge = " ".join(["phạt"] * 12000)
    messages = [{"q": f"hỏi {i}", "a": huge} for i in range(4)]

    turns = _turns_to_absorb(messages, absorbed_upto=0, window=1)

    for turn in turns:
        assert len(turn["content"].split()) <= _FORWARD_MAX_MESSAGE_WORDS + 1
