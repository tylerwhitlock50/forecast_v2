import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import UnitCostPreview from '../../Common/UnitCostPreview';
import { Modal, ModalClose, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  bomLineCount,
  bomVersionsFor,
  canonicalChoice,
  defaultBomVersion,
  productTypeOptions,
} from './productOptions';

const CREATE_NEW = '__create__';
const fieldClass = 'h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500';

const nextSequentialId = (items, field, prefix, width) => {
  const maxId = (items || []).reduce((max, item) => {
    const raw = String(item?.[field] || '');
    if (!raw.startsWith(prefix)) return max;
    const n = parseInt(raw.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(maxId + 1).padStart(width, '0')}`;
};

const emptyForm = {
  unit_id: '',
  unit_name: '',
  unit_description: '',
  base_price: '',
  unit_type: '',
  bom: '',
  bom_version: '',
  router: '',
};

/**
 * Add or edit a product. The BOM and routing are links to existing records;
 * "None (assign later)" leaves them empty, and a new empty BOM or routing is
 * created only when the user picks that option. Editing never changes the
 * BOM version behind the user's back: the product's version is kept and the
 * versions that exist are offered.
 */
const ProductModal = ({ isOpen, onClose, onSave, product }) => {
  const { data, actions } = useForecast();
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const bomDefinitions = useMemo(() => data.bom_definitions || [], [data.bom_definitions]);
  const bomLines = useMemo(() => data.bom || [], [data.bom]);
  const routers = useMemo(() => data.router_definitions || [], [data.router_definitions]);
  const typeOptions = useMemo(() => productTypeOptions(data.products), [data.products]);

  useEffect(() => {
    if (!isOpen) return;
    if (product) {
      const bom = product.bom ?? product.bom_id ?? '';
      setFormData({
        unit_id: product.unit_id || '',
        unit_name: product.unit_name || '',
        unit_description: product.unit_description || '',
        base_price: product.base_price ?? '',
        unit_type: product.unit_type || '',
        bom: bom || '',
        bom_version: bom ? (product.bom_version || defaultBomVersion(bom, { bomLines, bomDefinitions })) : '',
        router: product.router ?? product.router_id ?? '',
      });
    } else {
      setFormData(emptyForm);
    }
    setErrors({});
    // Reset when the modal opens or the product changes, not on every data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, product]);

  const bomIds = useMemo(() => {
    const ids = new Set();
    bomDefinitions.forEach(d => d?.bom_id && ids.add(d.bom_id));
    bomLines.forEach(l => l?.bom_id && ids.add(l.bom_id));
    if (formData.bom && formData.bom !== CREATE_NEW) ids.add(formData.bom);
    return Array.from(ids).sort();
  }, [bomDefinitions, bomLines, formData.bom]);

  const routerIds = useMemo(() => {
    const ids = new Set(routers.map(r => r?.router_id).filter(Boolean));
    if (formData.router && formData.router !== CREATE_NEW) ids.add(formData.router);
    return Array.from(ids).sort();
  }, [routers, formData.router]);

  const versions = useMemo(() => (
    formData.bom && formData.bom !== CREATE_NEW
      ? bomVersionsFor(formData.bom, { bomLines, bomDefinitions, keep: formData.bom_version })
      : []
  ), [formData.bom, formData.bom_version, bomLines, bomDefinitions]);

  const bomLabel = (id) => {
    const def = bomDefinitions.find(d => d.bom_id === id);
    return def?.bom_name ? `${id} — ${def.bom_name}` : id;
  };
  const routerLabel = (id) => {
    const r = routers.find(x => x.router_id === id);
    return r?.router_name ? `${id} — ${r.router_name}` : id;
  };

  const set = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
  };

  const chooseBom = (value) => {
    setFormData(prev => ({
      ...prev,
      bom: value,
      bom_version: value && value !== CREATE_NEW ? defaultBomVersion(value, { bomLines, bomDefinitions, current: product && (product.bom ?? product.bom_id) === value ? product.bom_version : null }) : '',
    }));
  };

  const validate = () => {
    const next = {};
    if (!formData.unit_name.trim()) next.unit_name = 'Product name is required';
    const price = String(formData.base_price).replace(/[$,\s]/g, '');
    if (price !== '' && !(Number(price) >= 0)) next.base_price = 'Enter a price of 0 or more';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const name = formData.unit_name.trim();
      let { bom, router } = formData;
      let bomVersion = formData.bom_version;

      if (bom === CREATE_NEW) {
        bom = nextSequentialId(bomDefinitions, 'bom_id', 'BOM-', 3);
        bomVersion = '1.0';
        await actions.createBOMDefinition({ bom_id: bom, bom_name: `${name} BOM`, version: '1.0' }, { silent: true });
      }
      if (router === CREATE_NEW) {
        router = nextSequentialId(routers, 'router_id', 'R', 4);
        await actions.createRouter({ router_id: router, router_name: `${name} routing`, version: '1.0' }, { silent: true });
      }

      const price = String(formData.base_price).replace(/[$,\s]/g, '');
      await onSave({
        unit_id: formData.unit_id.trim(),
        unit_name: name,
        unit_description: formData.unit_description.trim() || null,
        base_price: price === '' ? 0 : Number(price),
        unit_type: canonicalChoice(formData.unit_type, typeOptions) || null,
        bom: bom || null,
        bom_version: bom ? (bomVersion || '1.0') : null,
        router: router || null,
      });
    } catch (error) {
      setErrors(prev => ({ ...prev, form: error?.response?.data?.detail || error?.message || 'The product could not be saved.' }));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isEdit = Boolean(product);
  const lines = formData.bom && formData.bom !== CREATE_NEW && formData.bom_version
    ? bomLineCount(formData.bom, formData.bom_version, bomLines)
    : null;

  return (
    <Modal onClick={(e) => e.target === e.currentTarget && !submitting && onClose()} className="max-w-3xl">
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <ModalTitle>{isEdit ? `Edit ${product.unit_name || product.unit_id}` : 'Add product'}</ModalTitle>
          <ModalClose type="button" onClick={onClose} aria-label="Close" />
        </ModalHeader>
        <ModalContent className="space-y-6">
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pm-id">Product ID</Label>
                <Input
                  id="pm-id"
                  value={formData.unit_id}
                  onChange={(e) => set('unit_id', e.target.value)}
                  disabled={isEdit}
                  placeholder={isEdit ? '' : 'e.g. RFL-308 (left empty: PROD-###)'}
                  className={isEdit ? 'bg-gray-100' : ''}
                />
                {isEdit && <p className="text-xs text-gray-500">The ID links sales, prices and BOMs, so it cannot be changed here.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-name">Product name *</Label>
                <Input
                  id="pm-name"
                  value={formData.unit_name}
                  onChange={(e) => set('unit_name', e.target.value)}
                  placeholder="e.g. Ridgeline Hunter .308"
                  className={errors.unit_name ? 'border-red-500' : ''}
                />
                {errors.unit_name && <p className="text-xs text-red-600">{errors.unit_name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-type">Product type</Label>
                <Input
                  id="pm-type"
                  list="pm-type-options"
                  value={formData.unit_type}
                  onChange={(e) => set('unit_type', e.target.value)}
                  placeholder="Rifle, Pistol, Component…"
                  autoComplete="off"
                />
                <datalist id="pm-type-options">
                  {typeOptions.map(t => <option key={t} value={t} />)}
                </datalist>
                <p className="text-xs text-gray-500">Excise tax and discount rules can target a product type.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-price">List price</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                  <Input
                    id="pm-price"
                    inputMode="decimal"
                    value={formData.base_price}
                    onChange={(e) => set('base_price', e.target.value)}
                    placeholder="0.00"
                    className={`pl-7 ${errors.base_price ? 'border-red-500' : ''}`}
                  />
                </div>
                {errors.base_price
                  ? <p className="text-xs text-red-600">{errors.base_price}</p>
                  : <p className="text-xs text-gray-500">Used when no customer or customer-type price applies.</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-desc">Description</Label>
              <textarea
                id="pm-desc"
                rows={2}
                value={formData.unit_description}
                onChange={(e) => set('unit_description', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Optional"
              />
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Costing</h3>
              <p className="text-xs text-gray-500">Material cost comes from the BOM version, labor and machine cost from the routing.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-[2fr_1fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="pm-bom">Bill of materials</Label>
                <select id="pm-bom" className={fieldClass} value={formData.bom} onChange={(e) => chooseBom(e.target.value)}>
                  <option value="">None (assign later)</option>
                  {bomIds.map(id => <option key={id} value={id}>{bomLabel(id)}</option>)}
                  <option value={CREATE_NEW}>+ Create a new empty BOM</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-bom-version">BOM version</Label>
                <select
                  id="pm-bom-version"
                  className={fieldClass}
                  value={formData.bom_version}
                  onChange={(e) => set('bom_version', e.target.value)}
                  disabled={!formData.bom || formData.bom === CREATE_NEW}
                >
                  {!formData.bom && <option value="">—</option>}
                  {formData.bom === CREATE_NEW && <option value="">1.0</option>}
                  {versions.map(v => (
                    <option key={v} value={v}>
                      {v} ({bomLineCount(formData.bom, v, bomLines)} lines)
                    </option>
                  ))}
                </select>
                {lines === 0 && <p className="text-xs text-amber-700">This version has no lines yet: $0 material.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-router">Routing</Label>
                <select id="pm-router" className={fieldClass} value={formData.router} onChange={(e) => set('router', e.target.value)}>
                  <option value="">None (assign later)</option>
                  {routerIds.map(id => <option key={id} value={id}>{routerLabel(id)}</option>)}
                  <option value={CREATE_NEW}>+ Create a new empty routing</option>
                </select>
              </div>
            </div>
            {isEdit && product.bom_version && formData.bom === (product.bom ?? product.bom_id) && formData.bom_version !== product.bom_version && (
              <p className="text-xs text-amber-700">BOM version changes from {product.bom_version} to {formData.bom_version}; material cost will follow the new version.</p>
            )}
            <UnitCostPreview
              bomId={formData.bom && formData.bom !== CREATE_NEW ? formData.bom : null}
              bomVersion={formData.bom_version || '1.0'}
              routerId={formData.router && formData.router !== CREATE_NEW ? formData.router : null}
              className="mt-1"
            />
          </section>

          {errors.form && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{String(errors.form)}</div>}
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting} className="bg-orange-600 text-white hover:bg-orange-700">
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Add product'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default ProductModal;
