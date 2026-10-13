"""
Integrity fixes (review round 15).

* LOAN-PRINCIPAL-RESIDUE: schedules are generated in cents, so the stored
  principal column adds up exactly to the principal (or a rebuilt tail's
  opening balance); a schedule saved earlier with a few cents of rounding
  residue books it with its last installment, so statement debt and
  /loans/cash-flow reach 0.00 at maturity.
* LOAN-CURRENT-BALANCE: the loan list and the portfolio summary show the
  balance owed from the schedule (principal less recorded principal), not
  a stored column that only a terms edit refreshed; money in cents.
* APPROVAL-EVIDENCE-DELETABLE: an approval snapshot cannot be deleted, and
  the live database cannot be switched onto it (409, filed under the
  scenario); loading it restores a copy.
* REPLAY-MSG-GRAMMAR: every replay refusal reason reads after "would".

Drives the real FastAPI app against an isolated database (the governance
fixture).
"""
import hashlib
import os
import sqlite3

import pytest

from tests.test_governance_api import approve, env, log, q  # noqa: F401  (env is a fixture)
from tests.test_governance_hardening import raw


def create_loan(client, **fields):
    body = {"loan_name": "Loan", "lender": "Bank", "loan_type": "term_loan", "payment_type": "amortizing",
            "payment_frequency": "monthly", **fields}
    res = client.post("/loans/", json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]["loan_id"]


def rows(mgr, loan_id):
    return [dict(zip(("payment_id", "payment_number", "payment_date", "payment_amount", "principal_payment",
                      "interest_payment", "remaining_balance"), r))
            for r in q(mgr, "SELECT payment_id, payment_number, payment_date, payment_amount, principal_payment, "
                            "interest_payment, remaining_balance FROM loan_payments WHERE loan_id = ? "
                            "ORDER BY payment_number", (loan_id,))]


def statements(client, start, end):
    res = client.get("/reporting/statements", params={"forecast_ids": "F001", "start_period": start,
                                                      "end_period": end})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert all(abs(row["balance_check"]) < 0.01 for row in data["balance_sheet"]["by_period"])
    return data


def debt_by_period(data):
    return {row["period"]: row["debt"] for row in data["balance_sheet"]["by_period"]}


def loan_cash_flow(client, start, end):
    res = client.get("/loans/cash-flow", params={"start_period": start, "end_period": end})
    assert res.status_code == 200, res.text
    return {p["period"]: p for p in res.json()["data"]["projections"]}


def store_legacy_rows(mgr, loan_id, principal, count):
    """Rewrite a 0% loan's rows as the earlier generator stored them: the balance tracked unrounded, each
    row's principal rounded on its own, the last row taking the unrounded remainder (rounded) and saying
    0.00 is owed. 120,000 over 22 months stores 22 x 5,454.55 = 120,000.10."""
    level = principal / count
    for n in range(1, count + 1):
        amount = level if n < count else principal - level * (count - 1)
        raw(mgr, "UPDATE loan_payments SET principal_payment = ?, payment_amount = ?, interest_payment = 0, "
                 "remaining_balance = ? WHERE loan_id = ? AND payment_number = ?",
            (round(amount, 2), round(amount, 2), round(max(principal - level * n, 0.0), 2), loan_id, n))


