"""
Actuals controls (review follow-up W2): one atomic, reconciled, auditable
pipeline for CSV / XLSX imports and JSON entries, import batches with undo,
and month-end close.

The reviewer's evidence (commit 9199391):

* two rows with the same period + line + reference reported 'Imported 2' but
  left one (the second silently overwrote the first);
* a bad amount partially committed the valid April row;
* an invalid period rolled back the valid May row with 422 (inconsistent
  with the bad-amount case);
* no batch audit, no source-total reconciliation, no closed periods.

Drives the real FastAPI app against an isolated database in a temp folder.
"""
import io
import os
import shutil
import sqlite3
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
_APP_DIR = os.path.join(_REPO, "app")
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', '2026 Budget', 1)")
    c.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C1', 'Dealer One')")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P1', 'Rifle', 100)")
    for i, period in enumerate(("2026-03", "2026-04", "2026-05", "2026-06"), start=1):
        c.execute("INSERT INTO sales VALUES (?, 'C1', 'P1', ?, 10, 100, 1000, 'F001')", (f"S{i}", period))
    conn.commit()
    conn.close()


def _patch_db_manager(mgr):
    originals = {}
    for name, module in list(sys.modules.items()):
        if module is None:
            continue
        if name in ("db.database", "app.db.database") or name.startswith(("api.", "app.api.")):
            if hasattr(module, "db_manager"):
                originals[name] = module.db_manager
                module.db_manager = mgr
    return originals


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "forecast.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, mgr
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def stored(mgr, sql="SELECT period, line_item, reference_id, amount FROM actuals ORDER BY period, line_item, reference_id",
           params=()):
    conn = mgr.get_connection()
    try:
        return [tuple(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        mgr.close_connection(conn)


def upload(client, text, name="actuals.csv", **params):
    data = text.encode("utf-8") if isinstance(text, str) else text
    return client.post("/reporting/actuals/import", params=params, files={"file": (name, data, "text/csv")})


def post(client, entries, **flags):
    return client.post("/reporting/actuals", json={"entries": entries, **flags})


# ---------------------------------------------------------------------------
# The reviewer's evidence
# ---------------------------------------------------------------------------

class TestReviewerEvidence:
    def test_duplicate_reference_rows_are_an_error_naming_both_rows(self, env):
        client, mgr = env
        csv_text = ("period,line_item,amount,reference_id\n"
                    "2026-04,revenue,901,INV-9\n"
                    "2026-04,revenue,902,INV-9\n")
        res = upload(client, csv_text)
        assert res.status_code == 422, res.text
        body = res.json()
        report = body["data"]
        assert report["outcome"] == "rejected" and report["written"] is False
        assert report["rejected"] == 2 and report["inserted"] == 0
        assert {e["row"] for e in report["errors"]} == {2, 3}
        assert all("rows 2 and 3" in e["error"] for e in report["errors"])
        assert "INV-9" in report["errors"][0]["error"]
        assert report["duplicates"][0]["rows"] == [2, 3] and report["duplicates"][0]["amounts"] == [901, 902]
        assert "Nothing imported" in body["detail"]
        assert stored(mgr) == []

    def test_combine_duplicates_adds_them_up(self, env):
        client, mgr = env
        csv_text = ("period,line_item,amount,reference_id\n"
                    "2026-04,revenue,901,INV-9\n"
                    "2026-04,revenue,902,INV-9\n")
        res = upload(client, csv_text, combine_duplicates="true")
        assert res.status_code == 200, res.text
        report = res.json()["data"]
        assert report["outcome"] == "imported" and report["inserted"] == 1 and report["rejected"] == 0
        assert report["rows"][0]["rows"] == [2, 3] and report["rows"][0]["amount"] == 1803
        assert stored(mgr) == [("2026-04", "revenue", "INV-9", 1803.0)]

    def test_bad_amount_rejects_the_whole_file_by_default(self, env):
        client, mgr = env
        csv_text = ("period,line_item,amount\n"
                    "2026-04,revenue,1000\n"
                    "2026-04,payroll,oops\n")
        res = upload(client, csv_text)
        assert res.status_code == 422, res.text
        report = res.json()["data"]
        assert report["outcome"] == "rejected" and report["written"] is False
        assert report["errors"] == [{"row": 3, "error": "amount 'oops' is not a number"}]
        assert stored(mgr) == []              # the valid April row is NOT committed

    def test_allow_partial_writes_the_valid_rows_and_reports_the_rest(self, env):
        client, mgr = env
        csv_text = ("period,line_item,amount\n"
                    "2026-04,revenue,1000\n"
                    "2026-04,payroll,oops\n")
        res = upload(client, csv_text, allow_partial="true")
        assert res.status_code == 200, res.text
        report = res.json()["data"]
        assert report["outcome"] == "partial" and report["written"] is True
        assert report["inserted"] == 1 and report["rejected"] == 1
        assert [r["action"] for r in report["rows"]] == ["inserted", "rejected"]
        assert stored(mgr) == [("2026-04", "revenue", "", 1000.0)]
        batch = client.get("/reporting/actuals/batches").json()["data"]["batches"][0]
        assert batch["status"] == "partial" and batch["rejected"] == 1 and batch["inserted"] == 1

    def test_invalid_period_answers_exactly_like_a_bad_amount(self, env):
        client, mgr = env
        csv_text = ("period,line_item,amount\n"
                    "2026-05,revenue,1000\n"
                    "2026-13,payroll,50\n")
        res = upload(client, csv_text)
        assert res.status_code == 422, res.text
        report = res.json()["data"]
        assert report["outcome"] == "rejected" and report["errors"][0]["row"] == 3
        assert "2026-13" in report["errors"][0]["error"] and "not a month" in report["errors"][0]["error"]
        assert stored(mgr) == []
        # Same answer through the JSON entry point.
        res = post(client, [{"period": "2026-05", "line_item": "revenue", "amount": 1000},
                            {"period": "2026-13", "line_item": "payroll", "amount": 50}])
        assert res.status_code == 422
        assert res.json()["data"]["errors"][0]["row"] == 2 and stored(mgr) == []


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class TestValidation:
    def test_blank_amount_is_rejected_never_stored_as_zero(self, env):
        client, mgr = env
        res = upload(client, "period,line_item,amount\n2026-04,revenue,\n2026-04,payroll,0\n")
        assert res.status_code == 422
        errors = res.json()["data"]["errors"]
        assert errors[0]["row"] == 2 and errors[0]["error"].startswith("no amount")
        res = upload(client, "period,line_item,amount\n2026-04,revenue,\n2026-04,payroll,0\n", allow_partial="true")
        assert res.status_code == 200
        assert stored(mgr) == [("2026-04", "payroll", "", 0.0)]   # '0' is a confirmed zero

    def test_json_null_amount_is_no_amount(self, env):
        client, mgr = env
        res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": None}])
        assert res.status_code == 422
        assert res.json()["data"]["errors"][0]["error"].startswith("no amount")
        assert stored(mgr) == []

    @pytest.mark.parametrize("text,expected", [
        ("$1,234.50", 1234.5), ("(500)", -500.0), ("500-", -500.0), ("-$75", -75.0), ("$(12.5)", -12.5),
        ("1 000", 1000.0), ("-", 0.0), ("0", 0.0),
    ])
    def test_amount_formats(self, env, text, expected):
        client, mgr = env
        res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": text}])
        assert res.status_code == 200, res.text
        assert stored(mgr)[0][3] == pytest.approx(expected)

    @pytest.mark.parametrize("text,key", [
        ("Net Sales", "revenue"), ("net sales", "revenue"), ("REVENUE", "revenue"), ("Gross Sales", "gross_sales"),
        ("COGS - Materials", "cogs_materials"), ("Direct Materials", "cogs_materials"), ("Salaries & Wages", "payroll"),
        ("G&A", "admin_expense"), ("Cost of Goods Sold", "total_cogs"), ("closing_cash", "closing_cash"),
        ("Capital Expenditures", "capex"), ("Sales Commissions", "commissions"),
    ])
    def test_line_items_accept_labels_and_aliases(self, env, text, key):
        client, mgr = env
        res = post(client, [{"period": "2026-04", "line_item": text, "amount": 10}])
        assert res.status_code == 200, res.text
        assert stored(mgr)[0][1] == key

    def test_ambiguous_and_unknown_line_items_explain_what_to_use(self, env):
        client, _ = env
        res = post(client, [{"period": "2026-04", "line_item": "Sales", "amount": 1},
                            {"period": "2026-04", "line_item": "Net Slaes", "amount": 1},
                            {"period": "2026-04", "line_item": "Freight in", "amount": 1}])
        assert res.status_code == 422
        errors = [e["error"] for e in res.json()["data"]["errors"]]
        assert "Gross Sales" in errors[0] and "Net Sales" in errors[0]
        assert "Did you mean 'Net Sales'" in errors[1]
        assert "'Freight in' is not a statement line" in errors[2]

    @pytest.mark.parametrize("text", ["Apr 2026", "2026-04-30", "4/30/2026", "April 2026", "2026/4"])
    def test_period_formats(self, env, text):
        client, mgr = env
        res = post(client, [{"period": text, "line_item": "revenue", "amount": 1}])
        assert res.status_code == 200, res.text
        assert stored(mgr)[0][0] == "2026-04"

    def test_quarter_is_not_a_month(self, env):
        client, _ = env
        res = post(client, [{"period": "2026-Q2", "line_item": "revenue", "amount": 1}])
        assert res.status_code == 422
        assert "is a quarter" in res.json()["data"]["errors"][0]["error"]

    def test_header_aliases_title_rows_and_total_rows(self, env):
        client, mgr = env
        csv_text = ("Acme Corp - actuals for April,,,\n"
                    ",,,\n"
                    "Month,Account,Actual,Memo\n"
                    "Apr-26,Net Sales,\"$12,500.00\",from TB\n"
                    "Apr-26,Payroll,\"(4,000)\",\n"
                    "Total,,\"8,500.00\",\n")
        res = upload(client, csv_text)
        assert res.status_code == 200, res.text
        report = res.json()["data"]
        assert report["file"]["header_row"] == 3
        assert [r["row"] for r in report["rows"]] == [4, 5]
        assert report["skipped_rows"] == [{"row": 6, "text": "Total"}]
        assert any("Skipped 1 row" in w for w in report["warnings"])
        assert any("negative" in w for w in report["warnings"])   # payroll entered as (4,000)
        assert stored(mgr) == [("2026-04", "payroll", "", -4000.0), ("2026-04", "revenue", "", 12500.0)]
        notes = stored(mgr, "SELECT notes FROM actuals WHERE line_item = 'revenue'")
        assert notes == [("from TB",)]

    def test_missing_columns_is_a_clear_file_level_error(self, env):
        client, _ = env
        res = upload(client, "Account,Jan 2026,Feb 2026\nNet Sales,100,200\n")
        assert res.status_code == 422
        detail = res.json()["detail"]
        assert "No period" in detail and "Found: Account, Jan 2026, Feb 2026" in detail

    def test_xlsx_upload(self, env):
        from datetime import datetime
        from openpyxl import Workbook
        client, mgr = env
        wb = Workbook()
        ws = wb.active
        ws.title = "TB"
        ws.append(["April trial balance mapped to statement lines"])
        ws.append(["Period", "Line Item", "Amount", "Reference"])
        ws.append([datetime(2026, 4, 30), "Net Sales", 12500, 901])
        ws.append(["2026-04", "COGS - Materials", 4000.5, None])
        buf = io.BytesIO()
        wb.save(buf)
        res = client.post("/reporting/actuals/import", files={
            "file": ("april.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        assert res.status_code == 200, res.text
        report = res.json()["data"]
        assert report["inserted"] == 2 and report["file"]["sheet"] == "TB" and report["file"]["header_row"] == 2
        assert stored(mgr) == [("2026-04", "cogs_materials", "", 4000.5), ("2026-04", "revenue", "901", 12500.0)]

    def test_xls_is_refused_with_advice(self, env):
        client, _ = env
        res = upload(client, b"\xd0\xcf\x11\xe0junk", name="old.xls")
        assert res.status_code == 422 and ".xlsx or .csv" in res.json()["detail"]


# ---------------------------------------------------------------------------
# Compare with stored rows, dry run, reconciliation
# ---------------------------------------------------------------------------

class TestCompareAndReconcile:
    def test_per_row_actions_against_stored_rows(self, env):
        client, mgr = env
        assert post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000},
                             {"period": "2026-04", "line_item": "payroll", "amount": 300}]).status_code == 200
        res = upload(client, "period,line_item,amount\n2026-04,revenue,1000\n2026-04,payroll,350\n"
                             "2026-04,admin_expense,90\n")
        assert res.status_code == 200, res.text
        report = res.json()["data"]
        actions = {r["line_item"]: r for r in report["rows"]}
        assert actions["revenue"]["action"] == "unchanged"
        assert actions["payroll"]["action"] == "updated" and actions["payroll"]["previous_amount"] == 300
        assert actions["payroll"]["changes"] == ["amount"]
        assert actions["admin_expense"]["action"] == "inserted"
        assert (report["inserted"], report["updated"], report["unchanged"], report["rejected"]) == (1, 1, 1, 0)
        assert "1 new, 1 changed, 1 unchanged" in report["message"]

    def test_nothing_changed_writes_no_batch(self, env):
        client, _ = env
        post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000}])
        res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": "1,000.00"}])
        assert res.status_code == 200
        assert res.json()["data"]["outcome"] == "unchanged" and res.json()["data"]["batch_id"] is None
        assert client.get("/reporting/actuals/batches").json()["data"]["total_count"] == 1

    def test_dry_run_writes_nothing_and_always_answers_200(self, env):
        client, mgr = env
        res = upload(client, "period,line_item,amount\n2026-04,revenue,1000\n", dry_run="true")
        assert res.status_code == 200
        report = res.json()["data"]
        assert report["dry_run"] is True and report["written"] is False and report["outcome"] == "imported"
        assert report["inserted"] == 1 and "Check only" in report["message"]
        assert stored(mgr) == []
        res = upload(client, "period,line_item,amount\n2026-04,revenue,oops\n", dry_run="true")
        assert res.status_code == 200 and res.json()["data"]["outcome"] == "rejected"
        assert client.get("/reporting/actuals/batches").json()["data"]["total_count"] == 0

    def test_totals_by_line_and_period_and_control_total(self, env):
        client, mgr = env
        csv_text = ("period,line_item,amount\n"
                    "2026-03,revenue,1000\n2026-03,payroll,400\n"
                    "2026-04,revenue,1100.25\n2026-04,payroll,410\n")
        res = upload(client, csv_text, dry_run="true")
        totals = res.json()["data"]["totals"]
        assert totals["grand_total"] == 2910.25
        by_line = {t["line_item"]: t for t in totals["by_line_item"]}
        assert by_line["revenue"]["amount"] == 2100.25 and by_line["revenue"]["rows"] == 2
        assert by_line["revenue"]["label"] == "Net Sales"
        by_period = {t["period"]: t["amount"] for t in totals["by_period"]}
        assert by_period == {"2026-03": 1400, "2026-04": 1510.25}

        res = upload(client, csv_text, control_total="2,910.00")
        assert res.status_code == 422
        body = res.json()
        assert "2,910.25" in body["detail"] and "2,910.00" in body["detail"]
        assert body["data"]["control_matches"] is False and body["data"]["control_difference"] == 0.25
        assert stored(mgr) == []
        # A control total mismatch is refused even with allow_partial.
        assert upload(client, csv_text, control_total="2910", allow_partial="true").status_code == 422

        res = upload(client, csv_text, control_total="2910.25")
        assert res.status_code == 200 and res.json()["data"]["control_matches"] is True
        batch = client.get("/reporting/actuals/batches").json()["data"]["batches"][0]
        assert batch["file_total"] == 2910.25 and batch["control_total"] == 2910.25
        assert batch["filename"] == "actuals.csv" and batch["rows_in_file"] == 4

    def test_tie_out_warning(self, env):
        client, _ = env
        res = post(client, [{"period": "2026-04", "line_item": "gross_sales", "amount": 1000},
                            {"period": "2026-04", "line_item": "total_sales_deductions", "amount": 100},
                            {"period": "2026-04", "line_item": "revenue", "amount": 950}], dry_run=True)
        assert any("Gross Sales - Sales Deductions = 900.00 but Net Sales is 950.00" in w
                   for w in res.json()["data"]["warnings"])


