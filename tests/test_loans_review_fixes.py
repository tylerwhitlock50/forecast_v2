"""
Loan schedule fixes from the v12 review (findings LN-1 .. LN-12 and the
legacy-check wording). Each class reproduces one finding:

* LN-1  legacy month-end schedules are repaired onto the loan's calendar
        (installment n = start + n periods) without moving rows already on it;
        a push past the last recorded payment warns with the payoff dates.
* LN-2  a payment-frequency change after recorded payments continues from the
        last kept payment, to maturity, with interest for the months covered.
* LN-3  a principal correction after recorded payments re-amortises the
        difference (refused when it would leave a negative balance).
* LN-4  a start date after the recorded payment history is refused.
* LN-5  interest-only loans repay their principal at maturity; schedules that
        do not end at zero are flagged; payoff_date only when paid off.
* LN-7  amortizing loans honour balloon_date / balloon_payment; balloon fields
        are validated on create and on the merged values of an update.
* LN-8  ?preview=true plus a body "preview" flag is not a changed field.
* LN-9  inactive loans do not affect the statements in the audit.
* LN-11 terms must be whole payment periods; stored odd terms end with a
        short final installment at maturity.
* LN-12 GET /loans/cash-flow balances follow the schedule and tie to the
        balance sheet.
* LEGACY-LOAN-WORDING  the legacy check names the real statement impact.

From the v13 recheck:

* LN3-R every rebuild, re-date and repair repays the loan's current
        principal: the rows after the history repay the principal less the
        kept rows' principal (a principal change is never lost on a later
        edit or repair), the audit accepts such a schedule and flags one that
        lost the difference, and the statements open a later window on the
        same debt.
* LN1-R another payment frequency's calendar is followed only for history
        really kept from before a frequency change; a tail pushed off the
        loan's own calendar always warns with the payoff dates.
"""
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402

PAYMENT_COLS = ("payment_id, loan_id, payment_number, payment_date, payment_amount, principal_payment, "
                "interest_payment, remaining_balance, payment_status, actual_payment_date, actual_payment_amount, notes")


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "loans.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Base', 1)")
    conn.commit()
    conn.close()
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


def insert_loan(db_path, loan_id, *, principal, rate=0.0, term=12, start="2026-01-01", payment_type="amortizing",
                frequency="monthly", active=1, balloon_date=None, balloon_payment=None):
    conn = sqlite3.connect(db_path)
    conn.execute(
        """INSERT INTO loans (loan_id, loan_name, lender, loan_type, principal_amount, interest_rate, loan_term_months,
               start_date, payment_type, payment_frequency, balloon_payment, balloon_date, is_active, current_balance,
               next_payment_date, monthly_payment_amount)
           VALUES (?, ?, 'Bank', 'term_loan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100)""",
        (loan_id, loan_id, principal, rate, term, start, payment_type, frequency, balloon_payment, balloon_date, active,
         principal, start))
    conn.commit()
    conn.close()


def insert_rows(db_path, loan_id, rows):
    """rows: (number, date, amount, principal, interest, remaining, status)."""
    conn = sqlite3.connect(db_path)
    for n, d, amt, prin, intr, rem, status in rows:
        conn.execute(
            f"INSERT INTO loan_payments ({PAYMENT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
            (f"{loan_id}-P{n}", loan_id, n, d, amt, prin, intr, rem, status))
    conn.commit()
    conn.close()


def schedule(db_path, loan_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            f"SELECT {PAYMENT_COLS} FROM loan_payments WHERE loan_id = ? ORDER BY payment_number", (loan_id,))]
    finally:
        conn.close()


