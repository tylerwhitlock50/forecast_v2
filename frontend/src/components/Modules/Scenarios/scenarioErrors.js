// Errors from the scenario create / rename / branch endpoints, for the forms.
// (No import of the api client here, so the forms stay testable without axios.)

/** True when the server refused the name because another scenario already has it (HTTP 409). */
export const isDuplicateNameError = (err) => err?.response?.status === 409;

/**
 * The server's own explanation: the api client's `userMessage` (FastAPI
 * detail first), else a string `detail` / `message` in the body, else the
 * fallback. Never axios' "Request failed with status code 409".
 */
export const scenarioErrorMessage = (err, fallback) => {
  if (!err) return fallback;
  if (err.userMessage) return err.userMessage;
  const data = err.response?.data;
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail.trim();
  if (typeof data?.detail?.message === 'string' && data.detail.message.trim()) return data.detail.message.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  if (err.response) return fallback;
  return err.message || fallback;
};
