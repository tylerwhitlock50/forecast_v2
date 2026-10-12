// Development proxy for `npm start`.
//
// The UI always calls `/api/...`. In Docker, nginx strips the `/api` prefix
// before forwarding to FastAPI (see nginx.conf). This file does the same for
// the CRA dev server so local development hits the same backend routes.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { '^/api': '' },
      logLevel: 'warn',
    })
  );
};