# ---------------------------------------------------------------------------
# Batches and undo
# ---------------------------------------------------------------------------

class TestBatches:
    def test_every_write_is_a_batch_and_rows_are_stamped(self, env):
        client, mgr = env
        res = upload(client, "period,line_item,amount\n2026-04,revenue,1000\n2026-04,payroll,300\n",
                     source="GL export", note="April close")
        batch_id = res.json()["data"]["batch_id"]
        assert batch_id.startswith("ACT-") and len(batch_id) == 12
        assert {r[0] for r in stored(mgr, "SELECT batch_id FROM actuals")} == {batch_id}
        listing = client.get("/reporting/actuals", params={"start_period": "2026-04", "end_period": "2026-04"})
        assert {r["batch_id"] for r in listing.json()["data"]["actuals"]} == {batch_id}
        batches = client.get("/reporting/actuals/batches").json()["data"]
        b = batches["batches"][0]
        assert b["batch_id"] == batch_id and b["source"] == "GL export" and b["note"] == "April close"
        assert (b["inserted"], b["updated"], b["unchanged"], b["rejected"]) == (2, 0, 0, 0)
        assert b["status"] == "imported" and b["rows_current"] == 2 and b["can_undo"] is True
        assert b["periods"] == ["2026-04"] and b["created_at"].endswith("Z")
        manual = post(client, [{"period": "2026-04", "line_item": "admin_expense", "amount": 5}], source="manual")
        assert manual.json()["data"]["batch_id"] != batch_id
        assert client.get("/reporting/actuals/batches").json()["data"]["batches"][0]["source"] == "manual"

    def test_undo_removes_rows_still_stamped_and_keeps_later_changes(self, env):
        client, mgr = env
        first = upload(client, "period,line_item,amount\n2026-04,revenue,1000\n2026-04,payroll,300\n")
        first_id = first.json()["data"]["batch_id"]
        # A later correction re-stamps payroll: it belongs to the later batch now.
        second = post(client, [{"period": "2026-04", "line_item": "payroll", "amount": 320},
                               {"period": "2026-04", "line_item": "admin_expense", "amount": 40}])
        second_id = second.json()["data"]["batch_id"]

        preview = client.delete(f"/reporting/actuals/batches/{first_id}", params={"dry_run": "true"})
        assert preview.status_code == 200
        p = preview.json()["data"]
        assert p["rows_to_remove"] == 1 and p["added_rows"] == 1 and p["can_undo"] is True
        assert any("changed since" in n for n in p["notes"])
        assert len(stored(mgr)) == 3

        res = client.delete(f"/reporting/actuals/batches/{first_id}")
        assert res.status_code == 200 and res.json()["data"]["removed"] == 1
        assert stored(mgr) == [("2026-04", "admin_expense", "", 40.0), ("2026-04", "payroll", "", 320.0)]
        batches = {b["batch_id"]: b for b in client.get("/reporting/actuals/batches").json()["data"]["batches"]}
        assert batches[first_id]["status"] == "undone" and batches[first_id]["can_undo"] is False
        assert "Undone" in batches[first_id]["note"]
        assert client.delete(f"/reporting/actuals/batches/{first_id}").status_code == 409

        # Undoing the correction removes the row it added and puts payroll back to its earlier 300.
        p2 = client.delete(f"/reporting/actuals/batches/{second_id}", params={"dry_run": "true"}).json()["data"]
        assert p2["added_rows"] == 1 and p2["changed_rows"] == 1 and p2["rows_to_restore"] == 1
        assert any("earlier amount" in n for n in p2["notes"])
        assert p2["changed"] == [{"period": "2026-04", "line_item": "payroll", "label": "Payroll",
                                  "reference_id": "", "amount": 320.0, "restores_to": 300.0, "action": "restore"}]
        done = client.delete(f"/reporting/actuals/batches/{second_id}").json()["data"]
        assert done["removed"] == 1 and done["restored"] == 1
        assert stored(mgr) == [("2026-04", "payroll", "", 300.0)]

    def test_unknown_batch_is_404(self, env):
        client, _ = env
        assert client.delete("/reporting/actuals/batches/ACT-nope").status_code == 404

    def test_delete_is_recorded_in_the_history(self, env):
        client, mgr = env
        post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000}])
        res = client.delete("/reporting/actuals", params={"period": "2026-04"})
        assert res.status_code == 200 and res.json()["data"]["deleted"] == 1
        b = client.get("/reporting/actuals/batches").json()["data"]["batches"][0]
        assert b["status"] == "deleted" and "Deleted 1 row" in b["note"] and b["can_undo"] is False
        assert stored(mgr) == []


