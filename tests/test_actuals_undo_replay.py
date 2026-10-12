"""
Actuals undo = replay of the batches still in place (round 13 findings).

* NEW-1  undo was order-dependent once replace_lines was involved: undoing two
         summaries oldest-first brought back a stale value and dropped a live
         correction; a row an undone import had replaced never came back when a
         later undo removed the row written over it
* NEW-2  undoing an import deleted rows a later, still-live import had found
         unchanged ('as if it had never run' did not hold)
* NEW-4  an import whose only effect was replacing rows listed no months

The contract: undoing a batch leaves exactly the rows that replaying, in their
original order, every batch still in place (not undone) on top of the rows
that predate the batches would leave, whatever the undo order, with or
without replace_lines. ``test_undo_matches_replay_of_the_batches_still_live``
checks it on random histories against the real import code.

Drives the real FastAPI app (and the service on the same database) against an
isolated database, reusing the fixtures of the other actuals test modules.
"""
import itertools
import random

import pytest

from tests.test_actuals_controls import env, post, stored  # noqa: F401  (fixture + helpers)

from services import actuals as actuals_service


def batch_of(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]["batch_id"]


def undo(client, batch_id, dry_run=False):
    res = client.delete(f"/reporting/actuals/batches/{batch_id}", params={"dry_run": "true"} if dry_run else None)
    assert res.status_code == 200, res.text
    return res.json()["data"]


def month(mgr, period):
    return stored(mgr, "SELECT line_item, reference_id, amount, batch_id FROM actuals WHERE period = ? "
                       "ORDER BY line_item, reference_id", (period,))


def batches(client):
    return {b["batch_id"]: b for b in client.get("/reporting/actuals/batches").json()["data"]["batches"]}


# ---------------------------------------------------------------------------
# NEW-1: undo order never matters, replace_lines included
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("order", list(itertools.permutations(["T", "T2"])))
def test_two_summaries_undone_in_either_order_keep_the_live_correction(env, order):
    client, mgr = env
    p = "2028-06"
    ids = {
        "A": batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 100}])),
        "T": batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 1000}], replace_lines=True)),
        "C": batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 300}])),
        "T2": batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 2000}], replace_lines=True)),
    }
    undo(client, ids[order[0]])
    if order[0] == "T":          # T2 still replaces the line: only its summary is left
        assert month(mgr, p) == [("revenue", "", 2000.0, ids["T2"])]
    else:                        # T still replaced A's R1, but C wrote R1 again after it
        assert month(mgr, p) == [("revenue", "", 1000.0, ids["T"]), ("revenue", "R1", 300.0, ids["C"])]
    done = undo(client, ids[order[1]])
    assert month(mgr, p) == [("revenue", "R1", 300.0, ids["C"])]
    assert batches(client)[ids["C"]]["rows_current"] == 1
    if order[1] == "T2":         # C's R1 comes back; nothing stale blocks it
        assert done["put_back"] == 1 and done["put_back_rows"][0]["batch_id"] == ids["C"]
        assert not any("written again since" in n for n in done["notes"])
    else:                        # A's R1 is not put back: C wrote R1 again after T, and C is still in place
        assert done["put_back"] == 0 and any("written again since" in n for n in done["notes"])


@pytest.mark.parametrize("order", list(itertools.permutations(["B", "C", "E"])))
def test_a_row_an_undone_import_replaced_comes_back_in_any_order(env, order):
    client, mgr = env
    p = "2028-08"
    ids = {
        "A": batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 2000}])),
        "B": batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 8000}], replace_lines=True)),
        "C": batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 8000}])),
        "E": batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 5000}])),
    }
    for name in order:
        undo(client, ids[name])
    assert month(mgr, p) == [("revenue", "R1", 2000.0, ids["A"])]
    assert batches(client)[ids["A"]]["rows_current"] == 1


def test_the_undo_preview_names_the_import_that_still_replaces_a_row(env):
    client, mgr = env
    p = "2028-07"
    batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 100}]))
    t = batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 1000}], replace_lines=True))
    t2 = batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 2000}], replace_lines=True))
    preview = undo(client, t, dry_run=True)
    assert preview["rows_to_put_back"] == 0 and preview["rows_to_remove"] == 0
    assert any(t2 in n and "removes it as well" in n for n in preview["notes"])
    undo(client, t)
    assert month(mgr, p) == [("revenue", "", 2000.0, t2)]


