// Links from the sales, customer and product screens to the matching step of
// the Import data page (/import). That page checks every file on the server
// (dry run, header aliases, row errors) before saving, so the screens no
// longer carry their own CSV importers.

export const IMPORT_STEP_LABELS = {
  customers: 'Customers',
  products: 'Products',
  machines: 'Machines',
  labor_rates: 'Labor rates',
  routings: 'Routings',
  boms: 'Bills of materials',
  prices: 'Prices',
  deductions: 'Discounts & allowances',
  sales: 'Sales forecast',
};

/** '/import#sales' — the step's anchor on the Import data page. */
export const importPath = (step) => (step ? `/import#${step}` : '/import');

const stepSelector = (step) => `[data-testid="import-step-${step}"], #${step}`;

/**
 * Bring a step card into view once the Import page has rendered it. The
 * page renders its cards on mount, so a few animation frames are enough;
 * gives up quietly after ~2 seconds.
 */
export const scrollToImportStep = (step, { timeoutMs = 2000 } = {}) => {
  if (!step || typeof document === 'undefined') return;
  const started = Date.now();
  const tick = () => {
    const el = document.querySelector(stepSelector(step));
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.classList.add('ring-2', 'ring-orange-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-orange-400'), 2500);
      return;
    }
    if (Date.now() - started < timeoutMs) window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
};

/** navigate() to the Import page and scroll to `step` (customers, products, sales, ...). */
export const goToImport = (navigate, step) => {
  navigate(importPath(step));
  scrollToImportStep(step);
};
