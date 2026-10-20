// =============================================================================
// src/services/safepayAdapter.js
// MilJor Part 4E.3: Safepay Sandbox Integration Adapter
// Strictly communicates over HTTPS with Safepay Sandbox (sandbox.api.getsafepay.com).
// Never logs raw secrets, handles timeouts, and performs cryptographic HMAC verification.
// =============================================================================

const https = require('https');
const crypto = require('crypto');
const dns = require('dns');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

class SafepayAdapter {
  constructor() {
    this.env = process.env.SAFEPAY_ENV || 'sandbox';
    this.publicKey = process.env.SAFEPAY_PUBLIC_KEY || '';
    this.secretKey = process.env.SAFEPAY_SECRET_KEY || '';
    this.webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET || this.secretKey;

    this.sandboxApiHost = 'sandbox.api.getsafepay.com';
    this.productionApiHost = 'api.getsafepay.com';
    this.sandboxCheckoutBase = 'https://sandbox.api.getsafepay.com/checkout/pay';
    this.productionCheckoutBase = 'https://getsafepay.com/checkout/pay';
  }

  /**
   * Validate configuration and enforce sandbox mode for Part 4E.3.
   */
  validateConfig() {
    if (this.env !== 'sandbox') {
      const err = new Error('Production Safepay mode is strictly disabled in Part 4E.3');
      err.code = 'PRODUCTION_MODE_FORBIDDEN';
      err.statusCode = 500;
      throw err;
    }
    if (!this.publicKey) {
      const err = new Error('SAFEPAY_PUBLIC_KEY is missing from environment');
      err.code = 'CONFIG_ERROR';
      err.statusCode = 500;
      throw err;
    }
    return {
      env: this.env,
      publicKey: this.publicKey,
      secretKey: this.secretKey,
      webhookSecret: this.webhookSecret
    };
  }

  /**
   * Initialize a payment tracker session with Safepay.
   * Calls POST /order/v1/init outside any database transaction.
   *
   * @param {Object} params
   * @param {number} params.amount - Major unit decimal amount (e.g. 192450.00)
   * @param {string} params.currency - ISO currency code ('PKR')
   * @param {string} params.orderCode - Order reference code for correlation
   * @param {Object} [mockClient] - Optional injected client for testing network error/timeout
   * @returns {Promise<{ trackerToken: string, rawResponse: Object }>}
   */
  async createTracker({ amount, currency = 'PKR', orderCode, mockClient = null }) {
    this.validateConfig();

    if (currency !== 'PKR') {
      const err = new Error(`Safepay integration currently only accepts PKR. Provided: ${currency}`);
      err.code = 'UNSUPPORTED_CURRENCY';
      err.statusCode = 422;
      throw err;
    }

    if (mockClient && typeof mockClient.init === 'function') {
      return mockClient.init({ amount, currency, orderCode });
    }

    const payload = JSON.stringify({
      client: this.publicKey,
      amount: Number(Number(amount).toFixed(2)),
      currency: 'PKR',
      environment: 'sandbox'
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.sandboxApiHost,
        port: 443,
        path: '/order/v1/init',
        method: 'POST',
        family: 4,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000 // 10s timeout
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Safepay tracker initialization failed with status ${res.statusCode}`);
            err.code = 'SAFEPAY_API_ERROR';
            err.statusCode = 502;
            try {
              err.details = JSON.parse(body);
            } catch (e) {
              err.details = body;
            }
            return reject(err);
          }

          try {
            const parsed = JSON.parse(body);
            if (!parsed.data || !parsed.data.token) {
              const err = new Error('Safepay response missing tracker token');
              err.code = 'INVALID_PROVIDER_RESPONSE';
              err.statusCode = 502;
              return reject(err);
            }
            resolve({
              trackerToken: parsed.data.token,
              rawResponse: parsed
            });
          } catch (e) {
            const err = new Error('Safepay returned non-JSON response');
            err.code = 'MALFORMED_PROVIDER_RESPONSE';
            err.statusCode = 502;
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const err = new Error('Safepay network request timed out');
        err.code = 'SAFEPAY_TIMEOUT';
        err.statusCode = 504;
        reject(err);
      });

      req.on('error', (e) => {
        const err = new Error(`Safepay connection error: ${e.message}`);
        err.code = 'SAFEPAY_CONNECTION_ERROR';
        err.statusCode = 502;
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Generates a short-lived Time-Based Authentication Token (passport token / tbt).
   * Calls POST /client/passport/v1/token outside transaction locks.
   *
   * @param {Object} [options]
   * @param {Object} [options.mockClient] - Injected mock client for testing
   * @returns {Promise<string>} Passport token string
   */
  async createPassportToken({ mockClient = null } = {}) {
    this.validateConfig();

    if (mockClient && typeof mockClient.createPassportToken === 'function') {
      return mockClient.createPassportToken();
    }

    if (!this.secretKey) {
      const err = new Error('SAFEPAY_SECRET_KEY is missing from environment');
      err.code = 'CONFIG_ERROR';
      err.statusCode = 500;
      throw err;
    }

    const makeCall = () => new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.sandboxApiHost,
        port: 443,
        path: '/client/passport/v1/token',
        method: 'POST',
        family: 4,
        headers: {
          'Content-Type': 'application/json',
          'X-SFPY-MERCHANT-SECRET': this.secretKey
        },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Safepay passport token creation failed with status ${res.statusCode}`);
            err.code = 'SAFEPAY_API_ERROR';
            err.statusCode = 502;
            try {
              err.details = JSON.parse(body);
            } catch (e) {
              err.details = body;
            }
            return reject(err);
          }

          try {
            const parsed = JSON.parse(body);
            if (!parsed.data) {
              const err = new Error('Safepay response missing passport token data');
              err.code = 'INVALID_PROVIDER_RESPONSE';
              err.statusCode = 502;
              return reject(err);
            }
            resolve(parsed.data);
          } catch (e) {
            const err = new Error('Safepay returned non-JSON response for passport token');
            err.code = 'MALFORMED_PROVIDER_RESPONSE';
            err.statusCode = 502;
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const err = new Error('Safepay network request timed out');
        err.code = 'SAFEPAY_TIMEOUT';
        err.statusCode = 504;
        reject(err);
      });