# ---------------------------------------------------------------------------
# NEW-2: a row a later live import found unchanged stays with that import
# ---------------------------------------------------------------------------

def test_undoing_the_superseded_import_keeps_rows_the_corrected_one_confirmed(env):
    client, mgr = env
    a = batch_of(post(client, [{"period": "2027-03", "line_item": "revenue", "amount": 100},
                               {"period": "2027-03", "line_item": "payroll", "amount": 50}], source="TB v1"))
    res = post(client, [{"period": "2027-03", "line_item": "revenue", "amount": 100},
                        {"period": "2027-03", "line_item": "payroll", "amount": 60}], source="TB v2")
    b = batch_of(res)
    assert "0 new, 1 changed, 1 unchanged" in res.json()["data"]["message"]
    # The confirmed row keeps its owner until the import that stored it is undone.
    assert month(mgr, "2027-03") == [("payroll", "", 60.0, b), ("revenue", "", 100.0, a)]

    preview = undo(client, a, dry_run=True)
    assert preview["rows_to_remove"] == 0 and preview["rows_to_reassign"] == 1
    assert preview["reassigned_rows"][0]["batch_id"] == b and preview["reassigned_rows"][0]["from_batch_id"] == a
    assert any(b in n and "same amount" in n for n in preview["notes"])
    done = undo(client, a)
    assert done["removed"] == 0 and done["reassigned"] == 1
    assert month(mgr, "2027-03") == [("payroll", "", 60.0, b), ("revenue", "", 100.0, b)]
    data = client.get("/reporting/variance", params={"forecast_ids": "F001", "start_period": "2027-03",
                                                     "end_period": "2027-03"}).json()["data"]
    revenue = next(li for li in data["line_items"] if li["line_item"] == "revenue")
    assert revenue["by_period"][0]["actual"] == 100.0
    assert batches(client)[b]["rows_current"] == 2

    undo(client, b)
    assert month(mgr, "2027-03") == []


@pytest.mark.parametrize("order", [("A", "B"), ("B", "A")])
def test_undoing_both_imports_leaves_nothing_in_either_order(env, order):
    client, mgr = env
    ids = {"A": batch_of(post(client, [{"period": "2027-03", "line_item": "revenue", "amount": 100}])),
           "B": batch_of(post(client, [{"period": "2027-03", "line_item": "revenue", "amount": 100},
                                       {"period": "2027-03", "line_item": "payroll", "amount": 5}],
                              source="TB v2"))}
    undo(client, ids[order[0]])
    if order[0] == "A":
        assert month(mgr, "2027-03") == [("payroll", "", 5.0, ids["B"]), ("revenue", "", 100.0, ids["B"])]
    else:
        assert month(mgr, "2027-03") == [("revenue", "", 100.0, ids["A"])]
    undo(client, ids[order[1]])
    assert month(mgr, "2027-03") == []


def test_a_confirmed_row_in_a_closed_month_does_not_block_undoing_the_confirming_import(env):
    client, mgr = env
    a = batch_of(post(client, [{"period": "2027-03", "line_item": "revenue", "amount": 100}]))
    b = batch_of(post(client, [{"period": "2027-03", "line_item": "revenue", "amount": 100},
                               {"period": "2027-04", "line_item": "revenue", "amount": 7}]))
    client.post("/reporting/actuals/periods/2027-03/close", json={"closed_by": "Dana"})
    assert batches(client)[b]["can_undo"] is True and batches(client)[a]["can_undo"] is False
    done = undo(client, b)
    assert done["closed_periods"] == [] and done["removed"] == 1
    assert month(mgr, "2027-03") == [("revenue", "", 100.0, a)] and month(mgr, "2027-04") == []


# ---------------------------------------------------------------------------
# NEW-4: a replace-only import lists the month it changed
# ---------------------------------------------------------------------------