def execute(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def create(client, **fields):
    body = {"loan_name": "Loan", "lender": "Bank", "loan_type": "term_loan", "payment_type": "amortizing", **fields}
    r = client.post("/loans/", json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]["loan_id"]


def put(client, loan_id, body, **params):
    r = client.put(f"/loans/{loan_id}", json=body, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def mark_paid(db_path, loan_id, *numbers):
    for n in numbers:
        execute(db_path, "UPDATE loan_payments SET payment_status = 'paid' WHERE loan_id = ? AND payment_number = ?",
                (loan_id, n))


def audit(client):
    body = client.get("/loans/schedule-audit").json()
    data = dict(body["data"], message=body["message"])
    return data, {a["loan_id"]: a for a in data["loans"]}


def statements(db_path, start, end):
    """build_statements for F001; every month must still balance."""
    from services.financial_statements import build_statements
    conn = sqlite3.connect(db_path)
    try:
        result = build_statements(conn.cursor(), ["F001"], start, end)
    finally:
        conn.close()
    assert all(abs(row["balance_check"]) < 0.01 for row in result["balance_sheet"]["by_period"])
    return result


def legacy_dates(start, count):
    """Dates the pre-fix code saved: start + 30.44 * n days."""
    return [(start + timedelta(days=30.44 * n)).isoformat() for n in range(1, count + 1)]


# ---------------------------------------------------------------------------
# LN-1: legacy month-end repair stays on the loan's calendar
# ---------------------------------------------------------------------------

def _seed_month_end_legacy(db_path):
    """12-month 0% loan of 12,000 from Jan 31 with 30.44-day dates; #1 (Mar 2) paid."""
    insert_loan(db_path, "LEGX", principal=12000, term=12, start="2026-01-31")
    dates = legacy_dates(date(2026, 1, 31), 12)
    assert dates[0] == "2026-03-02" and dates[10] == "2026-12-31" and dates[11] == "2027-01-31"
    insert_rows(db_path, "LEGX", [(n, d, 1000, 1000, 0, 12000 - 1000 * n, "paid" if n == 1 else "scheduled")
                                  for n, d in enumerate(dates, start=1)])


class TestLegacyMonthEndRepair:
    def test_repair_keeps_rows_already_on_the_calendar_and_the_maturity(self, env):
        client, db_path = env
        _seed_month_end_legacy(db_path)
        data = client.post("/loans/LEGX/repair-schedule", json={"dry_run": True}).json()["data"]
        assert data["action"] == "redate"
        assert data["before"]["payoff_date"] == "2027-01-31" and data["after"]["payoff_date"] == "2027-01-31"
        moved = {r["payment_number"]: (r["from_date"], r["to_date"]) for r in data["redated_rows"]}
        assert moved[2] == ("2026-04-01", "2026-03-31")
        assert moved[3] == ("2026-05-02", "2026-04-30")
        assert 11 not in moved and 12 not in moved          # already on their calendar dates: not moved
        assert data["warnings"] == []

        _, by_id = audit(client)
        example = by_id["LEGX"]["examples"][0]
        assert example == {"payment_number": 2, "stored_date": "2026-04-01", "expected_date": "2026-03-31",
                           "issue": "wrong_month"}
        # #2-#8 and #10 sit in the month after their due date; #9, #11 and #12 are on it.
        assert by_id["LEGX"]["wrong_month"] == 8 and by_id["LEGX"]["drifted"] == 8

        client.post("/loans/LEGX/repair-schedule", json={"dry_run": False})
        after = schedule(db_path, "LEGX")
        assert after[0]["payment_date"] == "2026-03-02"                     # paid row untouched
        assert [r["payment_date"] for r in after[1:]] == [
            "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30",
            "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]
        assert sum(1 for r in after if r["payment_date"].startswith("2026")) == 11
        assert "LEGX" not in audit(client)[1]

    def test_rate_change_rebuilds_onto_the_calendar_without_a_push(self, env):
        client, db_path = env
        _seed_month_end_legacy(db_path)
        data = put(client, "LEGX", {"interest_rate": 6}, preview="true")["data"]
        assert data["new_rows"][0]["payment_date"] == "2026-03-31"
        assert data["new_rows"][-1]["payment_date"] == "2027-01-31"
        assert data["after"]["payoff_date"] == "2027-01-31"
        assert data["warnings"] == []

    def test_a_push_past_the_last_recorded_payment_warns_with_the_payoff_dates(self, env):
        """#1 is recorded a whole month after its calendar date, so the unpaid rows are pushed after it."""
        client, db_path = env
        insert_loan(db_path, "PUSH", principal=1200, term=12, start="2026-01-01")
        rows = [(1, "2026-03-01", 100, 100, 0, 1100, "paid")]
        rows += [(n, f"2026-{n + 1:02d}-03" if n < 12 else "2027-01-03", 100, 100, 0, 1200 - 100 * n, "scheduled")
                 for n in range(2, 13)]
        insert_rows(db_path, "PUSH", rows)
        data = client.post("/loans/PUSH/repair-schedule", json={"dry_run": True}).json()["data"]
        assert data["action"] == "redate"
        to = {r["payment_number"]: r["to_date"] for r in data["redated_rows"]}
        assert to[2] == "2026-04-01" and to[12] == "2027-02-01"
        assert data["after"]["payoff_date"] == "2027-02-01"
        assert any("Jan 3, 2027" in w and "Feb 1, 2027" in w for w in data["warnings"]), data["warnings"]

    def test_a_push_on_regenerate_warns_with_the_payoff_dates(self, env):
        """Start date moved earlier: installment 2 would fall before the paid #1, so the rest follow it."""
        client, db_path = env
        loan_id = create(client, principal_amount=1200, interest_rate=0, loan_term_months=12, start_date="2026-01-01")
        mark_paid(db_path, loan_id, 1)                                   # #1 due Feb 1, 2026
        data = put(client, loan_id, {"start_date": "2025-10-01"}, preview="true")["data"]
        assert data["new_rows"][0]["payment_date"] == "2026-03-01"       # first calendar date after the paid row
        assert data["new_rows"][-1]["payment_date"] == "2026-10-01"      # the new maturity
        assert any("Dec 1, 2025" in w and "payoff moves from Jan 1, 2027 to Oct 1, 2026" in w
                   for w in data["warnings"]), data["warnings"]


# ---------------------------------------------------------------------------
# LN-2: frequency change after recorded payments
# ---------------------------------------------------------------------------

class TestFrequencyChange:
    def test_monthly_to_quarterly_continues_after_the_last_paid_installment(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=120000, interest_rate=6, loan_term_months=36, start_date="2027-01-31")
        mark_paid(db_path, loan_id, 1, 2, 3)
        before_rows = schedule(db_path, loan_id)
        data = put(client, loan_id, {"payment_frequency": "quarterly"}, preview="true")["data"]
        assert schedule(db_path, loan_id) == before_rows
        assert data["kept_rows"][-1]["payment_date"] == "2027-04-30"
        assert data["kept_rows"][-1]["remaining_balance"] == pytest.approx(110802.27, abs=0.01)
        new = data["new_rows"]
        assert [r["payment_date"] for r in new] == [
            "2027-07-31", "2027-10-31", "2028-01-31", "2028-04-30", "2028-07-31", "2028-10-31", "2029-01-31",
            "2029-04-30", "2029-07-31", "2029-10-31", "2030-01-31"]
        assert [r["payment_number"] for r in new] == list(range(4, 15))
        assert new[0]["interest_payment"] == pytest.approx(110802.27 * 0.015, abs=0.01)
        assert new[-1]["remaining_balance"] == 0
        assert data["after"]["payoff_date"] == "2030-01-31"
        assert any("frequency" in w.lower() and "quarterly" in w for w in data["warnings"]), data["warnings"]
        # 11 quarterly installments repay 110,802.27 at 1.5% a quarter.
        assert sum(r["interest_payment"] for r in new) == pytest.approx(10220, abs=15)

        put(client, loan_id, {"payment_frequency": "quarterly"})
        assert loan_id not in audit(client)[1]
        # A later edit keeps the quarterly tail where it is (no jump to start + n quarters).
        mark_paid(db_path, loan_id, 4)
        data = put(client, loan_id, {"interest_rate": 7}, preview="true")["data"]
        assert data["new_rows"][0]["payment_date"] == "2027-10-31"
        assert data["new_rows"][-1]["payment_date"] == "2030-01-31"
        assert data["warnings"] == []

    def test_quarterly_to_monthly_pays_off_at_maturity(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=12000, interest_rate=6, loan_term_months=12, start_date="2027-01-31",
                         payment_frequency="quarterly")
        mark_paid(db_path, loan_id, 1)
        data = put(client, loan_id, {"payment_frequency": "monthly"})["data"]
        new = data["new_rows"]
        assert new[0]["payment_date"] == "2027-05-31"
        assert new[-1]["payment_date"] == "2028-01-31" and len(new) == 9
        assert new[-1]["remaining_balance"] == 0
        assert loan_id not in audit(client)[1]

    def test_quarterly_to_annually_first_installment_a_year_after_the_paid_one(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=36,
                         start_date="2027-01-31", payment_frequency="quarterly")
        mark_paid(db_path, loan_id, 1)
        data = put(client, loan_id, {"payment_frequency": "annually"}, preview="true")["data"]
        new = data["new_rows"]
        assert [r["payment_date"] for r in new] == ["2028-04-30", "2029-04-30", "2030-01-31"]
        balance = data["kept_rows"][-1]["remaining_balance"]
        assert new[0]["interest_payment"] == pytest.approx(balance * 0.06, abs=0.01)
        # The last installment covers the 9 months left to maturity.
        assert new[-1]["interest_payment"] == pytest.approx(new[-2]["remaining_balance"] * 0.06 * 9 / 12, abs=0.01)
        assert new[-1]["remaining_balance"] == 0


# ---------------------------------------------------------------------------
# LN-3: principal correction after recorded payments
# ---------------------------------------------------------------------------

class TestPrincipalChange:
    def test_difference_is_re_amortised_and_the_debt_reaches_zero(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=12, start_date="2027-01-15")
        mark_paid(db_path, loan_id, 1, 2)
        preview = put(client, loan_id, {"principal_amount": 120000}, preview="true")["data"]
        assert preview["after"]["total_principal"] == pytest.approx(120000, abs=0.05)
        assert preview["after"]["final_balance"] == 0
        assert any("principal" in w.lower() and "20,000.00" in w for w in preview["warnings"]), preview["warnings"]
        put(client, loan_id, {"principal_amount": 120000})
        rows = schedule(db_path, loan_id)
        assert sum(r["principal_payment"] for r in rows) == pytest.approx(120000, abs=0.05)
        st = statements(db_path, "2027-01", "2028-06")
        loan = st["detail"]["loans"][loan_id]
        assert sum(loan["proceeds"].values()) - sum(loan["principal"].values()) == pytest.approx(0, abs=0.05)
        assert st["balance_sheet"]["by_period"][-1]["debt"] == pytest.approx(0, abs=0.05)

    def test_lowering_the_principal_below_what_is_repaid_is_refused(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=12, start_date="2027-01-15")
        mark_paid(db_path, loan_id, 1, 2)
        before = schedule(db_path, loan_id)
        for params in ({"preview": "true"}, {}):
            r = client.put(f"/loans/{loan_id}", json={"principal_amount": 10000}, params=params)
            assert r.status_code == 422, r.text
            assert "already repaid" in r.json()["detail"]
        assert schedule(db_path, loan_id) == before

    def test_matured_all_paid_loan_gets_one_final_installment(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=12000, interest_rate=0, loan_term_months=12, start_date="2021-01-15")
        mark_paid(db_path, loan_id, *range(1, 13))
        data = put(client, loan_id, {"principal_amount": 15000})["data"]
        assert len(data["new_rows"]) == 1 and data["new_rows"][0]["principal_payment"] == pytest.approx(3000)
        assert data["after"]["final_balance"] == 0


# ---------------------------------------------------------------------------
# LN-4: start date after the recorded payments
# ---------------------------------------------------------------------------

class TestStartDateAfterHistory:
    def test_start_date_after_recorded_payments_is_refused(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=50000, interest_rate=6, loan_term_months=24, start_date="2027-01-31")
        mark_paid(db_path, loan_id, 1, 2)
        before = schedule(db_path, loan_id)
        for params in ({"preview": "true"}, {}):
            r = client.put(f"/loans/{loan_id}", json={"start_date": "2027-06-30"}, params=params)
            assert r.status_code == 422, r.text
            detail = r.json()["detail"]
            assert "Feb 28, 2027" in detail and "before it starts" in detail
        assert schedule(db_path, loan_id) == before
        assert client.get("/loans/").json()["data"]["loans"][0]["start_date"] == "2027-01-31"

    def test_a_later_start_on_or_before_the_first_recorded_payment_is_accepted(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=50000, interest_rate=6, loan_term_months=24, start_date="2027-01-31")
        mark_paid(db_path, loan_id, 1)
        data = put(client, loan_id, {"start_date": "2027-02-15"})["data"]
        assert data["changed_fields"] == ["start_date"]


# ---------------------------------------------------------------------------
# LN-5: interest-only loans repay at maturity
# ---------------------------------------------------------------------------

class TestInterestOnlyMaturity:
    def test_interest_only_without_balloon_repays_principal_at_maturity(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=12,
                         start_date="2027-01-15", payment_type="interest_only")
        rows = schedule(db_path, loan_id)
        assert len(rows) == 12 and rows[-1]["payment_date"] == "2028-01-15"
        assert rows[-1]["principal_payment"] == 100000 and rows[-1]["remaining_balance"] == 0
        assert all(r["interest_payment"] == 500 for r in rows)
        st = statements(db_path, "2027-01", "2029-12")
        totals = st["cash_flow"]["totals"]
        # Cash flow signs: proceeds in, principal repaid out.
        assert totals["loan_proceeds"] == pytest.approx(100000) and totals["principal_payments"] == pytest.approx(-100000)
        assert st["balance_sheet"]["by_period"][-1]["debt"] == pytest.approx(0, abs=0.01)

    def test_clearing_the_balloon_date_repays_at_maturity(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=50000, interest_rate=6, loan_term_months=24, start_date="2027-01-15",
                         payment_type="interest_only", balloon_date="2027-12-15")
        assert len(schedule(db_path, loan_id)) == 11
        data = put(client, loan_id, {"balloon_date": ""})["data"]
        assert data["after"]["payoff_date"] == "2029-01-15" and data["after"]["final_balance"] == 0

    def test_saved_schedule_left_at_full_balance_is_flagged_and_not_called_a_payoff(self, env):
        client, db_path = env
        insert_loan(db_path, "IOLEG", principal=100000, rate=6, term=12, start="2027-01-15", payment_type="interest_only")
        insert_rows(db_path, "IOLEG", [(n, f"2027-{n + 1:02d}-15" if n < 12 else "2028-01-15", 500, 0, 500, 100000,
                                        "scheduled") for n in range(1, 13)])
        _, by_id = audit(client)
        assert "incomplete" in by_id["IOLEG"]["issues"] and by_id["IOLEG"]["statement_impact"] is True
        assert "$100,000.00 unpaid" in by_id["IOLEG"]["summary"]
        r = client.put("/loans/IOLEG", json={"loan_name": "Renamed"}, params={"preview": "true"}).json()["data"]
        assert r["before"]["payoff_date"] is None and r["before"]["final_balance"] == 100000
        assert r["before"]["last_payment_date"] == "2028-01-15"
        data = client.post("/loans/IOLEG/repair-schedule", json={"dry_run": True}).json()
        assert data["data"]["before"]["payoff_date"] is None
        assert data["data"]["after"]["payoff_date"] == "2028-01-15"
        assert data["data"]["after"]["final_balance"] == 0

    def test_preview_message_does_not_call_an_unpaid_end_a_payoff(self, env):
        from api.loan_routes import _describe_plan
        plan = {"action": "regenerate"}
        payload = {"schedule": {"kept_paid": 0, "removed": 2, "added": 2},
                   "after": {"payoff_date": None, "last_payment_date": "2028-01-15", "final_balance": 1000.0}}
        text = _describe_plan(plan, payload)
        assert "payoff" not in text and "$1,000.00 still owed" in text


# ---------------------------------------------------------------------------
# LN-7: balloons on amortizing loans, validated on create and update
# ---------------------------------------------------------------------------

class TestBalloons:
    def test_amortizing_loan_pays_the_balance_on_the_balloon_date(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=300000, interest_rate=8, loan_term_months=240,
                         start_date="2027-01-01", balloon_date="2032-01-01")
        rows = schedule(db_path, loan_id)
        assert len(rows) == 60 and rows[-1]["payment_date"] == "2032-01-01"
        assert rows[0]["payment_amount"] == pytest.approx(2509.32, abs=0.01)   # 20-year amortization
        assert rows[-1]["principal_payment"] == pytest.approx(rows[-2]["remaining_balance"], abs=0.01)
        assert rows[-1]["remaining_balance"] == 0
        # Same balance as month 59 of the 20-year amortization (262,576.77 after month 60, plus its principal).
        assert rows[-2]["remaining_balance"] == pytest.approx(263330.55, abs=0.05)
        st = statements(db_path, "2027-01", "2032-03")
        assert st["balance_sheet"]["by_period"][-1]["debt"] == pytest.approx(0, abs=0.05)

    def test_balloon_payment_sizes_a_partially_amortizing_loan(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=300000, interest_rate=8, loan_term_months=60,
                         start_date="2027-01-01", balloon_payment=250000)
        rows = schedule(db_path, loan_id)
        assert len(rows) == 60 and rows[-1]["remaining_balance"] == 0
        level = rows[0]["payment_amount"]
        assert level < 3000                         # not the 6,083 of a full 5-year amortization
        assert rows[-1]["payment_amount"] == pytest.approx(level + 250000, abs=1)

    def test_balloon_only_change_rebuilds_the_schedule(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=300000, interest_rate=8, loan_term_months=240,
                         start_date="2027-01-01")
        data = put(client, loan_id, {"balloon_date": "2032-01-01"}, preview="true")["data"]
        assert data["before"] != data["after"] and data["after"]["payoff_date"] == "2032-01-01"

    @pytest.mark.parametrize("extra, text", [
        ({"balloon_date": "2020-01-01"}, "after start_date"),
        ({"balloon_date": "2027-01-01"}, "after start_date"),
        ({"balloon_date": "2048-01-01"}, "maturity"),
        ({"balloon_payment": 999999999}, "principal_amount"),
    ])
    def test_bad_balloons_are_refused_on_create(self, env, extra, text):
        client, _ = env
        body = {"loan_name": "B", "lender": "Bank", "loan_type": "term_loan", "principal_amount": 300000,
                "interest_rate": 8, "loan_term_months": 240, "start_date": "2027-01-01", "payment_type": "amortizing",
                **extra}
        r = client.post("/loans/", json=body)
        assert r.status_code == 422 and text in r.json()["detail"], r.text

    def test_balloon_checks_use_the_merged_values_on_update(self, env):
        client, _ = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=60,
                         start_date="2027-01-01", balloon_date="2030-01-01")
        r = client.put(f"/loans/{loan_id}", json={"loan_term_months": 24})       # balloon now after maturity
        assert r.status_code == 422 and "maturity" in r.json()["detail"], r.text
        r = client.put(f"/loans/{loan_id}", json={"start_date": "2030-06-01"})   # balloon now before the start
        assert r.status_code == 422 and "after start_date" in r.json()["detail"], r.text
        r = client.put(f"/loans/{loan_id}", json={"balloon_payment": 150000}, params={"preview": "true"})
        assert r.status_code == 422 and "principal_amount" in r.json()["detail"], r.text
        # Unrelated edits are not blocked by checks on fields they do not touch.
        assert client.put(f"/loans/{loan_id}", json={"loan_name": "Renamed"}).status_code == 200

    def test_interest_only_balloon_payment_that_differs_is_reported(self, env):
        client, _ = env
        r = client.post("/loans/", json={
            "loan_name": "IO", "lender": "Bank", "loan_type": "term_loan", "principal_amount": 400000,
            "interest_rate": 8, "loan_term_months": 60, "start_date": "2027-01-01", "payment_type": "interest_only",
            "balloon_date": "2030-01-01", "balloon_payment": 100000})
        assert r.status_code == 200, r.text
        assert any("400,000.00" in w for w in r.json()["data"]["warnings"])

    def test_mcp_tool_documents_the_balloon_fields(self):
        from mcp_server.tools import loans
        import inspect
        doc = inspect.getdoc(loans.create_loan)
        assert "balloon_date" in doc and "maturity" in doc
        hints = str(inspect.signature(loans.create_loan).parameters["balloon_date"].annotation)
        assert "start_date" in hints


# ---------------------------------------------------------------------------
# LN-8: preview flag in the query and the body
# ---------------------------------------------------------------------------

class TestPreviewFlag:
    def test_body_preview_flag_is_never_a_changed_field(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=10.25, loan_term_months=12,
                         start_date="2026-01-01")
        before = schedule(db_path, loan_id)
        out = put(client, loan_id, {"preview": True, "interest_rate": 10.25}, preview="true")
        assert out["data"]["changed_fields"] == [] and out["data"]["changes"] == {}
        assert out["message"].startswith("No changes")
        out = put(client, loan_id, {"preview": False, "interest_rate": 6}, preview="true")
        assert out["data"]["changed_fields"] == ["interest_rate"] and out["data"]["preview"] is True
        r = client.put(f"/loans/{loan_id}", json={"preview": True}, params={"preview": "true"})
        assert r.status_code == 400 and "No fields to update" in r.text
        assert schedule(db_path, loan_id) == before


# ---------------------------------------------------------------------------
# LN-9: inactive loans in the audit
# ---------------------------------------------------------------------------

class TestInactiveLoansInAudit:
    def test_inactive_drifted_loan_is_listed_but_does_not_affect_the_statements(self, env):
        client, db_path = env
        insert_loan(db_path, "LEG10", principal=12000, term=12, start="2026-01-31", active=0)
        insert_rows(db_path, "LEG10", [(n, d, 1000, 1000, 0, 12000 - 1000 * n, "scheduled")
                                       for n, d in enumerate(legacy_dates(date(2026, 1, 31), 12), start=1)])
        data, by_id = audit(client)
        entry = by_id["LEG10"]
        assert entry["is_active"] is False and entry["wrong_month"] > 0
        assert entry["statement_impact"] is False and entry["severity"] == "info"
        assert "inactive" in entry["summary"].lower()
        assert data["loans_affecting_statements"] == 0 and "affect" not in data["message"]
        from api.loan_routes import schedule_audit
        from services.governance import loan_schedule_issue
        conn = sqlite3.connect(db_path)
        try:
            issue = loan_schedule_issue(schedule_audit(conn.cursor()))
        finally:
            conn.close()
        assert issue["severity"] == "info"

    def test_inactive_loan_with_a_bad_start_date_is_info(self, env):
        client, db_path = env
        insert_loan(db_path, "BADSTART", principal=1000, term=12, start="not a date", active=0)
        _, by_id = audit(client)
        assert by_id["BADSTART"]["statement_impact"] is False and by_id["BADSTART"]["severity"] == "info"


# ---------------------------------------------------------------------------
# LN-11: terms that are not whole payment periods
# ---------------------------------------------------------------------------

class TestTermsAndFrequency:
    @pytest.mark.parametrize("frequency, term", [("quarterly", 10), ("annually", 18), ("quarterly", 2)])
    def test_create_refuses_a_term_that_is_not_whole_periods(self, env, frequency, term):
        client, _ = env
        r = client.post("/loans/", json={
            "loan_name": "Q", "lender": "Bank", "loan_type": "term_loan", "principal_amount": 30000,
            "interest_rate": 6, "loan_term_months": term, "start_date": "2027-01-15", "payment_type": "amortizing",
            "payment_frequency": frequency})
        assert r.status_code == 422 and "multiple of" in r.json()["detail"], r.text

    def test_update_checks_the_merged_term_and_frequency(self, env):
        client, _ = env
        loan_id = create(client, principal_amount=30000, interest_rate=6, loan_term_months=10, start_date="2027-01-15")
        r = client.put(f"/loans/{loan_id}", json={"payment_frequency": "quarterly"}, params={"preview": "true"})
        assert r.status_code == 422 and "multiple of 3" in r.json()["detail"], r.text
        loan_id = create(client, principal_amount=30000, interest_rate=6, loan_term_months=12, start_date="2027-01-15",
                         payment_frequency="quarterly")
        r = client.put(f"/loans/{loan_id}", json={"loan_term_months": 10})
        assert r.status_code == 422 and "9 or 12" in r.json()["detail"], r.text

    def test_stored_odd_term_gets_a_short_final_installment_at_maturity(self, env):
        client, db_path = env
        insert_loan(db_path, "ODD", principal=30000, rate=6, term=10, start="2027-01-15", frequency="quarterly")
        data, by_id = audit(client)
        assert "no_schedule" in by_id["ODD"]["issues"]
        client.post("/loans/ODD/repair-schedule", json={"dry_run": False})
        rows = schedule(db_path, "ODD")
        assert [r["payment_date"] for r in rows] == ["2027-04-15", "2027-07-15", "2027-10-15", "2027-11-15"]
        assert rows[-1]["remaining_balance"] == 0
        assert rows[-1]["interest_payment"] == pytest.approx(rows[-2]["remaining_balance"] * 0.06 / 12, abs=0.01)
        assert "ODD" not in audit(client)[1]
        # A rename of a stored odd-term loan is not blocked by the term check.
        assert client.put("/loans/ODD", json={"loan_name": "Renamed"}).status_code == 200

    def test_generator_never_returns_an_empty_schedule_for_a_balance(self):
        from api.loan_routes import generate_amortization_schedule
        rows = generate_amortization_schedule("X", 30000, 0.06, 2, "2027-01-15", payment_frequency="quarterly")
        assert [r.payment_date for r in rows] == ["2027-03-15"] and rows[-1].remaining_balance == 0


# ---------------------------------------------------------------------------
# LN-12: cash-flow balances
# ---------------------------------------------------------------------------

class TestLoanCashFlow:
    def test_remaining_balance_follows_the_schedule_and_ties_to_the_balance_sheet(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=120000, interest_rate=6, loan_term_months=24,
                         start_date="2026-12-01")
        r = client.get("/loans/cash-flow", params={"start_period": "2026-11", "end_period": "2027-06"})
        assert r.status_code == 200, r.text
        projections = r.json()["data"]["projections"]
        assert [p["period"] for p in projections] == ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
                                                      "2027-04", "2027-05", "2027-06"]
        balances = [p["remaining_balance"] for p in projections]
        assert balances[0] == 0 and balances[1] == 120000 and projections[1]["loan_proceeds"] == 120000
        by_month = {r_["payment_date"][:7]: r_["remaining_balance"] for r_ in schedule(db_path, loan_id)}
        for p in projections[2:]:
            # principal - the rounded principal paid so far; the schedule rounds each balance (within a cent).
            assert p["remaining_balance"] == pytest.approx(by_month[p["period"]], abs=0.015)
        assert balances[2:] == sorted(balances[2:], reverse=True)
        st = statements(db_path, "2026-11", "2027-06")
        debt = [row["debt"] for row in st["balance_sheet"]["by_period"]]
        assert balances == pytest.approx(debt, abs=0.005)
        assert projections[2]["loan_payments"][0]["remaining_balance"] == pytest.approx(by_month["2027-01"], abs=0.015)

    def test_bad_window_is_a_422(self, env):
        client, _ = env
        r = client.get("/loans/cash-flow", params={"start_period": "2027-06", "end_period": "2027-01"})
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# LEGACY-LOAN-WORDING: the legacy check names the real impact
# ---------------------------------------------------------------------------

class TestLegacyCheckWording:
    def _issue(self, db_path):
        from api.loan_routes import schedule_audit
        from services.governance import loan_schedule_issue
        conn = sqlite3.connect(db_path)
        try:
            return loan_schedule_issue(schedule_audit(conn.cursor()))
        finally:
            conn.close()

    def test_short_schedule_is_not_called_wrong_month(self, env):
        _, db_path = env
        insert_loan(db_path, "SHORT", principal=6000, term=6, start="2026-01-15")
        insert_rows(db_path, "SHORT", [(n, f"2026-{n + 1:02d}-15", 1000, 1000, 0, 6000 - 1000 * n, "scheduled")
                                       for n in range(1, 5)])
        issue = self._issue(db_path)
        assert issue["severity"] == "warning"
        assert "wrong month" not in issue["detail"]
        assert "missing" in issue["detail"] or "not fully repaid" in issue["detail"]

    def test_wrong_month_schedule_still_says_so(self, env):
        _, db_path = env
        insert_loan(db_path, "DRIFTED", principal=300, term=3, start="2026-01-01")
        insert_rows(db_path, "DRIFTED", [(1, "2026-01-31", 100, 100, 0, 200, "scheduled"),
                                         (2, "2026-03-02", 100, 100, 0, 100, "scheduled"),
                                         (3, "2026-04-02", 100, 100, 0, 0, "scheduled")])
        issue = self._issue(db_path)
        assert "1 put interest and principal in the wrong month" in issue["detail"]


# ---------------------------------------------------------------------------
# LN3-R: a principal change stays applied on every later rebuild and repair
# ---------------------------------------------------------------------------

def _principal_changed_loan(client, db_path):
    """100,000 at 6% for 12 months from Jan 15, 2027; #1-#2 paid, then the principal corrected to 120,000."""
    loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=12, start_date="2027-01-15")
    mark_paid(db_path, loan_id, 1, 2)
    put(client, loan_id, {"principal_amount": 120000})
    return loan_id