def mark_paid(client, mgr, loan_id, upto):
    for row in rows(mgr, loan_id)[:upto]:
        res = client.post("/forecast/update", json={"table": "loan_payments", "id": row["payment_id"],
                                                    "updates": {"payment_status": "paid"}})
        assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# LOAN-PRINCIPAL-RESIDUE
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("principal, rate, term, frequency, payment_type, balloon_payment, balloon_date", [
    (120000, 0.0, 22, "monthly", "amortizing", None, None),
    (120000, 0.06, 36, "monthly", "amortizing", None, None),
    (750000, 0.0, 84, "monthly", "amortizing", None, None),
    (100000, 0.0, 3, "monthly", "amortizing", None, None),
    (100157, 0.0, 11, "monthly", "amortizing", None, None),
    (99999.99, 0.0399, 13, "quarterly", "amortizing", None, None),
    (250000, 0.0725, 60, "annually", "amortizing", None, None),
    (80000, 0.05, 24, "monthly", "interest_only", None, None),
    (500000, 0.065, 120, "monthly", "amortizing", 150000, None),
    (500000, 0.065, 120, "monthly", "amortizing", None, "2030-06-30"),
])
def test_schedules_are_generated_in_cents_and_repay_the_principal_exactly(principal, rate, term, frequency,
                                                                          payment_type, balloon_payment, balloon_date):
    from api.loan_routes import generate_amortization_schedule

    schedule = generate_amortization_schedule("L", principal, rate, term, "2026-06-30", payment_type,
                                              balloon_payment, balloon_date, frequency)
    assert round(sum(p.principal_payment for p in schedule), 2) == round(principal, 2)
    assert schedule[-1].remaining_balance == 0.0
    balance = round(principal, 2)
    for p in schedule:
        # The stored balance is the running cent balance and each payment is its principal plus its interest.
        balance = round(balance - p.principal_payment, 2)
        assert p.remaining_balance == balance
        assert p.payment_amount == round(p.principal_payment + p.interest_payment, 2)
        assert all(round(v, 2) == v for v in (p.payment_amount, p.principal_payment, p.interest_payment))

    # A rebuilt tail repays exactly the opening balance it is given.
    tail = generate_amortization_schedule("L", principal, rate, term, "2026-06-30", payment_type, balloon_payment,
                                          balloon_date, frequency, first_payment_number=2, opening_balance=12345.67)
    assert round(sum(p.principal_payment for p in tail), 2) == 12345.67 and tail[-1].remaining_balance == 0.0


def test_statement_debt_and_loan_cash_flow_reach_zero_at_maturity(env):
    client, mgr = env
    loan_id = create_loan(client, loan_name="Zero", principal_amount=120000, interest_rate=0, loan_term_months=22,
                          start_date="2026-06-30")
    schedule = rows(mgr, loan_id)
    assert round(sum(r["principal_payment"] for r in schedule), 2) == 120000
    assert schedule[-1]["payment_date"] == "2028-04-30" and schedule[-1]["principal_payment"] == 5454.45

    data = statements(client, "2028-03", "2028-06")
    debt = debt_by_period(data)
    assert debt["2028-03"] == 5454.45
    assert all(abs(debt[p]) < 0.005 for p in ("2028-04", "2028-05", "2028-06"))
    flows = loan_cash_flow(client, "2028-03", "2028-06")
    assert flows["2028-03"]["remaining_balance"] == 5454.45
    assert [flows[p]["remaining_balance"] for p in ("2028-04", "2028-05", "2028-06")] == [0.0, 0.0, 0.0]
    assert flows["2028-04"]["total_principal"] == 5454.45 == flows["2028-04"]["total_payment"]


def test_a_legacy_schedule_with_a_rounding_residue_is_paid_off_at_maturity(env):
    """Rows saved before schedules were generated in cents add up to 120,000.10; the statements and the loan
    cash flow book the -0.10 with the last installment, so debt is 0.00 from maturity on and cash repays
    exactly what was borrowed."""
    client, mgr = env
    loan_id = create_loan(client, loan_name="Zero", principal_amount=120000, interest_rate=0, loan_term_months=22,
                          start_date="2026-06-30")
    store_legacy_rows(mgr, loan_id, 120000, 22)
    legacy = rows(mgr, loan_id)
    assert round(sum(r["principal_payment"] for r in legacy), 2) == 120000.10
    assert legacy[-1]["principal_payment"] == 5454.55 and legacy[-1]["remaining_balance"] == 0.0

    data = statements(client, "2028-03", "2030-03")
    debt = debt_by_period(data)
    assert debt["2028-03"] == 5454.45                       # principal less what was repaid before
    assert all(abs(debt[p]) < 0.005 for p in debt if p >= "2028-04"), debt
    # Cash pays out exactly the 10,909.00 still owed when the window opens.
    opening = 120000 - sum(r["principal_payment"] for r in legacy if r["payment_date"] < "2028-03-01")
    assert data["cash_flow"]["totals"]["principal_payments"] == pytest.approx(-round(opening, 2), abs=0.005)
    flows = loan_cash_flow(client, "2028-03", "2028-06")
    assert [flows[p]["remaining_balance"] for p in ("2028-04", "2028-05", "2028-06")] == [0.0, 0.0, 0.0]
    april = flows["2028-04"]
    assert april["total_principal"] == 5454.45 and april["total_payment"] == 5454.45
    assert april["loan_payments"][0]["payment_amount"] == 5454.45
    # A window that opens after maturity starts with no debt.
    later = statements(client, "2029-01", "2029-03")
    assert all(abs(v) < 0.005 for v in debt_by_period(later).values())

    # Fully recorded, the loan owes nothing: no balance on the overview, no "overpaid" flag in the audit, and a
    # terms edit is not refused as a principal below what was repaid.
    mark_paid(client, mgr, loan_id, 22)
    loan = next(l for l in client.get("/loans/").json()["data"]["loans"] if l["loan_id"] == loan_id)
    assert loan["current_balance"] == 0.0
    assert client.get("/loans/summary").json()["data"]["total_current_balance"] == 0.0
    audit = client.get("/loans/schedule-audit").json()["data"]["loans"]
    assert loan_id not in {entry["loan_id"] for entry in audit}
    res = client.put(f"/loans/{loan_id}", json={"interest_rate": 1}, params={"preview": "true"})
    assert res.status_code == 200, res.text


