import React, { useMemo } from 'react';
import { StatsCard } from '../../ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const LaborRateValidation = ({ laborRates }) => {
  const validationResults = useMemo(() => {
    const rates = Array.isArray(laborRates) ? laborRates : [];
    const errors = [];
    const warnings = [];
    const info = [];

    rates.forEach((rate, index) => {
      if (!rate.rate_id || (typeof rate.rate_id === 'string' && !rate.rate_id.trim())) {
        errors.push({ type: 'Missing Rate ID', message: `Labor rate at row ${index + 1} is missing a rate ID`, severity: 'error', row: index + 1 });
      }
      if (!rate.rate_name || (typeof rate.rate_name === 'string' && !rate.rate_name.trim())) {
        errors.push({ type: 'Missing Rate Name', message: `Labor rate at row ${index + 1} is missing a rate name`, severity: 'error', row: index + 1 });
      }
      if (!rate.rate_type || (typeof rate.rate_type === 'string' && !rate.rate_type.trim())) {
        warnings.push({ type: 'Missing Rate Type', message: `Labor rate "${rate.rate_name}" is missing a rate type`, severity: 'warning', row: index + 1 });
      }
      if (!rate.rate_amount || isNaN(rate.rate_amount) || parseFloat(rate.rate_amount) < 0) {
        errors.push({ type: 'Invalid Rate Amount', message: `Labor rate "${rate.rate_name}" has invalid or missing rate amount`, severity: 'error', row: index + 1 });
      }
    });

    const rateIds = rates.map(rate => rate.rate_id).filter(Boolean);
    const duplicateIds = [...new Set(rateIds.filter((id, index) => rateIds.indexOf(id) !== index))];
    duplicateIds.forEach(id => {
      errors.push({ type: 'Duplicate Rate ID', message: `Rate ID "${id}" is used by multiple labor rates`, severity: 'error' });
    });

    const rateNames = rates.map(rate => rate.rate_name).filter(Boolean);
    const duplicateNames = [...new Set(rateNames.filter((name, index) => rateNames.indexOf(name) !== index))];
    duplicateNames.forEach(name => {
      warnings.push({ type: 'Duplicate Rate Name', message: `Rate name "${name}" is used by multiple labor rates`, severity: 'warning' });
    });

    const rateAmounts = rates.map(rate => parseFloat(rate.rate_amount)).filter(amount => !isNaN(amount) && amount > 0);
    const averageRate = rateAmounts.length > 0 ? rateAmounts.reduce((a, b) => a + b, 0) / rateAmounts.length : 0;
    const stdDev = rateAmounts.length > 0
      ? Math.sqrt(rateAmounts.reduce((acc, rate) => acc + Math.pow(rate - averageRate, 2), 0) / rateAmounts.length)
      : 0;

    rates.forEach((rate, index) => {
      const amount = parseFloat(rate.rate_amount);
      if (isNaN(amount) || amount <= 0) return;
      if (amount < 5) {
        warnings.push({ type: 'Low Rate Amount', message: `Labor rate "${rate.rate_name}" has unusually low rate (${amount.toFixed(2)})`, severity: 'warning', row: index + 1 });
      } else if (amount > 200) {
        warnings.push({ type: 'High Rate Amount', message: `Labor rate "${rate.rate_name}" has unusually high rate (${amount.toFixed(2)})`, severity: 'warning', row: index + 1 });
      } else if (stdDev > 0 && Math.abs(amount - averageRate) > (2 * stdDev)) {
        info.push({ type: 'Rate Outlier', message: `Labor rate "${rate.rate_name}" (${amount.toFixed(2)}) is significantly different from average (${averageRate.toFixed(2)})`, severity: 'info', row: index + 1 });
      }
    });

    const missingDescriptions = rates.filter(rate => !rate.rate_description || (typeof rate.rate_description === 'string' && !rate.rate_description.trim())).length;
    if (missingDescriptions > 0) {
      info.push({ type: 'Missing Descriptions', message: `${missingDescriptions} labor rates are missing descriptions`, severity: 'info' });
    }

    return { errors, warnings, info, totalIssues: errors.length + warnings.length + info.length };
  }, [laborRates]);

  const severityStyles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800'
  };

  const severityIcon = (severity) => {
    switch (severity) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '🔍';
    }
  };

  const IssueList = ({ title, items, severity }) => {
    if (items.length === 0) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span>{severityIcon(severity)}</span>
            {title} ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className={`rounded border p-3 ${severityStyles[severity]}`}>
              <div className="font-medium">{item.type}</div>
              <div className="text-sm opacity-90">{item.message}</div>
              {item.row && <div className="text-xs opacity-70 mt-1">Row {item.row}</div>}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Errors" value={validationResults.errors.length} subtitle="Must be fixed" variant="danger" />
        <StatsCard title="Warnings" value={validationResults.warnings.length} subtitle="Should be reviewed" variant="warning" />
        <StatsCard title="Info" value={validationResults.info.length} subtitle="For your information" variant="primary" />
        <StatsCard title="Total Issues" value={validationResults.totalIssues} subtitle="All findings" variant="default" />
      </div>

      {validationResults.totalIssues === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-semibold">No Issues Found</div>
            <div className="text-sm text-muted-foreground">All labor rate data appears to be valid and complete.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <IssueList title="Errors" items={validationResults.errors} severity="error" />
          <IssueList title="Warnings" items={validationResults.warnings} severity="warning" />
          <IssueList title="Information" items={validationResults.info} severity="info" />
        </div>
      )}
    </div>
  );
};

export default LaborRateValidation;
