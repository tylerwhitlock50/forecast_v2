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
import ApproveScenarioModal from './ApproveScenarioModal';
import UnlockScenarioModal from './UnlockScenarioModal';
import ApprovalHistoryModal from './ApprovalHistoryModal';
import { SCOPE_KINDS } from './scenarioScope';
import { LockIcon, approvalLine, driftItems, isLocked, signedMoney, statusOf } from './governance';
import { approveScenario, fetchApprovals, unlockScenario } from './governanceApi';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Status badge: Draft, or a padlock + Approved & locked. */
export const StatusBadge = ({ scenario }) => {
  const status = statusOf(scenario);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${status.tone}`}
      data-testid="scenario-status"
      title={isLocked(scenario) ? `${approvalLine(scenario)}. Its own rows cannot be changed.` : 'Editable'}
    >
      {isLocked(scenario) && <LockIcon className="h-3 w-3" />}
      {status.label}
    </span>
  );
};

/** Amber note on an approved scenario whose totals moved since approval (shared inputs changed). */
const DriftWarning = ({ scenario, onReview }) => {
  const items = driftItems(scenario);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="drift-warning">
      <p className="font-medium">The numbers have moved since this scenario was approved</p>
      <p className="mt-0.5 text-xs text-amber-800">
        Its own rows are locked, but shared company-wide data (BOMs, routings, rates, company-wide prices, payroll or
        expenses) has changed.
      </p>
      <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.line} className="flex justify-between gap-3 tabular-nums">
            <span>{item.label || item.line}</span>
            <span>
              {money(item.approved)} → {money(item.current)}{' '}
              <span className="font-semibold">({signedMoney(item.delta)})</span>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 text-xs font-medium text-amber-900 underline underline-offset-2" onClick={onReview}>
        See what changed since approval
      </button>
    </div>
  );
};

/**
 * One place to create, branch, rename, approve / lock, flag and delete
 * scenarios, with the counts that tell you what each one actually contains.
 */
const ScenariosPage = () => {
  const { scenarios, activeScenario, actions, lastUpdated, error } = useForecast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [formModal, setFormModal] = useState({ open: false, scenario: null });
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchSource, setBranchSource] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [approveTarget, setApproveTarget] = useState(null);
  const [unlockTarget, setUnlockTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);

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

  const handleApprove = async (values) => {
    const result = await approveScenario(approveTarget.id, values);
    await actions.fetchScenarios();
    toast.success(`Approved and locked "${result?.name || approveTarget.name}". Snapshot and workbook saved.`, { duration: 4000 });
  };

  const handleUnlock = async (values) => {
    await unlockScenario(unlockTarget.id, values);
    await actions.fetchScenarios();
    toast.success(`Unlocked "${unlockTarget.name}": it is an editable draft again`);
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

  const reviewSince = (scenario) => {
    const since = scenario?.drift?.approved_at || scenario?.approved_at;
    navigate(since ? `/history?since=${encodeURIComponent(since)}` : '/history');
  };

  const headerActions = [
    { label: 'New scenario', onClick: () => setFormModal({ open: true, scenario: null }), className: 'bg-orange-600 hover:bg-orange-700 text-white' },
  ];
  if (activeScenario) {
    headerActions.push({ label: 'Branch active scenario', variant: 'outline', onClick: () => openBranch(null) });
  }
  headerActions.push({ label: 'Change history', variant: 'ghost', onClick: () => navigate('/history') });

  // Rows that belong only to this scenario; zero counts are left out.
  const ownData = (s) => [
    [s.expense_count, 'expense'],
    [s.employee_count, 'employee'],
    [s.capex_count, 'capex item'],
    [s.price_count, 'price rule'],
    [s.deduction_rule_count, 'deduction rule'],
  ].filter(([n]) => Number(n) > 0).map(([n, word]) => plural(Number(n), word));

  const renderActions = (s, { stacked = false } = {}) => {
    const isActive = s.id === activeScenario;
    const busy = busyId === s.id;
    const locked = isLocked(s);
    const size = 'h-8 px-2.5';
    return (
      <div className={`flex flex-wrap gap-1 ${stacked ? '' : 'justify-end'}`}>
        {isActive ? (
          <Button size="sm" variant="outline" className={size} onClick={() => navigate('/sales-forecast')}>Open forecast</Button>
        ) : (
          <Button size="sm" variant="outline" className={size} onClick={() => actions.switchScenario(s.id)}>Make active</Button>
        )}
        <Button size="sm" variant="ghost" className={size} onClick={() => openBranch(s)}>Branch</Button>
        {locked ? (
          <Button size="sm" variant="ghost" className={size} disabled={busy} onClick={() => setUnlockTarget(s)}>Unlock…</Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" className={size} onClick={() => setFormModal({ open: true, scenario: s })}>Edit</Button>
            <Button
              size="sm"
              variant="ghost"
              className={`${size} text-emerald-800 hover:text-emerald-900`}
              disabled={busy || !s.start_period}
              title={s.start_period ? 'Freeze this scenario as an approved baseline' : 'Add sales to this scenario before approving it'}
              onClick={() => setApproveTarget(s)}
            >
              Approve &amp; lock
            </Button>
          </>
        )}
        {(locked || s.approved_at) && (
          <Button size="sm" variant="ghost" className={size} onClick={() => setHistoryTarget(s)}>Approvals</Button>
        )}
        {!s.is_base && (
          <Button size="sm" variant="ghost" className={size} disabled={busy} onClick={() => handleSetBase(s)}>Set as base</Button>
        )}
        {!locked && (
          <Button size="sm" variant="ghost" className={`${size} text-red-600 hover:text-red-700`} disabled={busy} onClick={() => handleDelete(s)}>
            Delete
          </Button>
        )}
      </div>
    );
  };

  const renderBadges = (s) => (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <StatusBadge scenario={s} />
      {s.is_base && <Badge variant="secondary">Base</Badge>}
      {s.id === activeScenario && <Badge className="bg-orange-600 text-white hover:bg-orange-600">Active</Badge>}
    </div>
  );

  const renderApprovalLine = (s) => (isLocked(s) && approvalLine(s) ? (
    <div className="mt-1 text-xs text-emerald-800" title={s.approval_note || undefined}>
      {approvalLine(s)}{s.approval_note ? ` · ${s.approval_note}` : ''}
    </div>
  ) : null);

  const renderAssumptions = (s) => (s.has_assumptions
    ? <Badge variant="success" title="Financial assumptions saved for this scenario">Assumptions set</Badge>
    : <Badge variant="outline" title="Reports use engine defaults until assumptions are saved">Default assumptions</Badge>);

  return (
    <div className="container mx-auto px-4 py-8 sm:px-6">
      <PageHeader
        title="Scenarios"
        description="Each scenario is a self-contained forecast. Branch one to test a change, approve and lock the one you budget against, and compare them under Reporting."
        actions={headerActions}
      />

      {list.length === 0 && !lastUpdated && !error ? (
        <Card className="space-y-3 p-6" data-testid="scenarios-loading" aria-busy="true">
          {[0, 1].map((n) => (
            <div key={n} className="flex animate-pulse items-center gap-4">
              <span className="h-5 w-1/4 rounded bg-gray-200" />
              <span className="h-5 w-1/6 rounded bg-gray-200" />
              <span className="ml-auto h-8 w-1/4 rounded bg-gray-100" />
            </div>
          ))}
          <p className="text-sm text-gray-500">Loading scenarios…</p>
        </Card>
      ) : list.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-xl font-medium text-gray-700 mb-2">No scenarios yet</h3>
          <p className="text-gray-500 mb-6">Create your first scenario. It becomes the base scenario automatically, and the sales forecast, payroll and expense screens will scope to it.</p>
          <Button onClick={() => setFormModal({ open: true, scenario: null })} className="bg-orange-600 hover:bg-orange-700 text-white">
            Create a scenario
          </Button>
        </Card>
      ) : (
        <>
          {/* Phones and narrow windows: one card per scenario, no sideways scrolling. */}
          <div className="space-y-3 md:hidden" data-testid="scenario-cards">
            {list.map((s) => {
              const own = ownData(s);
              return (
                <Card key={s.id} className={s.id === activeScenario ? 'border-orange-300 bg-orange-50/40' : ''}>
                  <CardContent className="space-y-3 p-4">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 break-words font-semibold text-gray-900">{s.name}</span>
                        <span className="flex-shrink-0 font-mono text-xs text-gray-500">{s.id}</span>
                      </div>
                      {renderBadges(s)}
                      {renderApprovalLine(s)}
                      {s.description && <div className="mt-1 break-words text-sm text-gray-600">{s.description}</div>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="text-gray-500">Sales window</dt>
                      <dd className="text-right text-gray-800">
                        {s.start_period ? `${formatPeriod(s.start_period)} – ${formatPeriod(s.end_period)}` : 'No sales yet'}
                      </dd>
                      <dt className="text-gray-500">Revenue</dt>
                      <dd className="text-right tabular-nums text-gray-800">{money(s.revenue_total)}</dd>
                      <dt className="text-gray-500">Own data</dt>
                      <dd className="text-right text-xs text-gray-700">{own.length ? own.join(', ') : 'Company-wide only'}</dd>
                    </dl>
                    <div>{renderAssumptions(s)}</div>
                    <DriftWarning scenario={s} onReview={() => reviewSince(s)} />
                    {renderActions(s, { stacked: true })}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="hidden md:block">
            <CardContent className="p-0">
              <table className="w-full table-fixed text-sm" data-testid="scenario-table">
                <colgroup>
                  <col className="w-[29%]" />
                  <col className="w-[17%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[26%]" />
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
                {list.map((s) => {
                  const isActive = s.id === activeScenario;
                  const own = ownData(s);
                  const drift = driftItems(s).length > 0;
                  return (
                    <tbody key={s.id} className={`border-t border-gray-100 ${isActive ? 'bg-orange-50/60' : 'hover:bg-gray-50'}`}>
                      <tr>
                        <td className="px-4 py-3 align-top">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-semibold text-gray-900" title={s.name}>{s.name}</span>
                            <span className="flex-shrink-0 font-mono text-xs text-gray-500">{s.id}</span>
                          </div>
                          {renderBadges(s)}
                          {renderApprovalLine(s)}
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
                            ? own.map((text) => <div key={text}>{text}</div>)
                            : <div className="text-gray-400" title="Everything except the sales lines comes from company-wide rows">Company-wide only</div>}
                          <div className="mt-1">{renderAssumptions(s)}</div>
                        </td>
                        <td className="px-4 py-3 align-top">{renderActions(s)}</td>
                      </tr>
                      {drift && (
                        <tr>
                          <td colSpan={5} className="px-4 pb-3 pt-0">
                            <DriftWarning scenario={s} onReview={() => reviewSince(s)} />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">How scoping and approval work</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-gray-700 md:grid-cols-2 xl:grid-cols-4">
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
          <div>
            <StatusBadge scenario={{ locked: true }} />
            <p className="mt-2">
              Approving saves a snapshot and the Excel workbook and locks the scenario&apos;s own rows. Branch it to work on a new
              version, or unlock it with a reason. Changes to company-wide data still move its numbers; this page shows by how much.
            </p>
          </div>
        </CardContent>
      </Card>

      <ScenarioFormModal
        open={formModal.open}
        scenario={formModal.scenario}
        onClose={() => setFormModal({ open: false, scenario: null })}
        onSubmit={formModal.scenario ? handleEdit : handleCreate}
      />

      <ApproveScenarioModal
        open={Boolean(approveTarget)}
        scenario={approveTarget}
        onClose={() => setApproveTarget(null)}
        onSubmit={handleApprove}
      />

      <UnlockScenarioModal
        open={Boolean(unlockTarget)}
        scenario={unlockTarget}
        onClose={() => setUnlockTarget(null)}
        onSubmit={handleUnlock}
        onBranchInstead={() => openBranch(unlockTarget)}
      />

      <ApprovalHistoryModal
        open={Boolean(historyTarget)}
        scenario={historyTarget}
        onClose={() => setHistoryTarget(null)}
        loadApprovals={fetchApprovals}
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
