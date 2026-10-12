"""
Actuals: regressions for the verified review findings (round 12).

* ACT-1 / MCP-ACT-XLSX-DATE  Excel date cells crashed forecast_import_actuals
* ACT-3   out-of-order undo brought back the values of an undone import
* ACT-4 / UI-1  a summary on top of detail (or a hand entry on top of an
          import) silently double counted; replace_lines and the month totals
          before / after
* ACT-5   decimal-comma amounts were misread ('12.500,00' -> 12.5)
* ACT-7   re-closing a month erased the reopen reason
* ACT-8   the undo preview said deleted rows were 'kept'
* ACT-9   'Account' (a GL number) beat 'Account Name' for the line item
* ACTUALS-CLOSED-HINT  the MCP 'next' hint suggested allow_partial when it
          cannot help

Drives the real FastAPI app (and the MCP server over JSON-RPC) against an
isolated database, reusing the fixtures of the other actuals test modules.
"""
import io
import itertools
import json
import os
from datetime import date, datetime, time

import pytest
from openpyxl import Workbook

from tests.test_actuals_controls import env, post, stored, upload  # noqa: F401  (fixture + helpers)
from tests.test_actuals_mcp import call_tool, count, mcp_env, ok, write  # noqa: F401

from services import actuals as actuals_service


def batch_of(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]["batch_id"]


def variance_actual(client, line_item, period):
    data = client.get("/reporting/variance", params={"forecast_ids": "F001", "start_period": period,
                                                     "end_period": period}).json()["data"]
    line = next(li for li in data["line_items"] if li["line_item"] == line_item)
    return line["by_period"][0]["actual"]


def undo(client, batch_id, dry_run=False):
    res = client.delete(f"/reporting/actuals/batches/{batch_id}", params={"dry_run": "true"} if dry_run else None)
    assert res.status_code == 200, res.text
    return res.json()["data"]


ROWS_SQL = "SELECT line_item, reference_id, amount, batch_id FROM actuals ORDER BY line_item, reference_id"


# ---------------------------------------------------------------------------
# ACT-1 / MCP-ACT-XLSX-DATE: Excel date cells are JSON-safe for every caller
# ---------------------------------------------------------------------------

def _xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_read_table_returns_json_safe_cells():
    raw = _xlsx([["Period", "Line Item", "Amount", "Posted", "At"],
                 [datetime(2027, 4, 30), "Net Sales", 549000.5, datetime(2027, 5, 3, 14, 30), time(9, 15)],
                 [date(2027, 5, 31), "Payroll", 1200, None, None]])
    rows, _info = actuals_service.read_table("apr.xlsx", raw)
    json.dumps([r for _n, r in rows])                      # raised TypeError before the fix
    first = rows[0][1]
    assert first["Period"] == "2027-04-30" and first["Amount"] == 549000.5
    assert first["Posted"].startswith("2027-05-03") and isinstance(first["At"], str)
    assert rows[1][1]["Period"] == "2027-05-31"


@pytest.mark.parametrize("cell", [datetime(2027, 2, 28), date(2027, 2, 28)])
def test_mcp_xlsx_import_with_date_cells(mcp_env, cell):
    client, mgr, data_dir = mcp_env
    path = os.path.join(data_dir, "imports", "tb_dates.xlsx")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(_xlsx([["Period", "Line", "Actual", "Reference", "Posted"],
                        [cell, "Payroll", 26100.5, "TB-0227", datetime(2027, 3, 2, 9, 0)]]))
    dry = ok(client, "forecast_import_actuals", {"file_path": "imports/tb_dates.xlsx", "dry_run": True})
    assert dry["status"] == "ok" and dry["inserted"] == 1 and dry["written"] is False
    assert dry["totals"]["by_period"] == [{"period": "2027-02", "label": "Feb 2027", "amount": 26100.5, "rows": 1}]
    assert count(mgr) == 0

    rest = client.post("/reporting/actuals/import", params={"dry_run": "true"},
                       files={"file": ("tb_dates.xlsx", open(path, "rb").read(), "application/octet-stream")})
    by_period = rest.json()["data"]["totals"]["by_period"]
    assert [(t["period"], t["amount"]) for t in by_period] == [("2027-02", 26100.5)]

    done = ok(client, "forecast_import_actuals", {"file_path": "imports/tb_dates.xlsx"})
    assert done["status"] == "ok" and done["written"] is True
    assert count(mgr, "SELECT COUNT(*) FROM actuals WHERE period = '2027-02' AND amount = 26100.5") == 1


