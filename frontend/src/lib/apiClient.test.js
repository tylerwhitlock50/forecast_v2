import { toast } from 'react-hot-toast';
import { extractErrorMessage, describeError, showErrorToast } from './apiClient';

// axios ships ESM that jest cannot load; the helpers under test do not use it.
// (jest.mock calls are hoisted above the imports.)
jest.mock('axios', () => ({
  create: () => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  }),
}));
jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const httpError = (status, data) => ({ response: { status, data }, request: {} });

describe('extractErrorMessage', () => {
  it("shows FastAPI's string detail (e.g. a 409 duplicate)", () => {
    const err = httpError(409, { detail: "A labor_rates record with rate_id='LR-MACH' already exists" });
    expect(extractErrorMessage(err)).toBe("A labor_rates record with rate_id='LR-MACH' already exists");
  });

  it('formats a 422 validation list as "field: message" and drops body/query', () => {
    const err = httpError(422, {
      detail: [
        { loc: ['body', 'amount'], msg: 'value is not a valid float', type: 'type_error.float' },
        { loc: ['query', 'start_period'], msg: 'field required', type: 'value_error.missing' },
      ],
    });
    expect(extractErrorMessage(err)).toBe('amount: value is not a valid float; start_period: field required');
  });

  it('caps a long validation list', () => {
    const detail = [1, 2, 3, 4, 5].map(i => ({ loc: ['body', `f${i}`], msg: 'bad' }));
    expect(extractErrorMessage(httpError(422, { detail }))).toBe('f1: bad; f2: bad; f3: bad (and 2 more)');
  });

  it('falls back to message / error, then to the HTTP status', () => {
    expect(extractErrorMessage(httpError(400, { status: 'error', message: 'Bad period' }))).toBe('Bad period');
    expect(extractErrorMessage(httpError(400, { error: 'Nope' }))).toBe('Nope');
    expect(extractErrorMessage(httpError(500, {}))).toBe('The server could not complete the request');
    expect(extractErrorMessage(httpError(418, null))).toBe('Request failed with status 418');
  });

  it('ignores an HTML error page body', () => {
    expect(extractErrorMessage(httpError(502, '<html><body>Bad gateway</body></html>'))).toBe('The backend is not reachable (502)');
  });

  it('reports network errors and timeouts', () => {
    expect(extractErrorMessage({ request: {} })).toBe('Network error - the backend is not reachable');
    expect(extractErrorMessage({ code: 'ECONNABORTED', request: {} })).toMatch(/timed out/);
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });
});

describe('describeError', () => {
  it('prefixes the action', () => {
    const err = httpError(409, { detail: 'Routing R1 has 2 operation(s)' });
    expect(describeError(err, 'Could not delete routing')).toBe('Could not delete routing: Routing R1 has 2 operation(s)');
  });

  it('prefers the message the interceptor attached', () => {
    expect(describeError({ userMessage: 'Already exists' }, 'Could not save')).toBe('Could not save: Already exists');
  });
});

describe('showErrorToast', () => {
  it('shows one toast per error, with the action and the backend reason', () => {
    const err = httpError(409, { detail: 'BOM X is used by product(s) A' });
    err.userMessage = extractErrorMessage(err);
    showErrorToast(err, 'Could not delete BOM');
    showErrorToast(err, 'Could not delete BOM');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Could not delete BOM: BOM X is used by product(s) A', expect.objectContaining({ id: expect.any(String) }));
    expect(err.toastShown).toBe(true);
  });
});