def test_a_replace_only_import_lists_the_month_and_can_be_undone(env):
    client, mgr = env
    first = batch_of(post(client, [{"period": "2028-02", "line_item": "revenue", "reference_id": "R1", "amount": 10},
                                   {"period": "2028-02", "line_item": "revenue", "amount": 5}]))
    res = post(client, [{"period": "2028-02", "line_item": "revenue", "amount": 5}], replace_lines=True)
    t = batch_of(res)
    assert "0 new, 0 changed, 1 unchanged, 1 replaced" in res.json()["data"]["message"]
    b = batches(client)[t]
    assert b["periods"] == ["2028-02"] and b["rows_current"] == 0 and b["replaced"] == 1 and b["can_undo"] is True
    preview = undo(client, t, dry_run=True)
    assert preview["periods"] == ["2028-02"] and preview["rows_to_put_back"] == 1

    client.post("/reporting/actuals/periods/2028-02/close", json={"closed_by": "Dana"})
    b = batches(client)[t]
    assert b["periods"] == ["2028-02"] and b["closed_periods"] == ["2028-02"] and b["can_undo"] is False
    client.post("/reporting/actuals/periods/2028-02/reopen", json={"reason": "undo the summary"})

    undo(client, t)
    assert month(mgr, "2028-02") == [("revenue", "", 5.0, first), ("revenue", "R1", 10.0, first)]
    assert batches(client)[t]["periods"] == []


# ---------------------------------------------------------------------------
# Deletions, rejected references and older batches
# ---------------------------------------------------------------------------

def test_undo_never_brings_back_a_deleted_row(env):
    client, mgr = env
    p = "2027-10"
    a = batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 1},
                               {"period": p, "line_item": "revenue", "reference_id": "R2", "amount": 2}]))
    r1 = stored(mgr, "SELECT actual_id FROM actuals WHERE reference_id = 'R1'")[0][0]
    assert client.delete("/reporting/actuals", params={"actual_id": r1}).status_code == 200
    b = batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R2", "amount": 20}]))
    undo(client, b)
    assert month(mgr, p) == [("revenue", "R2", 2.0, a)]
    # A deletion of the whole line is replayed too: undoing a later import never resurrects its rows.
    assert client.delete("/reporting/actuals", params={"period": p, "line_item": "revenue"}).status_code == 200
    c = batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R3", "amount": 3}]))
    undo(client, c)
    undo(client, a)
    assert month(mgr, p) == []


def test_replace_lines_keeps_a_reference_named_by_a_rejected_row_after_undo(env):
    client, mgr = env
    p = "2027-11"
    a = batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 1},
                               {"period": p, "line_item": "revenue", "reference_id": "R2", "amount": 2}]))
    x = batch_of(post(client, [{"period": p, "line_item": "revenue", "reference_id": "R1", "amount": 5}]))
    t = post(client, [{"period": p, "line_item": "revenue", "amount": 9},
                      {"period": p, "line_item": "revenue", "reference_id": "R2", "amount": "oops"}],
             replace_lines=True, allow_partial=True)
    t = batch_of(t)
    assert month(mgr, p) == [("revenue", "", 9.0, t), ("revenue", "R2", 2.0, a)]
    undo(client, x)       # replaying A then T: T still replaces R1 and still keeps R2
    assert month(mgr, p) == [("revenue", "", 9.0, t), ("revenue", "R2", 2.0, a)]


def test_batches_imported_before_the_entry_log_still_undo(env):
    client, mgr = env
    p = "2027-12"
    a = batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 1},
                               {"period": p, "line_item": "payroll", "amount": 2}]))
    b = batch_of(post(client, [{"period": p, "line_item": "revenue", "amount": 10}]))
    c = batch_of(post(client, [{"period": p, "line_item": "payroll", "amount": 3, "reference_id": "X"},
                               {"period": p, "line_item": "payroll", "amount": 4}], replace_lines=True))
    conn = mgr.get_connection()
    try:   # what an older version kept: no entries, no confirmations, no replace_lines flag
        conn.execute("DELETE FROM actuals_batch_entries")
        conn.execute("DELETE FROM actuals_batch_changes WHERE change_type = 'confirmed'")
        conn.execute("UPDATE actuals_batches SET entries_logged = 0, replace_lines = 0")
        conn.commit()
    finally:
        mgr.close_connection(conn)
    undo(client, b)
    assert month(mgr, p) == [("payroll", "", 4.0, c), ("payroll", "X", 3.0, c), ("revenue", "", 1.0, a)]
    undo(client, c)
    assert month(mgr, p) == [("payroll", "", 2.0, a), ("revenue", "", 1.0, a)]
    undo(client, a)
    assert month(mgr, p) == []


