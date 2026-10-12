import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import { COST_WARNING_LABELS, COST_WARNING_ACTIONS } from '../utils/costWarnings';
import { TabIntro, fmt, tableWrap, tableClass, theadRow, stickyName } from './parts';

/** Per-unit cost of each product sold in the window, from its BOM and routing. */
const UnitCostsTab = ({ unitCosts = [] }) => {
  const withWarnings = unitCosts.filter(u => (u.warnings || []).length > 0).length;
  return (
    <div className="space-y-4">
      <TabIntro>
        Cost to build one unit of each product sold in this window: BOM materials plus routing labor and machine time at current rates.
        These per-unit costs × units sold make up product COGS.
      </TabIntro>
      {unitCosts.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">No products sold in this window.</p>
      ) : (
        <>
          {withWarnings > 0 && (
            <p className="text-sm text-amber-800">
              {withWarnings} product{withWarnings === 1 ? ' has' : 's have'} incomplete cost data; {withWarnings === 1 ? 'its' : 'their'} COGS may be understated.
            </p>
          )}
          <div className={tableWrap}>
            <table data-testid="unit-costs-table" className={tableClass}>
              <thead>
                <tr className={theadRow}>
                  <th scope="col" className={cn('px-3 py-2 text-left font-medium bg-gray-100 min-w-[180px]', stickyName)}>Product</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">BOM</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Routing</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Material</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Labor</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Machine</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium bg-gray-200 text-gray-800">Total / unit</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" title="Routing labor minutes per unit">Labor min</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" title="Routing machine minutes per unit">Machine min</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Data issues</th>
                </tr>
              </thead>
              <tbody>
                {unitCosts.map(u => (
                  <tr key={u.unit_id || u.unit_name} className={cn('border-t border-gray-100', (u.warnings || []).length > 0 && 'bg-amber-50/40')}>
                    <td className={cn('px-3 py-1.5 text-left whitespace-nowrap bg-white', stickyName)}>
                      <div className="font-medium text-gray-900">{u.unit_name || u.unit_id}</div>
                      {u.unit_name && u.unit_id && <div className="font-mono text-[10px] text-gray-400">{u.unit_id}</div>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">
                      {u.bom_id ? <>{u.bom_id}{u.bom_version ? <span className="text-gray-400"> v{u.bom_version}</span> : null}</> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{u.router_id || <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(u.material_per_unit, 'money2')}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(u.labor_per_unit, 'money2')}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(u.machine_per_unit, 'money2')}</td>
                    <td className="px-3 py-1.5 text-right bg-gray-50 font-semibold">{fmt(u.total_per_unit, 'money2')}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{fmt(u.labor_minutes_per_unit, 'decimal1')}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{fmt(u.machine_minutes_per_unit, 'decimal1')}</td>
                    <td className="px-3 py-1.5 text-left">
                      {(u.warnings || []).length === 0 ? (
                        <span className="text-green-700">OK</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(u.warnings)].map(code => {
                            const action = COST_WARNING_ACTIONS[code];
                            const label = COST_WARNING_LABELS[code] || code;
                            const chip = 'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900';
                            return action ? (
                              <Link key={code} to={action.path} title={action.label} className={cn(chip, 'hover:bg-amber-100')}>{label} →</Link>
                            ) : (
                              <span key={code} className={chip}>{label}</span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default UnitCostsTab;
