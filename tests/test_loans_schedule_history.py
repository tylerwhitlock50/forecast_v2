"""
Loan schedules keep paid history (W1).

Reproduces the external review of 9199391: a legacy loan with one paid
installment lost it (and its actual date, amount and note) when
`PUT /loans/{id}` was sent an UNCHANGED interest rate, and schedules saved
before the calendar-month fix kept their drifted dates (Jan 31 / Mar 2 /
Apr 2). Covers:

* updates only regenerate when a schedule field's value really changes;
* regeneration keeps every recorded row exactly and continues after it;
* `?preview=true` returns the before / after summary without writing;
* `GET /loans/schedule-audit` and `POST /loans/{id}/repair-schedule`
  (dry run first) for legacy schedules, and the pure `schedule_audit` helper.
"""
import os
import shutil
import sqlite3
import sys
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402

PAYMENT_COLS = ("payment_id, loan_id, payment_number, payment_date, payment_amount, principal_payment, "
                "interest_payment, remaining_balance, payment_status, actual_payment_date, actual_payment_amount, notes")


def _insert_loan(conn, loan_id, *, principal=1200, rate=0.0, term=12, start="2026-01-01",
                 payment_type="amortizing", frequency="monthly", name=None):
    conn.execute(
        """INSERT INTO loans (loan_id, loan_name, lender, loan_type, principal_amount, interest_rate, loan_term_months,
               start_date, payment_type, payment_frequency, is_active, current_balance, next_payment_date,
               monthly_payment_amount)
           VALUES (?, ?, 'Bank', 'term_loan', ?, ?, ?, ?, ?, ?, 1, ?, '2026-02-01', 100)""",
        (loan_id, name or loan_id, principal, rate, term, start, payment_type, frequency, principal))


