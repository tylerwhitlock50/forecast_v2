import React from 'react';
import CrudModule from '../../Common/CrudModule';

const columns = [
  { key: 'rate_id', label: 'ID', required: true },
  { key: 'rate_name', label: 'Name', required: true },
  { key: 'rate_description', label: 'Description' },
  { key: 'rate_amount', label: 'Amount' },
  { key: 'rate_type', label: 'Type' }
];

const LaborRateManagementModule = () => (
  <CrudModule
    tableName="labor_rates"
    title="Labor Rates"
    idField="rate_id"
    columns={columns}
  />
);

export default LaborRateManagementModule;
