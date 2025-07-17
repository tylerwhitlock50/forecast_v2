import React from 'react';
import MetricsHorizonSelector from '../MetricsHorizonSelector';

const MachinesTab = ({ machinesUtilization, formatCurrency, formatPercent, startDate, endDate, onStartChange, onEndChange }) => (
  <div className="machines-tab">
    <MetricsHorizonSelector
      startDate={startDate}
      endDate={endDate}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
    />
    <h3>Machine Utilization</h3>
    <div className="machines-grid">
      {machinesUtilization.map((machine, index) => (
        <div key={index} className={`machine-card ${machine.capacity_exceeded ? 'over-capacity' : ''}`}>
          <h4>{machine.machine_name}</h4>
          <div className="machine-metrics">
            <div className="metric">
              <span className="metric-label">Required Minutes</span>
              <span className="metric-value">{Math.round(machine.total_minutes_required)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Available Minutes</span>
              <span className="metric-value">{machine.available_minutes_per_month}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Utilization</span>
              <span className="metric-value">{formatPercent(machine.utilization_percent)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Total Cost</span>
              <span className="metric-value">{formatCurrency(machine.total_cost)}</span>
            </div>
          </div>
          {machine.capacity_exceeded && (
            <div className="capacity-warning">⚠️ Capacity Exceeded</div>
          )}
        </div>
      ))}
    </div>
  </div>
);

export default MachinesTab;