def test_a_real_balance_left_after_the_schedule_is_not_rounding(env):
    """Only a residue within a cent per installment is rounding: a principal raised after the schedule was
    saved stays owed on the statements."""
    client, mgr = env
    loan_id = create_loan(client, loan_name="Zero", principal_amount=120000, interest_rate=0, loan_term_months=22,
                          start_date="2026-06-30")
    raw(mgr, "UPDATE loans SET principal_amount = 120500 WHERE loan_id = ?", (loan_id,))
    debt = debt_by_period(statements(client, "2028-05", "2028-06"))
    assert debt == {"2028-05": 500.0, "2028-06": 500.0}


def test_schedule_rounding_residue_rule():
    from services.financial_statements import schedule_rounding_residue

    assert schedule_rounding_residue(120000, [5454.55] * 22, 0.0) == pytest.approx(-0.10)
    assert schedule_rounding_residue(750000, [8928.57] * 83 + [8928.69], 0.0) == 0.0     # exact: nothing to book
    assert schedule_rounding_residue(100000, [33333.33] * 3, 0.0) == pytest.approx(0.01)
    assert schedule_rounding_residue(120000, [5454.55] * 22, 500.0) == 0.0               # the schedule says owed
    assert schedule_rounding_residue(120500, [5454.55] * 22, 0.0) == 0.0                 # a real balance
    assert schedule_rounding_residue(120000, [], None) == 0.0


# ---------------------------------------------------------------------------
# LOAN-CURRENT-BALANCE
# ---------------------------------------------------------------------------

def overview(client, loan_id):
    loan = next(l for l in client.get("/loans/").json()["data"]["loans"] if l["loan_id"] == loan_id)
    summary = client.get("/loans/summary").json()["data"]
    by_type = {t["loan_type"]: t for t in summary["loans_by_type"]}
    return loan["current_balance"], summary["total_current_balance"], by_type["term_loan"]["total_balance"]


def test_the_current_balance_comes_from_the_recorded_payments_not_the_edit_history(env):
    client, mgr = env
    loan_id = create_loan(client, loan_name="Term A", principal_amount=120000, interest_rate=6, loan_term_months=36,
                          start_date="2027-01-15")
    assert overview(client, loan_id) == (120000.0, 120000.0, 120000.0)
    mark_paid(client, mgr, loan_id, 3)
    schedule = rows(mgr, loan_id)
    owed = round(120000 - sum(r["principal_payment"] for r in schedule[:3]), 2)
    assert owed == schedule[2]["remaining_balance"]
    assert overview(client, loan_id) == (owed, owed, owed)
    loan = next(l for l in client.get("/loans/").json()["data"]["loans"] if l["loan_id"] == loan_id)
    assert loan["payments_made"] == 3
    # The same loan state shows the same balance whatever was edited in between.
    assert client.put(f"/loans/{loan_id}", json={"loan_name": "renamed"}).status_code == 200
    assert overview(client, loan_id) == (owed, owed, owed)
    assert client.put(f"/loans/{loan_id}", json={"interest_rate": 6.0001}).status_code == 200
    assert client.put(f"/loans/{loan_id}", json={"interest_rate": 6}).status_code == 200
    assert overview(client, loan_id) == (owed, owed, owed)
    # A stale stored column is never shown.
    raw(mgr, "UPDATE loans SET current_balance = 1 WHERE loan_id = ?", (loan_id,))
    assert overview(client, loan_id) == (owed, owed, owed)


