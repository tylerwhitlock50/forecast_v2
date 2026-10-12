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
    if (scenario.has_assumptions) parts.push('its financial assumptions');
    const ok = await confirm({
      title: `Delete "${scenario.name}" (${scenario.id})?`,
      body:
        `This permanently deletes ${parts.join(', ')}.\n\n` +
        'Company-wide rows (payroll, expenses and capex without a scenario) are kept. This cannot be undone.',
      confirmLabel: 'Delete scenario',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusyId(scenario.id);
    try {
      await actions.deleteScenario(scenario.id);
      toast.success(`Deleted ${scenario.name}`);
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
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Scenario</th>
                  <th className="px-4 py-3">Sales window</th>
                  <th className="px-4 py-3 text-right">Lines</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3">Scenario-only rows</th>
                  <th className="px-4 py-3">Assumptions</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map(s => {
                  const isActive = s.id === activeScenario;
                  const busy = busyId === s.id;
                  return (
                    <tr key={s.id} className={isActive ? 'bg-orange-50/60' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-gray-900">{s.name}</span>
                          <span className="font-mono text-xs text-gray-500">{s.id}</span>
                          {s.is_base && <Badge variant="secondary">Base</Badge>}
                          {isActive && <Badge className="bg-orange-600 text-white hover:bg-orange-600">Active</Badge>}
                        </div>
                        {s.description && <div className="mt-1 text-gray-600">{s.description}</div>}
                        {s.notes && (
                          <div className="mt-1 max-w-xl truncate text-xs text-gray-500" title={s.notes}>
                            {s.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap text-gray-700">
                        {s.start_period ? `${formatPeriod(s.start_period)} – ${formatPeriod(s.end_period)}` : <span className="text-gray-400">No sales yet</span>}
                      </td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-gray-700">{s.sales_lines || 0}</td>
                      <td className="px-4 py-3 align-top text-right tabular-nums text-gray-700">{money(s.revenue_total)}</td>
                      <td className="px-4 py-3 align-top text-gray-700 whitespace-nowrap">
                        <div>{plural(s.expense_count || 0, 'expense')}</div>
                        <div>{plural(s.employee_count || 0, 'employee')}</div>
                        <div>{plural(s.capex_count || 0, 'capex item')}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {s.has_assumptions
                          ? <Badge variant="success">Set</Badge>
                          : <Badge variant="outline" title="Reports will use engine defaults until assumptions are saved">Defaults</Badge>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          {isActive ? (
                            <Button size="sm" variant="outline" onClick={() => navigate('/sales-forecast')}>Open forecast</Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => actions.switchScenario(s.id)}>Make active</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openBranch(s)}>Branch</Button>
                          <Button size="sm" variant="ghost" onClick={() => setFormModal({ open: true, scenario: s })}>Edit</Button>
                          {!s.is_base && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleSetBase(s)}>Set as base</Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => handleDelete(s)}>
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
            <p className="mt-2">Payroll, expenses and capex. Each row is either company-wide (in every scenario) or pinned to one scenario. The screens show both, exactly as the statements use them.</p>
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
