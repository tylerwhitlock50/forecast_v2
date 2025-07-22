import React, { useMemo } from 'react';


const RouterSummary = ({ routers, machines, units, laborRates }) => {
  const summaryData = useMemo(() => {
    const totalRouters = routers.length;
    
    // Version breakdown
    const versionBreakdown = routers.reduce((acc, router) => {
      const version = router.version || '1.0';
      acc[version] = (acc[version] || 0) + 1;
      return acc;
    }, {});
    
    // Unit breakdown
    const unitBreakdown = routers.reduce((acc, router) => {
      const unitId = router.unit_id || 'Unknown';
      acc[unitId] = (acc[unitId] || 0) + 1;
      return acc;
    }, {});
    
    // Machine utilization
    const machineUtilization = routers.reduce((acc, router) => {
      const machineId = router.machine_id || 'Unknown';
      acc[machineId] = (acc[machineId] || 0) + (router.machine_minutes || 0);
      return acc;
    }, {});
    
    // Labor utilization
    const laborUtilization = routers.reduce((acc, router) => {
      const laborId = router.labor_type_id || 'Unknown';
      acc[laborId] = (acc[laborId] || 0) + (router.labor_minutes || 0);
      return acc;
    }, {});
    
    // Time statistics
    const totalMachineMinutes = routers.reduce((sum, r) => sum + (r.machine_minutes || 0), 0);
    const totalLaborMinutes = routers.reduce((sum, r) => sum + (r.labor_minutes || 0), 0);
    const avgMachineMinutes = totalRouters > 0 ? totalMachineMinutes / totalRouters : 0;
    const avgLaborMinutes = totalRouters > 0 ? totalLaborMinutes / totalRouters : 0;
    
    // Sequence analysis
    const maxSequence = routers.reduce((max, r) => Math.max(max, r.sequence || 0), 0);
    const avgSequence = totalRouters > 0 ? 
      routers.reduce((sum, r) => sum + (r.sequence || 0), 0) / totalRouters : 0;
    
    // Data completeness
    const withMachine = routers.filter(r => r.machine_id).length;
    const withUnit = routers.filter(r => r.unit_id).length;
    const withLaborRate = routers.filter(r => r.labor_type_id).length;
    const withMachineMinutes = routers.filter(r => r.machine_minutes && r.machine_minutes > 0).length;
    const withLaborMinutes = routers.filter(r => r.labor_minutes && r.labor_minutes > 0).length;
    
    // Complete profiles
    const completeProfiles = routers.filter(r => 
      r.router_id && r.unit_id && r.machine_id && r.sequence && 
      (r.machine_minutes > 0 || r.labor_minutes > 0)
    ).length;
    
    return {
      totalRouters,
      versionBreakdown,
      unitBreakdown,
      machineUtilization,
      laborUtilization,
      timeStats: {
        totalMachineMinutes,
        totalLaborMinutes,
        avgMachineMinutes,
        avgLaborMinutes
      },
      sequenceStats: {
        maxSequence,
        avgSequence
      },
      completeness: {
        withMachine,
        withUnit,
        withLaborRate,
        withMachineMinutes,
        withLaborMinutes
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalRouters - completeProfiles
      }
    };
  }, [routers]);

  const topVersions = Object.entries(summaryData.versionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topUnits = Object.entries(summaryData.unitBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topMachines = Object.entries(summaryData.machineUtilization)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topLaborRates = Object.entries(summaryData.laborUtilization)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatMinutes = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes.toFixed(1)}m`;
  };

  const getMachineName = (machineId) => {
    const machine = machines.find(m => m.machine_id === machineId);
    return machine ? machine.machine_name : machineId;
  };

  const getUnitName = (unitId) => {
    const unit = units.find(u => u.unit_id === unitId);
    return unit ? unit.unit_name : unitId;
  };

  const getLaborRateName = (rateId) => {
    const rate = laborRates.find(r => r.rate_id === rateId);
    return rate ? rate.rate_name : rateId;
  };

  return (
    <div className="router-summary">
      <div className="summary-header">
        <h3>Router Analytics</h3>
        <p>Overview of your routing operations and workflow</p>
      </div>

      <div className="summary-grid">
        {/* Key Metrics */}
        <div className="summary-section">
          <h4>Key Metrics</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">🔄</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalRouters}</span>
                <span className="metric-label">Total Operations</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">✅</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.dataQuality.completeProfiles}</span>
                <span className="metric-label">Complete Operations</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">🏭</div>
              <div className="metric-content">
                <span className="metric-value">{formatMinutes(summaryData.timeStats.totalMachineMinutes)}</span>
                <span className="metric-label">Total Machine Time</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">👷</div>
              <div className="metric-content">
                <span className="metric-value">{formatMinutes(summaryData.timeStats.totalLaborMinutes)}</span>
                <span className="metric-label">Total Labor Time</span>
              </div>
            </div>
          </div>
        </div>

        {/* Version Distribution */}
        <div className="summary-section">
          <h4>Version Distribution</h4>
          <div className="chart-container">
            {topVersions.map(([version, count]) => (
              <div key={version} className="chart-bar">
                <div className="bar-label">{version}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalRouters) * 100}%`,
                      backgroundColor: '#007bff'
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Unit Distribution */}
        <div className="summary-section">
          <h4>Unit Distribution</h4>
          <div className="chart-container">
            {topUnits.map(([unitId, count]) => (
              <div key={unitId} className="chart-bar">
                <div className="bar-label">{getUnitName(unitId)}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalRouters) * 100}%`,
                      backgroundColor: '#28a745'
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Machine Utilization */}
        <div className="summary-section">
          <h4>Machine Utilization (Minutes)</h4>
          <div className="chart-container">
            {topMachines.map(([machineId, minutes]) => (
              <div key={machineId} className="chart-bar">
                <div className="bar-label">{getMachineName(machineId)}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(minutes / summaryData.timeStats.totalMachineMinutes) * 100}%`,
                      backgroundColor: '#ffc107'
                    }}
                  ></div>
                  <span className="bar-value">{minutes.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Labor Utilization */}
        <div className="summary-section">
          <h4>Labor Utilization (Minutes)</h4>
          <div className="chart-container">
            {topLaborRates.map(([rateId, minutes]) => (
              <div key={rateId} className="chart-bar">
                <div className="bar-label">{getLaborRateName(rateId)}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(minutes / summaryData.timeStats.totalLaborMinutes) * 100}%`,
                      backgroundColor: '#e83e8c'
                    }}
                  ></div>
                  <span className="bar-value">{minutes.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Time Analysis */}
        <div className="summary-section">
          <h4>Time Analysis</h4>
          <div className="analysis-grid">
            <div className="analysis-item">
              <span className="analysis-label">Avg Machine Time</span>
              <span className="analysis-value">{summaryData.timeStats.avgMachineMinutes.toFixed(1)} min</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Avg Labor Time</span>
              <span className="analysis-value">{summaryData.timeStats.avgLaborMinutes.toFixed(1)} min</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Max Sequence</span>
              <span className="analysis-value">{summaryData.sequenceStats.maxSequence}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Avg Sequence</span>
              <span className="analysis-value">{summaryData.sequenceStats.avgSequence.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Data Completeness */}
        <div className="summary-section">
          <h4>Data Completeness</h4>
          <div className="quality-metrics">
            <div className="quality-item">
              <span className="quality-label">Complete Operations</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalRouters) * 100}%`,
                    backgroundColor: '#28a745'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.dataQuality.completeProfiles}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Machine</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withMachine / summaryData.totalRouters) * 100}%`,
                    backgroundColor: '#007bff'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withMachine}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Labor Rate</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withLaborRate / summaryData.totalRouters) * 100}%`,
                    backgroundColor: '#ffc107'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withLaborRate}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Time Data</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${((summaryData.completeness.withMachineMinutes + summaryData.completeness.withLaborMinutes) / (summaryData.totalRouters * 2)) * 100}%`,
                    backgroundColor: '#6f42c1'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withMachineMinutes + summaryData.completeness.withLaborMinutes}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="summary-section recommendations">
        <h4>Recommendations</h4>
        <div className="recommendations-list">
          {summaryData.dataQuality.incompleteProfiles > 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">⚠️</span>
              <span className="recommendation-text">
                {summaryData.dataQuality.incompleteProfiles} router operations have incomplete data. 
                Consider adding missing machine assignments or time estimates.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withMachineMinutes < summaryData.totalRouters * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">⏰</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withMachineMinutes / summaryData.totalRouters) * 100)}% of operations have machine time data. 
                Machine time is crucial for capacity planning.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withLaborMinutes < summaryData.totalRouters * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">👷</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withLaborMinutes / summaryData.totalRouters) * 100)}% of operations have labor time data. 
                Labor time is essential for cost calculations.
              </span>
            </div>
          )}
          
          {summaryData.sequenceStats.maxSequence > 10 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🔄</span>
              <span className="recommendation-text">
                Some routers have long sequences (max: {summaryData.sequenceStats.maxSequence}). 
                Consider breaking down complex operations for better tracking.
              </span>
            </div>
          )}
          
          {Object.keys(summaryData.versionBreakdown).length > 5 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🏷️</span>
              <span className="recommendation-text">
                Multiple router versions detected. Consider consolidating or archiving older versions.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RouterSummary;