def test_mcp_import_failure_is_never_an_empty_error(mcp_env, monkeypatch):
    client, _mgr, data_dir = mcp_env
    name = write(data_dir, "imports/ok.csv", "period,line_item,amount\n2027-01,revenue,1\n")
    from mcp_server.tools import reporting as reporting_tools

    async def broken(*_a, **_k):
        raise TypeError("Object of type Widget is not JSON serializable")

    monkeypatch.setattr(reporting_tools, "call", broken)
    text, is_error = call_tool(client, "forecast_import_actuals", {"file_path": name, "dry_run": True})
    assert is_error and "Widget is not JSON serializable" in text and "ok.csv" in text


# ---------------------------------------------------------------------------
# ACT-3: undo resolves through the chain of undone imports
# ---------------------------------------------------------------------------

def test_undoing_the_earlier_import_first_never_brings_its_value_back(env):
    client, mgr = env
    a = batch_of(post(client, [{"period": "2027-05", "line_item": "revenue", "amount": 10}], source="A3"))
    b = batch_of(post(client, [{"period": "2027-05", "line_item": "revenue", "amount": 20}], source="B3"))
    undo(client, a)
    assert stored(mgr, ROWS_SQL) == [("revenue", "", 20.0, b)]
    done = undo(client, b)
    assert done["removed"] == 1 and done["restored"] == 0
    assert stored(mgr, ROWS_SQL) == []
    batches = {x["batch_id"]: x for x in client.get("/reporting/actuals/batches").json()["data"]["batches"]}
    assert batches[a]["rows_current"] == 0 and batches[b]["rows_current"] == 0


def test_undo_skips_undone_imports_in_the_middle_of_the_chain(env):
    client, mgr = env
    ids = [batch_of(post(client, [{"period": "2027-04", "line_item": "revenue", "amount": n}])) for n in (1, 2, 3)]
    a, b, c = ids
    undo(client, b)
    assert stored(mgr, ROWS_SQL) == [("revenue", "", 3.0, c)]
    preview = undo(client, c, dry_run=True)
    assert preview["rows_to_restore"] == 1 and preview["changed"][0]["restores_to"] == 1.0
    assert any("already undone" in n and b in n for n in preview["notes"])
    undo(client, c)
    assert stored(mgr, ROWS_SQL) == [("revenue", "", 1.0, a)]
    undo(client, a)
    assert stored(mgr, ROWS_SQL) == []


# A: revenue 1, payroll 10 (both new). B: revenue 2. C: revenue 3, payroll 30, admin 5 (new).
_WRITES = {
    "A": [("revenue", 1), ("payroll", 10)],
    "B": [("revenue", 2)],
    "C": [("revenue", 3), ("payroll", 30), ("admin_expense", 5)],
}


def _expected(live, ids):
    """Every line holds the value of the latest import that is not undone (none: the line is gone)."""
    out = {}
    for name in ("A", "B", "C"):
        if name in live:
            for line, amount in _WRITES[name]:
                out[line] = (float(amount), ids[name])
    return sorted((line, "", amount, owner) for line, (amount, owner) in out.items())


@pytest.mark.parametrize("order", list(itertools.permutations("ABC")))
def test_undo_in_any_order_matches_the_imports_still_live(env, order):
    client, mgr = env
    ids = {}
    for name in ("A", "B", "C"):
        ids[name] = batch_of(post(client, [{"period": "2027-06", "line_item": line, "amount": amount}
                                           for line, amount in _WRITES[name]]))
    live = {"A", "B", "C"}
    for name in order:
        undo(client, ids[name])
        live.discard(name)
        assert stored(mgr, ROWS_SQL) == _expected(live, ids), f"after undoing {name} (order {order})"
    batches = client.get("/reporting/actuals/batches").json()["data"]["batches"]
    assert all(b["rows_current"] == 0 for b in batches)


# ---------------------------------------------------------------------------
# ACT-4 / UI-1: other references, month totals before / after, replace_lines
# ---------------------------------------------------------------------------

GL_DETAIL = "Month,Account,Amount,JE\n2026-04,Net Sales,300000,JE-101\n2026-04,Net Sales,200000,JE-102\n"
TB_SUMMARY = "Month,Account,Amount\n2026-04,Net Sales,500000\n"
GL_CORRECTED = "Month,Account,Amount,JE\n2026-04,Net Sales,300000,JE-101\n"


