/** @format */

(() => {
  let socket = null;
  let currentConversationId = localStorage.getItem('supportConversationId') || null;
  let localClientMessageCounter = 0;

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

  const buildMessageMeta = (role, createdAt) => {
    if (role === 'agent') return `${t('support_chat.agent_label', 'Agent')} - ${formatTime(createdAt)}`;
    if (role === 'client') return `${t('support_chat.you_label', 'Vous')} - ${formatTime(createdAt)}`;
    return formatTime(createdAt);
  };

  const createClientMessageId = () => {
    localClientMessageCounter += 1;
    return `cmsg_${Date.now()}_${localClientMessageCounter}`;
  };

  const messageKey = (message) =>
    String(message?._id || message?.id || '').trim();

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

    const meta = document.createElement('span');
    meta.className = 'chat-message-meta';
    meta.textContent = buildMessageMeta(role, message?.createdAt || Date.now());

    const text = document.createElement('div');
    text.className = 'chat-message-text';
    text.textContent = String(message?.content || message?.message || '').trim();

    item.appendChild(meta);
    item.appendChild(text);

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

    const role =
      serverMessage?.senderRole === 'agent'
        ? 'agent'
        : serverMessage?.senderRole === 'client'
          ? 'client'
          : 'system';

    pendingElement.classList.remove('pending', 'agent', 'client', 'system');
    pendingElement.classList.add(role);

    const meta = pendingElement.querySelector('.chat-message-meta');
    if (meta) meta.textContent = buildMessageMeta(role, serverMessage?.createdAt);

    const text = pendingElement.querySelector('.chat-message-text');
    if (text) text.textContent = String(serverMessage?.content || serverMessage?.message || '');

    scrollMessagesToBottom();
    return true;
  };

  const readConversationIdFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      const conversationId = String(url.searchParams.get('conversationId') || '').trim();
      if (!conversationId) return;
      currentConversationId = conversationId;
      localStorage.setItem('supportConversationId', currentConversationId);
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

  const bootstrapConversation = async () => {
    const response = await window.SiteApi.request('/api/support/chat/bootstrap', {
      method: 'POST',
      auth: Boolean(window.SiteApi.getToken()),
      data: {
        conversationId: currentConversationId,
        category: 'general',
        channelPage: 'contact',
        locale: window.SiteI18n?.getLanguage?.() || 'fr',
      },
    });

    if (!response?.conversation?._id) {
      throw new Error(
        t('support_chat.conversation_unavailable', 'Conversation support indisponible.'),
      );
    }

    currentConversationId = String(response.conversation._id);
    localStorage.setItem('supportConversationId', currentConversationId);

    renderedMessageIds.clear();
    pendingByClientMessageId.clear();
    initialFocusDone = false;
    initialFocusInProgress = false;
    if (els.messages) els.messages.innerHTML = '';

    (response.messages || []).forEach((message) => {
      const role =
        message.senderRole === 'agent'
          ? 'agent'
          : message.senderRole === 'client'
            ? 'client'
            : 'system';
      appendMessage(message, role, { messageId: messageKey(message) });
    });

    scheduleInitialSupportFocus();
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
      if (currentConversationId) {
        socket.emit('support:joinConversation', {
          conversationId: currentConversationId,
          channelPage: 'contact',
          locale: window.SiteI18n?.getLanguage?.() || 'fr',
        });
      }
    });

    socket.on('disconnect', () => {
      setConnectionState(t('support_chat.status_disconnected', 'Déconnecté'));
    });

    socket.on('support:conversationReady', (payload = {}) => {
      setQueuePosition(payload.queuePosition || '-');
      if (!payload.supportOpen) {
        setSystemMessage(
          t(
            'support_chat.off_hours_waiting',
            "Le support est hors horaires, votre conversation reste en file d'attente.",
          ),
          'warning',
        );
      }

      if (Array.isArray(payload.messages)) {
        renderedMessageIds.clear();
        pendingByClientMessageId.clear();
        els.messages.innerHTML = '';
        payload.messages.forEach((message) => {
          const role =
            message.senderRole === 'agent'
              ? 'agent'
              : message.senderRole === 'client'
                ? 'client'
                : 'system';
          appendMessage(message, role, { messageId: messageKey(message) });
        });
        initialFocusDone = false;
        initialFocusInProgress = false;
        scheduleInitialSupportFocus();
      }
    });

    socket.on('support:queued', (payload = {}) => {
      setSystemMessage(
        payload.message || t('support_chat.queue_waiting', "Vous êtes en file d'attente."),
        'info',
      );
    });

    socket.on('support:assigned', () => {
      setSystemMessage(t('support_chat.assigned', 'Un agent vous a rejoint.'), 'success');
    });

    socket.on('support:statusChanged', (payload = {}) => {
      setQueuePosition(payload.queuePosition || '-');
    });

    socket.on('support:newMessage', (payload = {}) => {
      const message = payload?.message;
      if (!message) return;

      const resolvedMessageId = messageKey(message);
      if (resolvedMessageId && renderedMessageIds.has(resolvedMessageId)) return;

      const clientMessageId = String(payload.clientMessageId || '').trim();
      if (reconcilePendingMessage(message, clientMessageId)) return;

      const role =
        message.senderRole === 'agent'
          ? 'agent'
          : message.senderRole === 'client'
            ? 'client'
            : 'system';
      appendMessage(message, role, { messageId: resolvedMessageId });
    });

    socket.on('support:error', (payload = {}) => {
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

    els.input?.addEventListener('input', () => {
      if (!socket?.connected || !currentConversationId) return;
      socket.emit('support:typing', {
        conversationId: currentConversationId,
        typing: Boolean(String(els.input.value || '').trim()),
      });
    });

    els.form?.addEventListener('submit', (event) => {
      event.preventDefault();
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
        localStorage.setItem('supportConversationId', currentConversationId);
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

    if (!els.messages || !els.form || !els.input) return;

    readConversationIdFromUrl();
    setConnectionState(t('support_chat.status_connecting', 'Connexion...'));

    try {
      await bootstrapConversation();
      connectSocket();
      registerClientPush().catch(() => {});
    } catch (error) {
      window.SiteUI?.notify?.(
        error?.message ||
          t('support_chat.bootstrap_error', "Impossible d'initialiser le chat support."),
        'error',
      );
      setConnectionState(t('support_chat.status_unavailable', 'Indisponible'));
    }

    bindEvents();
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('support-chat init failed:', error);
    });
  });
})();
