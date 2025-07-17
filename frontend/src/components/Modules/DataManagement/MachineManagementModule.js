import React from 'react';
import CrudModule from '../../Common/CrudModule';

const columns = [
  { key: 'machine_id', label: 'ID', required: true },
  { key: 'machine_name', label: 'Name', required: true },
  { key: 'machine_description', label: 'Description' },
  { key: 'machine_rate', label: 'Rate' },
  { key: 'labor_type', label: 'Labor Type' },
  { key: 'available_minutes_per_month', label: 'Avail. Min/Month' }
];

const MachineManagementModule = () => (
  <CrudModule
    tableName="machines"
    title="Machines"
    idField="machine_id"
    columns={columns}
  />
);

export default MachineManagementModule;