def _insert_rows(conn, loan_id, rows):
    """rows: (number, date, amount, principal, interest, remaining, status, actual_date, actual_amount, notes)."""
    for n, d, amt, prin, intr, rem, status, adate, aamt, notes in rows:
        conn.execute(
            f"INSERT INTO loan_payments ({PAYMENT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"{loan_id}-P{n}", loan_id, n, d, amt, prin, intr, rem, status, adate, aamt, notes))


#: The reviewer's legacy loan: 12-month, 0% loan of 1,200 saved with 30.44-day
#: dates; installment 1 paid on Feb 2 with a note.
LEGACY_ROWS = [
    (1, "2026-01-31", 100, 100, 0, 1100, "paid", "2026-02-02", 100, "Paid by ACH"),
    (2, "2026-03-02", 100, 100, 0, 1000, "scheduled", None, None, None),
    (3, "2026-04-02", 100, 100, 0, 900, "scheduled", None, None, None),
]


def _seed(path):
    conn = sqlite3.connect(path)
    _insert_loan(conn, "LEGACY")
    _insert_rows(conn, "LEGACY", LEGACY_ROWS)
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "loans.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)
    import db.database as dbmod_short
    original = dbmod_short.db_manager
    dbmod_short.db_manager = mgr
    from api import loan_routes
    app = FastAPI()
    app.include_router(loan_routes.router)
    try:
        yield TestClient(app), db_path
    finally:
        dbmod_short.db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def rows(db_path, loan_id):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(f"SELECT {PAYMENT_COLS} FROM loan_payments WHERE loan_id = ? ORDER BY payment_number",
                            (loan_id,)).fetchall()
    finally:
        conn.close()


def execute(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def put(client, loan_id, body, **params):
    r = client.put(f"/loans/{loan_id}", json=body, params=params)
    assert r.status_code == 200, r.text
    return r.json()["data"]


# ---------------------------------------------------------------------------
# PUT /loans/{id}: only real changes regenerate, history is never touched
# ---------------------------------------------------------------------------

class TestUpdateKeepsHistory:
    def test_unchanged_rate_does_not_touch_the_schedule(self, env):
        client, db_path = env
        before = rows(db_path, "LEGACY")
        data = put(client, "LEGACY", {"interest_rate": 0})
        assert data["schedule"] == {"regenerated": False, "kept_paid": 0, "kept": 0, "removed": 0, "added": 0,
                                    "redated": 0}
        assert rows(db_path, "LEGACY") == before          # paid row, its actuals and note all still there
        assert data["changed_fields"] == []

    def test_equivalent_values_are_not_changes(self, env):
        client, db_path = env
        before = rows(db_path, "LEGACY")
        data = put(client, "LEGACY", {
            "interest_rate": 0.0, "principal_amount": 1200.0, "loan_term_months": 12,
            "start_date": "2026-01-01T00:00:00", "payment_type": "amortizing", "payment_frequency": "monthly",
        })
        assert data["schedule"]["regenerated"] is False
        assert rows(db_path, "LEGACY") == before
        execute(db_path, "UPDATE loans SET interest_rate = 5 WHERE loan_id = 'LEGACY'")
        assert put(client, "LEGACY", {"interest_rate": 5.0})["schedule"]["regenerated"] is False
        assert rows(db_path, "LEGACY") == before

    def test_name_only_change_keeps_the_schedule(self, env):
        client, db_path = env
        before = rows(db_path, "LEGACY")
        data = put(client, "LEGACY", {"loan_name": "Renamed", "interest_rate": 0})
        assert data["changed_fields"] == ["loan_name"]
        assert data["schedule"]["regenerated"] is False
        assert rows(db_path, "LEGACY") == before
        loans = client.get("/loans/").json()["data"]["loans"]
        assert loans[0]["loan_name"] == "Renamed"

    def test_rate_change_keeps_paid_row_exactly_and_continues_after_it(self, env):
        client, db_path = env
        paid = rows(db_path, "LEGACY")[0]
        data = put(client, "LEGACY", {"interest_rate": 6})
        assert data["schedule"] == {"regenerated": True, "kept_paid": 1, "kept": 1, "removed": 2, "added": 11,
                                    "redated": 0}
        after = rows(db_path, "LEGACY")
        assert after[0] == paid                            # kept exactly: id, date, amounts, status, actuals, note
        new = after[1:]
        assert [r[2] for r in new] == list(range(2, 13))  # numbering continues after the paid installment
        assert [r[3] for r in new] == ["2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01",
                                       "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01",
                                       "2027-01-01"]       # calendar months, installment n = start + n months
        assert all(r[8] == "scheduled" and r[9] is None and r[10] is None and r[11] is None for r in new)
        # Re-amortised from the paid row's balance (1,100) at 0.5% a month over the 11 remaining months.
        assert new[0][7] < 1100 and new[0][6] == pytest.approx(5.50, abs=0.01)
        assert new[-1][7] == pytest.approx(0, abs=0.01)
        assert sum(r[5] for r in new) == pytest.approx(1100, abs=0.05)
        loan = client.get("/loans/").json()["data"]["loans"][0]
        assert loan["payments_made"] == 1 and loan["payments_remaining"] == 11
        assert loan["current_balance"] == pytest.approx(1100)
        assert loan["next_payment_date"] == "2026-03-01"

    def test_rows_before_the_last_recorded_row_are_kept_too(self, env):
        client, db_path = env
        conn = sqlite3.connect(db_path)
        _insert_loan(conn, "MIX", principal=400, term=4)
        _insert_rows(conn, "MIX", [
            (1, "2026-02-01", 100, 100, 0, 300, "paid", "2026-02-01", 100, None),
            (2, "2026-03-01", 100, 100, 0, 200, "scheduled", None, None, None),      # missed, before a paid one
            (3, "2026-04-01", 100, 100, 0, 100, "scheduled", "2026-04-03", 100, None),  # actuals recorded
            (4, "2026-05-01", 100, 100, 0, 0, "scheduled", None, None, None),
        ])
        conn.commit()
        conn.close()
        before = rows(db_path, "MIX")
        data = put(client, "MIX", {"interest_rate": 12})
        assert data["schedule"]["kept_paid"] == 2 and data["schedule"]["kept"] == 3
        assert data["schedule"]["removed"] == 1 and data["schedule"]["added"] == 1
        after = rows(db_path, "MIX")
        assert after[:3] == before[:3]
        assert after[3][2] == 4 and after[3][3] == "2026-05-01"
        assert after[3][7] == pytest.approx(0, abs=0.01)
        assert after[3][6] == pytest.approx(1.0, abs=0.01)  # 1% of the 100 left after installment 3

    def test_start_date_moved_before_history_never_dates_new_rows_before_it(self, env):
        client, db_path = env
        data = put(client, "LEGACY", {"start_date": "2025-10-01"})
        assert data["schedule"]["regenerated"] is True
        after = rows(db_path, "LEGACY")
        assert after[0][3] == "2026-01-31" and after[0][8] == "paid"
        dates = [r[3] for r in after]
        assert dates == sorted(dates) and len({d[:7] for d in dates}) == len(dates)
        assert after[1][3] == "2026-02-01"
        assert any("start date" in w.lower() for w in data.get("warnings", []))

    def test_quarterly_regeneration_uses_calendar_quarters(self, env):
        client, db_path = env
        conn = sqlite3.connect(db_path)
        _insert_loan(conn, "QTR", principal=4000, term=12, start="2026-01-31", frequency="quarterly")
        _insert_rows(conn, "QTR", [(1, "2026-04-30", 1000, 1000, 0, 3000, "paid", "2026-04-30", 1000, None)])
        conn.commit()
        conn.close()
        put(client, "QTR", {"interest_rate": 4})
        after = rows(db_path, "QTR")
        assert [r[3] for r in after] == ["2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]
        assert after[-1][7] == pytest.approx(0, abs=0.05)

    def test_schedule_endpoint_flags_history_rows(self, env):
        client, _ = env
        data = client.get("/loans/LEGACY/schedule").json()["data"]
        assert [(p["recorded"], p["locked"]) for p in data["payment_schedule"]] == [(True, True), (False, False), (False, False)]
        assert data["history"] == {"recorded": 1, "paid": 1, "last_recorded_payment_number": 1}
        assert data["payment_schedule"][0]["notes"] == "Paid by ACH"

    def test_clearing_a_balloon_date_stores_null(self, env):
        client, db_path = env
        execute(db_path, "UPDATE loans SET balloon_date = '2026-12-01' WHERE loan_id = 'LEGACY'")
        data = put(client, "LEGACY", {"balloon_date": ""}, preview="true")
        assert data["changes"]["balloon_date"] == {"from": "2026-12-01", "to": None}

    def test_unknown_loan_and_bad_values(self, env):
        client, _ = env
        assert client.put("/loans/NOPE", json={"loan_name": "x"}).status_code == 404
        r = client.put("/loans/LEGACY", json={"payment_frequency": "weekly"})
        assert r.status_code == 422 and "payment_frequency" in r.text
        r = client.put("/loans/LEGACY", json={"loan_term_months": 0})
        assert r.status_code == 422


class TestPreview:
    def test_preview_returns_before_after_without_writing(self, env):
        client, db_path = env
        before_rows = rows(db_path, "LEGACY")
        data = put(client, "LEGACY", {"interest_rate": 6, "loan_name": "Changed"}, preview="true")
        assert data["preview"] is True
        assert data["schedule"]["regenerated"] is True
        assert data["schedule"]["kept_paid"] == 1 and data["schedule"]["removed"] == 2 and data["schedule"]["added"] == 11
        # The legacy schedule stops with 900 still owed: no payoff date before, only its last installment.
        assert data["before"]["payoff_date"] is None and data["before"]["last_payment_date"] == "2026-04-02"
        assert data["before"]["final_balance"] == 900 and data["after"]["payoff_date"] == "2027-01-01"
        assert data["before"]["total_interest"] == 0 and data["after"]["total_interest"] > 0
        assert data["before"]["payments"] == 3 and data["after"]["payments"] == 12
        assert data["after"]["paid"] == 1
        assert [r["payment_number"] for r in data["kept_rows"]] == [1]
        assert data["kept_rows"][0]["notes"] == "Paid by ACH"
        assert [r["payment_number"] for r in data["removed_rows"]] == [2, 3]
        assert len(data["new_rows"]) == 11 and data["new_rows"][0]["payment_date"] == "2026-03-01"
        assert sorted(data["changed_fields"]) == ["interest_rate", "loan_name"]
        # Nothing written.
        assert rows(db_path, "LEGACY") == before_rows
        assert client.get("/loans/").json()["data"]["loans"][0]["loan_name"] == "LEGACY"

    def test_preview_body_flag_and_no_change_preview(self, env):
        client, db_path = env
        data = put(client, "LEGACY", {"interest_rate": 0, "preview": True})
        assert data["preview"] is True and data["schedule"]["regenerated"] is False
        assert data["new_rows"] == [] and data["removed_rows"] == []
        assert data["before"]["payoff_date"] == data["after"]["payoff_date"]

    def test_saved_update_reports_the_same_summary(self, env):
        client, _ = env
        preview = put(client, "LEGACY", {"interest_rate": 6}, preview="true")
        saved = put(client, "LEGACY", {"interest_rate": 6})
        assert saved["preview"] is False
        assert saved["schedule"] == preview["schedule"]
        assert saved["after"] == preview["after"]


# ---------------------------------------------------------------------------
# Legacy schedules: audit and controlled repair
# ---------------------------------------------------------------------------

def _seed_complete_legacy(db_path, loan_id="DRIFT"):
    """A complete 3-month legacy schedule with 30.44-day dates, first installment paid."""
    conn = sqlite3.connect(db_path)
    _insert_loan(conn, loan_id, principal=300, term=3)
    _insert_rows(conn, loan_id, [
        (1, "2026-01-31", 100, 100, 0, 200, "paid", "2026-02-02", 100, "Paid by ACH"),
        (2, "2026-03-02", 100, 100, 0, 100, "scheduled", None, None, None),
        (3, "2026-04-02", 100, 100, 0, 0, "scheduled", None, None, None),
    ])
    conn.commit()
    conn.close()


class TestScheduleAudit:
    def test_audit_lists_drifted_and_incomplete_schedules(self, env):
        client, db_path = env
        _seed_complete_legacy(db_path)
        conn = sqlite3.connect(db_path)
        _insert_loan(conn, "CLEAN", principal=200, term=2)
        _insert_rows(conn, "CLEAN", [(1, "2026-02-01", 100, 100, 0, 100, "scheduled", None, None, None),
                                     (2, "2026-03-01", 100, 100, 0, 0, "scheduled", None, None, None)])
        conn.commit()
        conn.close()
        r = client.get("/loans/schedule-audit")
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        by_id = {l["loan_id"]: l for l in data["loans"]}
        assert set(by_id) == {"DRIFT", "LEGACY"} and data["loans_checked"] == 3 and data["loans_with_issues"] == 2
        drift = by_id["DRIFT"]
        assert drift["drifted"] == 2 and drift["wrong_month"] == 0 and drift["paid_rows"] == 1
        assert drift["needs_recompute"] is False and drift["proposed_action"] == "redate"
        assert drift["examples"][0] == {"payment_number": 2, "stored_date": "2026-03-02",
                                        "expected_date": "2026-03-01", "issue": "date_drift"}
        legacy = by_id["LEGACY"]
        assert "incomplete" in legacy["issues"] and legacy["needs_recompute"] is True
        assert legacy["proposed_action"] == "regenerate"

    def test_wrong_month_missing_and_out_of_order(self, env):
        client, db_path = env
        conn = sqlite3.connect(db_path)
        _insert_loan(conn, "MESS", principal=400, term=4)
        _insert_rows(conn, "MESS", [
            (1, "2026-01-31", 100, 100, 0, 300, "scheduled", None, None, None),   # Feb installment in January
            (2, "", 100, 100, 0, 200, "scheduled", None, None, None),             # no date
            (3, "2026-06-01", 100, 100, 0, 100, "scheduled", None, None, None),
            (4, "2026-05-01", 100, 100, 0, 0, "scheduled", None, None, None),     # before #3
        ])
        conn.commit()
        conn.close()
        from api.loan_routes import schedule_audit
        conn = sqlite3.connect(db_path)
        try:
            audit = {a["loan_id"]: a for a in schedule_audit(conn.cursor())}
        finally:
            conn.close()
        mess = audit["MESS"]
        assert mess["wrong_month"] == 2 and mess["missing_dates"] == 1 and mess["out_of_order"] == 1
        assert set(mess["issues"]) >= {"date_drift", "wrong_month", "missing_date", "out_of_order"}
        assert mess["summary"]

    def test_schedules_the_app_creates_are_never_flagged(self, env):
        client, _ = env
        base = {"lender": "Bank", "loan_type": "term_loan", "principal_amount": 250000, "start_date": "2026-01-31"}
        created = []
        for extra in ({"interest_rate": 6.5, "loan_term_months": 60, "payment_type": "amortizing"},
                      {"interest_rate": 8, "loan_term_months": 36, "payment_type": "amortizing", "payment_frequency": "quarterly"},
                      {"interest_rate": 5, "loan_term_months": 24, "payment_type": "amortizing", "payment_frequency": "annually"},
                      {"interest_rate": 7, "loan_term_months": 36, "payment_type": "interest_only", "balloon_date": "2027-07-31"},
                      {"interest_rate": 7, "loan_term_months": 24, "payment_type": "interest_only"},
                      {"interest_rate": 0, "loan_term_months": 7, "payment_type": "amortizing"}):
            r = client.post("/loans/", json={**base, **extra, "loan_name": f"New {len(created)}"})
            assert r.status_code == 200, r.text
            created.append(r.json()["data"]["loan_id"])
        flagged = {a["loan_id"] for a in client.get("/loans/schedule-audit").json()["data"]["loans"]}
        assert not flagged & set(created)
        # Quarterly / annual schedules now pay off exactly at the end of the term.
        for loan_id in created[1:3]:
            sched = client.get(f"/loans/{loan_id}/schedule").json()["data"]["payment_schedule"]
            assert sched[-1]["remaining_balance"] == 0

    def test_full_term_schedule_that_does_not_pay_off_is_flagged(self, env):
        client, db_path = env
        conn = sqlite3.connect(db_path)
        _insert_loan(conn, "RESIDUE", principal=300, term=3)
        _insert_rows(conn, "RESIDUE", [(1, "2026-02-01", 95, 95, 0, 205, "paid", None, None, None),
                                       (2, "2026-03-01", 95, 95, 0, 110, "scheduled", None, None, None),
                                       (3, "2026-04-01", 95, 95, 0, 15, "scheduled", None, None, None)])
        conn.commit()
        conn.close()
        audit = {a["loan_id"]: a for a in client.get("/loans/schedule-audit").json()["data"]["loans"]}
        assert audit["RESIDUE"]["issues"] == ["incomplete"] and audit["RESIDUE"]["balance_left"] == 15
        assert "leaves $15.00 unpaid" in audit["RESIDUE"]["summary"]
        data = client.post("/loans/RESIDUE/repair-schedule", json={"dry_run": False}).json()["data"]
        assert data["action"] == "regenerate" and data["after"]["final_balance"] == 0
        assert [r[7] for r in rows(db_path, "RESIDUE")] == [205, 102.5, 0]

    def test_helper_is_pure_and_reads_only(self, env):
        _, db_path = env
        from api.loan_routes import schedule_audit
        before = rows(db_path, "LEGACY")
        conn = sqlite3.connect(db_path)
        try:
            result = schedule_audit(conn.cursor())
            assert not conn.in_transaction
        finally:
            conn.close()
        assert isinstance(result, list) and result[0]["loan_id"] == "LEGACY"
        assert rows(db_path, "LEGACY") == before


class TestRepair:
    def test_dry_run_then_repair_redates_unpaid_rows_only(self, env):
        client, db_path = env
        _seed_complete_legacy(db_path)
        before = rows(db_path, "DRIFT")
        r = client.post("/loans/DRIFT/repair-schedule", json={"dry_run": True})
        assert r.status_code == 200, r.text
        preview = r.json()["data"]
        assert preview["dry_run"] is True and preview["action"] == "redate"
        assert preview["schedule"] == {"regenerated": False, "kept_paid": 1, "kept": 1, "removed": 0, "added": 0,
                                       "redated": 2}
        assert preview["redated_rows"] == [
            {"payment_number": 2, "from_date": "2026-03-02", "to_date": "2026-03-01"},
            {"payment_number": 3, "from_date": "2026-04-02", "to_date": "2026-04-01"},
        ]
        assert preview["before"]["payoff_date"] == "2026-04-02" and preview["after"]["payoff_date"] == "2026-04-01"
        assert rows(db_path, "DRIFT") == before            # dry run writes nothing

        r = client.post("/loans/DRIFT/repair-schedule", json={"dry_run": False})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["schedule"]["redated"] == 2
        after = rows(db_path, "DRIFT")
        assert after[0] == before[0]                        # paid row untouched (still Jan 31, with actuals)
        assert [r_[3] for r_ in after[1:]] == ["2026-03-01", "2026-04-01"]
        # Amounts unchanged: only the dates moved.
        assert [r_[4:9] for r_ in after[1:]] == [b[4:9] for b in before[1:]]
        audit = client.get("/loans/schedule-audit").json()["data"]
        assert "DRIFT" not in {l["loan_id"] for l in audit["loans"]}

    def test_dry_run_is_the_default(self, env):
        client, db_path = env
        _seed_complete_legacy(db_path)
        before = rows(db_path, "DRIFT")
        r = client.post("/loans/DRIFT/repair-schedule")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["dry_run"] is True
        assert rows(db_path, "DRIFT") == before

    def test_incomplete_schedule_is_recomputed_after_the_paid_row(self, env):
        client, db_path = env
        paid = rows(db_path, "LEGACY")[0]
        r = client.post("/loans/LEGACY/repair-schedule", json={"dry_run": False})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["action"] == "regenerate"
        assert data["schedule"]["regenerated"] is True and data["schedule"]["kept_paid"] == 1
        assert data["schedule"]["removed"] == 2 and data["schedule"]["added"] == 11
        after = rows(db_path, "LEGACY")
        assert after[0] == paid
        assert [r_[3] for r_ in after[1:3]] == ["2026-03-01", "2026-04-01"]
        assert after[-1][3] == "2027-01-01" and after[-1][7] == pytest.approx(0, abs=0.01)
        assert all(r_[4] == pytest.approx(100) for r_ in after[1:])   # 0% loan: 1,100 over 11 months

    def test_broken_balance_chain_is_recomputed(self, env):
        client, db_path = env
        _seed_complete_legacy(db_path)
        execute(db_path, "UPDATE loan_payments SET remaining_balance = 150 WHERE loan_id = 'DRIFT' AND payment_number = 2")
        audit = {a["loan_id"]: a for a in client.get("/loans/schedule-audit").json()["data"]["loans"]}
        assert "balance_break" in audit["DRIFT"]["issues"] and audit["DRIFT"]["needs_recompute"] is True
        data = client.post("/loans/DRIFT/repair-schedule", json={"dry_run": False}).json()["data"]
        assert data["action"] == "regenerate"
        after = rows(db_path, "DRIFT")
        assert [r_[7] for r_ in after] == [200, 100, 0]

    def test_clean_loan_repair_is_a_no_op(self, env):
        client, db_path = env
        conn = sqlite3.connect(db_path)
        _insert_loan(conn, "CLEAN", principal=200, term=2)
        _insert_rows(conn, "CLEAN", [(1, "2026-02-01", 100, 100, 0, 100, "paid", None, None, None),
                                     (2, "2026-03-01", 100, 100, 0, 0, "scheduled", None, None, None)])
        conn.commit()
        conn.close()
        before = rows(db_path, "CLEAN")
        data = client.post("/loans/CLEAN/repair-schedule", json={"dry_run": False}).json()["data"]
        assert data["action"] == "none" and data["schedule"]["redated"] == 0
        assert rows(db_path, "CLEAN") == before

    def test_repair_unknown_loan(self, env):
        client, _ = env
        assert client.post("/loans/NOPE/repair-schedule", json={"dry_run": True}).status_code == 404