      req.on('error', (e) => {
        const err = new Error(`Safepay connection error: ${e.message}`);
        err.code = 'SAFEPAY_CONNECTION_ERROR';
        err.statusCode = 502;
        err.originalError = e;
        reject(err);
      });

      req.end();
    });

    try {
      return await makeCall();
    } catch (err) {
      if (err.message && err.message.includes('EAI_AGAIN')) {
        await new Promise(r => setTimeout(r, 600));
        return await makeCall();
      }
      throw err;
    }
  }

  /**
   * Fetches the authoritative status of a tracker from Safepay.
   * Calls GET /order/v1/:tracker outside any database transaction.
   *
   * @param {string} trackerToken - The track_... token
   * @param {Object} [options]
   * @param {Object} [options.mockClient] - Injected mock client for testing
   * @returns {Promise<Object>} Tracker response data from Safepay
   */
  async fetchTracker(trackerToken, { mockClient = null } = {}) {
    this.validateConfig();

    if (!trackerToken || typeof trackerToken !== 'string') {
      const err = new Error('Valid tracker token is required');
      err.code = 'INVALID_TRACKER_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    if (mockClient && typeof mockClient.fetchTracker === 'function') {
      return mockClient.fetchTracker(trackerToken);
    }

    const makeCall = () => new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.sandboxApiHost,
        port: 443,
        path: `/order/v1/${trackerToken}`,
        method: 'GET',
        family: 4,
        headers: {
          'Accept': 'application/json',
          'X-SFPY-MERCHANT-SECRET': this.secretKey
        },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Safepay tracker lookup failed with status ${res.statusCode}`);
            err.code = 'SAFEPAY_API_ERROR';
            err.statusCode = 502;
            try {
              err.details = JSON.parse(body);
            } catch (e) {
              err.details = body;
            }
            return reject(err);
          }

          try {
            const parsed = JSON.parse(body);
            if (!parsed.data) {
              const err = new Error('Safepay response missing tracker data');
              err.code = 'INVALID_PROVIDER_RESPONSE';
              err.statusCode = 502;
              return reject(err);
            }
            resolve(parsed);
          } catch (e) {
            const err = new Error('Safepay returned non-JSON response for tracker lookup');
            err.code = 'MALFORMED_PROVIDER_RESPONSE';
            err.statusCode = 502;
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const err = new Error('Safepay network request timed out');
        err.code = 'SAFEPAY_TIMEOUT';
        err.statusCode = 504;
        reject(err);
      });

      req.on('error', (e) => {
        const err = new Error(`Safepay connection error: ${e.message}`);
        err.code = 'SAFEPAY_CONNECTION_ERROR';
        err.statusCode = 502;
        err.originalError = e;
        reject(err);
      });

      req.end();
    });

    try {
      return await makeCall();
    } catch (err) {
      if (err.message && err.message.includes('EAI_AGAIN')) {
        await new Promise(r => setTimeout(r, 600));
        return await makeCall();
      }
      throw err;
    }
  }

  /**
   * Builds the authoritative hosted checkout redirect URL for Safepay.
   * Uses Safepay's official checkout route /checkout/pay.
   *
   * @param {Object} params
   * @param {string} params.trackerToken - The track_... token
   * @param {string} params.orderCode - The internal order code
   * @param {string} [params.tbtToken] - Optional Time-Based Authentication Token (passport token)
   * @param {string} [params.redirectUrl] - Approved success callback
   * @param {string} [params.cancelUrl] - Approved cancel callback
   * @param {boolean} [params.webhooks] - Enable webhooks notification flag
   * @returns {string} Fully qualified hosted checkout URL
   */
  constructCheckoutUrl({ trackerToken, orderCode, tbtToken = null, redirectUrl, cancelUrl, webhooks = true }) {
    this.validateConfig();

    const baseUrl = this.sandboxCheckoutBase;
    const params = new URLSearchParams({
      beacon: trackerToken,
      cancel_url: cancelUrl || '',
      env: 'sandbox',
      order_id: orderCode,
      redirect_url: redirectUrl || '',
      source: 'custom',
      webhooks: webhooks ? 'true' : 'false'
    });

    if (tbtToken) {
      params.set('tbt', tbtToken);
    }

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Cryptographically verifies incoming Safepay webhook signature.
   *
   * Official Safepay Webhook specification:
   * - Algorithm: HMAC-SHA512 strictly over raw untouched JSON request body bytes.
   * - Signature Header: X-SFPY-SIGNATURE (hex string, with optional 'sha512=' prefix).
   * - Security: Constant-time comparison using crypto.timingSafeEqual.
   * - No legacy SHA256 / timestamp fallbacks (strictly fails closed).
   *
   * @param {Object} params
   * @param {Buffer|string} params.rawBody - Exact untouched raw bytes of the request body
   * @param {string} params.signature - Received X-SFPY-SIGNATURE header
   * @returns {boolean} True if signature is cryptographically valid
   */
  verifyWebhookSignature({ rawBody, signature }) {
    if (!signature || !rawBody) {
      return false;
    }

    const secret = this.webhookSecret;
    if (!secret) {
      return false;
    }

    try {
      const rawBodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');

      // Normalize received signature (strip sha512= prefix if present)
      let normalizedReceived = signature.toLowerCase().trim();
      if (normalizedReceived.startsWith('sha512=')) {
        normalizedReceived = normalizedReceived.slice(7);
      }

      const receivedBuffer = Buffer.from(normalizedReceived, 'utf8');

      // Compute official Safepay HMAC-SHA512 strictly over untouched raw body bytes
      const computedSha512 = crypto
        .createHmac('sha512', secret)
        .update(rawBodyBuffer)
        .digest('hex');

      const expectedBuffer512 = Buffer.from(computedSha512.toLowerCase(), 'utf8');

      if (receivedBuffer.length !== expectedBuffer512.length) {
        return false;
      }

      return crypto.timingSafeEqual(receivedBuffer, expectedBuffer512);
    } catch (e) {
      return false;
    }
  }
}

module.exports = new SafepayAdapter();
