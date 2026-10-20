// =============================================================================
// src/services/webhookForwardingProxy.js
// MilJor Part 4E.3.2: Dedicated Strict Reverse Proxy for Safepay Webhook Tunnel
//
// Security Invariants:
// 1. Method restriction: Accepts ONLY POST. All other HTTP methods rejected (405).
// 2. Path restriction: Accepts ONLY /api/v1/payments/webhook/safepay.
//    All other paths (auth, admin, products, orders, etc.) immediately rejected (404/403).
// 3. Raw byte preservation: Buffers exact incoming bytes and passes them untouched
//    to backend port 5000 along with all headers (specifically X-SFPY-SIGNATURE).
// 4. Isolation: Only forwards to 127.0.0.1:5000.
// =============================================================================

const http = require('http');

const FORWARD_PORT = process.env.WEBHOOK_FORWARD_PORT || 5005;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = process.env.PORT || 5000;
const ALLOWED_PATH = '/api/v1/payments/webhook/safepay';

function createWebhookProxy({
  port = FORWARD_PORT,
  backendHost = BACKEND_HOST,
  backendPort = BACKEND_PORT,
  allowedPath = ALLOWED_PATH
} = {}) {
  const server = http.createServer((clientReq, clientRes) => {
    const parsedUrl = new URL(clientReq.url, `http://${clientReq.headers.host || 'localhost'}`);

    // Invariant 1 & 2: Strict Path & Method Verification
    if (parsedUrl.pathname !== allowedPath) {
      clientRes.writeHead(404, { 'Content-Type': 'application/json' });
      return clientRes.end(JSON.stringify({
        success: false,
        error: {
          code: 'PROXY_ROUTE_FORBIDDEN',
          message: 'Access restricted: Only Safepay webhook endpoint is exposed via this secure gateway'
        }
      }));
    }

    if (clientReq.method !== 'POST') {
      clientRes.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
      return clientRes.end(JSON.stringify({
        success: false,
        error: {
          code: 'PROXY_METHOD_NOT_ALLOWED',
          message: 'Only POST requests are permitted on the webhook endpoint'
        }
      }));
    }

    // Collect raw request body chunks
    const chunks = [];
    clientReq.on('data', chunk => chunks.push(chunk));
    clientReq.on('end', () => {
      const rawBody = Buffer.concat(chunks);

      // Clone headers and preserve exact incoming values
      const forwardHeaders = { ...clientReq.headers };
      forwardHeaders['host'] = `${backendHost}:${backendPort}`;
      forwardHeaders['content-length'] = rawBody.length;

      // Add proxy tracing headers
      forwardHeaders['x-forwarded-for'] = clientReq.socket.remoteAddress;
      forwardHeaders['x-forwarded-proto'] = 'https';

      // Forward to backend
      const proxyReq = http.request({
        hostname: backendHost,
        port: backendPort,
        path: allowedPath,
        method: 'POST',
        headers: forwardHeaders
      }, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes);
      });

      proxyReq.on('error', (err) => {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({
          success: false,
          error: {
            code: 'PROXY_UPSTREAM_ERROR',
            message: `Failed to forward webhook to upstream backend: ${err.message}`
          }
        }));
      });

      if (rawBody.length > 0) {
        proxyReq.write(rawBody);
      }
      proxyReq.end();
    });

    clientReq.on('error', (err) => {
      clientRes.writeHead(400, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        success: false,
        error: { code: 'CLIENT_REQUEST_ERROR', message: err.message }
      }));
    });
  });

  return server;
}

if (require.main === module) {
  const proxyServer = createWebhookProxy({ port: FORWARD_PORT });
  proxyServer.listen(FORWARD_PORT, '127.0.0.1', () => {
    console.log(`[WebhookProxy] Secure forwarding gateway listening on http://127.0.0.1:${FORWARD_PORT}`);
    console.log(`[WebhookProxy] Forwarding strictly POST ${ALLOWED_PATH} -> http://${BACKEND_HOST}:${BACKEND_PORT}${ALLOWED_PATH}`);
  });
}

module.exports = { createWebhookProxy, FORWARD_PORT, ALLOWED_PATH };