def _total_principal(db_path, loan_id):
    return sum(r["principal_payment"] for r in schedule(db_path, loan_id))


def _current_balance(db_path, loan_id):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute("SELECT current_balance FROM loans WHERE loan_id = ?", (loan_id,)).fetchone()[0]
    finally:
        conn.close()


def _final_debt(db_path, start="2027-01", end="2028-06"):
    return statements(db_path, start, end)["balance_sheet"]["by_period"][-1]["debt"]


class TestPrincipalChangeIsKept:
    def test_a_later_rate_change_keeps_the_difference(self, env):
        client, db_path = env
        loan_id = _principal_changed_loan(client, db_path)
        assert loan_id not in audit(client)[1]                    # the adjusted schedule is consistent
        preview = put(client, loan_id, {"interest_rate": 7}, preview="true")["data"]
        assert preview["after"]["total_principal"] == pytest.approx(120000, abs=0.05)
        assert preview["after"]["final_balance"] == 0
        assert any("leaves 103,746.19 owed, 20,000.00 more than the 83,746.19" in w for w in preview["warnings"]), \
            preview["warnings"]
        put(client, loan_id, {"interest_rate": 7})
        rows = schedule(db_path, loan_id)
        assert rows[1]["remaining_balance"] == pytest.approx(83746.19, abs=0.01)     # history untouched
        assert rows[2]["interest_payment"] == pytest.approx(103746.19 * 0.07 / 12, abs=0.01)
        assert _total_principal(db_path, loan_id) == pytest.approx(120000, abs=0.05)
        assert _current_balance(db_path, loan_id) == pytest.approx(103746.19, abs=0.01)
        assert _final_debt(db_path) == pytest.approx(0, abs=0.05)
        assert loan_id not in audit(client)[1]

    def test_a_principal_cut_to_what_is_repaid_previews_nothing_owed(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=12, start_date="2027-01-15")
        mark_paid(db_path, loan_id, 1, 2)
        repaid = sum(r["principal_payment"] for r in schedule(db_path, loan_id)[:2])
        data = put(client, loan_id, {"principal_amount": round(repaid, 2)})["data"]
        assert data["after"]["final_balance"] == pytest.approx(0, abs=0.01)
        assert data["after"]["payoff_date"] == data["after"]["last_payment_date"]
        later = put(client, loan_id, {"interest_rate": 5}, preview="true")["data"]
        assert later["after"]["final_balance"] == pytest.approx(0, abs=0.01)
        assert later["after"]["payoff_date"] is not None

    def test_a_later_frequency_change_keeps_the_difference(self, env):
        client, db_path = env
        loan_id = _principal_changed_loan(client, db_path)
        data = put(client, loan_id, {"payment_frequency": "quarterly"})["data"]
        assert any("the 103,746.19 still owed is re-amortised" in w for w in data["warnings"]), data["warnings"]
        assert data["after"]["total_principal"] == pytest.approx(120000, abs=0.05)
        assert _final_debt(db_path) == pytest.approx(0, abs=0.05)

    def test_the_audit_accepts_the_adjusted_schedule_and_the_repair_leaves_it(self, env):
        client, db_path = env
        loan_id = _principal_changed_loan(client, db_path)
        before = schedule(db_path, loan_id)
        data = client.post(f"/loans/{loan_id}/repair-schedule", json={"dry_run": False}).json()["data"]
        assert data["action"] == "none" and data["audit"] is None
        assert schedule(db_path, loan_id) == before

    def test_a_schedule_that_lost_the_difference_is_flagged_and_the_repair_restores_it(self, env):
        """The state a rebuild from the stale remaining balance left: principal 120,000, rows repaying 100,000."""
        client, db_path = env
        loan_id = create(client, principal_amount=100000, interest_rate=6, loan_term_months=12, start_date="2027-01-15")
        mark_paid(db_path, loan_id, 1, 2)
        execute(db_path, "UPDATE loans SET principal_amount = 120000 WHERE loan_id = ?", (loan_id,))
        assert _final_debt(db_path) == pytest.approx(20000, abs=0.05)
        entry = audit(client)[1][loan_id]
        assert entry["issues"] == ["balance_break"] and entry["statement_impact"] is True
        assert entry["principal_difference"] == pytest.approx(20000, abs=0.01)
        assert "repay $83,746.19" in entry["summary"] and "leaves $103,746.19 owed" in entry["summary"]
        dry = client.post(f"/loans/{loan_id}/repair-schedule", json={"dry_run": True}).json()["data"]
        assert dry["action"] == "regenerate"
        assert dry["after"]["total_principal"] == pytest.approx(120000, abs=0.05)
        assert any("leaves 103,746.19 owed" in w for w in dry["warnings"]), dry["warnings"]
        client.post(f"/loans/{loan_id}/repair-schedule", json={"dry_run": False})
        assert _total_principal(db_path, loan_id) == pytest.approx(120000, abs=0.05)
        assert _final_debt(db_path) == pytest.approx(0, abs=0.05)
        assert loan_id not in audit(client)[1]

    def test_a_broken_balance_after_a_principal_change_is_still_flagged(self, env):
        client, db_path = env
        loan_id = _principal_changed_loan(client, db_path)
        execute(db_path, "UPDATE loan_payments SET remaining_balance = remaining_balance + 500 "
                         "WHERE loan_id = ? AND payment_number = 6", (loan_id,))
        entry = audit(client)[1][loan_id]
        assert "balance_break" in entry["issues"] and "principal_difference" not in entry
        assert "remaining balances do not add up" in entry["summary"].lower()

    def test_rounding_in_a_long_history_is_not_a_principal_change(self, env):
        """A 30-year 0% schedule's rounded rows drift from principal - repaid by more than a dollar; that is
        rounding, so nothing is flagged or warned."""
        client, db_path = env
        loan_id = create(client, principal_amount=1158586.16, interest_rate=0, loan_term_months=360,
                         start_date="2026-01-31")
        # Schedules are generated in cents now; store the rows as the earlier generator did (the balance tracked
        # unrounded, each row's principal rounded on its own), so the history drifts as a legacy one does.
        level = 1158586.16 / 360
        for n in range(1, 361):
            principal = level if n < 360 else 1158586.16 - level * 359
            execute(db_path, "UPDATE loan_payments SET principal_payment = ?, payment_amount = ?, remaining_balance = ? "
                             "WHERE loan_id = ? AND payment_number = ?",
                    (round(principal, 2), round(principal, 2), round(max(1158586.16 - level * n, 0), 2), loan_id, n))
        execute(db_path, "UPDATE loan_payments SET payment_status = 'paid' WHERE loan_id = ? AND payment_number <= 300",
                (loan_id,))
        rows = schedule(db_path, loan_id)
        drift = 1158586.16 - sum(r["principal_payment"] for r in rows[:300]) - rows[299]["remaining_balance"]
        assert abs(drift) > 1
        assert loan_id not in audit(client)[1]
        data = put(client, loan_id, {"interest_rate": 1}, preview="true")["data"]
        assert data["warnings"] == []
        assert data["after"]["total_principal"] == pytest.approx(1158586.16, abs=0.5)

    def test_principal_raised_after_the_last_installment_gets_a_final_one(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=12000, interest_rate=0, loan_term_months=12, start_date="2021-01-15")
        mark_paid(db_path, loan_id, *range(1, 13))
        execute(db_path, "UPDATE loans SET principal_amount = 15000 WHERE loan_id = ?", (loan_id,))
        entry = audit(client)[1][loan_id]
        assert entry["issues"] == ["incomplete"] and entry["balance_left"] == 3000
        data = client.post(f"/loans/{loan_id}/repair-schedule", json={"dry_run": False}).json()["data"]
        assert [r["principal_payment"] for r in data["new_rows"]] == [3000]
        assert loan_id not in audit(client)[1]

    def test_a_principal_below_what_the_history_repaid_must_be_fixed_first(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=12000, interest_rate=0, loan_term_months=12, start_date="2027-01-15")
        mark_paid(db_path, loan_id, 1, 2, 3)
        execute(db_path, "UPDATE loans SET principal_amount = 2000 WHERE loan_id = ?", (loan_id,))
        entry = audit(client)[1][loan_id]
        assert entry["proposed_action"] == "fix_loan_terms" and "at least $3,000.00" in entry["summary"]
        before = schedule(db_path, loan_id)
        r = client.post(f"/loans/{loan_id}/repair-schedule", json={"dry_run": False})
        assert r.status_code == 422 and "at least $3,000.00" in r.json()["detail"]
        r = client.put(f"/loans/{loan_id}", json={"interest_rate": 5})
        assert r.status_code == 422 and "already repaid" in r.json()["detail"], r.text
        assert schedule(db_path, loan_id) == before

    def test_a_window_after_the_recorded_payments_opens_on_the_same_debt(self, env):
        client, db_path = env
        loan_id = _principal_changed_loan(client, db_path)
        full = statements(db_path, "2027-01", "2028-06")["balance_sheet"]["by_period"]
        march = next(row for row in full if row["period"] == "2027-03")
        assert march["debt"] == pytest.approx(103746.19, abs=0.01)
        later = statements(db_path, "2027-04", "2028-06")
        assert later["detail"]["loans"][loan_id]["opening_balance"] == pytest.approx(march["debt"], abs=0.01)
        assert later["balance_sheet"]["by_period"][-1]["debt"] == pytest.approx(0, abs=0.05)


