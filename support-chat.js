/** @format */

(() => {
  const STORAGE_KEYS = {
    conversationId: 'supportConversationId',
    needsNewSession: 'supportNeedsNewSession',
  };

  let socket = null;
  let currentConversationId = localStorage.getItem(STORAGE_KEYS.conversationId) || null;
  let activeConversationClientId = '';
  let localClientMessageCounter = 0;
  let conversationClosed = false;
  let supportOpen = false;
  let supportNeedsNewSession = localStorage.getItem(STORAGE_KEYS.needsNewSession) === '1';

  const renderedMessageIds = new Set();
  const pendingByClientMessageId = new Map();

  let initialFocusDone = false;
  let initialFocusInProgress = false;

  const els = {
    messages: null,
    form: null,
    input: null,
    connectionState: null,
    queuePosition: null,
    systemMessage: null,
    newSessionBox: null,
    newSessionMessage: null,
    newSessionBtn: null,
  };

  const clientPushState = {
    supported: false,
    permission: 'default',
    registration: null,
    subscribed: false,
  };

  const t = (key, fallback, params) =>
    window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const formatTime = (value) =>
    new Date(value || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

  const normalizeUserId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value).trim();
    if (typeof value === 'object') {
      if (value._id) return normalizeUserId(value._id);
      if (value.id) return normalizeUserId(value.id);
    }
    return String(value).trim();
  };

  const resolveSenderUserId = (message) => normalizeUserId(message?.senderUserId);

  const syncActiveConversationClient = (conversation) => {
    activeConversationClientId = normalizeUserId(conversation?.clientUserId);
  };

  const resolveMessageRole = (message, fallbackRole = 'system', options = {}) => {
    if (options.forceClient) return 'client';

    const senderRole = String(message?.senderRole || fallbackRole || '').toLowerCase();
    if (senderRole === 'agent' || senderRole === 'client' || senderRole === 'system') {
      return senderRole;
    }

    const senderUserId = resolveSenderUserId(message);
    if (
      activeConversationClientId &&
      senderUserId &&
      senderUserId === activeConversationClientId
    ) {
      return 'client';
    }
    return 'system';
  };

  const getRoleMeta = (role) => {
    if (role === 'agent') {
      return {
        label: t('support_chat.agent_label', 'Agent'),
        iconClass: 'fas fa-user-shield',
      };
    }
    if (role === 'client') {
      return {
        label: t('support_chat.you_label', 'Client'),
        iconClass: 'fas fa-user',
      };
    }
    return {
      label: t('support_chat.system_label', 'Système'),
      iconClass: 'fas fa-circle-info',
    };
  };

  const createClientMessageId = () => {
    localClientMessageCounter += 1;
    return `cmsg_${Date.now()}_${localClientMessageCounter}`;
  };

  const messageKey = (message) => String(message?._id || message?.id || '').trim();

  const setSystemMessage = (message, type = 'info') => {
    if (!els.systemMessage) return;
    els.systemMessage.textContent = String(message || '');
    els.systemMessage.dataset.type = type;
  };

  const setConnectionState = (label) => {
    if (!els.connectionState) return;
    els.connectionState.textContent = String(label || '');
  };

  const setQueuePosition = (value) => {
    if (!els.queuePosition) return;
    els.queuePosition.textContent = value ?? '-';
  };

  const setNeedsNewSession = (value) => {
    supportNeedsNewSession = Boolean(value);
    if (supportNeedsNewSession) {
      localStorage.setItem(STORAGE_KEYS.needsNewSession, '1');
    } else {
      localStorage.removeItem(STORAGE_KEYS.needsNewSession);
    }
  };

  const setComposerState = (isClosed) => {
    const closed = Boolean(isClosed);
    conversationClosed = closed;
    if (els.input) els.input.disabled = closed;
    const submitBtn = els.form?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = closed;
  };

  const clearConversationUi = () => {
    renderedMessageIds.clear();
    pendingByClientMessageId.clear();
    initialFocusDone = false;
    initialFocusInProgress = false;
    if (els.messages) els.messages.innerHTML = '';
    setQueuePosition('-');
  };

  const refreshNewSessionCta = () => {
    if (!els.newSessionBox || els.newSessionBox.classList.contains('hidden')) return;

    if (els.newSessionBtn) {
      els.newSessionBtn.disabled = !supportOpen;
    }

    if (els.newSessionMessage) {
      els.newSessionMessage.textContent = supportOpen
        ? t(
            'support_chat.new_session_prompt',
            'Souhaitez-vous lancer une nouvelle session avec le support ?',
          )
        : t(
            'support_chat.new_session_closed_hours',
            "Le support est actuellement hors horaires. Vous pourrez relancer une session pendant les heures d'ouverture.",
          );
    }
  };

  const showNewSessionPrompt = () => {
    if (!els.newSessionBox) return;
    els.newSessionBox.classList.remove('hidden');
    refreshNewSessionCta();
  };

  const hideNewSessionPrompt = () => {
    if (!els.newSessionBox) return;
    els.newSessionBox.classList.add('hidden');
  };

  const setSupportOpenState = (value) => {
    if (typeof value !== 'boolean') return;
    supportOpen = value;
    refreshNewSessionCta();
  };

  const scrollMessagesToBottom = () => {
    if (!els.messages) return;
    els.messages.scrollTop = els.messages.scrollHeight;
  };

  const scheduleInitialSupportFocus = ({ attempts = 4, delay = 70 } = {}) => {
    if (initialFocusDone || initialFocusInProgress) return;
    initialFocusInProgress = true;
    let remaining = Math.max(1, Number(attempts) || 1);

    const step = () => {
      scrollMessagesToBottom();
      remaining -= 1;
      if (remaining <= 0) {
        initialFocusDone = true;
        initialFocusInProgress = false;
        return;
      }
      window.requestAnimationFrame(() => {
        setTimeout(step, delay);
      });
    };

    step();
  };

  const appendMessage = (message, role = 'system', options = {}) => {
    if (!els.messages) return null;

    const resolvedMessageId = String(options.messageId || messageKey(message)).trim();
    const clientMessageId = String(options.clientMessageId || message?.clientMessageId || '').trim();

    if (resolvedMessageId && renderedMessageIds.has(resolvedMessageId)) {
      return null;
    }

    const item = document.createElement('div');
    item.className = `chat-message-item ${role}`;
    if (options.pending) item.classList.add('pending');

    if (resolvedMessageId) {
      item.dataset.messageId = resolvedMessageId;
      renderedMessageIds.add(resolvedMessageId);
    }
    if (clientMessageId) {
      item.dataset.clientMessageId = clientMessageId;
    }

    const text = document.createElement('div');
    text.className = 'chat-message-text';
    text.textContent = String(message?.content || message?.message || '').trim();
    const createdAt = message?.createdAt || Date.now();

    if (role === 'system') {
      const meta = document.createElement('span');
      meta.className = 'chat-message-meta';
      meta.textContent = `${getRoleMeta(role).label} - ${formatTime(createdAt)}`;
      item.appendChild(meta);
      item.appendChild(text);
    } else {
      if (role === 'agent') {
        const head = document.createElement('div');
        head.className = 'chat-message-head';

        const roleTag = document.createElement('span');
        roleTag.className = 'chat-message-role';
        const roleMeta = getRoleMeta(role);
        roleTag.innerHTML = `<i class="${roleMeta.iconClass}" aria-hidden="true"></i><span>${roleMeta.label}</span>`;

        head.appendChild(roleTag);
        item.appendChild(head);
      }
      item.appendChild(text);

      const time = document.createElement('span');
      time.className = 'chat-message-time';
      time.textContent = formatTime(createdAt);
      item.appendChild(time);
    }

    els.messages.appendChild(item);
    scrollMessagesToBottom();
    return item;
  };

  const reconcilePendingMessage = (serverMessage, clientMessageId) => {
    if (!clientMessageId || !pendingByClientMessageId.has(clientMessageId)) return false;

    const pendingElement = pendingByClientMessageId.get(clientMessageId);
    pendingByClientMessageId.delete(clientMessageId);
    if (!pendingElement || !pendingElement.isConnected) return false;

    const resolvedMessageId = messageKey(serverMessage);
    if (resolvedMessageId) {
      pendingElement.dataset.messageId = resolvedMessageId;
      renderedMessageIds.add(resolvedMessageId);
    }

    const role = resolveMessageRole(serverMessage, 'system', { forceClient: true });

    pendingElement.classList.remove('pending', 'agent', 'client', 'system');
    pendingElement.classList.add(role);

    const text = pendingElement.querySelector('.chat-message-text');
    if (text) text.textContent = String(serverMessage?.content || serverMessage?.message || '');

    if (role === 'system') {
      let meta = pendingElement.querySelector('.chat-message-meta');
      if (!meta) {
        meta = document.createElement('span');
        meta.className = 'chat-message-meta';
        pendingElement.prepend(meta);
      }
      meta.textContent = `${getRoleMeta(role).label} - ${formatTime(serverMessage?.createdAt || Date.now())}`;
      pendingElement.querySelector('.chat-message-head')?.remove();
      pendingElement.querySelector('.chat-message-time')?.remove();
    } else {
      pendingElement.querySelector('.chat-message-meta')?.remove();
      if (role === 'agent') {
        let head = pendingElement.querySelector('.chat-message-head');
        if (!head) {
          head = document.createElement('div');
          head.className = 'chat-message-head';
          pendingElement.prepend(head);
        }
        let roleTag = head.querySelector('.chat-message-role');
        if (!roleTag) {
          roleTag = document.createElement('span');
          roleTag.className = 'chat-message-role';
          head.appendChild(roleTag);
        }
        const roleMeta = getRoleMeta(role);
        roleTag.innerHTML = `<i class="${roleMeta.iconClass}" aria-hidden="true"></i><span>${roleMeta.label}</span>`;
      } else {
        pendingElement.querySelector('.chat-message-head')?.remove();
      }

      let time = pendingElement.querySelector('.chat-message-time');
      if (!time) {
        time = document.createElement('span');
        time.className = 'chat-message-time';
        pendingElement.appendChild(time);
      }
      time.textContent = formatTime(serverMessage?.createdAt || Date.now());
    }

    scrollMessagesToBottom();
    return true;
  };

  const readConversationIdFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      const conversationId = String(url.searchParams.get('conversationId') || '').trim();
      if (!conversationId) return;
      currentConversationId = conversationId;
      localStorage.setItem(STORAGE_KEYS.conversationId, currentConversationId);
      setNeedsNewSession(false);
      url.searchParams.delete('conversationId');
      window.history.replaceState({}, '', url.toString());
    } catch (_error) {
      // ignore
    }
  };

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let index = 0; index < rawData.length; index += 1) {
      outputArray[index] = rawData.charCodeAt(index);
    }
    return outputArray;
  };

  const canUseBrowserNotifications = () =>
    typeof window !== 'undefined' && 'Notification' in window;

  const ensureNotificationPermission = async () => {
    if (!canUseBrowserNotifications()) return 'unsupported';
    return Notification.permission;
  };

  const getDeviceLabel = () => {
    const ua = navigator.userAgent || '';
    if (/android|iphone|ipad|mobile/i.test(ua)) return 'Mobile';
    if (/tablet/i.test(ua)) return 'Tablette';
    return 'Desktop';
  };

  const registerClientPush = async () => {
    const token = window.SiteApi.getToken();
    if (!token) return;

    if (window.SitePushCenter?.ensureChannels) {
      try {
        const result = await window.SitePushCenter.ensureChannels(['support_reply']);
        clientPushState.permission = result?.permission || Notification.permission || 'default';
        clientPushState.supported = result?.permission !== 'unsupported';
        clientPushState.subscribed = Boolean(result?.subscribed || result?.ok);

        if (clientPushState.permission === 'denied') {
          window.SiteUI?.notify?.(
            t('support_chat.push_permission_denied', 'Notifications du navigateur refusées.'),
            'warning',
          );
        }
        return;
      } catch (error) {
        window.SiteUI?.notify?.(
          error?.payload?.message ||
            error?.message ||
            t('support_chat.push_subscribe_failed', "Impossible d'activer les notifications push."),
          'warning',
        );
        return;
      }
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      clientPushState.supported = false;
      return;
    }

    clientPushState.supported = true;
    clientPushState.permission = await ensureNotificationPermission();

    if (clientPushState.permission === 'denied') {
      window.SiteUI?.notify?.(
        t('support_chat.push_permission_denied', 'Notifications du navigateur refusées.'),
        'warning',
      );
      return;
    }

    if (clientPushState.permission !== 'granted') return;

    try {
      await navigator.serviceWorker.register('/support-client-sw.js', { scope: '/' });
      clientPushState.registration = await navigator.serviceWorker.ready;

      const keyResponse = await window.SiteApi.request('/api/support/chat/push/public-key', {
        method: 'GET',
        auth: true,
      });

      const publicKey = String(keyResponse?.publicKey || '').trim();
      if (!publicKey) {
        window.SiteUI?.notify?.(
          t('support_chat.push_unavailable', 'Notifications push indisponibles pour le moment.'),
          'warning',
        );
        return;
      }

      let subscription = await clientPushState.registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await clientPushState.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await window.SiteApi.request('/api/support/chat/push/subscribe', {
        method: 'POST',
        auth: true,
        data: {
          subscription: subscription.toJSON(),
          platform: navigator.platform || '',
          deviceLabel: getDeviceLabel(),
        },
      });

      clientPushState.subscribed = true;
    } catch (error) {
      clientPushState.subscribed = false;
      window.SiteUI?.notify?.(
        error?.payload?.message ||
          error?.message ||
          t('support_chat.push_subscribe_failed', "Impossible d'activer les notifications push."),
        'warning',
      );
    }
  };

  const unsubscribeClientPush = async () => {
    if (window.SitePushCenter?.unsubscribeChannels) {
      try {
        await window.SitePushCenter.unsubscribeChannels(['support_reply']);
        clientPushState.subscribed = false;
      } catch (_error) {
        // ignore
      }
      return;
    }

    try {
      if (!clientPushState.registration) return;
      const subscription = await clientPushState.registration.pushManager.getSubscription();
      if (!subscription) return;

      await window.SiteApi.request('/api/support/chat/push/unsubscribe', {
        method: 'POST',
        auth: true,
        data: { endpoint: subscription.endpoint },
      });

      await subscription.unsubscribe();
      clientPushState.subscribed = false;
    } catch (_error) {
      // ignore
    }
  };

  const joinCurrentConversation = () => {
    if (!socket?.connected || !currentConversationId) return;
    socket.emit('support:joinConversation', {
      conversationId: currentConversationId,
      channelPage: 'contact',
      locale: window.SiteI18n?.getLanguage?.() || 'fr',
    });
  };

  const resolveClosedMessage = (payload = {}) =>
    payload.message ||
    t(
      'support_chat.closed_by_admin',
      'Ce chat a été clôturé par l’admin.',
    );

  const handleConversationClosed = (payload = {}) => {
    if (typeof payload.supportOpen === 'boolean') {
      setSupportOpenState(payload.supportOpen);
    }

    setNeedsNewSession(true);
    currentConversationId = null;
    activeConversationClientId = '';
    localStorage.removeItem(STORAGE_KEYS.conversationId);
    clearConversationUi();
    setComposerState(true);
    showNewSessionPrompt();
    setSystemMessage(resolveClosedMessage(payload), 'warning');
  };

  const bootstrapConversation = async ({ forceNewSession = false } = {}) => {
    const response = await window.SiteApi.request('/api/support/chat/bootstrap', {
      method: 'POST',
      auth: Boolean(window.SiteApi.getToken()),
      data: {
        conversationId: forceNewSession ? null : currentConversationId,
        forceNewSession,
        category: 'general',
        channelPage: 'contact',
        locale: window.SiteI18n?.getLanguage?.() || 'fr',
      },
    });

    if (typeof response?.supportOpen === 'boolean') {
      setSupportOpenState(response.supportOpen);
    }

    if (!response?.conversation?._id) {
      throw new Error(
        t('support_chat.conversation_unavailable', 'Conversation support indisponible.'),
      );
    }

    const status = String(response?.conversation?.status || '').toLowerCase();
    currentConversationId = String(response.conversation._id);
    syncActiveConversationClient(response.conversation);

    if (status === 'closed') {
      handleConversationClosed({
        message: t(
          'support_chat.new_session_required',
          'Cette session est clôturée. Lancez une nouvelle session pour continuer.',
        ),
        supportOpen,
      });
      return response;
    }

    localStorage.setItem(STORAGE_KEYS.conversationId, currentConversationId);
    setNeedsNewSession(false);
    hideNewSessionPrompt();
    setComposerState(false);
    clearConversationUi();

    (response.messages || []).forEach((message) => {
      const role = resolveMessageRole(message);
      appendMessage(message, role, { messageId: messageKey(message) });
    });

    scheduleInitialSupportFocus();
    return response;
  };

  const startNewSession = async () => {
    if (!supportOpen) {
      showNewSessionPrompt();
      setSystemMessage(
        t(
          'support_chat.new_session_closed_hours',
          "Le support est actuellement hors horaires. Vous pourrez relancer une session pendant les heures d'ouverture.",
        ),
        'warning',
      );
      return;
    }

    if (els.newSessionBtn) els.newSessionBtn.disabled = true;
    try {
      await bootstrapConversation({ forceNewSession: true });
      joinCurrentConversation();
      setSystemMessage(
        t('support_chat.new_session_started', 'Nouvelle session support démarrée.'),
        'success',
      );
    } catch (error) {
      const status = Number(error?.status || error?.payload?.status || 0);
      const code = String(error?.payload?.code || '').trim();
      if (status === 403 && code === 'SUPPORT_CLOSED_HOURS') {
        setSupportOpenState(false);
        showNewSessionPrompt();
        setSystemMessage(
          t(
            'support_chat.new_session_closed_hours',
            "Le support est actuellement hors horaires. Vous pourrez relancer une session pendant les heures d'ouverture.",
          ),
          'warning',
        );
        return;
      }

      window.SiteUI?.notify?.(
        error?.payload?.message ||
          error?.message ||
          t(
            'support_chat.new_session_error',
            "Impossible de lancer une nouvelle session pour le moment.",
          ),
        'error',
      );
    } finally {
      refreshNewSessionCta();
    }
  };

  const connectSocket = () => {
    if (typeof window.io !== 'function') {
      setConnectionState(t('support_chat.status_unavailable', 'Indisponible'));
      setSystemMessage(
        t('support_chat.chat_unavailable', 'Le chat support est indisponible pour le moment.'),
        'warning',
      );
      return;
    }

    socket = window.io('/support', {
      auth: { token: window.SiteApi.getToken() || undefined },
    });

    socket.on('connect', () => {
      setConnectionState(t('support_chat.status_connected', 'Connecté'));
      joinCurrentConversation();
    });

    socket.on('disconnect', () => {
      setConnectionState(t('support_chat.status_disconnected', 'Déconnecté'));
    });

    socket.on('support:presence', (payload = {}) => {
      if (typeof payload.supportOpen === 'boolean') {
        setSupportOpenState(payload.supportOpen);
      }
    });

    socket.on('support:conversationReady', (payload = {}) => {
      if (typeof payload.supportOpen === 'boolean') {
        setSupportOpenState(payload.supportOpen);
      }
      syncActiveConversationClient(payload?.conversation);
      setQueuePosition(payload.queuePosition || '-');

      const status = String(payload?.conversation?.status || '').toLowerCase();
      if (status === 'closed') {
        handleConversationClosed(payload);
        return;
      }

      if (Array.isArray(payload.messages)) {
        clearConversationUi();
        payload.messages.forEach((message) => {
          const role = resolveMessageRole(message);
          appendMessage(message, role, { messageId: messageKey(message) });
        });
        scheduleInitialSupportFocus();
      }

      setNeedsNewSession(false);
      hideNewSessionPrompt();
      setComposerState(false);

      if (!supportOpen) {
        setSystemMessage(
          t(
            'support_chat.off_hours_waiting',
            "Le support est hors horaires, votre conversation reste en file d'attente.",
          ),
          'warning',
        );
      }
    });

    socket.on('support:queued', (payload = {}) => {
      setSystemMessage(
        payload.message || t('support_chat.queue_waiting', "Vous etes en file d'attente."),
        'info',
      );
    });

    socket.on('support:assigned', () => {
      setSystemMessage(t('support_chat.assigned', 'Un agent vous a rejoint.'), 'success');
    });

    socket.on('support:statusChanged', (payload = {}) => {
      if (typeof payload.supportOpen === 'boolean') {
        setSupportOpenState(payload.supportOpen);
      }
      syncActiveConversationClient(payload?.conversation);

      setQueuePosition(payload.queuePosition || '-');
      const status = String(payload?.conversation?.status || '').toLowerCase();
      if (!status) return;
      if (status === 'closed') {
        handleConversationClosed(payload);
        return;
      }

      setNeedsNewSession(false);
      hideNewSessionPrompt();
      setComposerState(false);
    });

    socket.on('support:closed', (payload = {}) => {
      handleConversationClosed(payload);
    });

    socket.on('support:newMessage', (payload = {}) => {
      const message = payload?.message;
      if (!message) return;

      const resolvedMessageId = messageKey(message);
      if (resolvedMessageId && renderedMessageIds.has(resolvedMessageId)) return;

      const clientMessageId = String(payload.clientMessageId || '').trim();
      if (reconcilePendingMessage(message, clientMessageId)) return;

      const role = resolveMessageRole(message);
      appendMessage(message, role, { messageId: resolvedMessageId });
    });

    socket.on('support:error', (payload = {}) => {
      if (payload?.code === 'CONVERSATION_CLOSED') {
        handleConversationClosed(payload);
        return;
      }
      window.SiteUI?.notify?.(
        payload.message || t('support_chat.error_generic', 'Erreur chat support.'),
        'error',
      );
    });
  };

  const bindEvents = () => {
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = 'contact.html';
    });

    els.newSessionBtn?.addEventListener('click', () => {
      startNewSession().catch((error) => {
        console.error('support-chat startNewSession failed:', error);
      });
    });

    els.input?.addEventListener('input', () => {
      if (!socket?.connected || !currentConversationId) return;
      socket.emit('support:typing', {
        conversationId: currentConversationId,
        typing: Boolean(String(els.input.value || '').trim()),
      });
    });

    els.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (conversationClosed || supportNeedsNewSession) {
        showNewSessionPrompt();
        setSystemMessage(
          t(
            'support_chat.new_session_required',
            'Cette session est clôturée. Lancez une nouvelle session pour continuer.',
          ),
          'warning',
        );
        return;
      }

      const content = String(els.input?.value || '').trim();
      if (!content || !currentConversationId) return;

      if (!socket?.connected) {
        window.SiteUI?.notify?.(
          t('support_chat.status_disconnected', 'Déconnecté. Reconnexion en cours...'),
          'warning',
        );
        return;
      }

      const clientMessageId = createClientMessageId();
      const pendingElement = appendMessage(
        { content, createdAt: new Date().toISOString(), clientMessageId },
        'client',
        { clientMessageId, pending: true },
      );
      if (pendingElement) pendingByClientMessageId.set(clientMessageId, pendingElement);

      els.input.value = '';
      socket.emit('support:sendMessage', {
        conversationId: currentConversationId,
        content,
        clientMessageId,
        senderContext: 'client',
      });
    });

    document.getElementById('logout-ok')?.addEventListener('click', () => {
      unsubscribeClientPush().catch(() => {});
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event?.data?.type !== 'support:openConversation') return;
        const conversationId = String(event.data.conversationId || '').trim();
        if (!conversationId) return;
        currentConversationId = conversationId;
        localStorage.setItem(STORAGE_KEYS.conversationId, currentConversationId);
        setNeedsNewSession(false);
        window.location.href = `support-chat.html?conversationId=${encodeURIComponent(conversationId)}`;
      });
    }
  };

  const init = async () => {
    els.messages = document.getElementById('chat-messages');
    els.form = document.getElementById('support-chat-form');
    els.input = document.getElementById('support-chat-input');
    els.connectionState = document.getElementById('support-connection-state');
    els.queuePosition = document.getElementById('queue-position');
    els.systemMessage = document.getElementById('support-system-message');
    els.newSessionBox = document.getElementById('support-new-session');
    els.newSessionMessage = document.getElementById('support-new-session-message');
    els.newSessionBtn = document.getElementById('support-new-session-btn');

    if (!els.messages || !els.form || !els.input) return;

    readConversationIdFromUrl();
    if (supportNeedsNewSession) {
      currentConversationId = null;
      localStorage.removeItem(STORAGE_KEYS.conversationId);
      clearConversationUi();
      setComposerState(true);
      showNewSessionPrompt();
      setSystemMessage(
        t(
          'support_chat.new_session_required',
          'Cette session est clôturée. Lancez une nouvelle session pour continuer.',
        ),
        'warning',
      );
    }

    bindEvents();
    setConnectionState(t('support_chat.status_connecting', 'Connexion...'));
    connectSocket();

    try {
      if (!supportNeedsNewSession) {
        await bootstrapConversation();
        joinCurrentConversation();
      }
      registerClientPush().catch(() => {});
    } catch (error) {
      const status = Number(error?.status || error?.payload?.status || 0);
      const code = String(error?.payload?.code || '').trim();
      if (status === 403 && code === 'SUPPORT_CLOSED_HOURS') {
        setSupportOpenState(false);
        setNeedsNewSession(true);
        currentConversationId = null;
        localStorage.removeItem(STORAGE_KEYS.conversationId);
        clearConversationUi();
        setComposerState(true);
        showNewSessionPrompt();
        setSystemMessage(
          t(
            'support_chat.new_session_closed_hours',
            "Le support est actuellement hors horaires. Vous pourrez relancer une session pendant les heures d'ouverture.",
          ),
          'warning',
        );
        return;
      }

      window.SiteUI?.notify?.(
        error?.payload?.message ||
          error?.message ||
          t('support_chat.bootstrap_error', "Impossible d'initialiser le chat support."),
        'error',
      );
      setConnectionState(t('support_chat.status_unavailable', 'Indisponible'));
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('support-chat init failed:', error);
    });
  });
})();