def test_schema_logs_entries_and_migrates_old_databases(env):
    client, mgr = env
    cols = {r[1] for r in stored(mgr, "PRAGMA table_info(actuals_batches)")}
    assert {"replace_lines", "entries_logged"} <= cols
    assert {r[1] for r in stored(mgr, "PRAGMA table_info(actuals_batch_entries)")} >= {
        "batch_id", "seq", "action", "period", "line_item", "reference_id", "amount", "notes", "source", "actual_id"}
    bid = batch_of(post(client, [{"period": "2027-01", "line_item": "revenue", "amount": 1, "notes": "n"}],
                        replace_lines=True))
    assert stored(mgr, "SELECT action, period, line_item, reference_id, amount, notes FROM actuals_batch_entries "
                       "WHERE batch_id = ?", (bid,)) == [("insert", "2027-01", "revenue", "", 1.0, "n")]
    assert stored(mgr, "SELECT replace_lines, entries_logged FROM actuals_batches WHERE batch_id = ?",
                  (bid,)) == [(1, 1)]
    # An older database: no entries table, no new columns, change records without their key.
    conn = mgr.get_connection()
    try:
        conn.execute("DROP TABLE actuals_batch_entries")
        conn.execute("ALTER TABLE actuals_batches DROP COLUMN replace_lines")
        conn.execute("ALTER TABLE actuals_batches DROP COLUMN entries_logged")
        conn.execute("INSERT INTO actuals_batch_changes (batch_id, actual_id, previous_amount) "
                     "SELECT 'ACT-legacy01', actual_id, 0 FROM actuals")
        conn.commit()
    finally:
        mgr.close_connection(conn)
    mgr.initialize_schema()
    mgr.migrate_actuals_undo_tracking()                    # idempotent
    assert {"replace_lines", "entries_logged"} <= {r[1] for r in stored(mgr, "PRAGMA table_info(actuals_batches)")}
    assert stored(mgr, "SELECT COUNT(*) FROM actuals_batch_entries") == [(0,)]
    assert stored(mgr, "SELECT previous_period, previous_line_item, previous_reference_id FROM actuals_batch_changes "
                       "WHERE batch_id = 'ACT-legacy01'") == [("2027-01", "revenue", "")]


def test_the_entry_log_is_not_writable_through_the_generic_writers(env):
    client, _mgr = env
    res = client.post("/forecast/create", json={"table": "actuals_batch_entries", "data": {
        "batch_id": "ACT-x", "seq": 0, "action": "insert", "period": "2027-01", "line_item": "revenue"}})
    assert res.status_code == 409 and "/reporting/actuals" in res.json()["detail"]


# ---------------------------------------------------------------------------
# The contract, on random histories
# ---------------------------------------------------------------------------

LINES = ("revenue", "payroll")
REFS = ("", "R1", "R2")
AMOUNTS = (100.0, 200.0, 300.0)
NOTES = (None, None, None, "n1", "n2")
TRIAL_PERIOD = "2031-01"
ORACLE_PERIOD = "2031-02"


