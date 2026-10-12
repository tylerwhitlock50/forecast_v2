import { plannedChanges, summarizeImportResult } from './importSteps';

describe('summarizeImportResult: counts newer servers add', () => {
  it('reads unchanged, removed lines and replaced BOMs from data or summary, null when absent', () => {
    const sales = summarizeImportResult({
      data: {
        imported: 10, inserted: 2, updated: 3, unchanged: 5, deleted: 4, removed_line_count: 2,
        removed_lines: [{ customer_id: 'C1', unit_id: 'U1', months: ['2027-01', '2027-02'] }],
      },
    });
    expect(sales).toMatchObject({ unchanged: 5, removedLineCount: 2, deleted: 4 });
    expect(sales.removedLines[0]).toMatchObject({ customerId: 'C1', unitId: 'U1', months: ['2027-01', '2027-02'], monthCount: 2 });

    const bom = summarizeImportResult({ data: { created: 3, replaced: 1, summary: { lines_deleted: 7, boms_replaced: 1 } } });
    expect(bom).toMatchObject({ bomsReplaced: 1, linesDeleted: 7, routingsReplaced: null, operationsDeleted: null });

    const old = summarizeImportResult({ data: { imported: 2, inserted: 0, updated: 2 } });
    expect(old).toMatchObject({ unchanged: null, removedLineCount: null, removedLines: [] });
  });
});

describe('plannedChanges', () => {
  const sales = (data) => summarizeImportResult({ data: { created_customers: [], created_products: [], ...data } });

  it('counts new + updated sales rows (never unchanged) and the rows a replace removes', () => {
    expect(plannedChanges(sales({ imported: 10, inserted: 2, updated: 3, unchanged: 5, deleted: 4 }), 'sales'))
      .toEqual({ writes: 5, removals: 4, created: 0, nothing: false });
    expect(plannedChanges(sales({ imported: 10, inserted: 0, updated: 0, unchanged: 10 }), 'sales').nothing).toBe(true);
    // An older server without an unchanged count: every row it would import.
    expect(plannedChanges(sales({ imported: 10, inserted: 0, updated: 10 }), 'sales').writes).toBe(10);
    // A blocked replace removes nothing.
    expect(plannedChanges(sales({ imported: 1, inserted: 1, updated: 0, unchanged: 0, deleted: 0, replace_blocked: true }), 'sales').removals).toBe(0);
    // Creating a customer is a change.
    expect(plannedChanges(sales({ imported: 1, inserted: 0, updated: 0, unchanged: 1, created_customers: ['C9'] }), 'sales').nothing).toBe(false);
  });

  it('counts new + updated records', () => {
    const r = summarizeImportResult({ data: { created: 0, updated: 0, summary: { unchanged: 12 } } });
    expect(plannedChanges(r, 'customers')).toEqual({ writes: 0, removals: 0, created: 0, nothing: true });
  });
});
