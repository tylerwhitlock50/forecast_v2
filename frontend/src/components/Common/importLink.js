// Links to one step of the Import data page (/import#<step>). That page
// checks every file on the server (dry run, header aliases, row errors)
// before saving, so the master-data and sales screens carry no CSV importers
// of their own: they link here instead.
//
// The page reads the hash on load and whenever it changes (DataImportPage:
// stepFromHash + scrollToImportStep), so a link from another screen, a
// bookmark or a URL typed by hand all land on the step.
import { IMPORT_STEPS } from '../Modules/DataImport/importSteps';

/** Step ids (customers, products, ..., sales), in the order the page shows them. */
export const IMPORT_STEP_IDS = IMPORT_STEPS.map((s) => s.kind);

// Other spellings people type or paste (#bom, #labor-rates, #pricing ...).
const STEP_ALIASES = {
  customer: 'customers',
  product: 'products',
  unit: 'products',
  units: 'products',
  machine: 'machines',
  labor: 'labor_rates',
  labor_rate: 'labor_rates',
  laborrates: 'labor_rates',
  routing: 'routings',
  router: 'routings',
  routers: 'routings',
  bom: 'boms',
  bill_of_materials: 'boms',
  bills_of_materials: 'boms',
  price: 'prices',
  pricing: 'prices',
  price_list: 'prices',
  deduction: 'deductions',
  discounts: 'deductions',
  allowances: 'deductions',
  sale: 'sales',
  sales_forecast: 'sales',
  forecast: 'sales',
};

/** '/import#sales': the step's address on the Import data page. */
export const importPath = (step) => (step ? `/import#${step}` : '/import');

/** '#labor-rates' -> 'labor_rates'; null when the hash names no step. */
export const stepFromHash = (hash) => {
  let raw = String(hash || '').replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw text */ }
  const key = raw.trim().toLowerCase().replace(/^import[-_]step[-_]/, '').replace(/[\s-]+/g, '_');
  if (!key) return null;
  if (IMPORT_STEP_IDS.includes(key)) return key;
  return STEP_ALIASES[key] || null;
};

// Long enough for the browser's smooth scroll to finish.
const SMOOTH_SCROLL_MS = 900;

/** navigate() to a step of the Import data page; the page scrolls to it and highlights it. */
export const goToImport = (navigate, step) => navigate(importPath(step));

/**
 * Scroll a step card ([data-testid="import-step-<step>"]) into view below
 * the sticky scenario bar. Waits up to `timeoutMs` for the card to render,
 * then keeps it in place for `settleMs` while the content above it changes
 * height (data still loading), unless the user scrolls, clicks or types
 * first. Returns a function that stops it.
 */
export const scrollToImportStep = (step, { timeoutMs = 3000, settleMs = 4000 } = {}) => {
  if (!step || typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let stopped = false;
  let timer = null;
  const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  const stop = () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    userEvents.forEach((name) => window.removeEventListener(name, stop, true));
  };
  userEvents.forEach((name) => window.addEventListener(name, stop, { capture: true, passive: true }));

  const targetTop = (el) => {
    const bar = document.querySelector('[data-testid="scenario-bar"]');
    const offset = (bar ? bar.getBoundingClientRect().height : 0) + 16;
    return Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - offset));
  };

  const started = Date.now();
  let foundAt = null;
  let lastTop = null;
  const tick = () => {
    if (stopped) return;
    const el = document.querySelector(`[data-testid="import-step-${step}"]`);
    if (!el) {
      if (Date.now() - started < timeoutMs) timer = window.setTimeout(tick, 100);
      else stop();
      return;
    }
    const now = Date.now();
    const top = targetTop(el);
    if (lastTop === null) {
      window.scrollTo({ top, behavior: 'smooth' });
      foundAt = now;
    } else {
      // The content above moved (data arrived), or a smooth scroll that was
      // still running when it moved ended in the wrong place: jump there.
      const maxScroll = Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight);
      const settledOff = now - foundAt > SMOOTH_SCROLL_MS && Math.abs(window.scrollY - Math.min(top, maxScroll)) > 4;
      if (Math.abs(top - lastTop) > 4 || settledOff) window.scrollTo({ top, behavior: 'auto' });
    }
    lastTop = top;
    if (now - foundAt < settleMs) timer = window.setTimeout(tick, 150);
    else stop();
  };
  timer = window.setTimeout(tick, 0);
  return stop;
};
