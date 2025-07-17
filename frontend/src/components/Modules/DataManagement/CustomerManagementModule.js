import React from 'react';
import CrudModule from '../../Common/CrudModule';

const columns = [
  { key: 'customer_id', label: 'ID', required: true },
  { key: 'customer_name', label: 'Name', required: true },
  { key: 'customer_type', label: 'Type' },
  { key: 'region', label: 'Region' }
];

const CustomerManagementModule = () => (
  <CrudModule
    tableName="customers"
    title="Customers"
    idField="customer_id"
    columns={columns}
  />
);

export default CustomerManagementModule;