# ---------------------------------------------------------------------------
# Month-end close
# ---------------------------------------------------------------------------

class TestPeriodClose:
    def _close(self, client, period="2026-04"):
        res = client.post(f"/reporting/actuals/periods/{period}/close", json={"closed_by": "Dana", "note": "April close"})
        assert res.status_code == 200, res.text
        return res.json()["data"]

    def test_close_and_list(self, env):
        client, _ = env
        post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000}])
        data = self._close(client)
        assert data["status"] == "closed" and data["closed_by"] == "Dana" and data["changed"] is True
        again = self._close(client)
        assert again["changed"] is False and "already closed" in again["message"]
        periods = client.get("/reporting/actuals/periods").json()["data"]
        assert periods["closed_periods"] == ["2026-04"]
        april = periods["periods"][0]
        assert april["closed"] is True and april["rows"] == 1 and april["closed_by"] == "Dana"
        window = client.get("/reporting/actuals/periods", params={"start_period": "2026-03", "end_period": "2026-05"})
        assert [p["period"] for p in window.json()["data"]["periods"]] == ["2026-03", "2026-04", "2026-05"]
        assert client.post("/reporting/actuals/periods/Apr-2026/close", json={}).status_code == 422

    def test_every_write_to_a_closed_month_is_refused(self, env):
        client, mgr = env
        first = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000},
                              {"period": "2026-05", "line_item": "revenue", "amount": 900}])
        batch_id = first.json()["data"]["batch_id"]
        self._close(client)
        before = stored(mgr)

        res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1500}])
        assert res.status_code == 409 and "Apr 2026" in res.json()["detail"]
        assert res.json()["data"]["closed_periods"] == [{"period": "2026-04", "label": "Apr 2026", "rows": 1}]

        res = upload(client, "period,line_item,amount\n2026-04,payroll,10\n2026-05,payroll,20\n", allow_partial="true")
        assert res.status_code == 409 and "Apr 2026" in res.json()["detail"]

        res = client.delete("/reporting/actuals", params={"period": "2026-04"})
        assert res.status_code == 409 and "Apr 2026" in res.json()["detail"]
        res = client.delete("/reporting/actuals", params={"line_item": "revenue"})
        assert res.status_code == 409

        res = client.delete(f"/reporting/actuals/batches/{batch_id}")
        assert res.status_code == 409 and "Apr 2026" in res.json()["detail"]
        batch = client.get("/reporting/actuals/batches").json()["data"]["batches"][0]
        assert batch["can_undo"] is False and batch["closed_periods"] == ["2026-04"]
        assert stored(mgr) == before

        # A dry run reports it instead of refusing.
        res = post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1500}], dry_run=True)
        assert res.status_code == 200 and res.json()["data"]["outcome"] == "rejected"
        assert res.json()["data"]["rows"][0]["error"] == "Apr 2026 is closed"

        # A row for a closed month that already matches changes nothing, so a year-to-date file is fine.
        res = upload(client, "period,line_item,amount\n2026-04,revenue,1000\n2026-05,payroll,20\n")
        assert res.status_code == 200, res.text
        assert res.json()["data"]["unchanged"] == 1 and res.json()["data"]["inserted"] == 1

    def test_reopen_needs_a_reason_then_writes_work_again(self, env):
        client, mgr = env
        post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000}])
        self._close(client)
        res = client.post("/reporting/actuals/periods/2026-04/reopen", json={})
        assert res.status_code == 422 and "reason" in res.json()["detail"]
        res = client.post("/reporting/actuals/periods/2026-04/reopen", json={"reason": "Late freight invoice",
                                                                             "reopened_by": "Dana"})
        assert res.status_code == 200 and res.json()["data"]["changed"] is True
        april = client.get("/reporting/actuals/periods").json()["data"]["periods"][0]
        assert april["status"] == "open" and "Late freight invoice" in april["note"]
        assert post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1100}]).status_code == 200
        assert stored(mgr)[0][3] == 1100

    def test_variance_and_actuals_list_closed_periods(self, env):
        client, _ = env
        post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000}])
        self._close(client)
        var = client.get("/reporting/variance", params={"forecast_ids": "F001", "start_period": "2026-03",
                                                         "end_period": "2026-06"})
        assert var.status_code == 200 and var.json()["data"]["closed_periods"] == ["2026-04"]
        outside = client.get("/reporting/variance", params={"forecast_ids": "F001", "start_period": "2026-05",
                                                             "end_period": "2026-06"})
        assert outside.json()["data"]["closed_periods"] == []
        listing = client.get("/reporting/actuals", params={"start_period": "2026-04", "end_period": "2026-04"})
        assert listing.json()["data"]["closed_periods"] == ["2026-04"]

    def test_start_clean_clears_batches_and_close_status(self, env):
        client, mgr = env
        post(client, [{"period": "2026-04", "line_item": "revenue", "amount": 1000}])
        self._close(client)
        mgr.clear_all_data()
        assert stored(mgr, "SELECT COUNT(*) FROM actuals_batches") == [(0,)]
        assert stored(mgr, "SELECT COUNT(*) FROM actuals_periods") == [(0,)]


