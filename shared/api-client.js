/** @format */

(() => {
  const TOKEN_KEYS = ['token', 'jwt_token'];
  const POST_LOGIN_REDIRECT_KEY = 'community:post-login-redirect';
  const GOOGLE_AUTH_PATH = '/api/auth/google';

  const normalizePath = (path) => {
    const value = String(path || '').trim();
    if (!value) return '/';
    if (/^https?:\/\//i.test(value)) return value;
    return value.startsWith('/') ? value : `/${value}`;
  };

  const toRelativeLocation = (url) => {
    if (!url) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const normalizeReturnTarget = (target) => {
    try {
      const current = new URL(window.location.href);
      const url = new URL(String(target || '').trim() || '/', current.origin);
      if (url.origin !== current.origin) return null;
      if (url.pathname.startsWith('/api/auth')) return null;
      url.searchParams.delete('token');
      return toRelativeLocation(url);
    } catch (_error) {
      return null;
    }
  };

  const getCurrentReturnTarget = () => normalizeReturnTarget(window.location.href);

  const stashPostLoginRedirect = (target = getCurrentReturnTarget()) => {
    const normalized = normalizeReturnTarget(target);
    if (!normalized) return null;

    try {
      window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, normalized);
      return normalized;
    } catch (_error) {
      return normalized;
    }
  };

  const readPostLoginRedirect = ({ consume = false } = {}) => {
    try {
      const stored = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
      const normalized = normalizeReturnTarget(stored);
      if (consume) {
        window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
      }
      return normalized;
    } catch (_error) {
      return null;
    }
  };

  const redirectToPostLoginTarget = () => {
    const target = readPostLoginRedirect({ consume: true });
    if (!target) return false;

    const currentTarget = getCurrentReturnTarget();
    if (currentTarget === target) return false;

    window.location.replace(target);
    return true;
  };

  const beginGoogleAuth = ({ returnTo } = {}) => {
    stashPostLoginRedirect(returnTo || getCurrentReturnTarget());
    window.location.assign(GOOGLE_AUTH_PATH);
  };

  const absorbTokenFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      const token = String(url.searchParams.get('token') || '').trim();
      if (!token) return null;
      TOKEN_KEYS.forEach((key) => localStorage.setItem(key, token));
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
      return token;
    } catch (_error) {
      return null;
    }
  };

  const getToken = () => {
    absorbTokenFromUrl();
    for (const key of TOKEN_KEYS) {
      const value = String(localStorage.getItem(key) || '').trim();
      if (value) return value;
    }
    return null;
  };

  const setToken = (token) => {
    const normalized = String(token || '').trim();
    if (!normalized) return;
    TOKEN_KEYS.forEach((key) => localStorage.setItem(key, normalized));
  };

  const clearToken = () => {
    TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
  };

  const resolveAuthToken = (auth) => {
    if (!auth) return null;
    if (typeof auth === 'object') {
      return String(auth.token || '').trim() || null;
    }
    return getToken();
  };

  const parseResponsePayload = async (response, responseType) => {
    if (responseType === 'text') return response.text();
    if (responseType === 'blob') return response.blob();

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      try {
        return await response.json();
      } catch (_error) {
        return {};
      }
    }

    if (contentType.startsWith('text/')) {
      return response.text();
    }

    const bodyText = await response.text();
    if (!bodyText) return null;
    try {
      return JSON.parse(bodyText);
    } catch (_error) {
      return bodyText;
    }
  };

  const request = async (path, options = {}) => {
    const {
      method = 'GET',
      auth = false,
      headers = {},
      data,
      body,
      timeoutMs = 20000,
      responseType,
      credentials = 'same-origin',
    } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const finalHeaders = { ...headers };
      const upperMethod = String(method || 'GET').toUpperCase();
      let payload = body !== undefined ? body : data;

      if (payload !== undefined && payload !== null && !(payload instanceof FormData)) {
        finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
        payload = JSON.stringify(payload);
      }

      const token = resolveAuthToken(auth);
      if (token) {
        finalHeaders.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(normalizePath(path), {
        method: upperMethod,
        headers: finalHeaders,
        body: upperMethod === 'GET' || upperMethod === 'HEAD' ? undefined : payload,
        signal: controller.signal,
        credentials,
      });

      const parsedPayload = await parseResponsePayload(response, responseType);
      if (!response.ok) {
        const message =
          typeof parsedPayload === 'object' && parsedPayload && parsedPayload.message
            ? String(parsedPayload.message)
            : `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.payload = parsedPayload;
        throw error;
      }

      return parsedPayload;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  window.SiteApi = Object.freeze({
    absorbTokenFromUrl,
    beginGoogleAuth,
    getToken,
    readPostLoginRedirect,
    redirectToPostLoginTarget,
    stashPostLoginRedirect,
    setToken,
    clearToken,
    request,
  });

  window.redirectToGoogleAuth = () => beginGoogleAuth();
})();
