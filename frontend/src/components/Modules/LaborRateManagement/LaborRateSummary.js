import React, { useMemo } from 'react';
import { StatsCard } from '../../ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const LaborRateSummary = ({ laborRates }) => {
  const stats = useMemo(() => {
    const rates = Array.isArray(laborRates) ? laborRates : [];

    const totalRates = rates.length;
    const rateAmounts = rates.map(rate => parseFloat(rate.rate_amount) || 0);
    const averageRate = rateAmounts.length > 0 ? rateAmounts.reduce((a, b) => a + b, 0) / rateAmounts.length : 0;
    const minRate = rateAmounts.length > 0 ? Math.min(...rateAmounts) : 0;
    const maxRate = rateAmounts.length > 0 ? Math.max(...rateAmounts) : 0;

    const rateTypeDistribution = rates.reduce((acc, rate) => {
      const type = rate.rate_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    const rateTypeAverages = Object.keys(rateTypeDistribution).reduce((acc, type) => {
      const typeRates = rates.filter(rate => (rate.rate_type || 'General') === type);
      const typeAmounts = typeRates.map(rate => parseFloat(rate.rate_amount) || 0);
      acc[type] = typeAmounts.length > 0 ? typeAmounts.reduce((a, b) => a + b, 0) / typeAmounts.length : 0;
      return acc;
    }, {});

    const rateRanges = {
      'Low ($0-$20)': rateAmounts.filter(rate => rate >= 0 && rate <= 20).length,
      'Medium ($20-$40)': rateAmounts.filter(rate => rate > 20 && rate <= 40).length,
      'High ($40-$60)': rateAmounts.filter(rate => rate > 40 && rate <= 60).length,
      'Premium ($60+)': rateAmounts.filter(rate => rate > 60).length
    };

    return {
      totalRates,
      averageRate,
      minRate,
      maxRate,
      rateTypeDistribution,
      rateTypeAverages,
      rateRanges
    };
  }, [laborRates]);

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount || 0);

  const formatPercent = (value, total) => (total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%');

  const DistributionBar = ({ label, count, total }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-500">{count} · {formatPercent(count, total)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary"
          style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );

  if (stats.totalRates === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No labor rates yet. Add one to see summary metrics.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Rates"
          value={stats.totalRates}
          subtitle="Active labor rates"
          variant="primary"
        />
        <StatsCard
          title="Average Rate"
          value={formatCurrency(stats.averageRate)}
          subtitle="Per hour"
          variant="success"
        />
        <StatsCard
          title="Rate Range"
          value={`${formatCurrency(stats.minRate)} – ${formatCurrency(stats.maxRate)}`}
          subtitle="Min to max"
          variant="warning"
        />
        <StatsCard
          title="Rate Types"
          value={Object.keys(stats.rateTypeDistribution).length}
          subtitle="Different types"
          variant="default"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rate Type Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(stats.rateTypeDistribution).map(([type, count]) => (
              <DistributionBar key={type} label={type} count={count} total={stats.totalRates} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rate Ranges</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(stats.rateRanges).map(([range, count]) => (
              <DistributionBar key={range} label={range} count={count} total={stats.totalRates} />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Average Rate by Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 font-medium">Rate Type</th>
                  <th className="py-2 font-medium">Count</th>
                  <th className="py-2 font-medium">Average Rate</th>
                  <th className="py-2 font-medium">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.rateTypeAverages).map(([type, avgRate]) => (
                  <tr key={type} className="border-b last:border-0">
                    <td className="py-2 text-gray-800">{type}</td>
                    <td className="py-2 text-gray-700">{stats.rateTypeDistribution[type]}</td>
                    <td className="py-2 text-gray-700">{formatCurrency(avgRate)}</td>
                    <td className="py-2 w-1/3">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${(stats.rateTypeDistribution[type] / stats.totalRates) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LaborRateSummary;
