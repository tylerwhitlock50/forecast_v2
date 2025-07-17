import React, { useState } from 'react';
import DataTable from '../DataTable';
import { useForecast } from '../../context/ForecastContext';

const CrudModule = ({ tableName, title, idField, columns }) => {
  const { data, actions } = useForecast();
  const records = Array.isArray(data[tableName]) ? data[tableName] : [];
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({});

  const handleAdd = () => {
    setEditing(null);
    setFormData({});
    setShowModal(true);
  };

  const handleEdit = (record) => {
    setEditing(record);
    setFormData(record);
    setShowModal(true);
  };

  const handleDelete = (record) => {
    if (window.confirm('Delete this record?')) {
      actions.deleteForecast(tableName, record[idField]);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editing) {
      const updates = { ...formData };
      delete updates[idField];
      actions.updateForecast({ table: tableName, id: editing[idField], updates });
    } else {
      actions.createRecord(tableName, formData);
    }
    setShowModal(false);
  };

  return (
    <div className="crud-module">
      <div className="crud-header">
        <h3>{title}</h3>
        <button onClick={handleAdd}>Add</button>
      </div>
      <DataTable data={records} columns={columns} onEdit={handleEdit} onDelete={handleDelete} />
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{editing ? 'Edit' : 'Add'} {title}</h3>
            <form onSubmit={handleSubmit}>
              {columns.map(col => (
                <div className="form-group" key={col.key}>
                  <label>{col.label}</label>
                  <input
                    type="text"
                    name={col.key}
                    value={formData[col.key] || ''}
                    onChange={handleChange}
                    required={col.required}
                    disabled={editing && col.key === idField}
                  />
                </div>
              ))}
              <div className="form-actions">
                <button type="submit">{editing ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrudModule;