def _wipe(conn):
    for table in ("actuals", "actuals_batches", "actuals_batch_changes", "actuals_batch_entries"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()


def _clear_period(conn, period):
    conn.execute("DELETE FROM actuals WHERE period = ?", (period,))
    conn.commit()


def _insert_base(conn, period, base_rows):
    for n, (line, ref, amount) in enumerate(base_rows):
        conn.execute("INSERT INTO actuals (actual_id, period, line_item, amount, reference_id, source, notes, "
                     "batch_id) VALUES (?, ?, ?, ?, ?, 'ledger', NULL, NULL)",
                     (f"BASE-{period}-{n}", period, line, amount, ref))
    conn.commit()


def _random_step(rng, name):
    if rng.random() < 0.12:
        line = rng.choice(LINES)
        return {"name": name, "kind": "delete", "line": line, "ref": rng.choice((None, *REFS))}
    keys = rng.sample([(line, ref) for line in LINES for ref in REFS], rng.randint(1, 3))
    entries = [{"line_item": line, "reference_id": ref, "amount": rng.choice(AMOUNTS), "notes": rng.choice(NOTES)}
               for line, ref in keys]
    flags = {"replace_lines": rng.random() < 0.45}
    if rng.random() < 0.2:      # a rejected row whose reference a replace_lines import still keeps
        free = [(line, ref) for line in LINES for ref in REFS if (line, ref) not in keys]
        line, ref = rng.choice(free)
        entries.append({"line_item": line, "reference_id": ref, "amount": "oops", "notes": None})
        flags["allow_partial"] = True
    return {"name": name, "kind": "import", "entries": entries, "flags": flags}


def _run_step(conn, step, period):
    """Run one step on ``period`` like the API does; returns the batch id, or None when nothing was recorded."""
    if step["kind"] == "delete":
        if step["ref"] is None:
            result = actuals_service.delete_actuals(conn, period=period, line_item=step["line"])
        else:
            found = conn.execute("SELECT actual_id FROM actuals WHERE period = ? AND line_item = ? AND "
                                 "reference_id = ?", (period, step["line"], step["ref"])).fetchone()
            if not found:
                return None
            result = actuals_service.delete_actuals(conn, actual_id=found[0])
        return result["batch_id"]
    rows = actuals_service.rows_from_entries([{**e, "period": period} for e in step["entries"]])
    _status, report = actuals_service.run_import(conn, rows, source=f"src-{step['name']}", **step["flags"])
    return report["batch_id"]


def _state(conn, period, names):
    rows = conn.execute("SELECT line_item, reference_id, amount, notes, source, batch_id FROM actuals "
                        "WHERE period = ? ORDER BY line_item, reference_id", (period,)).fetchall()
    return [(line, ref, round(amount, 2), notes, source, names.get(batch, batch))
            for line, ref, amount, notes, source, batch in rows]


def test_undo_matches_replay_of_the_batches_still_live(env):
    """
    200 random histories (3-5 imports with inserts, updates, unchanged rows, replace_lines, rejected rows and
    deletions on top of rows that predate the batches), undone in a random order with new imports now and
    then in between: after every undo the month holds exactly what replaying the batches still in place, in
    their original order, gives (amount, notes, source and the batch that owns each row).
    """
    _client, mgr = env
    rng = random.Random(20261012)
    conn = mgr.get_connection()
    undos = 0
    try:
        for trial in range(200):
            _wipe(conn)
            base_rows = [(line, ref, rng.choice(AMOUNTS)) for line, ref in
                         rng.sample([(line, ref) for line in LINES for ref in REFS], rng.randint(0, 2))]
            _insert_base(conn, TRIAL_PERIOD, base_rows)
            ran = []                                  # (step, batch id) for every step that recorded a batch
            steps = []

            def run(step):
                steps.append(step)
                batch_id = _run_step(conn, step, TRIAL_PERIOD)
                if batch_id:
                    ran.append((step, batch_id))

            for _ in range(rng.randint(3, 5)):
                run(_random_step(rng, chr(ord("A") + len(steps))))
            undone, order = set(), []
            for _ in range(rng.randint(1, 5)):
                live = [(step, batch_id) for step, batch_id in ran
                        if step["kind"] == "import" and batch_id not in undone]
                if not live:
                    break
                step, batch_id = rng.choice(live)
                actuals_service.undo_batch(conn, batch_id)
                undone.add(batch_id)
                order.append(step["name"])
                undos += 1
                names = {b: s["name"] for s, b in ran}
                _clear_period(conn, ORACLE_PERIOD)
                _insert_base(conn, ORACLE_PERIOD, base_rows)
                oracle_names = {}
                for live_step, live_id in ran:
                    if live_id in undone:
                        continue
                    replayed = _run_step(conn, live_step, ORACLE_PERIOD)
                    if replayed:
                        oracle_names[replayed] = live_step["name"]
                got = _state(conn, TRIAL_PERIOD, names)
                want = _state(conn, ORACLE_PERIOD, oracle_names)
                assert got == want, (f"trial {trial}: after undoing {order}; steps {steps}; base {base_rows}")
                if rng.random() < 0.3:                # a new import (or deletion) after the undo
                    run(_random_step(rng, chr(ord("A") + len(steps))))
    finally:
        mgr.close_connection(conn)
    assert undos > 400
