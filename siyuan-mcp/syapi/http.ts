/**
 * HTTP utilities for SiYuan kernel communication
 */

// ============================================================================
// Kernel connection state
// ============================================================================

let baseUrl: string = '';
let authToken: string | undefined;
let cfServiceClientId: string | undefined;
let cfServiceClientSecret: string | undefined;

/**
 * Initialize kernel connection
 * @param url - Kernel base URL
 * @param token - SiYuan API token
 * @param serviceClientId - CF Access Service Token client ID
 * @param serviceClientSecret - CF Access Service Token client secret
 */
export function initKernel(
  url: string,
  token?: string,
  serviceClientId?: string,
  serviceClientSecret?: string
): void {
  baseUrl = url.replace(/\/$/, '');
  authToken = token;
  cfServiceClientId = serviceClientId;
  cfServiceClientSecret = serviceClientSecret;
}

/** Get the current kernel base URL */
export function getBaseUrl(): string {
  return baseUrl;
}

// ============================================================================
// HTTP request utilities
// ============================================================================

/**
 * Build auth headers for SiYuan kernel requests.
 */
export function buildKernelHeaders(
  token?: string,
  serviceClientId?: string,
  serviceClientSecret?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }
  if (serviceClientId && serviceClientSecret) {
    headers['CF-Access-Client-Id'] = serviceClientId;
    headers['CF-Access-Client-Secret'] = serviceClientSecret;
  }
  return headers;
}

/**
 * Fetch from SiYuan kernel with authentication.
 */
export async function kernelFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!baseUrl && !url.startsWith('http')) {
    throw new Error('Kernel not initialized. Call initKernel first.');
  }
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const headers = buildKernelHeaders(authToken, cfServiceClientId, cfServiceClientSecret);

  // Don't set Content-Type for FormData - let the runtime set it with boundary
  if (init?.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  return fetch(fullUrl, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
  });
}

/**
 * Send POST request to SiYuan kernel API
 * @param data Request body
 * @param url API endpoint (e.g., /api/query/sql)
 */
export async function postRequest(data: any, url: string): Promise<any> {
  const response = await kernelFetch(url, {
    body: JSON.stringify(data),
    method: 'POST',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }
  const text = await response.text();
  if (!text) {
    // Empty response body - return success indicator
    return { code: 0 };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Kernel ${url} returned invalid JSON: ${text.slice(0, 100)}`);
  }
}

// ============================================================================
// Response utilities
// ============================================================================

/**
 * Extract data from a successful API response.
 * @returns response.data if code === 0, otherwise null
 */
export async function getResponseData(promiseResponse: Promise<any>): Promise<any> {
  const response = await promiseResponse;
  if (response.code !== 0 || response.data == null) {
    return null;
  }
  return response.data;
}
