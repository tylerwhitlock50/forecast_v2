// Jump to one step of the /import page (e.g. 'boms', 'routings') from a
// master-data screen: navigate there, then scroll the step's card
// ([data-testid="import-step-<kind>"]) into view once it has rendered.

export const importStepPath = (kind) => (kind ? `/import#${kind}` : '/import');

export const goToImportStep = (navigate, kind, { timeoutMs = 3000 } = {}) => {
  navigate(importStepPath(kind));
  if (!kind || typeof window === 'undefined' || typeof document === 'undefined') return;
  const started = Date.now();
  const tryScroll = () => {
    const el = document.querySelector(`[data-testid="import-step-${kind}"]`);
    if (el) {
      // Leave room for the sticky scenario bar above the page.
      const bar = document.querySelector('[data-testid="scenario-bar"]');
      const offset = (bar ? bar.getBoundingClientRect().height : 0) + 16;
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset), behavior: 'smooth' });
      // Same brief highlight as the sales / customer / product screens' links.
      el.classList.add('ring-2', 'ring-orange-400');
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-orange-400'), 2500);
      return;
    }
    if (Date.now() - started < timeoutMs) window.setTimeout(tryScroll, 100);
  };
  window.setTimeout(tryScroll, 50);
};
