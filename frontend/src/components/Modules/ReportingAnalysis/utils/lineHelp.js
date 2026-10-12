// One-line explanations shown as tooltips on statement lines.
export const DEDUCTION_HELP = {
  terms_allowance: 'Early-payment and dating terms discounts customers take (e.g. 2% 10 net 30).',
  chargebacks: 'Miscellaneous chargebacks and deductions customers take from their payments.',
  other_allowances: 'Volume rebates, co-op advertising, freight or returns allowances.',
  excise_tax: 'Federal excise tax included in the selling price and paid on to the government: price × rate ÷ (1 + rate). At 11% a $1,110 invoice carries $110.'
};

// Labor lines: where payroll lands depends on each employee's labor class
// (Payroll screen). Admin and not classified -> Payroll (operating expense);
// Indirect -> Indirect labor (COGS); Direct -> COGS through the variance line.
export const LABOR_HELP = {
  cogs_labor: 'Routing labor minutes × labor rates × units sold: the standard labor in each product. When employees are classed Direct, the variance line below brings direct labor to their actual pay.',
  labor_variance: 'Pay of employees classed Direct less the routing standard above, so total direct labor equals direct payroll and nobody is counted twice. Zero when no employee is classed Direct.',
  indirect_labor: 'Pay of employees classed Indirect: factory support such as supervisors, maintenance and material handling.',
  payroll: 'Pay of employees classed Admin or not classified, with employer taxes and benefits. Direct and Indirect employees are in cost of goods sold instead.'
};
