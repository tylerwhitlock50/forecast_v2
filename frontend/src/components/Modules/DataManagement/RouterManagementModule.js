import React from 'react';
import CrudModule from '../../Common/CrudModule';

const columns = [
  { key: 'router_id', label: 'ID', required: true },
  { key: 'version', label: 'Version' },
  { key: 'unit_id', label: 'Unit ID' },
  { key: 'machine_id', label: 'Machine ID' },
  { key: 'machine_minutes', label: 'Machine Min' },
  { key: 'labor_minutes', label: 'Labor Min' },
  { key: 'labor_type_id', label: 'Labor Type' },
  { key: 'sequence', label: 'Seq' }
];

const RouterManagementModule = () => (
  <CrudModule
    tableName="routers"
    title="Routers"
    idField="sequence"
    columns={columns}
  />
);

export default RouterManagementModule;