def test_a_summary_on_top_of_detail_warns_and_shows_the_month_total_after(env):
    client, mgr = env
    detail = batch_of(upload(client, GL_DETAIL, control_total="500000"))
    res = upload(client, TB_SUMMARY, control_total="500000", dry_run="true")
    report = res.json()["data"]
    assert report["control_matches"] is True                       # the file still ties
    line = report["line_totals"][0]
    assert (line["period"], line["line_item"]) == ("2026-04", "revenue")
    assert (line["before"], line["file_amount"], line["after"]) == (500000.0, 500000.0, 1000000.0)
    assert [(o["reference_id"], o["amount"], o["batch_id"]) for o in line["other_references"]] == [
        ("JE-101", 300000.0, detail), ("JE-102", 200000.0, detail)]
    assert report["stored_after_total"] == 1000000.0 and report["control_matches_after"] is False
    text = " ".join(report["warnings"])
    assert "Apr 2026 Net Sales" in text and "other references" in text and "JE-101" in text
    assert "1,000,000.00" in text and "replace" in text.lower()

    res = upload(client, TB_SUMMARY, control_total="500000")          # a real import warns the same way
    assert res.status_code == 200 and any("other references" in w for w in res.json()["data"]["warnings"])
    assert variance_actual(client, "revenue", "2026-04") == 1000000.0


def test_a_corrected_file_that_leaves_a_stale_row_says_so(env):
    client, _ = env
    upload(client, GL_DETAIL)
    res = upload(client, GL_CORRECTED, control_total="300000")
    report = res.json()["data"]
    assert report["outcome"] == "unchanged" and report["control_matches"] is True
    assert report["line_totals"][0]["after"] == 500000.0
    assert any("JE-102" in w and "500,000.00" in w for w in report["warnings"])


def test_replace_lines_replaces_other_references_and_undo_puts_them_back_exactly(env):
    client, mgr = env
    upload(client, GL_DETAIL)
    before = stored(mgr, "SELECT actual_id, reference_id, amount, source, batch_id, created_at FROM actuals "
                         "ORDER BY reference_id")
    dry = upload(client, GL_CORRECTED, control_total="300000", replace_lines="true", dry_run="true").json()["data"]
    assert dry["outcome"] == "imported" and dry["replaced"] == 1 and dry["unchanged"] == 1
    assert dry["line_totals"][0]["after"] == 300000.0 and dry["control_matches_after"] is True
    assert [o["reference_id"] for o in dry["line_totals"][0]["other_references"]] == ["JE-102"]
    assert not any("other references" in w and "kept" in w for w in dry["warnings"])

    res = upload(client, GL_CORRECTED, control_total="300000", replace_lines="true")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["replaced"] == 1 and "1 replaced" in data["message"]
    assert stored(mgr) == [("2026-04", "revenue", "JE-101", 300000.0)]
    assert variance_actual(client, "revenue", "2026-04") == 300000.0
    batch = client.get("/reporting/actuals/batches").json()["data"]["batches"][0]
    assert batch["batch_id"] == data["batch_id"] and batch["replaced"] == 1 and batch["can_undo"] is True

    preview = undo(client, data["batch_id"], dry_run=True)
    assert preview["rows_to_put_back"] == 1 and preview["rows_to_remove"] == 0
    assert preview["put_back_rows"][0]["reference_id"] == "JE-102"
    done = undo(client, data["batch_id"])
    assert done["put_back"] == 1 and done["removed"] == 0
    after = stored(mgr, "SELECT actual_id, reference_id, amount, source, batch_id, created_at FROM actuals "
                        "ORDER BY reference_id")
    assert after == before
    assert variance_actual(client, "revenue", "2026-04") == 500000.0


def test_replace_lines_only_touches_the_lines_and_months_in_the_file(env):
    client, mgr = env
    upload(client, "period,line_item,amount,reference_id\n2026-04,revenue,10,R1\n2026-04,payroll,20,P1\n"
                   "2026-05,revenue,30,R2\n")
    res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 15}], replace_lines=True)
    assert res.status_code == 200 and res.json()["data"]["replaced"] == 1
    assert stored(mgr) == [("2026-04", "payroll", "P1", 20.0), ("2026-04", "revenue", "", 15.0),
                           ("2026-05", "revenue", "R2", 30.0)]


