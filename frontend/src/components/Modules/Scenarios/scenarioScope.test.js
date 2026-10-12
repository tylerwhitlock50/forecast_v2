import { scopeForPath, SCOPE_KINDS } from './scenarioScope';

describe('scopeForPath', () => {
  it('Cost Management and product detail use the active scenario sales', () => {
    expect(scopeForPath('/cost-management')).toBe(SCOPE_KINDS.sales);
    expect(scopeForPath('/products/RFL-100')).toBe(SCOPE_KINDS.sales);
    expect(SCOPE_KINDS.sales.label).toBe("Uses this scenario's sales");
  });

  it('master data lists stay company-wide', () => {
    expect(scopeForPath('/products')).toBe(SCOPE_KINDS.company);
    expect(scopeForPath('/bom')).toBe(SCOPE_KINDS.company);
  });

  it('reports follow the active scenario', () => {
    expect(scopeForPath('/reporting/cogs-labor')).toBe(SCOPE_KINDS.selection);
    expect(SCOPE_KINDS.selection.help).toMatch(/active scenario/);
  });

  it('the scenarios page has no badge', () => {
    expect(scopeForPath('/scenarios')).toBeNull();
  });
});
