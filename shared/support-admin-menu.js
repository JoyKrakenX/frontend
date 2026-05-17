/** @format */

(() => {
  if (window.SiteSupportAdminMenu) return;

  const SUPPORT_ADMIN_PATH = 'support-chat-admin.html';
  const WAITING_COUNT_STORAGE_KEY = 'supportAdminWaitingCount';
  const POLL_INTERVAL_MS = 20_000;
  const PENDING_STATUSES = ['waiting', 'assigned'];

  const state = {
    initialized: false,
    authorized: false,
    waitingCount: 0,
    pollTimerId: null,
    refreshInFlight: null,
    renderQueued: false,
  };

  const t = (key, fallback, params) =>
    window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const parseWaitingCount = (value) => {
    const count = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(count) || count < 0) return 0;
    return count;
  };

  const readStoredWaitingCount = () => {
    try {
      return parseWaitingCount(localStorage.getItem(WAITING_COUNT_STORAGE_KEY));
    } catch (_error) {
      return 0;
    }
  };

  const persistWaitingCount = (count) => {
    try {
      localStorage.setItem(WAITING_COUNT_STORAGE_KEY, String(count));
    } catch (_error) {
      // ignore storage failures
    }
  };

  const getAuthToken = () => {
    const apiToken = window.SiteApi?.getToken?.();
    if (apiToken) return String(apiToken);

    try {
      return String(localStorage.getItem('token') || '');
    } catch (_error) {
      return '';
    }
  };

  const getUserDropdowns = () =>
    Array.from(document.querySelectorAll('#user-menu .user-dropdown'));

  const removeSupportAdminEntries = () => {
    document.querySelectorAll('#support-admin-link').forEach((entry) => entry.remove());
  };

  const setAuthorizedState = (authorized) => {
    state.authorized = Boolean(authorized);
    if (state.authorized) return;
    stopPolling();
    state.waitingCount = 0;
    persistWaitingCount(0);
    removeSupportAdminEntries();
  };

  const ensureAlertDot = (entry) => {
    let dot = entry.querySelector('.support-admin-alert-dot');
    if (dot) return dot;

    dot = document.createElement('span');
    dot.className = 'support-admin-alert-dot hidden';
    dot.setAttribute('aria-hidden', 'true');
    entry.appendChild(dot);
    return dot;
  };

  const updateSupportEntryState = (entry) => {
    if (!entry) return;
    const pendingCount = state.waitingCount;
    const dot = ensureAlertDot(entry);

    if (pendingCount > 0) {
      dot.classList.remove('hidden');
      entry.classList.add('has-pending');
    } else {
      dot.classList.add('hidden');
      entry.classList.remove('has-pending');
    }

    const defaultAria =
      pendingCount > 0
        ? t(
            'shared.auth.support_admin_pending_aria',
            'Support Admin, {count} messages support en attente',
            { count: pendingCount },
          )
        : t('shared.auth.support_admin', 'Support Admin');

    entry.setAttribute('aria-label', defaultAria);
    entry.setAttribute('title', defaultAria);
  };

  const createSupportEntry = (dropdown) => {
    const entry = document.createElement('a');
    entry.id = 'support-admin-link';
    entry.className = 'dropdown-item support-admin-item';
    entry.href = SUPPORT_ADMIN_PATH;
    entry.innerHTML =
      '<i class="fas fa-headset"></i><span data-i18n="shared.auth.support_admin">Support Admin</span>';

    const nav = dropdown.querySelector('.user-menu-nav');
    const billingEntry = dropdown.querySelector('#user-menu-billing');
    const createEntry = dropdown.querySelector('#user-menu-create-survey');
    if (billingEntry) {
      billingEntry.insertAdjacentElement('afterend', entry);
    } else if (createEntry) {
      createEntry.insertAdjacentElement('beforebegin', entry);
    } else if (nav) {
      nav.appendChild(entry);
    } else {
      dropdown.prepend(entry);
    }

    return entry;
  };

  const upsertSupportEntry = (dropdown) => {
    if (!dropdown) return null;

    let entry = dropdown.querySelector('#support-admin-link');
    if (!entry) {
      entry = createSupportEntry(dropdown);
    } else {
      entry.href = SUPPORT_ADMIN_PATH;
      entry.classList.add('support-admin-item');
      const label = entry.querySelector('span');
      if (!label) {
        entry.insertAdjacentHTML(
          'beforeend',
          '<span data-i18n="shared.auth.support_admin">Support Admin</span>',
        );
      } else if (!label.getAttribute('data-i18n')) {
        label.setAttribute('data-i18n', 'shared.auth.support_admin');
      }
    }

    // Managed dynamically to include pending count in aria-label.
    entry.removeAttribute('data-i18n-aria');
    ensureAlertDot(entry);
    window.SiteI18n?.applyTranslations?.(entry);
    updateSupportEntryState(entry);
    return entry;
  };

  const renderSupportEntries = () => {
    if (!state.authorized) {
      removeSupportAdminEntries();
      return;
    }

    getUserDropdowns().forEach(upsertSupportEntry);
  };

  const queueRender = () => {
    if (state.renderQueued) return;
    state.renderQueued = true;
    window.requestAnimationFrame(() => {
      state.renderQueued = false;
      renderSupportEntries();
    });
  };

  const setWaitingCount = (count, { persist = true } = {}) => {
    const safeCount = parseWaitingCount(count);
    state.waitingCount = safeCount;
    if (persist) persistWaitingCount(safeCount);
    queueRender();
    return safeCount;
  };

  const fetchCurrentUser = async () => {
    const token = getAuthToken();
    if (!token || !window.SiteApi?.request) return null;

    try {
      return await window.SiteApi.request('/api/auth/me', {
        method: 'GET',
        auth: true,
      });
    } catch (_error) {
      return null;
    }
  };

  const parseConversationTotal = (response) => {
    if (!response || typeof response !== 'object') return 0;

    const directTotal = parseWaitingCount(response.total);
    if (directTotal > 0) return directTotal;

    if (Array.isArray(response.conversations)) {
      return response.conversations.length;
    }

    return directTotal;
  };

  const fetchStatusTotal = async (status) => {
    const params = new URLSearchParams({
      status,
      limit: '1',
    });
    const response = await window.SiteApi.request(
      `/api/support/chat/conversations?${params.toString()}`,
      {
        method: 'GET',
        auth: true,
      },
    );
    return parseConversationTotal(response);
  };

  const fetchWaitingCount = async () => {
    if (!window.SiteApi?.request) return null;

    try {
      const settledTotals = await Promise.allSettled(
        PENDING_STATUSES.map((status) => fetchStatusTotal(status)),
      );

      const unauthorized = settledTotals.some(
        (result) =>
          result.status === 'rejected' &&
          [401, 403].includes(Number(result.reason?.status || result.reason?.payload?.status || 0)),
      );

      if (unauthorized) {
        setAuthorizedState(false);
        return null;
      }

      const resolvedTotals = settledTotals
        .filter((result) => result.status === 'fulfilled')
        .map((result) => parseWaitingCount(result.value));

      if (!resolvedTotals.length) return null;

      const count = resolvedTotals.reduce((sum, value) => sum + value, 0);
      setWaitingCount(count);
      return count;
    } catch (_error) {
      return null;
    }
  };

  const stopPolling = () => {
    if (!state.pollTimerId) return;
    window.clearInterval(state.pollTimerId);
    state.pollTimerId = null;
  };

  const startPolling = () => {
    if (!state.authorized || state.pollTimerId) return;
    state.pollTimerId = window.setInterval(() => {
      refreshWaitingCount().catch(() => {});
    }, POLL_INTERVAL_MS);
  };

  const resolveAdminAccess = async () => {
    const token = getAuthToken();
    if (!token) {
      setAuthorizedState(false);
      return false;
    }

    const me = await fetchCurrentUser();
    if (!me) {
      setAuthorizedState(false);
      return false;
    }

    const role = String(me.role || '').trim().toLowerCase();
    if (!['admin', 'support'].includes(role)) {
      setAuthorizedState(false);
      return false;
    }

    const count = await fetchWaitingCount();
    if (count === null) {
      if (!state.authorized) setAuthorizedState(false);
      return false;
    }

    state.authorized = true;
    startPolling();
    queueRender();
    return true;
  };

  const refreshWaitingCount = async () => {
    if (state.refreshInFlight) return state.refreshInFlight;

    state.refreshInFlight = (async () => {
      if (!state.authorized) {
        await resolveAdminAccess();
        return state.waitingCount;
      }
      await fetchWaitingCount();
      return state.waitingCount;
    })();

    try {
      return await state.refreshInFlight;
    } finally {
      state.refreshInFlight = null;
    }
  };

  const bindEvents = () => {
    document.addEventListener('site:language-changed', () => {
      document.querySelectorAll('.support-admin-item').forEach((entry) => {
        window.SiteI18n?.applyTranslations?.(entry);
        updateSupportEntryState(entry);
      });
    });

    window.addEventListener('focus', () => {
      if (!state.authorized) return;
      refreshWaitingCount().catch(() => {});
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !state.authorized) return;
      refreshWaitingCount().catch(() => {});
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== WAITING_COUNT_STORAGE_KEY) return;
      setWaitingCount(parseWaitingCount(event.newValue), { persist: false });
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event?.data?.type !== 'support:queue-pending-hint') return;
        if (state.waitingCount < 1) {
          setWaitingCount(1);
        }
        refreshWaitingCount().catch(() => {});
      });
    }

    const observer = new MutationObserver(() => {
      queueRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const init = async () => {
    if (state.initialized) return;
    state.initialized = true;

    state.waitingCount = readStoredWaitingCount();
    bindEvents();
    queueRender();
    await resolveAdminAccess();
  };

  const exposeApi = {
    init,
    refreshWaitingCount,
    setWaitingCount: (count) => setWaitingCount(count),
    getWaitingCount: () => state.waitingCount,
  };

  window.SiteSupportAdminMenu = Object.freeze(exposeApi);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => console.error('support-admin-menu init failed:', error));
    });
  } else {
    init().catch((error) => console.error('support-admin-menu init failed:', error));
  }
})();