def test_replace_lines_in_a_closed_month_is_refused(env):
    client, mgr = env
    upload(client, GL_DETAIL)
    client.post("/reporting/actuals/periods/2026-04/close", json={"closed_by": "Dana"})
    res = upload(client, GL_CORRECTED, replace_lines="true")
    assert res.status_code == 409 and res.json()["data"]["closed_periods"][0]["rows"] == 1
    assert len(stored(mgr)) == 2


def test_a_replaced_row_written_again_later_undoes_in_any_order(env):
    """X replaces JE-102 away, Y writes JE-102 again: undoing both, in either order, brings back A's row."""
    for order in (("X", "Y"), ("Y", "X")):
        client, mgr = env
        client.delete("/reporting/actuals", params={"period": "2026-04"})
        a = batch_of(upload(client, GL_DETAIL))
        x = batch_of(upload(client, GL_CORRECTED, replace_lines="true"))
        y = batch_of(post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 250000,
                                    "reference_id": "JE-102"}]))
        ids = {"X": x, "Y": y}
        undo(client, ids[order[0]])
        expected_mid = ({"JE-101": 300000.0, "JE-102": 250000.0} if order[0] == "X" else {"JE-101": 300000.0})
        assert {r[1]: r[2] for r in stored(mgr, ROWS_SQL)} == expected_mid
        undo(client, ids[order[1]])
        assert stored(mgr, ROWS_SQL) == [("revenue", "JE-101", 300000.0, a), ("revenue", "JE-102", 200000.0, a)]


def test_a_hand_entry_sets_the_month_total_and_undo_restores_the_import(env):
    client, mgr = env
    upload(client, 'period,line_item,amount,reference_id\n2026-04,Net Sales,"$1,060,000.00",GL-JAN\n')
    # Without replace_lines the new amount is added to the import: the response says so.
    dry = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1070000}], source="manual",
               dry_run=True).json()["data"]
    assert dry["line_totals"][0]["after"] == 2130000.0
    assert any("GL-JAN" in w and "2,130,000.00" in w for w in dry["warnings"])

    res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1070000}], source="manual",
               replace_lines=True)
    assert res.status_code == 200, res.text
    manual = res.json()["data"]
    assert manual["inserted"] == 1 and manual["replaced"] == 1 and manual["line_totals"][0]["after"] == 1070000.0
    assert stored(mgr) == [("2026-04", "revenue", "", 1070000.0)]
    assert variance_actual(client, "revenue", "2026-04") == 1070000.0

    undo(client, manual["batch_id"])
    assert stored(mgr) == [("2026-04", "revenue", "GL-JAN", 1060000.0)]
    assert variance_actual(client, "revenue", "2026-04") == 1060000.0


def test_schema_records_replaced_rows_and_migrates_old_databases(env):
    _client, mgr = env
    cols = {r[1] for r in stored(mgr, "PRAGMA table_info(actuals_batch_changes)")}
    assert {"change_type", "previous_period", "previous_line_item", "previous_reference_id",
            "previous_created_at"} <= cols
    assert "replaced" in {r[1] for r in stored(mgr, "PRAGMA table_info(actuals_batches)")}
    mgr.migrate_actuals_undo_tracking()                  # idempotent
    mgr.initialize_schema()


# ---------------------------------------------------------------------------
# ACT-5: decimal-comma and misplaced-comma amounts are refused
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text", ["12.500,00", "1,23", "1.234,50", "12,50", "1.234.567"])
def test_decimal_comma_amounts_are_refused_with_advice(text):
    amount, error = actuals_service.parse_amount(text)
    assert amount is None and "decimal comma" in error and "12500.00" in error


@pytest.mark.parametrize("text", ["1,2,3,4", "1,2345.6", "12,34,567"])
def test_misplaced_commas_are_not_a_number(text):
    amount, error = actuals_service.parse_amount(text)
    assert amount is None and "thousands" in error


@pytest.mark.parametrize("text,expected", [
    ("1,234.50", 1234.5), ("(1,234)", -1234.0), ("500-", -500.0), ("$1,234.50", 1234.5), ("12,500.00", 12500.0),
    ("1,234-", -1234.0), ("1,234,567.89", 1234567.89), ("1 000", 1000.0), ("1234.5", 1234.5), ("1,234", 1234.0),
    ("-$75", -75.0), ("$(12.5)", -12.5), ("1.5E+03", 1500.0), (".5", 0.5), ("-", 0.0),
])
def test_us_formatted_amounts_still_parse(text, expected):
    assert actuals_service.parse_amount(text) == (pytest.approx(expected), None)


