/** @format */

(() => {
  const NOTIFICATION_DEDUP_MS = 60000;

  let socket = null;
  let currentConversationId = null;
  let conversations = [];
  let queuedReloadTimer = null;

  const recentNotifications = new Map();

  let initialFocusKey = null;
  let initialFocusDone = false;
  let initialFocusInProgress = false;
  let activeConversationClosed = false;
  let activeConversationClientId = '';
  let activeConversationAssignedAgentId = '';

  const els = {
    queueList: null,
    messages: null,
    form: null,
    input: null,
    title: null,
    claimBtn: null,
    closeBtn: null,
    pushStatus: null,
  };

  const pushState = {
    supported: false,
    permission: 'default',
    registration: null,
    subscribed: false,
  };

  const authState = {
    role: null,
    isAgent: false,
    userId: '',
  };

  const t = (key, fallback, params) =>
    window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const isAccessDeniedError = (error) => {
    const status = Number(error?.status || error?.payload?.status || 0);
    return status === 401 || status === 403;
  };

  const redirectIfDenied = (error) => {
    if (!isAccessDeniedError(error)) return false;
    const message =
      error?.payload?.message ||
      error?.message ||
      t(
        'support_chat_admin.access_denied',
        "Accès réservé à l’administrateur support autorisé.",
      );
    window.SiteUI?.notify?.(message, 'error');
    window.SiteUI?.renderPageState?.({
      mount: '.support-admin-page',
      variant: 'error',
      icon: 'fa-user-shield',
      title: 'Acces restreint',
      message,
      actions: [
        {
          label: 'Se connecter',
          icon: 'fa-right-to-bracket',
          onClick: () => window.SiteApi?.beginGoogleAuth?.(),
        },
        {
          label: 'Parcourir les sondages',
          icon: 'fa-list',
          href: 'browse-surveys.html',
          secondary: true,
        },
      ],
    });
    return true;
  };

  const toMillis = (value) => {
    const ts = Number(new Date(value).getTime());
    return Number.isFinite(ts) ? ts : 0;
  };

  const formatDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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

  const syncActiveConversationMeta = (conversation) => {
    activeConversationClientId = normalizeUserId(conversation?.clientUserId);
    activeConversationAssignedAgentId = normalizeUserId(conversation?.assignedAgentId);
  };

  const resolveAdminMessageRole = (message, options = {}) => {
    if (options.forceClient || String(options.clientMessageId || '').trim()) {
      return 'client';
    }

    const senderRole = String(message?.senderRole || '').toLowerCase();
    if (senderRole === 'agent' || senderRole === 'client' || senderRole === 'system') {
      return senderRole;
    }

    const senderUserId = normalizeUserId(message?.senderUserId);

    if (
      senderUserId &&
      activeConversationAssignedAgentId &&
      senderUserId === activeConversationAssignedAgentId
    ) {
      return 'agent';
    }

    if (senderUserId && authState.userId && senderUserId === authState.userId) {
      return 'agent';
    }

    if (senderUserId && activeConversationClientId && senderUserId === activeConversationClientId) {
      return 'client';
    }

    return 'system';
  };

  const getRoleMeta = (role) => {
    if (role === 'agent') {
      return {
        label: t('support_chat_admin.agent_role', 'Agent'),
        iconClass: 'fas fa-user-shield',
      };
    }
    if (role === 'client') {
      return {
        label: t('support_chat_admin.client_role', 'Client'),
        iconClass: 'fas fa-user',
      };
    }
    return {
      label: t('support_chat_admin.system_role', 'Système'),
      iconClass: 'fas fa-circle-info',
    };
  };

  const categoryLabel = (category) => {
    switch (String(category || '').toLowerCase()) {
      case 'technical':
      case 'bug':
        return t('support_chat_admin.category_technical', 'Technique');
      case 'privacy':
        return t('support_chat_admin.category_privacy', 'Confidentialité');
      case 'legal':
        return t('support_chat_admin.category_legal', 'Légal');
      case 'accessibility':
        return t('support_chat_admin.category_accessibility', 'Accessibilité');
      default:
        return t('support_chat_admin.category_general', 'Général');
    }
  };

  const setPushStatus = (state) => {
    if (!els.pushStatus) return;
    els.pushStatus.classList.remove('is-pending', 'is-enabled', 'is-disabled', 'is-unsupported');

    switch (state) {
      case 'enabled':
        els.pushStatus.classList.add('is-enabled');
        els.pushStatus.textContent = t('support_chat_admin.push_status_enabled', 'Push actif');
        break;
      case 'disabled':
        els.pushStatus.classList.add('is-disabled');
        els.pushStatus.textContent = t('support_chat_admin.push_status_disabled', 'Push désactivé');
        break;
      case 'unsupported':
        els.pushStatus.classList.add('is-unsupported');
        els.pushStatus.textContent = t('support_chat_admin.push_status_unsupported', 'Push non supporté');
        break;
      default:
        els.pushStatus.classList.add('is-pending');
        els.pushStatus.textContent = t('support_chat_admin.push_status_pending', 'Push en attente');
        break;
    }
  };

  const canUseBrowserNotifications = () =>
    typeof window !== 'undefined' && 'Notification' in window;

  const ensureNotificationPermission = async () => {
    if (!canUseBrowserNotifications()) return 'unsupported';
    return Notification.permission;
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

  const getDeviceLabel = () => {
    const ua = navigator.userAgent || '';
    if (/android|iphone|ipad|mobile/i.test(ua)) return 'Mobile';
    if (/tablet/i.test(ua)) return 'Tablette';
    return 'Desktop';
  };

  const registerAdminPush = async () => {
    if (!authState.isAgent) {
      setPushStatus('disabled');
      window.SiteUI?.notify?.(
        t(
          'support_chat_admin.not_agent_role',
          'Session non agent/admin. Reconnectez-vous avec un compte autorisé.',
        ),
        'warning',
      );
      return;
    }

    if (window.SitePushCenter?.ensureChannels) {
      try {
        const result = await window.SitePushCenter.ensureChannels(['support_queue']);
        pushState.permission = result?.permission || Notification.permission || 'default';
        pushState.supported = result?.permission !== 'unsupported';
        pushState.subscribed = Boolean(result?.subscribed || result?.ok);

        if (pushState.permission === 'unsupported') {
          setPushStatus('unsupported');
        } else if (pushState.permission === 'denied') {
          setPushStatus('disabled');
          window.SiteUI?.notify?.(
            t('support_chat_admin.push_permission_denied', 'Notifications du navigateur refusées.'),
            'warning',
          );
        } else if (pushState.permission !== 'granted') {
          setPushStatus('pending');
        } else {
          setPushStatus(pushState.subscribed ? 'enabled' : 'disabled');
        }
        return;
      } catch (error) {
        pushState.subscribed = false;
        setPushStatus('disabled');
        const backendMessage = String(error?.payload?.message || error?.message || '').trim();
        window.SiteUI?.notify?.(
          backendMessage ||
            t(
              'support_chat_admin.push_subscribe_failed',
              "Impossible d'activer les notifications push administrateur.",
            ),
          'error',
        );
        return;
      }
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      pushState.supported = false;
      setPushStatus('unsupported');
      return;
    }

    pushState.supported = true;
    pushState.permission = await ensureNotificationPermission();

    if (pushState.permission === 'denied') {
      setPushStatus('disabled');
      window.SiteUI?.notify?.(
        t('support_chat_admin.push_permission_denied', 'Notifications du navigateur refusées.'),
        'warning',
      );
      return;
    }

    if (pushState.permission !== 'granted') {
      setPushStatus('pending');
      return;
    }

    try {
      await navigator.serviceWorker.register('/support-admin-sw.js', { scope: '/' });
      pushState.registration = await navigator.serviceWorker.ready;

      const keyResponse = await window.SiteApi.request('/api/support/chat/push/public-key', {
        method: 'GET',
        auth: true,
      });

      const publicKey = String(keyResponse?.publicKey || '').trim();
      if (!publicKey) {
        setPushStatus('disabled');
        window.SiteUI?.notify?.(
          t(
            'support_chat_admin.push_subscribe_failed',
            "Impossible d'activer les notifications push administrateur.",
          ),
          'error',
        );
        return;
      }

      let subscription = await pushState.registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await pushState.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await window.SiteApi.request('/api/support/chat/push/subscribe', {
        method: 'POST',
        auth: true,
        data: {
          subscription: subscription.toJSON(),
          channel: 'support_queue',
          platform: navigator.platform || '',
          deviceLabel: getDeviceLabel(),
        },
      });

      pushState.subscribed = true;
      setPushStatus('enabled');
    } catch (error) {
      pushState.subscribed = false;
      setPushStatus('disabled');
      const backendMessage = String(error?.payload?.message || error?.message || '').trim();
      window.SiteUI?.notify?.(
        backendMessage ||
          t(
            'support_chat_admin.push_subscribe_failed',
            "Impossible d'activer les notifications push administrateur.",
          ),
        'error',
      );
    }
  };

  const unsubscribeAdminPush = async () => {
    if (window.SitePushCenter?.unsubscribeChannels) {
      try {
        await window.SitePushCenter.unsubscribeChannels(['support_queue']);
        pushState.subscribed = false;
        setPushStatus('disabled');
      } catch (_error) {
        // ignore
      }
      return;
    }

    try {
      if (!pushState.registration) return;
      const subscription = await pushState.registration.pushManager.getSubscription();
      if (!subscription) return;

      await window.SiteApi.request('/api/support/chat/push/unsubscribe', {
        method: 'POST',
        auth: true,
        data: { endpoint: subscription.endpoint },
      });

      await subscription.unsubscribe();
      pushState.subscribed = false;
      setPushStatus('disabled');
    } catch (_error) {
      // ignore
    }
  };

  const appendAdminMessage = (message, options = {}) => {
    if (!els.messages) return;

    const role = resolveAdminMessageRole(message, options);

    const bubble = document.createElement('div');
    bubble.className = `msg ${role}`;
    bubble.title = formatDate(message?.createdAt);

    const content = String(message?.content || '').trim();
    const meta = getRoleMeta(role);

    if (role === 'system') {
      const body = document.createElement('div');
      body.className = 'msg-body';
      body.textContent = content;
      bubble.appendChild(body);
    } else {
      const head = document.createElement('div');
      head.className = 'msg-head';

      const roleTag = document.createElement('span');
      roleTag.className = 'msg-role';
      roleTag.innerHTML = `<i class="${meta.iconClass}" aria-hidden="true"></i><span>${meta.label}</span>`;
      head.appendChild(roleTag);

      const body = document.createElement('div');
      body.className = 'msg-body';
      body.textContent = content;

      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = formatDate(message?.createdAt);

      bubble.appendChild(head);
      bubble.appendChild(body);
      bubble.appendChild(time);
    }

    els.messages.appendChild(bubble);
  };

  const scrollAdminToBottom = () => {
    if (!els.messages) return;
    els.messages.scrollTop = els.messages.scrollHeight;
  };

  const scheduleAdminInitialFocus = (conversationId, { attempts = 4, delay = 80 } = {}) => {
    if (!conversationId || !els.messages) return;
    if (initialFocusInProgress && initialFocusKey === conversationId) return;

    initialFocusKey = conversationId;
    initialFocusDone = false;
    initialFocusInProgress = true;
    let remaining = Math.max(1, Number(attempts) || 1);

    const step = () => {
      if (String(currentConversationId || '') !== String(conversationId)) {
        initialFocusInProgress = false;
        return;
      }

      scrollAdminToBottom();
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

  const getMostRecentConversationId = (items) => {
    if (!Array.isArray(items) || !items.length) return null;

    const pickTime = (item) =>
      Math.max(toMillis(item?.lastMessageAt), toMillis(item?.openedAt), toMillis(item?.createdAt));

    const newest = [...items].sort((a, b) => pickTime(b) - pickTime(a))[0];
    return newest?._id ? String(newest._id) : null;
  };

  const isQueueConversationStatus = (status) =>
    ['waiting', 'assigned'].includes(String(status || '').toLowerCase());

  const keepQueueConversationsOnly = (items = []) =>
    Array.isArray(items)
      ? items.filter((item) => isQueueConversationStatus(item?.status))
      : [];

  const renderQueue = () => {
    if (!els.queueList) return;
    els.queueList.innerHTML = '';

    if (!conversations.length) {
      const empty = document.createElement('p');
      empty.className = 'queue-empty';
      empty.textContent = t('support_chat_admin.queue_empty', 'Aucune conversation.');
      els.queueList.appendChild(empty);
      return;
    }

    conversations.forEach((conversation) => {
      const id = String(conversation._id);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'queue-item';
      if (id === String(currentConversationId || '')) item.classList.add('active');

      const ref = conversation.conversationRef || id.slice(-8);
      const status = String(conversation.status || 'waiting').toUpperCase();
      const category = categoryLabel(conversation.category);
      const when = formatDate(conversation.lastMessageAt || conversation.openedAt);

      item.innerHTML = `<strong>${ref}</strong><br><small>${status} - ${category} - ${when}</small>`;

      item.addEventListener('click', () => {
        selectConversation(id).catch((error) => {
          console.error('selectConversation failed:', error);
        });
      });

      els.queueList.appendChild(item);
    });
  };

  const updateConversationHeader = () => {
    const active = conversations.find((item) => String(item._id) === String(currentConversationId || ''));
    if (active) {
      syncActiveConversationMeta(active);
    } else {
      activeConversationClientId = '';
      activeConversationAssignedAgentId = '';
    }

    if (els.title) {
      els.title.textContent = active
        ? `${active.conversationRef || ''} - ${categoryLabel(active.category)}`
        : t('support_chat_admin.no_conversation_selected', 'Aucune conversation sélectionnée');
    }

    const selected = Boolean(active);
    if (els.claimBtn) els.claimBtn.disabled = !selected;
    if (els.closeBtn) els.closeBtn.disabled = !selected;
    activeConversationClosed = String(active?.status || '').toLowerCase() === 'closed';
    if (els.input) els.input.disabled = !selected || activeConversationClosed;
    const sendButton = els.form?.querySelector('button[type="submit"]');
    if (sendButton) sendButton.disabled = !selected || activeConversationClosed;
  };

  const loadMessages = async (conversationId) => {
    const response = await window.SiteApi.request(
      `/api/support/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'GET', auth: true },
    );
    return response?.messages || [];
  };

  const selectConversation = async (conversationId) => {
    if (!conversationId) return;

    currentConversationId = String(conversationId);
    localStorage.setItem('supportAdminConversationId', currentConversationId);

    renderQueue();
    updateConversationHeader();

    if (!els.messages) return;

    els.messages.innerHTML = '';
    const messages = await loadMessages(currentConversationId);
    messages.forEach(appendAdminMessage);
    scheduleAdminInitialFocus(currentConversationId);

    if (socket?.connected) {
      socket.emit('support:joinConversation', { conversationId: currentConversationId });
    }
  };

  const publishWaitingCount = (items = conversations) => {
    const pendingCount = Array.isArray(items)
      ? items.filter((item) =>
          ['waiting', 'assigned'].includes(String(item?.status || '').toLowerCase()),
        ).length
      : 0;

    try {
      localStorage.setItem('supportAdminWaitingCount', String(pendingCount));
    } catch (_error) {
      // ignore storage failures
    }

    window.SiteSupportAdminMenu?.setWaitingCount?.(pendingCount);
  };

  const loadConversations = async () => {
    const response = await window.SiteApi.request('/api/support/chat/conversations?limit=80', {
      method: 'GET',
      auth: true,
    });

    conversations = keepQueueConversationsOnly(response?.conversations || []);

    conversations.sort((a, b) =>
      Math.max(toMillis(b.lastMessageAt), toMillis(b.openedAt), toMillis(b.createdAt)) -
      Math.max(toMillis(a.lastMessageAt), toMillis(a.openedAt), toMillis(a.createdAt)),
    );

    if (
      currentConversationId &&
      !conversations.some((item) => String(item?._id || '') === String(currentConversationId))
    ) {
      currentConversationId = null;
      localStorage.removeItem('supportAdminConversationId');
      activeConversationClosed = false;
      if (els.messages) els.messages.innerHTML = '';
    }

    publishWaitingCount(conversations);
    renderQueue();
    updateConversationHeader();

    if (!currentConversationId) {
      const newestId = getMostRecentConversationId(conversations);
      if (newestId) {
        await selectConversation(newestId);
      }
    }
  };

  const removeClosedConversationFromQueue = async (conversationId) => {
    const closedId = String(conversationId || '').trim();
    if (!closedId) return;

    const wasActive = closedId === String(currentConversationId || '');
    const previousLength = conversations.length;
    conversations = keepQueueConversationsOnly(
      conversations.filter((item) => String(item?._id || '') !== closedId),
    );

    if (!wasActive && previousLength === conversations.length) return;

    if (wasActive) {
      currentConversationId = null;
      localStorage.removeItem('supportAdminConversationId');
      activeConversationClosed = true;
      if (els.messages) els.messages.innerHTML = '';
    }

    publishWaitingCount(conversations);
    renderQueue();
    updateConversationHeader();

    if (wasActive) {
      const fallbackId = getMostRecentConversationId(conversations);
      if (fallbackId) {
        await selectConversation(fallbackId);
      }
    }
  };

  const cleanupOldNotificationKeys = () => {
    const now = Date.now();
    for (const [key, timestamp] of recentNotifications.entries()) {
      if (now - timestamp > NOTIFICATION_DEDUP_MS) {
        recentNotifications.delete(key);
      }
    }
  };

  const maybeNotifyQueueEvent = (payload = {}) => {
    if (!document.hidden) return;

    cleanupOldNotificationKeys();
    const conversationId = String(payload.conversationId || '').trim();
    const reason = String(payload.reason || 'new_conversation').trim();
    const dedupKey = `${conversationId}:${reason}`;

    if (recentNotifications.has(dedupKey)) return;
    recentNotifications.set(dedupKey, Date.now());

    const title =
      reason === 'new_client_message'
        ? t('support_chat_admin.notification_new_message_title', 'Nouveau message client')
        : t('support_chat_admin.notification_new_contact_title', 'Nouveau contact support');

    const body =
      reason === 'new_client_message'
        ? t('support_chat_admin.notification_new_message_body', 'Un client attend une réponse.')
        : t('support_chat_admin.notification_new_contact_body', 'Une nouvelle conversation est en attente.');

    if (pushState.subscribed) return;

    if (!canUseBrowserNotifications()) {
      window.SiteUI?.notify?.(
        t('support_chat_admin.notification_fallback', 'Nouvelle activité support.'),
        'info',
      );
      return;
    }

    if (Notification.permission !== 'granted') return;

    const notification = new Notification(title, {
      body,
      icon: '/assets/logo.png',
      tag: `support-admin-${dedupKey}`,
      data: { conversationId },
    });

    notification.onclick = () => {
      window.focus();
      if (conversationId) {
        selectConversation(conversationId).catch(() => {});
      }
      notification.close();
    };
  };

  const queueReload = () => {
    if (queuedReloadTimer) return;
    queuedReloadTimer = setTimeout(() => {
      queuedReloadTimer = null;
      loadConversations().catch((error) => {
        console.error('loadConversations failed:', error);
      });
    }, 180);
  };

  const connectSocket = () => {
    if (!authState.isAgent) {
      window.SiteUI?.notify?.(
        t(
          'support_chat_admin.not_agent_role',
          'Session non agent/admin. Reconnectez-vous avec un compte autorisé.',
        ),
        'warning',
      );
      return;
    }

    if (typeof window.io !== 'function') {
      window.SiteUI?.notify?.(
        t('support_chat_admin.socket_unavailable', 'WebSocket indisponible pour le support admin.'),
        'warning',
      );
      return;
    }

    socket = window.io('/support', {
      auth: { token: window.SiteApi.getToken() || undefined },
    });

    socket.on('connect', () => {
      socket.emit('support:agentOnline');
      if (currentConversationId) {
        socket.emit('support:joinConversation', { conversationId: currentConversationId });
      }
    });

    socket.on('support:queueUpdated', (payload = {}) => {
      maybeNotifyQueueEvent(payload);
      queueReload();
    });

    socket.on('support:conversationReady', (payload = {}) => {
      const conversationId = String(payload?.conversation?._id || '').trim();
      if (conversationId && conversationId === String(currentConversationId || '')) {
        syncActiveConversationMeta(payload?.conversation);
        els.messages.innerHTML = '';
        (payload.messages || []).forEach((message) => appendAdminMessage(message));
        scheduleAdminInitialFocus(conversationId);
      }
      queueReload();
    });

    socket.on('support:newMessage', (payload = {}) => {
      const conversationId = String(payload.conversationId || '').trim();
      const message = payload.message;
      if (!conversationId || !message) return;
      const messageRole = resolveAdminMessageRole(message, {
        clientMessageId: payload.clientMessageId,
      });

      if (conversationId === String(currentConversationId || '')) {
        appendAdminMessage(message, { clientMessageId: payload.clientMessageId });
        scrollAdminToBottom();
      } else {
        maybeNotifyQueueEvent({
          conversationId,
          reason: messageRole === 'client' ? 'new_client_message' : 'new_conversation',
        });
      }

      queueReload();
    });

    socket.on('support:statusChanged', () => {
      queueReload();
    });

    socket.on('support:assigned', (payload = {}) => {
      const assignedId = String(payload.conversationId || '').trim();
      if (assignedId && assignedId === String(currentConversationId || '')) {
        window.SiteUI?.notify?.(
          t('support_chat_admin.claim_success', 'Conversation prise en charge.'),
          'success',
        );
      }
      queueReload();
    });

    socket.on('support:closed', (payload = {}) => {
      const closedId = String(payload.conversationId || '').trim();
      removeClosedConversationFromQueue(closedId).catch((error) => {
        console.error('removeClosedConversationFromQueue failed:', error);
      });
      if (closedId) {
        window.SiteUI?.notify?.(
          payload.message || t('support_chat_admin.closed_by_admin', 'Cette conversation est clôturée.'),
          'info',
        );
      }
      queueReload();
    });

    socket.on('support:error', (payload = {}) => {
      window.SiteUI?.notify?.(
        payload.message || t('support_chat_admin.error_generic', 'Erreur sur le chat admin support.'),
        'error',
      );
    });
  };

  const ensureAdminSession = async () => {
    const me = await window.SiteApi.request('/api/auth/me', {
      method: 'GET',
      auth: true,
    });

    const role = String(me?.role || '').toLowerCase();
    authState.role = role;
    authState.isAgent = role === 'support' || role === 'admin';
    authState.userId = normalizeUserId(me?._id || me?.id);

    await window.SiteApi.request('/api/support/chat/conversations?limit=1', {
      method: 'GET',
      auth: true,
    });

    return me;
  };

  const bindEvents = () => {
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = 'browse-surveys.html';
    });

    els.claimBtn?.addEventListener('click', () => {
      if (!currentConversationId || !socket) return;
      socket.emit('support:claimConversation', { conversationId: currentConversationId });
    });

    els.closeBtn?.addEventListener('click', () => {
      if (!currentConversationId || !socket) return;
      socket.emit('support:closeConversation', { conversationId: currentConversationId });
    });

    els.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (activeConversationClosed) {
        window.SiteUI?.notify?.(
          t('support_chat_admin.closed_send_blocked', 'Conversation clôturée : envoi impossible.'),
          'warning',
        );
        return;
      }
      const content = String(els.input?.value || '').trim();
      if (!content || !currentConversationId || !socket) return;
      socket.emit('support:sendMessage', {
        conversationId: currentConversationId,
        content,
        senderContext: 'agent',
      });
      if (els.input) els.input.value = '';
    });

    document.getElementById('logout-ok')?.addEventListener('click', () => {
      unsubscribeAdminPush().catch(() => {});
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event?.data?.type !== 'support:openConversation') return;
        const conversationId = String(event.data.conversationId || '').trim();
        if (!conversationId) return;
        selectConversation(conversationId).catch(() => {});
      });
    }
  };

  const readConversationIdFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      const conversationId = String(url.searchParams.get('conversationId') || '').trim();
      if (!conversationId) return;

      currentConversationId = conversationId;
      localStorage.setItem('supportAdminConversationId', currentConversationId);

      url.searchParams.delete('conversationId');
      window.history.replaceState({}, '', url.toString());
    } catch (_error) {
      // ignore
    }
  };

  const init = async () => {
    els.queueList = document.getElementById('queue-list');
    els.messages = document.getElementById('admin-chat-messages');
    els.form = document.getElementById('admin-chat-form');
    els.input = document.getElementById('admin-chat-input');
    els.title = document.getElementById('conversation-title');
    els.claimBtn = document.getElementById('claim-btn');
    els.closeBtn = document.getElementById('close-btn');
    els.pushStatus = document.getElementById('push-status-indicator');

    if (!els.queueList || !els.messages || !els.form || !els.input) return;

    if (!window.SiteApi?.getToken?.()) {
      redirectIfDenied({ status: 401 });
      return;
    }

    setPushStatus('pending');
    readConversationIdFromUrl();

    currentConversationId =
      currentConversationId || localStorage.getItem('supportAdminConversationId') || null;

    await ensureAdminSession();
    bindEvents();
    connectSocket();
    await loadConversations();
    registerAdminPush().catch(() => {
      setPushStatus('disabled');
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('support-chat-admin init failed:', error);
      if (redirectIfDenied(error)) return;
      window.SiteUI?.notify?.(
        error?.message ||
          t('support_chat_admin.bootstrap_error', "Impossible d'initialiser le support admin."),
        'error',
      );
    });
  });
})();