# ---------------------------------------------------------------------------
# LN1-R: another frequency's calendar only for history from a frequency change
# ---------------------------------------------------------------------------

def _seed_late_monthly(db_path):
    """12-month 0% monthly loan of 12,000 from Jan 31, 2026 with 30.44-day dates; #1 is paid but dated Apr 20,
    10 days before the date a quarterly #1 would have."""
    insert_loan(db_path, "LATE", principal=12000, term=12, start="2026-01-31")
    dates = legacy_dates(date(2026, 1, 31), 12)
    dates[0] = "2026-04-20"
    insert_rows(db_path, "LATE", [(n, d, 1000, 1000, 0, 12000 - 1000 * n, "paid" if n == 1 else "scheduled")
                                  for n, d in enumerate(dates, start=1)])


class TestOtherFrequencyHistory:
    def test_a_late_monthly_payment_is_not_taken_for_quarterly_history(self, env):
        client, db_path = env
        _seed_late_monthly(db_path)
        data = client.post("/loans/LATE/repair-schedule", json={"dry_run": True}).json()["data"]
        assert data["action"] == "redate"
        to = {r["payment_number"]: r["to_date"] for r in data["redated_rows"]}
        assert to[2] == "2026-04-30" and to[12] == "2027-02-28"          # no calendar month skipped
        assert data["after"]["payoff_date"] == "2027-02-28"
        assert any("installment 2 would fall due on Mar 31, 2026" in w
                   and "payoff moves from Jan 31, 2027 to Feb 28, 2027" in w for w in data["warnings"]), data["warnings"]
        client.post("/loans/LATE/repair-schedule", json={"dry_run": False})
        assert "LATE" not in audit(client)[1]

    @pytest.mark.parametrize("new_start, payoff", [("2026-12-31", "Dec 31, 2028"), ("2026-11-30", "Nov 30, 2028"),
                                                  ("2026-10-31", "Oct 31, 2028")])
    def test_a_start_date_moved_earlier_always_explains_the_push(self, env, new_start, payoff):
        """Two months earlier puts the paid #1 on a quarterly position by chance; it warns like one or three."""
        client, db_path = env
        loan_id = create(client, principal_amount=24000, interest_rate=0, loan_term_months=24, start_date="2027-01-31")
        mark_paid(db_path, loan_id, 1)                                       # #1 due Feb 28, 2027
        data = put(client, loan_id, {"start_date": new_start}, preview="true")["data"]
        assert data["after"]["last_payment_date"] == date.fromisoformat(new_start).replace(year=2028).isoformat()
        assert any("on or before the last recorded payment (Feb 28, 2027)" in w
                   and f"payoff moves from Jan 31, 2029 to {payoff}" in w for w in data["warnings"]), data["warnings"]

    def test_quarterly_history_is_followed_on_later_edits_without_a_warning(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=12000, interest_rate=6, loan_term_months=12, start_date="2027-01-31",
                         payment_frequency="quarterly")
        mark_paid(db_path, loan_id, 1)                                       # #1 on Apr 30, 2027
        put(client, loan_id, {"payment_frequency": "monthly"})
        data = put(client, loan_id, {"interest_rate": 7}, preview="true")["data"]
        assert data["new_rows"][0]["payment_date"] == "2027-05-31"
        assert data["new_rows"][-1]["payment_date"] == "2028-01-31"
        assert data["warnings"] == []
        assert loan_id not in audit(client)[1]

    def test_a_date_on_a_quarterly_position_alone_is_not_quarterly_history(self):
        from api.loan_routes import _history_anchor, _terms
        terms = _terms({"principal_amount": 12000, "interest_rate": 0, "loan_term_months": 12,
                        "start_date": "2026-01-31", "payment_frequency": "monthly"})
        kept = [{"payment_number": 1, "payment_date": "2026-04-30"}]       # exactly start + 3 months
        on_own_calendar = [{"payment_number": 2, "payment_date": "2026-03-31"}]
        after_a_change = [{"payment_number": 2, "payment_date": "2026-05-31"}]
        anchor = _history_anchor(terms, kept, on_own_calendar)
        assert anchor["months"] == 3 and anchor["pushed"] is True
        anchor = _history_anchor(terms, kept, after_a_change)
        assert anchor["months"] == 3 and anchor["pushed"] is False

    def test_a_push_that_keeps_the_payoff_says_so(self, env):
        client, db_path = env
        loan_id = create(client, principal_amount=1200, interest_rate=0, loan_term_months=12, start_date="2026-01-01")
        execute(db_path, "UPDATE loan_payments SET payment_status = 'paid', payment_date = '2026-03-01' "
                         "WHERE loan_id = ? AND payment_number = 1", (loan_id,))
        data = put(client, loan_id, {"interest_rate": 5}, preview="true")["data"]
        assert data["new_rows"][0]["payment_date"] == "2026-04-01"
        assert any("payoff stays on Jan 1, 2027" in w for w in data["warnings"]), data["warnings"]