def test_loan_money_is_in_cents(env):
    client, mgr = env
    zero = create_loan(client, loan_name="Zero", principal_amount=100157, interest_rate=0, loan_term_months=11,
                       start_date="2027-01-15")
    term = create_loan(client, loan_name="Term", principal_amount=120000, interest_rate=6, loan_term_months=36,
                       start_date="2027-01-15")
    loans = {l["loan_id"]: l for l in client.get("/loans/").json()["data"]["loans"]}
    assert loans[zero]["monthly_payment_amount"] == 9105.18
    assert loans[term]["monthly_payment_amount"] == 3650.63
    summary = client.get("/loans/summary").json()["data"]
    assert summary["total_monthly_payments"] == 12755.81
    assert summary["total_annual_payments"] == 153069.72
    # A value stored unrounded by an earlier version is shown in cents too.
    raw(mgr, "UPDATE loans SET monthly_payment_amount = 9105.181818181818 WHERE loan_id = ?", (zero,))
    loans = {l["loan_id"]: l for l in client.get("/loans/").json()["data"]["loans"]}
    assert loans[zero]["monthly_payment_amount"] == 9105.18
    assert client.get("/loans/summary").json()["data"]["total_monthly_payments"] == 12755.81


# ---------------------------------------------------------------------------
# APPROVAL-EVIDENCE-DELETABLE
# ---------------------------------------------------------------------------

def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def test_an_approval_snapshot_cannot_be_deleted(env):
    client, mgr = env
    snap = approve(client)["approval"]["snapshot_filename"]
    path = os.path.join(mgr.snapshot_dir, snap)
    res = client.delete(f"/database/delete/{snap}")
    assert res.status_code == 409, res.text
    body = res.json()
    assert body["code"] == "APPROVAL_EVIDENCE" and body["forecast_id"] == "F001"
    assert "cannot be deleted" in body["detail"] and "'2027 Budget' (F001)" in body["detail"]
    assert "Dana CFO" in body["detail"] and "/database/load" in body["detail"]
    assert os.path.exists(path)
    approvals = client.get("/forecast/scenario/F001/approvals").json()["data"]["approvals"]
    assert approvals[0]["snapshot_available"] is True
    # The refused attempt is in the scenario's change history.
    entry = log(client, limit=1)["entries"][0]
    assert entry["path"] == f"/database/delete/{snap}" and entry["status"] == 409 and entry["forecast_id"] == "F001"


def test_a_file_an_approval_names_is_evidence_whatever_it_is_called(env):
    client, mgr = env
    approve(client)
    assert client.post("/database/save", json={"name": "board copy"}).status_code == 200
    raw(mgr, "UPDATE scenario_approvals SET snapshot_filename = 'board copy.db' WHERE forecast_id = 'F001'")
    res = client.delete("/database/delete/board copy.db")
    assert res.status_code == 409 and res.json()["forecast_id"] == "F001"
    assert os.path.exists(os.path.join(mgr.snapshot_dir, "board copy.db"))
    # An ordinary save, even one called 'approved budget', can still be deleted.
    assert client.post("/database/save", json={"name": "approved budget"}).status_code == 200
    assert client.delete("/database/delete/approved budget.db").status_code == 200


