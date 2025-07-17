import React from 'react';
import CrudModule from '../../Common/CrudModule';

const columns = [
  { key: 'unit_id', label: 'ID', required: true },
  { key: 'unit_name', label: 'Name', required: true },
  { key: 'unit_description', label: 'Description' },
  { key: 'base_price', label: 'Base Price' },
  { key: 'unit_type', label: 'Type' },
  { key: 'bom_id', label: 'BOM ID' },
  { key: 'router_id', label: 'Router ID' }
];

const UnitManagementModule = () => (
  <CrudModule
    tableName="units"
    title="Units"
    idField="unit_id"
    columns={columns}
  />
);

export default UnitManagementModule;
