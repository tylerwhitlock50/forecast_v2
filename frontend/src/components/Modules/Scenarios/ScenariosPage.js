import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import { useConfirm } from '../../Common/ConfirmDialog';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import ScenarioFormModal from './ScenarioFormModal';
import BranchScenarioModal from './BranchScenarioModal';
import { SCOPE_KINDS } from './scenarioScope';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One place to create, branch, rename, flag and delete scenarios, with the
 * counts that tell you what each one actually contains.
 */
const ScenariosPage = () => {
  const { scenarios, activeScenario, actions } = useForecast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [formModal, setFormModal] = useState({ open: false, scenario: null });
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchSource, setBranchSource] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const list = useMemo(
    () => Object.values(scenarios || {}).sort((a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0) || a.name.localeCompare(b.name)),
    [scenarios]
  );

  const handleCreate = async (values) => {
    const created = await actions.createScenario(values);
    toast.success(`Created ${created?.name || values.name}`);
  };

  const handleEdit = async (values) => {
    await actions.updateScenario(formModal.scenario.id, values);
    toast.success('Scenario updated');
  };

  const handleSetBase = async (scenario) => {
    setBusyId(scenario.id);
    try {
      await actions.setBaseScenario(scenario.id);
      toast.success(`${scenario.name} is now the base scenario`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (scenario) => {
    const parts = [
      plural(scenario.sales_rows || 0, 'sales row'),
      plural(scenario.expense_count || 0, 'scenario-specific expense'),
      plural(scenario.employee_count || 0, 'scenario-specific employee'),
      plural(scenario.capex_count || 0, 'capex item'),
    ];
    if (scenario.price_count) parts.push(plural(scenario.price_count, 'scenario price rule'));
    if (scenario.deduction_rule_count) parts.push(plural(scenario.deduction_rule_count, 'scenario deduction rule'));
    if (scenario.has_assumptions) parts.push('its financial assumptions');
    const ok = await confirm({
      title: `Delete "${scenario.name}" (${scenario.id})?`,
      body:
        `This permanently deletes ${parts.join(', ')}.\n\n` +
        'Company-wide rows (payroll, expenses, capex, prices and deduction rules without a scenario) are kept. This cannot be undone.' +
        (scenario.is_base ? '\n\nThis is the base scenario; another scenario will become the base.' : ''),
      confirmLabel: 'Delete scenario',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusyId(scenario.id);
    try {
      const result = await actions.deleteScenario(scenario.id);
      toast.success(
        result?.promoted_base
          ? `Deleted ${scenario.name}. ${scenarios?.[result.promoted_base]?.name || result.promoted_base} is now the base scenario.`
          : `Deleted ${scenario.name}`
      );
    } finally {
      setBusyId(null);
    }
  };

  const openBranch = (scenario) => {
    setBranchSource(scenario?.id || activeScenario || null);
    setBranchOpen(true);
  };

  const headerActions = [
    { label: 'New scenario', onClick: () => setFormModal({ open: true, scenario: null }), className: 'bg-orange-600 hover:bg-orange-700 text-white' },
  ];
  if (activeScenario) {
    headerActions.push({ label: 'Branch active scenario', variant: 'outline', onClick: () => openBranch(null) });
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Scenarios"
        description="Each scenario is a self-contained forecast. Branch one to test a change, mark one as the base, and compare them under Reporting."
        actions={headerActions}
      />

      {list.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-xl font-medium text-gray-700 mb-2">No scenarios yet</h3>
          <p className="text-gray-500 mb-6">Create your first scenario. It becomes the base scenario automatically, and the sales forecast, payroll and expense screens will scope to it.</p>
          <Button onClick={() => setFormModal({ open: true, scenario: null })} className="bg-orange-600 hover:bg-orange-700 text-white">
            Create a scenario
          </Button>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[52rem] table-fixed text-sm">
              <colgroup>
                <col className="w-[27%]" />
                <col className="w-[19%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Scenario</th>
                  <th className="px-4 py-3">Sales window</th>
                  <th className="px-4 py-3 pl-6 text-right">Revenue</th>
                  <th className="px-4 py-3 pl-6" title="Rows that belong only to this scenario (company-wide rows apply to every scenario)">Scenario&apos;s own data</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map(s => {
                  const isActive = s.id === activeScenario;
                  const busy = busyId === s.id;
                  // Rows that belong only to this scenario; zero counts are left out.
                  const own = [
                    [s.expense_count, 'expense'],
                    [s.employee_count, 'employee'],
                    [s.capex_count, 'capex item'],
                    [s.price_count, 'price rule'],
                    [s.deduction_rule_count, 'deduction rule'],
                  ].filter(([n]) => Number(n) > 0).map(([n, word]) => plural(Number(n), word));
                  return (
                    <tr key={s.id} className={isActive ? 'bg-orange-50/60' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 align-top">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-semibold text-gray-900" title={s.name}>{s.name}</span>
                          <span className="flex-shrink-0 font-mono text-xs text-gray-500">{s.id}</span>
                        </div>
                        {(s.is_base || isActive) && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {s.is_base && <Badge variant="secondary">Base</Badge>}
                            {isActive && <Badge className="bg-orange-600 text-white hover:bg-orange-600">Active</Badge>}
                          </div>
                        )}
                        {s.description && (
                          <div className="mt-1 truncate text-gray-600" title={s.description}>{s.description}</div>
                        )}
                        {s.notes && (
                          <div className="mt-0.5 truncate text-xs text-gray-500" title={s.notes}>
                            {s.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-700">
                        {s.start_period
                          ? <div className="whitespace-nowrap">{formatPeriod(s.start_period)} – {formatPeriod(s.end_period)}</div>
                          : <span className="text-gray-400">No sales yet</span>}
                        {(s.sales_lines || 0) > 0 && (
                          <div className="mt-0.5 text-xs text-gray-500">{plural(s.sales_lines, 'line')}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 pl-6 align-top text-right tabular-nums text-gray-700">{money(s.revenue_total)}</td>
                      <td className="px-4 py-3 pl-6 align-top text-xs text-gray-600">
                        {own.length > 0
                          ? own.map((text) => <div key={text} className="whitespace-nowrap">{text}</div>)
                          : <div className="whitespace-nowrap text-gray-400" title="Everything except the sales lines comes from company-wide rows">Company-wide only</div>}
                        <div className="mt-1 whitespace-nowrap">
                          {s.has_assumptions
                            ? <Badge variant="success" title="Financial assumptions saved for this scenario">Assumptions set</Badge>
                            : <Badge variant="outline" title="Reports use engine defaults until assumptions are saved">Default assumptions</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          {isActive ? (
                            <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={() => navigate('/sales-forecast')}>Open forecast</Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={() => actions.switchScenario(s.id)}>Make active</Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => openBranch(s)}>Branch</Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => setFormModal({ open: true, scenario: s })}>Edit</Button>
                          {!s.is_base && (
                            <Button size="sm" variant="ghost" className="h-8 px-2.5" disabled={busy} onClick={() => handleSetBase(s)}>Set as base</Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 px-2.5 text-red-600 hover:text-red-700" disabled={busy} onClick={() => handleDelete(s)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">How scoping works</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-gray-700 md:grid-cols-3">
          <div>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${SCOPE_KINDS.scenario.tone}`}>{SCOPE_KINDS.scenario.label}</span>
            <p className="mt-2">Sales forecast lines. Branching copies them and applies your price and quantity overrides to the copy.</p>
          </div>
          <div>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${SCOPE_KINDS.mixed.tone}`}>{SCOPE_KINDS.mixed.label}</span>
            <p className="mt-2">
              Price-list and deduction rules, payroll, expenses and capex. Each rule or row is either company-wide (in every scenario) or
              belongs to one scenario. The screens show both, exactly as the statements use them. Branching copies the scenario&apos;s own
              rules and rows; company-wide ones already apply to the copy.
            </p>
          </div>
          <div>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${SCOPE_KINDS.company.tone}`}>{SCOPE_KINDS.company.label}</span>
            <p className="mt-2">Customers, products, BOMs, routings, machines, labor rates and loans are shared by every scenario.</p>
          </div>
        </CardContent>
      </Card>

      <ScenarioFormModal
        open={formModal.open}
        scenario={formModal.scenario}
        onClose={() => setFormModal({ open: false, scenario: null })}
        onSubmit={formModal.scenario ? handleEdit : handleCreate}
      />

      <BranchScenarioModal
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        scenarios={scenarios}
        activeScenarioId={branchSource}
        onSubmit={async (sourceId, scenarioData, overrides) => {
          const result = await actions.duplicateScenario(sourceId, scenarioData, overrides);
          if (result) {
            const copied = result.copied || {};
            toast.success(
              `Branched to "${result.name}": ${plural(copied.sales || 0, 'sales row')}` +
              (copied.sales_extended ? ` + ${copied.sales_extended} extended` : '') +
              (copied.assumptions ? ', assumptions copied' : '')
            );
          }
          return result;
        }}
      />
    </div>
  );
};

export default ScenariosPage;