def test_a_european_csv_with_a_matching_control_total_writes_nothing(env):
    client, mgr = env
    eu = "Period;Account;Amount\n2026-10;Payroll;12.500,00\n2026-10;Admin;1.234,50\n"
    res = upload(client, eu, control_total="13.734,50")
    assert res.status_code == 422 and "control_total" in res.json()["detail"]
    assert "decimal comma" in res.json()["detail"]
    res = upload(client, eu, control_total="13734.50")
    assert res.status_code == 422
    errors = res.json()["data"]["errors"]
    assert [e["row"] for e in errors] == [2, 3] and all("decimal comma" in e["error"] for e in errors)
    assert stored(mgr) == []


# ---------------------------------------------------------------------------
# ACT-7: re-closing keeps the reopen reason (and the first close note)
# ---------------------------------------------------------------------------

def test_reclosing_a_reopened_month_keeps_the_reason(env):
    client, _ = env
    client.post("/reporting/actuals/periods/2027-08/close", json={"closed_by": "ann", "note": "Aug close v1"})
    reopened = client.post("/reporting/actuals/periods/2027-08/reopen",
                           json={"reason": "late AP invoice 4411 posted", "reopened_by": "bob"}).json()["data"]
    assert "late AP invoice 4411" in reopened["note"] and "Aug close v1" in reopened["note"]
    closed = client.post("/reporting/actuals/periods/2027-08/close", json={"closed_by": "ann"}).json()["data"]
    period = client.get("/reporting/actuals/periods").json()["data"]["periods"][0]
    assert period["closed"] is True and closed["note"] == period["note"]
    for text in ("late AP invoice 4411 posted", "by bob", "Aug close v1"):
        assert text in period["note"]
    again = client.post("/reporting/actuals/periods/2027-08/reopen", json={"reason": "audit fix"}).json()["data"]
    client.post("/reporting/actuals/periods/2027-08/close", json={"closed_by": "ann", "note": "v3"})
    note = client.get("/reporting/actuals/periods").json()["data"]["periods"][0]["note"]
    assert note.startswith("v3") and "audit fix" in note and "late AP invoice 4411" in note
    assert "audit fix" in again["note"]


# ---------------------------------------------------------------------------
# ACT-8: the undo preview tells deleted rows from rows changed since
# ---------------------------------------------------------------------------

def test_undo_preview_says_a_deleted_row_was_deleted_not_kept(env):
    client, mgr = env
    bid = batch_of(post(client, [{"period": "2027-09", "line_item": "revenue", "amount": 1},
                                 {"period": "2027-09", "line_item": "payroll", "amount": 2}]))
    payroll_id = stored(mgr, "SELECT actual_id FROM actuals WHERE line_item = 'payroll'")[0][0]
    assert client.delete("/reporting/actuals", params={"actual_id": payroll_id}).status_code == 200
    preview = undo(client, bid, dry_run=True)
    assert not any("kept" in n for n in preview["notes"])
    assert any("deleted since" in n for n in preview["notes"])
    assert preview["rows_deleted_since"] == 1 and preview["rows_changed_since"] == 0


def test_undo_preview_still_says_kept_for_a_row_changed_later(env):
    client, _ = env
    bid = batch_of(post(client, [{"period": "2027-09", "line_item": "revenue", "amount": 1},
                                 {"period": "2027-09", "line_item": "payroll", "amount": 2}]))
    post(client, [{"period": "2027-09", "line_item": "payroll", "amount": 3}])
    preview = undo(client, bid, dry_run=True)
    assert any("changed since by later entries and is kept" in n for n in preview["notes"])
    assert not any("deleted since" in n for n in preview["notes"])
    assert preview["rows_changed_since"] == 1 and preview["rows_deleted_since"] == 0


# ---------------------------------------------------------------------------
# ACT-9: the line-item column is chosen by its values
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("csv_text", [
    "Period,Account,Account Name,Amount\n2026-10,4000,Net Sales,1000\n2026-10,6000,Payroll,250\n",
    "Period,Account Name,Account,Amount\n2026-10,Net Sales,4000,1000\n2026-10,Payroll,6000,250\n",
])
def test_account_name_beats_an_account_number_column(env, csv_text):
    client, _ = env
    report = upload(client, csv_text, dry_run="true").json()["data"]
    assert report["outcome"] == "imported", report["message"]
    assert [r["line_item"] for r in report["rows"]] == ["revenue", "payroll"]
    assert any("Used 'Account Name' for the line item" in w and "'Account'" in w for w in report["warnings"])


