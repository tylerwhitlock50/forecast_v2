import React from 'react';
import { ArrowRight } from 'lucide-react';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

/**
 * Which file column feeds which field ("Class → customer type"), the month
 * columns of a wide sales file, and the columns that are not used. Built by
 * describeColumnMapping (importSteps.js).
 */
const ColumnMapping = ({ mapping }) => {
  if (!mapping) return null;
  const { mapped = [], months = null, dropped = [], ignored = [] } = mapping;
  if (mapped.length === 0 && !months && ignored.length === 0) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" data-testid="column-mapping">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">How the columns were read</div>
      <ul className="flex flex-wrap gap-1.5">
        {mapped.map(({ column, label }) => (
          <li key={`m-${column}`} className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs">
            <span className="font-medium text-gray-900">{column}</span>
            <ArrowRight className="h-3 w-3 text-gray-400" aria-label="goes to" />
            <span className="text-gray-700">{label}</span>
          </li>
        ))}
        {months && (
          <li
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs"
            title={months.columns ? months.columns.join(', ') : undefined}
          >
            <span className="font-medium text-gray-900">
              {months.count === 1 ? months.columns?.[0] : `${months.count} month columns (${formatPeriod(months.first)} – ${formatPeriod(months.last)})`}
            </span>
            <ArrowRight className="h-3 w-3 text-gray-400" aria-label="goes to" />
            <span className="text-gray-700">quantity per month</span>
          </li>
        )}
      </ul>
      {(dropped.length > 0 || ignored.length > 0) && (
        <p className="mt-1.5 text-xs text-gray-500">
          {dropped.length > 0 && <>Row total not imported: <span className="font-medium text-gray-700">{dropped.join(', ')}</span>. </>}
          {ignored.length > 0 && <>Not used: <span className="font-medium text-gray-700">{ignored.join(', ')}</span>.</>}
        </p>
      )}
    </div>
  );
};

export default ColumnMapping;
