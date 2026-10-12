import { IMPORT_STEP_IDS, goToImport, importPath, scrollToImportStep, stepFromHash } from './importLink';

describe('importLink', () => {
  it('lists every step of the Import data page', () => {
    expect(IMPORT_STEP_IDS).toEqual([
      'customers', 'products', 'machines', 'labor_rates', 'routings', 'boms', 'prices', 'deductions', 'sales',
    ]);
  });

  it('builds the step address', () => {
    expect(importPath('sales')).toBe('/import#sales');
    expect(importPath()).toBe('/import');
  });

  it('reads the step from a hash, with or without #, and common spellings', () => {
    expect(stepFromHash('#boms')).toBe('boms');
    expect(stepFromHash('labor_rates')).toBe('labor_rates');
    expect(stepFromHash('#labor-rates')).toBe('labor_rates');
    expect(stepFromHash('#Labor%20Rates')).toBe('labor_rates');
    expect(stepFromHash('#bom')).toBe('boms');
    expect(stepFromHash('#routing')).toBe('routings');
    expect(stepFromHash('#import-step-prices')).toBe('prices');
    expect(stepFromHash('#sales-forecast')).toBe('sales');
    expect(stepFromHash('')).toBeNull();
    expect(stepFromHash('#')).toBeNull();
    expect(stepFromHash('#nothing-here')).toBeNull();
    expect(stepFromHash('#%E0%A4%A')).toBeNull(); // malformed escape: ignored, no throw
  });

  it('navigates to the step address', () => {
    const navigate = jest.fn();
    goToImport(navigate, 'customers');
    expect(navigate).toHaveBeenCalledWith('/import#customers');
  });

  it('scrolls the step card below the scenario bar and can be stopped', () => {
    jest.useFakeTimers();
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const card = document.createElement('div');
    card.setAttribute('data-testid', 'import-step-boms');
    card.getBoundingClientRect = () => ({ top: 900, height: 200 });
    const bar = document.createElement('div');
    bar.setAttribute('data-testid', 'scenario-bar');
    bar.getBoundingClientRect = () => ({ top: 0, height: 48 });
    document.body.append(bar, card);
    try {
      const stop = scrollToImportStep('boms');
      jest.advanceTimersByTime(10);
      expect(scrollTo).toHaveBeenCalledWith({ top: 900 - 48 - 16, behavior: 'smooth' });
      // The page above the card grows (data loaded): it follows the card.
      card.getBoundingClientRect = () => ({ top: 1100, height: 200 });
      jest.advanceTimersByTime(200);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100 - 48 - 16, behavior: 'auto' });
      // Once stopped (or the user scrolls), it leaves the page alone.
      stop();
      card.getBoundingClientRect = () => ({ top: 1500, height: 200 });
      jest.advanceTimersByTime(1000);
      expect(scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      bar.remove();
      card.remove();
      scrollTo.mockRestore();
      jest.useRealTimers();
    }
  });

  it('stops following the card when the user scrolls', () => {
    jest.useFakeTimers();
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const card = document.createElement('div');
    card.setAttribute('data-testid', 'import-step-sales');
    card.getBoundingClientRect = () => ({ top: 700, height: 200 });
    document.body.append(card);
    try {
      scrollToImportStep('sales');
      jest.advanceTimersByTime(10);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event('wheel'));
      card.getBoundingClientRect = () => ({ top: 400, height: 200 });
      jest.advanceTimersByTime(1000);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      card.remove();
      scrollTo.mockRestore();
      jest.useRealTimers();
    }
  });
});