class TestDuplicatesWithBrokenRows:
    def test_a_broken_row_does_not_block_its_valid_twin_under_allow_partial(self, env):
        """The bad row is left out anyway; it is told which valid row shares its key."""
        client, mgr = env
        csv_text = "period,line_item,amount\n2026-02,revenue,\"2,100\"\n2026-02,admin_expense,90\n2026-02,revenue,oops\n"
        res = upload(client, csv_text)
        assert res.status_code == 422
        errors = res.json()["data"]["errors"]
        assert errors == [{"row": 4, "error": "amount 'oops' is not a number; row 2 has the same month, line and reference"}]
        res = upload(client, csv_text, allow_partial="true")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["imported"] == 2 and len(data["errors"]) == 1
        assert stored(mgr) == [("2026-02", "admin_expense", "", 90.0), ("2026-02", "revenue", "", 2100.0)]


def test_close_by_defaults_to_the_forecast_user_header(env):
    client, _ = env
    res = client.post("/reporting/actuals/periods/2026-04/close", json={}, headers={"X-Forecast-User": "Lee"})
    assert res.status_code == 200 and res.json()["data"]["closed_by"] == "Lee"
    res = client.post("/reporting/actuals/periods/2026-04/reopen", json={"reason": "Typo"},
                      headers={"X-Forecast-User": "Lee"})
    assert res.json()["data"]["reopened_by"] == "Lee" and "by Lee" in res.json()["data"]["note"]
