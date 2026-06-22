"""EdgeNonce tests — offline-issuable, strictly monotonic, durable, replay-gated.

No Frappe: a fake control plane whose nonce-floor mirror can be flipped offline.
"""

import requests

from edge_cache import EdgeNonce


class FlakyCP:
    def __init__(self):
        self.up = True
        self.floor = {}

    def get_nonce_floor(self, rover, operator):
        if not self.up:
            raise requests.ConnectionError("frappe unreachable")
        return self.floor.get(f"{rover}::{operator}", 0)

    def set_nonce_floor(self, rover, operator, nonce):
        if not self.up:
            raise requests.ConnectionError("frappe unreachable")
        k = f"{rover}::{operator}"
        self.floor[k] = max(self.floor.get(k, 0), int(nonce))
        return self.floor[k]


def test_issue_is_monotonic(tmp_path):
    n = EdgeNonce(FlakyCP(), path=str(tmp_path / "n.json"))
    assert [n.issue("R", "O") for _ in range(3)] == [1, 2, 3]


def test_issue_works_offline(tmp_path):
    cp = FlakyCP()
    cp.up = False
    n = EdgeNonce(cp, path=str(tmp_path / "n.json"))
    assert n.issue("R", "O") == 1     # Frappe down — still issues from the durable local floor
    assert n.issue("R", "O") == 2


def test_durable_across_restart(tmp_path):
    p = str(tmp_path / "n.json")
    assert EdgeNonce(FlakyCP(), path=p).issue("R", "O") == 1   # process 1
    assert EdgeNonce(FlakyCP(), path=p).issue("R", "O") == 2   # process 2 continues, no reuse
    assert EdgeNonce(FlakyCP(), path=p).issue("R", "O") == 3   # process 3


def test_reconciles_up_from_frappe(tmp_path):
    cp = FlakyCP()
    cp.floor["R::O"] = 40                              # Frappe already issued 1..40 pre-edge
    n = EdgeNonce(cp, path=str(tmp_path / "n.json"))
    assert n.issue("R", "O") == 41                     # never reuse a Frappe-issued nonce
    assert cp.floor["R::O"] == 41                       # mirrored back


def test_mirrors_floor_back_to_frappe(tmp_path):
    cp = FlakyCP()
    n = EdgeNonce(cp, path=str(tmp_path / "n.json"))
    n.issue("R", "O")
    n.issue("R", "O")
    assert cp.floor["R::O"] == 2


def test_offline_then_reconnect_never_reuses(tmp_path):
    p = str(tmp_path / "n.json")
    cp = FlakyCP()
    cp.up = False
    n = EdgeNonce(cp, path=p)
    assert n.issue("R", "O") == 1     # offline
    assert n.issue("R", "O") == 2     # offline
    cp.up = True                      # Frappe back, but its mirror is behind (floor 0)
    assert n.issue("R", "O") == 3     # local floor wins — no reuse
    assert cp.floor["R::O"] == 3      # Frappe catches up


def test_replay_consume_gate(tmp_path):
    n = EdgeNonce(FlakyCP(), path=str(tmp_path / "n.json"))
    assert n.consume("R", "O", 5) is True
    assert n.consume("R", "O", 5) is False    # exact replay
    assert n.consume("R", "O", 4) is False    # older
    assert n.consume("R", "O", 6) is True     # newer


def test_relayed_floor_durable(tmp_path):
    p = str(tmp_path / "n.json")
    assert EdgeNonce(FlakyCP(), path=p).consume("R", "O", 7) is True
    assert EdgeNonce(FlakyCP(), path=p).consume("R", "O", 7) is False   # replay survives restart