def test_the_live_database_is_never_switched_onto_an_approval_snapshot(env):
    client, mgr = env
    snap = approve(client)["approval"]["snapshot_filename"]
    path = os.path.join(mgr.snapshot_dir, snap)
    live, digest = mgr.database_path, sha256(path)
    res = client.post("/database/switch", json={"filename": snap})
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "APPROVAL_EVIDENCE" and res.json()["forecast_id"] == "F001"
    assert "cannot become the live database" in res.json()["detail"]
    assert mgr.database_path == live
    # Writes after the refusal land in the live database; the evidence file is untouched.
    assert client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana", "reason": "reforecast"}).status_code == 200
    assert client.post("/forecast/update", json={"table": "sales", "id": "S1",
                                                 "updates": {"quantity": 99}}).status_code == 200
    assert sha256(path) == digest
    # Inspecting it goes through /database/load, which restores a copy and leaves the file as it was.
    res = client.post("/database/load", json={"filename": snap})
    assert res.status_code == 200, res.text
    assert mgr.database_path == live
    assert q(mgr, "SELECT quantity FROM sales WHERE sale_id = 'S1'") == [(10,)]
    assert client.post("/forecast/update", json={"table": "customers", "id": "C1",
                                                 "updates": {"customer_name": "Renamed"}}).status_code == 200
    assert sha256(path) == digest


# ---------------------------------------------------------------------------
# REPLAY-MSG-GRAMMAR
# ---------------------------------------------------------------------------

def log_sql(mgr, statement):
    raw(mgr, "INSERT INTO execution_log (execution_date, sql_statement, execution_status) "
             "VALUES ('2020-01-01 00:00:00', ?, 'success')", (statement,))


@pytest.mark.parametrize("statement, reason", [
    ("DROP TRIGGER trg_lock_sales_update", "change the schema (drop trigger trg_lock_sales_update)"),
    ("PRAGMA recursive_triggers = OFF", "run PRAGMA recursive_triggers = OFF"),
    ("PRAGMA foreign_keys", "run PRAGMA foreign_keys"),
    ("CREATE TRIGGER t_evil AFTER INSERT ON customers BEGIN DELETE FROM sales; END",
     "change the schema (create trigger t_evil)"),
    ("CREATE TABLE evil (a)", "change the schema (insert into sqlite_master)"),
    ("DROP TABLE expense_categories", "change the schema (delete from sqlite_master)"),
    ("ALTER TABLE customers ADD COLUMN evil TEXT", "change the schema (alter table customers)"),
    ("ATTACH DATABASE ':memory:' AS other", "attach another database (:memory:)"),
    ("COMMIT", "run transaction control (COMMIT)"),
    ("SAVEPOINT sp", "run savepoint control (SAVEPOINT sp)"),
    ("UPDATE sqlite_sequence SET seq = 0", "update sqlite_sequence (SQLite's own bookkeeping)"),
    ("INSERT INTO audit_log (path, actor) VALUES ('/x', 'M')", "insert into audit_log"),
    ("UPDATE forecast SET locked = 1 WHERE forecast_id = 'F002'", "change forecast.locked (approve / unlock only)"),
])
def test_every_replay_refusal_reads_after_would(env, statement, reason):
    client, mgr = env
    log_sql(mgr, statement)
    res = client.post("/database/rollback/replay")
    assert res.status_code == 409, (statement, res.text)
    detail = res.json()["detail"]
    assert f"(log 1: would {reason})" in detail, detail
    assert "would schema change" not in detail


def test_the_replay_authorizer_names_every_denied_action_as_a_verb_phrase():
    from db.database import replay_authorizer

    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.executescript("CREATE TABLE t (a); CREATE INDEX ix ON t (a); CREATE VIEW v AS SELECT 1;")
    verbs = ("change ", "run ", "attach ", "detach ", "insert into ", "update ", "delete from ")
    for statement in ("DROP INDEX ix", "DROP VIEW v", "REINDEX", "ANALYZE t", "VACUUM", "DETACH other", "BEGIN",
                      "RELEASE sp", "ROLLBACK TO sp", "CREATE TEMP TABLE tt (x)"):
        denied = []
        conn.set_authorizer(replay_authorizer(denied))
        with pytest.raises(sqlite3.DatabaseError):
            conn.execute(statement)
        conn.set_authorizer(None)
        assert denied and all(reason.startswith(verbs) for reason in denied), (statement, denied)
