import React from 'react';
import CrudModule from '../../Common/CrudModule';

const columns = [
  { key: 'bom_id', label: 'BOM ID', required: true },
  { key: 'version', label: 'Version' },
  { key: 'bom_line', label: 'Line', required: true },
  { key: 'material_description', label: 'Material' },
  { key: 'qty', label: 'Qty' },
  { key: 'unit', label: 'Unit' },
  { key: 'unit_price', label: 'Unit Price' },
  { key: 'material_cost', label: 'Cost' },
  { key: 'target_cost', label: 'Target' }
];

const BomManagementModule = () => (
  <CrudModule
    tableName="bom"
    title="Bill of Materials"
    idField="bom_line"
    columns={columns}
  />
);

export default BomManagementModule;
