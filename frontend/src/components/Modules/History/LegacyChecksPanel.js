import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { fetchLegacyChecks } from '../Scenarios/governanceApi';
import { scenarioErrorMessage } from '../Scenarios/scenarioErrors';
import { formatWhen } from '../Scenarios/governance';
import { LINK_LABELS, SEVERITY } from './historyFormat';

/**
 * Read-only checks for data an older version (or an old import) left
 * behind. Each finding says what it means and what to do; nothing is fixed
 * automatically.
 */
const LegacyChecksPanel = () => {
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      setResult(await fetchLegacyChecks());
    } catch (err) {
      setError(scenarioErrorMessage(err, 'Could not run the data checks'));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  const issues = result?.issues || [];

  return (
    <Card className="mt-6" data-testid="legacy-checks">
      <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Legacy data checks</CardTitle>
          <p className="text-sm text-gray-600">
            Data an older version of the app or an old import may have left behind. These checks only report; nothing is
            changed until you fix it yourself.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running} className="flex-none">
          {running ? 'Checking…' : 'Check again'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!error && !result && <p className="text-sm text-gray-500">Checking…</p>}
        {result && issues.length === 0 && (
          <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            No legacy data issues found{result.checked_at ? ` (checked ${formatWhen(result.checked_at)})` : ''}.
          </p>
        )}
        {issues.map((issue) => {
          const severity = SEVERITY[issue.severity] || SEVERITY.info;
          const examples = issue.examples || [];
          const more = (issue.count || 0) - examples.length;
          return (
            <div key={issue.code} className="rounded-md border border-gray-200 p-3 text-sm" data-testid={`legacy-issue-${issue.code}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${severity.tone}`}
                  title={severity.label}
                >
                  {severity.short}
                </span>
                <span className="font-semibold text-gray-900">{issue.title}</span>
                <span className="text-xs text-gray-500">({issue.count})</span>
              </div>
              <p className="mt-1 text-gray-700">{issue.detail}</p>
              <p className="mt-1 text-gray-900"><span className="font-medium">What to do:</span> {issue.action}</p>
              {examples.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
                  {examples.slice(0, 5).map((example) => <li key={example} className="break-words">{example}</li>)}
                  {(examples.length > 5 || more > 0) && (
                    <li className="list-none text-gray-500">
                      and {Math.max(examples.length - 5, 0) + Math.max(more, 0)} more
                    </li>
                  )}
                </ul>
              )}
              {issue.link && (
                <Button size="sm" variant="ghost" className="mt-1 h-8 px-2 text-orange-700" onClick={() => navigate(issue.link)}>
                  {LINK_LABELS[issue.link] || 'Open the screen'}
                </Button>
              )}
            </div>
          );
        })}
        {(result?.skipped || []).map((skip) => (
          <p key={skip.code} className="text-xs text-gray-500">Not checked: {skip.reason}</p>
        ))}
      </CardContent>
    </Card>
  );
};

export default LegacyChecksPanel;
