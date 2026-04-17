// Pure helpers for CSVUploadModal: column mapping, expected schema,
// validation. Kept pure so they are unit-testable and the modal itself
// focuses on UI state and the file-reading lifecycle.

const EXPECTED_COLUMNS_BY_TYPE = {
  customers: {
    customer_id: ['customer_id', 'customer id', 'id'],
    customer_name: ['customer_name', 'customer name', 'name'],
    customer_type: ['customer_type', 'customer type', 'type'],
    region: ['region'],
  },
  products: {
    unit_id: ['unit_id', 'product_id', 'product id', 'id'],
    unit_name: ['unit_name', 'product_name', 'product name', 'name'],
    unit_description: ['unit_description', 'description', 'desc'],
    base_price: ['base_price', 'price', 'unit_price'],
    unit_type: ['unit_type', 'type'],
    bom_id: ['bom_id', 'bom'],
    router_id: ['router_id', 'router'],
  },
  sales_forecast: {
    customer_id: ['customer_id', 'customer id', 'customer'],
    product_id: ['product_id', 'unit_id', 'product id', 'product'],
    period: ['period', 'date', 'month'],
    quantity: ['quantity', 'qty', 'q'],
    price: ['price', 'unit_price', 'unit price'],
  },
};

const REQUIRED_FIELDS_BY_TYPE = {
  customers: ['customer_id', 'customer_name'],
  products: ['unit_id', 'unit_name'],
  sales_forecast: ['customer_id', 'product_id', 'period', 'quantity', 'price'],
};

export const getExpectedColumns = (type) => EXPECTED_COLUMNS_BY_TYPE[type] || {};

export const getRequiredFields = (type) => REQUIRED_FIELDS_BY_TYPE[type] || [];

export const mapColumns = (csvHeaders, type) => {
  const mapping = {};
  const expected = getExpectedColumns(type);

  csvHeaders.forEach((header) => {
    const normalized = header.toLowerCase().trim();
    for (const [expectedKey, expectedAliases] of Object.entries(expected)) {
      if (expectedAliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
        mapping[header] = expectedKey;
        break;
      }
    }
  });

  return mapping;
};

export const validateData = (data, mapping, type, existingData = { customers: [], products: [] }) => {
  const errors = [];
  const warnings = [];
  const missingItems = { customers: [], products: [] };
  const requiredFields = getRequiredFields(type);

  data.forEach((row, index) => {
    // +2: index is 0-based and we skip the header row.
    const rowNum = index + 2;

    // Required fields
    requiredFields.forEach((field) => {
      const mappedKey = Object.keys(mapping).find((k) => mapping[k] === field);
      const value = mappedKey ? row[mappedKey] : row[field];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors.push({ row: rowNum, field, message: `Missing required field: ${field}` });
      }
    });

    // Sales-forecast-specific: cross-reference customers and products.
    if (type === 'sales_forecast') {
      const customerId = row[mapping.customer_id] || row.customer_id;
      const productId = row[mapping.product_id] || row.product_id;

      if (customerId && !existingData.customers.find((c) => c.customer_id === customerId)) {
        if (!missingItems.customers.find((c) => c.id === customerId)) {
          missingItems.customers.push({ id: customerId, name: customerId });
        }
        warnings.push({ row: rowNum, message: `Customer ${customerId} does not exist` });
      }

      if (productId && !existingData.products.find((p) => (p.unit_id || p.id) === productId)) {
        if (!missingItems.products.find((p) => p.id === productId)) {
          missingItems.products.push({ id: productId, name: productId });
        }
        warnings.push({ row: rowNum, message: `Product ${productId} does not exist` });
      }

      const period = row[mapping.period] || row.period;
      if (period && !/^\d{4}-\d{2}/.test(period)) {
        warnings.push({ row: rowNum, message: `Invalid period format: ${period}. Expected YYYY-MM` });
      }

      const quantity = parseFloat(row[mapping.quantity] || row.quantity);
      const price = parseFloat(row[mapping.price] || row.price);

      if (Number.isNaN(quantity) || quantity < 0) {
        errors.push({
          row: rowNum,
          field: 'quantity',
          message: `Invalid quantity: ${row[mapping.quantity] || row.quantity}`,
        });
      }
      if (Number.isNaN(price) || price < 0) {
        errors.push({
          row: rowNum,
          field: 'price',
          message: `Invalid price: ${row[mapping.price] || row.price}`,
        });
      }
    }
  });

  return { errors, warnings, missingItems };
};

export const applyColumnMapping = (rows, columnMapping) =>
  rows.map((row) => {
    const transformed = {};
    Object.entries(columnMapping).forEach(([csvHeader, expectedKey]) => {
      transformed[expectedKey] = row[csvHeader];
    });
    Object.keys(row).forEach((key) => {
      if (!columnMapping[key]) transformed[key] = row[key];
    });
    return transformed;
  });