def test_a_shadowed_column_is_named_when_nothing_resolves(env):
    client, _ = env
    res = upload(client, "Period,Account,Account Name,Amount\n2026-10,4000,Revenue Acct,1000\n", dry_run="true")
    report = res.json()["data"]
    assert report["outcome"] == "rejected"
    assert any("Account Name" in w for w in report["warnings"])


def test_refusal_messages_have_no_doubled_punctuation(env):
    client, _ = env
    for line in ("Net Sals", "Freight in"):
        res = post(client, [{"period": "2026-04", "line_item": line, "amount": 1}])
        message = res.json()["detail"]
        assert ".." not in message and "?." not in message, message


# ---------------------------------------------------------------------------
# ACTUALS-CLOSED-HINT and replace_lines through MCP
# ---------------------------------------------------------------------------

def test_mcp_hint_for_a_closed_month_does_not_suggest_allow_partial(mcp_env):
    client, mgr, _ = mcp_env
    ok(client, "forecast_close_actuals_period", {"period": "2027-01", "closed_by": "Dana"})
    for allow_partial in (True, False):
        out = ok(client, "forecast_upsert_actuals", {"entries": [
            {"period": "2027-01", "line_item": "payroll", "amount": 1, "reference_id": "TB-0127"},
            {"period": "2027-03", "line_item": "payroll", "amount": 1}], "allow_partial": allow_partial})
        assert out["status"] == "rejected" and out["nothing_written"] is True
        assert "forecast_reopen_actuals_period" in out["next"] and "Jan 2027" in out["next"]
        assert "allow_partial=true" not in out["next"] and "rows in errors" not in out["next"]
    assert count(mgr) == 0


def test_mcp_hint_for_a_control_total_mismatch(mcp_env):
    client, _, _ = mcp_env
    out = ok(client, "forecast_upsert_actuals", {"entries": [{"period": "2027-03", "line_item": "payroll",
                                                              "amount": 1}], "allow_partial": True,
                                                 "control_total": 5})
    assert out["status"] == "rejected" and "control_total" in out["next"]
    assert "allow_partial=true" not in out["next"]


def test_mcp_hint_for_row_errors(mcp_env):
    client, _, _ = mcp_env
    entries = [{"period": "2027-03", "line_item": "payroll", "amount": 1},
               {"period": "2027-03", "line_item": "bogus", "amount": 1}]
    out = ok(client, "forecast_upsert_actuals", {"entries": entries})
    assert "rows in errors" in out["next"] and "allow_partial=true" in out["next"]
    out = ok(client, "forecast_upsert_actuals", {"entries": [entries[1]], "allow_partial": True})
    assert out["status"] == "rejected" and "rows in errors" in out["next"]
    assert "allow_partial=true" not in out["next"]


def test_mcp_replace_lines_and_month_totals(mcp_env):
    client, mgr, data_dir = mcp_env
    name = write(data_dir, "imports/jan_detail.csv", GL_DETAIL.replace("2026-04", "2027-01"))
    ok(client, "forecast_import_actuals", {"file_path": name})
    summary = ok(client, "forecast_upsert_actuals", {"entries": [{"period": "2027-01", "line_item": "Net Sales",
                                                                  "amount": 500000}], "dry_run": True})
    assert summary["line_totals"][0]["after"] == 1000000.0 and summary["stored_after_total"] == 1000000.0
    assert any("other references" in w for w in summary["warnings"])
    done = ok(client, "forecast_upsert_actuals", {"entries": [{"period": "2027-01", "line_item": "Net Sales",
                                                               "amount": 500000}], "replace_lines": True})
    assert done["status"] == "ok" and done["replaced"] == 2 and done["line_totals"][0]["after"] == 500000.0
    assert count(mgr, "SELECT COUNT(*) FROM actuals") == 1
    undone = ok(client, "forecast_undo_actuals_batch", {"batch_id": done["batch_id"], "dry_run": False})
    assert undone["put_back"] == 2
    assert count(mgr, "SELECT COUNT(*) FROM actuals") == 2
