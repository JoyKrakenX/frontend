/**
 * ChatRoomTv - Script principal amélioré
 * Responsive mobile-first avec UX moderne
 *
 * @format
 */

/* Configuration */
const CONFIG = {
	api: {
		endpoints: {
			getSurvey: '/api/survey',
			getSurveyMultiple: '/api/survey_2',
			getChatMessages: '/api/chat',
			getChatStats: '/api/chat',
			sendMessage: '/api/chat',
		},
	},
	socket: { url: '' },
	colors: {
		primary: '#6366f1',
		success: '#10b981',
		danger: '#ef4444',
		warning: '#f59e0b',
		info: '#3b82f6',
	},
};

const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';

/* State */
let socket = null;
let currentUser = null;
let currentSurvey = null;
let currentSurveyType = null;
let currentSurveyId = null;
let onlineUsers = new Map();
let chatMessages = 0;
let isConnected = false;
let replyingToMessage = null;
let isUserMenuOpen = false;
let lastDateSeparator = null;
let uptimeInterval = null;
let userMapForExport = new Map();
let nextAnonymousId = 1;
let isMobileUsersExpanded = false;
let initialViewportFocusDone = false;
let unreadIncomingCount = 0;
let chatReadOnly = false;
let chatReadOnlyNoticeShown = false;
const HEADER_TOP_REVEAL = 8;
const HEADER_SHADOW_THRESHOLD = 6;
const NEAR_BOTTOM_THRESHOLD = 100;
const UNREAD_BADGE_MAX = 99;
const QUICK_HELLO_INTERVAL_MS = 10000;
const QUICK_HELLO_VISIBLE_MS = 1850;
const QUICK_HELLO_PARTICIPATION_KEY_PREFIX =
	'chatroom:quick-hello-participated';
const CHAT_SOUND_PREF_KEY = 'chatroom:notification-sound-enabled';
let headerStateRaf = null;
let isHeadersCollapsed = true;
let quickHelloIntervalId = null;
let quickHelloHideTimeoutId = null;
let hasUserParticipatedInCurrentChat = false;
let quickHelloParticipationInitialized = false;
let quickHelloParticipationStorageKey = null;
let notificationSoundEnabled = true;
let notificationAudioContext = null;
let isLeavingChat = false;
let focusLayoutEnsureTimeoutId = null;
const USER_ACCENT_COLORS = [
	'#3b82f6',
	'#10b981',
	'#f59e0b',
	'#ef4444',
	'#8b5cf6',
	'#14b8a6',
	'#f97316',
	'#84cc16',
	'#06b6d4',
	'#ec4899',
];

let chatLifecycleBound = false;

/* Utility: wait for element */
function waitForElement(selector, timeout = 10000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const check = () => {
			const el = document.querySelector(selector);
			if (el) return resolve(el);
			if (Date.now() - start > timeout)
				return reject(
					new Error(`Élément ${selector} introuvable après ${timeout} ms`),
				);
			setTimeout(check, 100);
		};
		check();
	});
}

function isNearBottom(container, threshold = NEAR_BOTTOM_THRESHOLD) {
	if (!container) return true;
	const { scrollTop, scrollHeight, clientHeight } = container;
	return scrollHeight - scrollTop - clientHeight < threshold;
}

function ensureScrollUnreadBadgeNode() {
	const scrollButton = document.getElementById('scroll-to-bottom');
	if (!scrollButton) return null;

	let badge = scrollButton.querySelector('#scroll-unread-count');
	if (!badge) {
		badge = document.createElement('span');
		badge.id = 'scroll-unread-count';
		badge.className = 'scroll-unread-count hidden';
		badge.setAttribute('aria-hidden', 'true');
		badge.textContent = '0';
		scrollButton.appendChild(badge);
	}

	return badge;
}

function updateScrollUnreadBadge() {
	const scrollButton = document.getElementById('scroll-to-bottom');
	if (!scrollButton) return;

	const baseLabel =
		scrollButton.dataset.baseAriaLabel ||
		scrollButton.getAttribute('aria-label') ||
		'Aller au dernier message';
	scrollButton.dataset.baseAriaLabel = baseLabel;

	const badge = ensureScrollUnreadBadgeNode();
	if (!badge) return;

	if (unreadIncomingCount <= 0) {
		badge.textContent = '0';
		badge.classList.add('hidden');
		scrollButton.classList.remove('is-active');
		scrollButton.setAttribute('aria-label', baseLabel);
		return;
	}

	const visibleCount =
		unreadIncomingCount > UNREAD_BADGE_MAX ?
			`${UNREAD_BADGE_MAX}+`
		:	String(unreadIncomingCount);

	badge.textContent = visibleCount;
	badge.classList.remove('hidden');
	scrollButton.classList.add('is-active');
	scrollButton.setAttribute(
		'aria-label',
		`${baseLabel} (${unreadIncomingCount} nouveaux messages non lus)`,
	);
}

function incrementUnreadIncomingCount() {
	unreadIncomingCount += 1;
	updateScrollUnreadBadge();
}

function resetUnreadIncomingCount() {
	unreadIncomingCount = 0;
	updateScrollUnreadBadge();
}

function isSharedUserMenuEnabled() {
	return document.body?.dataset?.sharedUserMenu === 'true';
}

function isUserMenuExpanded() {
	return !!document.querySelector('.user-menu-details[open]');
}

function getQuickHelloParticipationStorageKey() {
	if (!currentSurveyId || !currentUser?.id) return null;
	return `${QUICK_HELLO_PARTICIPATION_KEY_PREFIX}:${currentSurveyId}:${String(
		currentUser.id,
	)}`;
}

function readQuickHelloParticipationFromStorage() {
	const key = getQuickHelloParticipationStorageKey();
	if (!key) return false;
	try {
		return localStorage.getItem(key) === '1';
	} catch (_error) {
		return false;
	}
}

function writeQuickHelloParticipationToStorage(participated) {
	const key = getQuickHelloParticipationStorageKey();
	if (!key) return;
	try {
		if (participated) {
			localStorage.setItem(key, '1');
			return;
		}
		localStorage.removeItem(key);
	} catch (_error) {
		// localStorage can be unavailable in private modes; fail silently.
	}
}

function isMessageFromCurrentUser(message) {
	const messageUserId =
		message?.user?.id ||
		message?.user?._id ||
		message?.userId ||
		message?.authorId;
	if (!messageUserId || !currentUser?.id) return false;
	return String(messageUserId) === String(currentUser.id);
}

function isQuickHelloPromptEligible() {
	return (
		!chatReadOnly &&
		!hasUserParticipatedInCurrentChat &&
		Boolean(currentUser?.id) &&
		Boolean(currentSurveyId)
	);
}

function setQuickHelloParticipation(
	participated,
	{ persist = true, source = 'unknown' } = {},
) {
	void source;
	const nextValue = Boolean(participated);
	hasUserParticipatedInCurrentChat = nextValue;

	if (persist) {
		writeQuickHelloParticipationToStorage(nextValue);
	}

	if (nextValue) {
		stopQuickHelloPromptLoop();
		hideQuickHelloThought({ immediate: true });
		return;
	}

	if (document.hidden) return;
	if (!isQuickHelloPromptEligible()) return;
	startQuickHelloPromptLoop();
}

function initializeQuickHelloParticipationState() {
	const key = getQuickHelloParticipationStorageKey();

	if (!key) {
		quickHelloParticipationInitialized = false;
		quickHelloParticipationStorageKey = null;
		hasUserParticipatedInCurrentChat = false;
		return false;
	}

	if (
		quickHelloParticipationInitialized &&
		quickHelloParticipationStorageKey === key
	) {
		if (hasUserParticipatedInCurrentChat) {
			stopQuickHelloPromptLoop();
			hideQuickHelloThought({ immediate: true });
		}
		return hasUserParticipatedInCurrentChat;
	}

	quickHelloParticipationInitialized = true;
	quickHelloParticipationStorageKey = key;
	hasUserParticipatedInCurrentChat = readQuickHelloParticipationFromStorage();

	if (hasUserParticipatedInCurrentChat) {
		stopQuickHelloPromptLoop();
		hideQuickHelloThought({ immediate: true });
	}

	return hasUserParticipatedInCurrentChat;
}

function setChatReadOnly(enabled, { showNotice = false } = {}) {
	const nextReadOnly = Boolean(enabled);
	const stateChanged = chatReadOnly !== nextReadOnly;
	chatReadOnly = nextReadOnly;

	if (document.body) {
		document.body.classList.toggle('chat-read-only', chatReadOnly);
		document.body.dataset.chatReadOnly = chatReadOnly ? 'true' : 'false';
	}

	const messageInput = document.getElementById('message-input');
	const sendBtn = document.getElementById('send-btn');
	const emojiBtn = document.getElementById('emoji-btn');
	const quickHelloBtn = document.getElementById('quick-hello-btn');

	if (messageInput) {
		messageInput.disabled = chatReadOnly;
		messageInput.readOnly = chatReadOnly;
		if (chatReadOnly) {
			messageInput.placeholder = t(
				'chatroom.read_only.input_placeholder',
				'Le sondage est cloture. Le chat est en lecture seule.',
			);
			messageInput.title = t(
				'chatroom.read_only.input_title',
				'Le chat est en lecture seule car le sondage est cloture',
			);
		} else {
			messageInput.placeholder = t(
				'chatroom.input.default_placeholder',
				'Tapez votre message ici... (Entree pour envoyer, Shift+Entree pour aller a la ligne)',
			);
			messageInput.title = '';
		}
	}

	if (sendBtn) {
		sendBtn.disabled = chatReadOnly;
		sendBtn.setAttribute('aria-disabled', chatReadOnly ? 'true' : 'false');
	}
	if (emojiBtn) {
		emojiBtn.disabled = chatReadOnly;
		emojiBtn.setAttribute('aria-disabled', chatReadOnly ? 'true' : 'false');
	}
	if (quickHelloBtn) {
		quickHelloBtn.disabled = chatReadOnly;
		quickHelloBtn.setAttribute('aria-disabled', chatReadOnly ? 'true' : 'false');
	}

	if (chatReadOnly) {
		cancelReply(false);
		hideQuickHelloThought({ immediate: true });
		stopQuickHelloPromptLoop();
	} else if (stateChanged) {
		startQuickHelloPromptLoop();
	}

	if (chatReadOnly) {
		if (showNotice && (!chatReadOnlyNoticeShown || stateChanged)) {
			showNotification(t(
				'chatroom.read_only.notice',
				'Le sondage est cloture. Le chat est en lecture seule.',
			), 'info');
			chatReadOnlyNoticeShown = true;
		}
	} else {
		chatReadOnlyNoticeShown = false;
	}
}

function readNotificationSoundPreference() {
	try {
		const storedValue = localStorage.getItem(CHAT_SOUND_PREF_KEY);
		if (storedValue === '0') return false;
		if (storedValue === '1') return true;
	} catch (_error) {
		// no-op
	}
	return true;
}

function persistNotificationSoundPreference(enabled) {
	try {
		localStorage.setItem(CHAT_SOUND_PREF_KEY, enabled ? '1' : '0');
	} catch (_error) {
		// no-op
	}
}

function updateNotificationSoundToggleUI() {
	const soundToggleBtn = document.getElementById('sound-toggle-btn');
	if (!soundToggleBtn) return;

	const muted = !notificationSoundEnabled;
	const label = muted ?
			t(
				'chatroom.sound.enable_label',
				'Activer le son des notifications',
			)
		:	t(
				'chatroom.sound.disable_label',
				'Couper le son des notifications',
			);

	soundToggleBtn.setAttribute('title', label);
	soundToggleBtn.setAttribute('aria-label', label);
	soundToggleBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
	soundToggleBtn.classList.toggle('is-muted', muted);

	const iconNode = soundToggleBtn.querySelector('i');
	if (iconNode) {
		iconNode.className = `fas ${muted ? 'fa-bell-slash' : 'fa-bell'}`;
	}
}

function ensureNotificationAudioContext() {
	if (notificationAudioContext) return notificationAudioContext;
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!AudioCtx) return null;
	notificationAudioContext = new AudioCtx();
	return notificationAudioContext;
}

function warmNotificationAudioContext() {
	const audioContext = ensureNotificationAudioContext();
	if (!audioContext) return;
	if (audioContext.state === 'suspended') {
		audioContext.resume().catch(() => {});
	}
}

function toggleNotificationSound() {
	notificationSoundEnabled = !notificationSoundEnabled;
	persistNotificationSoundPreference(notificationSoundEnabled);
	updateNotificationSoundToggleUI();
	if (notificationSoundEnabled) {
		warmNotificationAudioContext();
	}

	const toastKey =
		notificationSoundEnabled ?
			'chatroom.sound.enabled_toast'
		:	'chatroom.sound.disabled_toast';
	const toastFallback =
		notificationSoundEnabled ?
			'Son des notifications activé'
		:	'Son des notifications désactivé';
	showNotification(t(toastKey, toastFallback), 'info', 1400);
}

function initializeNotificationSoundToggle() {
	const soundToggleBtn = document.getElementById('sound-toggle-btn');
	if (!soundToggleBtn) return;

	notificationSoundEnabled = readNotificationSoundPreference();
	updateNotificationSoundToggleUI();

	soundToggleBtn.addEventListener('click', () => {
		toggleNotificationSound();
	});

	soundToggleBtn.addEventListener('pointerdown', () => {
		warmNotificationAudioContext();
	});

	document.addEventListener('site:language-changed', () => {
		updateNotificationSoundToggleUI();
	});
}

function getUserAccentColor(identity) {
	const value = String(identity || '');
	if (!value) return USER_ACCENT_COLORS[0];
	let hash = 0;
	for (let idx = 0; idx < value.length; idx += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(idx);
		hash |= 0;
	}
	return USER_ACCENT_COLORS[Math.abs(hash) % USER_ACCENT_COLORS.length];
}

function joinCurrentChatRoom() {
	if (!socket?.connected || !currentSurveyId || !currentUser?.id) return;
	socket.emit('joinChatRoom', {
		surveyId: currentSurveyId,
		userId: currentUser.id,
		pseudo: currentUser.pseudo,
		type: currentSurveyType,
	});
}

function disconnectSocket({ notifyServer = false } = {}) {
	if (!socket) return;
	try {
		if (
			notifyServer &&
			socket.connected &&
			currentSurveyId &&
			currentUser?.id
		) {
			socket.emit('leaveChatRoom', {
				surveyId: currentSurveyId,
				userId: currentUser.id,
				pseudo: currentUser.pseudo,
			});
		}
		socket.removeAllListeners();
		socket.disconnect();
	} catch (_error) {
		// no-op
	} finally {
		socket = null;
		isConnected = false;
	}
}

function ensureRealtimeConnection({ reloadData = false } = {}) {
	if (!currentSurveyId || !currentSurveyType || !currentUser?.id) return;

	if (!socket) {
		initializeSocket(currentSurveyId);
	} else if (!socket.connected) {
		try {
			socket.connect();
		} catch (_error) {
			initializeSocket(currentSurveyId);
		}
	} else {
		joinCurrentChatRoom();
	}

	if (reloadData) {
		loadChatMessages(currentSurveyId);
		loadChatStats(currentSurveyId);
	}
}

function refreshScrollButtonState(container = null) {
	const messagesContainer =
		container || document.getElementById('messages-container');
	const scrollButton = document.getElementById('scroll-to-bottom');
	if (!messagesContainer || !scrollButton) return;
	const nearBottom = isNearBottom(messagesContainer);
	scrollButton.classList.toggle('hidden', nearBottom);
	if (nearBottom) {
		resetUnreadIncomingCount();
	} else {
		updateScrollUnreadBadge();
	}
}

function hasBlockingOverlayOpen() {
	return (
		!!document.querySelector('.modal:not(.hidden)') ||
		!!document.querySelector('#logout-confirm-modal:not(.hidden)') ||
		!!document.querySelector('.user-menu-details[open]') ||
		!!document.querySelector('.side-panel.active') ||
		!!document.querySelector('#emoji-picker:not(.hidden)')
	);
}

function applyHeaderVisibility(currentY = window.scrollY || 0) {
	void currentY;
	if (!document.body?.classList.contains('chat-focus-layout')) return;
	document.body.classList.toggle('chat-headers-collapsed', isHeadersCollapsed);
}

function queueHeaderVisibilityUpdate() {
	const currentY = window.scrollY || 0;
	if (headerStateRaf) return;
	headerStateRaf = window.requestAnimationFrame(() => {
		headerStateRaf = null;
		applyHeaderVisibility(currentY);
	});
}

function getVisibleBlockHeight(element) {
	if (!element) return 0;
	const computed = window.getComputedStyle(element);
	if (
		computed.display === 'none' ||
		computed.visibility === 'hidden' ||
		computed.opacity === '0'
	) {
		return 0;
	}
	const rect = element.getBoundingClientRect();
	if (!Number.isFinite(rect.height) || rect.height <= 0.5) return 0;
	return Math.ceil(rect.height);
}

function syncFocusViewportMetrics() {
	if (!document.body) return;
	const chatInputSection = document.querySelector('.chat-input-section');
	const composerHeight = Math.max(
		96,
		Math.ceil(chatInputSection?.getBoundingClientRect?.().height || 0) || 136,
	);
	document.body.style.setProperty('--chat-composer-height', `${composerHeight}px`);

	if (!document.body.classList.contains('chat-focus-layout')) {
		document.body.style.setProperty('--chat-top-offset', '0px');
		return;
	}

	let topOffset = 0;
	if (!isHeadersCollapsed) {
		topOffset += getVisibleBlockHeight(document.getElementById('chat-subheader'));
	}
	document.body.style.setProperty('--chat-top-offset', `${Math.max(0, topOffset)}px`);
}

function syncComposerHeightVar() {
	syncFocusViewportMetrics();
}

function ensureFocusLayoutState() {
	if (!document.body || document.body.dataset.page !== 'chatroom') return;
	document.body.classList.add('chat-focus-layout');
	document.body.classList.toggle('chat-headers-collapsed', isHeadersCollapsed);
	syncFocusViewportMetrics();

	window.clearTimeout(focusLayoutEnsureTimeoutId);
	focusLayoutEnsureTimeoutId = window.setTimeout(() => {
		if (!document.body || document.body.dataset.page !== 'chatroom') return;
		document.body.classList.add('chat-focus-layout');
		document.body.classList.toggle('chat-headers-collapsed', isHeadersCollapsed);
		syncFocusViewportMetrics();
	}, 120);
}

function updateChatLayoutToggleUI() {
	const toggleBtn = document.getElementById('chat-layout-toggle');
	if (!toggleBtn) return;

	const icon = toggleBtn.querySelector('i');
	const expanded = !isHeadersCollapsed;
	const openHeadersLabel = t(
		'chatroom.layout.toggle_open_headers',
		'Afficher les en-tetes',
	);
	const closeHeadersLabel = t(
		'chatroom.layout.toggle_close_headers',
		'Masquer les en-tetes',
	);
	const nextLabel = expanded ? closeHeadersLabel : openHeadersLabel;

	toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
	toggleBtn.setAttribute('aria-label', nextLabel);
	toggleBtn.setAttribute('title', nextLabel);
	toggleBtn.classList.toggle('is-expanded', expanded);

	if (icon) {
		icon.classList.remove('fa-angle-down', 'fa-angle-up');
		icon.classList.add(expanded ? 'fa-angle-up' : 'fa-angle-down');
	}
}

function updateLeaveChatButtonUI() {
	const leaveBtn = document.getElementById('leave-chat-btn');
	if (!leaveBtn) return;

	const label = t('chatroom.layout.leave_chat_label', 'Sortir');
	const title = t('chatroom.layout.leave_chat_title', 'Sortir du chat');
	const aria = t('chatroom.layout.leave_chat_aria', 'Sortir du chat');

	leaveBtn.setAttribute('title', title);
	leaveBtn.setAttribute('aria-label', aria);
	const labelNode = leaveBtn.querySelector('span');
	if (labelNode) {
		labelNode.textContent = label;
	}
}

function closeTransientOverlays() {
	closeAllPanels();
	const picker = document.getElementById('emoji-picker');
	if (picker && !picker.classList.contains('hidden')) {
		picker.classList.add('hidden');
		picker.setAttribute('aria-hidden', 'true');
	}

	const emojiBtn = document.getElementById('emoji-btn');
	if (emojiBtn) {
		emojiBtn.setAttribute('aria-expanded', 'false');
	}

	const logoutModal = document.getElementById('logout-confirm-modal');
	if (logoutModal && !logoutModal.classList.contains('hidden')) {
		logoutModal.classList.add('hidden');
	}

	const userMenuDetails = document.querySelector('.user-menu-details[open]');
	if (userMenuDetails) {
		userMenuDetails.removeAttribute('open');
	}
}

function leaveChatRoomAndExit() {
	if (isLeavingChat) return;
	isLeavingChat = true;

	stopQuickHelloPromptLoop();
	hideQuickHelloThought({ immediate: true });
	closeTransientOverlays();
	disconnectSocket({ notifyServer: true });
	window.location.href = 'browse-surveys.html';
}

function setHeadersCollapsed(collapsed) {
	isHeadersCollapsed = Boolean(collapsed);
	if (document.body?.classList.contains('chat-focus-layout')) {
		document.body.classList.toggle('chat-headers-collapsed', isHeadersCollapsed);
	}
	updateChatLayoutToggleUI();
	queueHeaderVisibilityUpdate();
	syncFocusViewportMetrics();
	window.setTimeout(syncFocusViewportMetrics, 220);
}

function initializeChatFocusLayout() {
	if (!document.body) return;

	ensureFocusLayoutState();
	setHeadersCollapsed(true);

	const toggleBtn = document.getElementById('chat-layout-toggle');
	if (toggleBtn && !toggleBtn.dataset.bound) {
		toggleBtn.dataset.bound = 'true';
		toggleBtn.addEventListener('click', () => {
			if (hasBlockingOverlayOpen()) return;
			setHeadersCollapsed(!isHeadersCollapsed);
		});
	}

	const focusMetricTargets = [
		document.getElementById('chat-subheader'),
		document.querySelector('.chat-input-section'),
	];
	focusMetricTargets.forEach((target) => {
		if (!target || target.dataset.focusMetricsBound === 'true') return;
		target.dataset.focusMetricsBound = 'true';
		target.addEventListener('transitionend', () => {
			syncFocusViewportMetrics();
		});
	});

	updateLeaveChatButtonUI();
	syncFocusViewportMetrics();
	window.setTimeout(() => {
		ensureFocusLayoutState();
		syncFocusViewportMetrics();
		scrollToBottomAfterLayout({ passes: 3, delay: 85 });
	}, 180);
}

function scrollToLatestMessage({
	smooth = false,
	retries = 3,
	onlyIfNearBottom = false,
} = {}) {
	const container = document.getElementById('messages-container');
	if (!container) return;
	if (onlyIfNearBottom && !isNearBottom(container)) return;

	const maxRetries = Math.max(1, Number(retries) || 1);
	let remaining = maxRetries;
	const initialBehavior = smooth ? 'smooth' : 'auto';

	const step = () => {
		container.scrollTo({
			top: container.scrollHeight,
			behavior: remaining === maxRetries ? initialBehavior : 'auto',
		});
		refreshScrollButtonState(container);
		remaining -= 1;
		if (remaining <= 0) return;
		window.requestAnimationFrame(() => {
			setTimeout(step, 70);
		});
	};

	step();
}

function scrollToBottomAfterLayout({ passes = 6, delay = 90 } = {}) {
	const container = document.getElementById('messages-container');
	if (!container) return;

	let remaining = Math.max(1, Number(passes) || 1);
	const step = () => {
		syncFocusViewportMetrics();
		if (
			container.clientHeight <= 0 ||
			container.scrollHeight <= 0 ||
			container.offsetParent === null
		) {
			remaining -= 1;
			if (remaining <= 0) return;
			window.requestAnimationFrame(() => {
				setTimeout(step, delay);
			});
			return;
		}
		scrollToLatestMessage({ smooth: false, retries: 2 });
		remaining -= 1;
		if (remaining <= 0) return;
		window.requestAnimationFrame(() => {
			setTimeout(step, delay);
		});
	};

	step();
}

function forceInitialBottomSnap({ passes = 5, delay = 90 } = {}) {
	scrollToBottomAfterLayout({ passes, delay });
}

/* Date formatting utilities */
function formatMessageDate(date) {
	const now = new Date();
	const messageDate = new Date(date);
	const isToday = messageDate.toDateString() === now.toDateString();
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	const isYesterday = yesterday.toDateString() === messageDate.toDateString();

	if (isToday) {
		return "Aujourd'hui";
	} else if (isYesterday) {
		return 'Hier';
	} else {
		return messageDate.toLocaleDateString(getIntlLocale(), {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
		});
	}
}

function formatMessageClock(date) {
	return new Date(date).toLocaleTimeString(getIntlLocale(), {
		hour: '2-digit',
		minute: '2-digit',
	});
}

function getDateKey(date) {
	const d = new Date(date);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function createDateSeparator(date) {
	const container = document.getElementById('messages-container');
	const template = document.getElementById('date-separator-template');
	if (!container || !template) return;

	const separator = template.cloneNode(true);
	separator.classList.remove('hidden');

	const dateText = separator.querySelector('.date-text');
	const messageDate = new Date(date);
	const now = new Date();
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);

	if (messageDate.toDateString() === now.toDateString()) {
		dateText.textContent = "Aujourd'hui";
	} else if (yesterday.toDateString() === messageDate.toDateString()) {
		dateText.textContent = 'Hier';
	} else {
		dateText.textContent = messageDate.toLocaleDateString(getIntlLocale(), {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
		});
	}

	container.appendChild(separator);
}

/* Scroll management */
function initScrollToBottom() {
	const messagesContainer = document.getElementById('messages-container');
	const scrollButton = document.getElementById('scroll-to-bottom');

	if (!messagesContainer || !scrollButton) return;
	ensureScrollUnreadBadgeNode();
	updateScrollUnreadBadge();

	const checkScrollPosition = () => refreshScrollButtonState(messagesContainer);
	messagesContainer.addEventListener('scroll', checkScrollPosition);
	messagesContainer.addEventListener('scroll', queueHeaderVisibilityUpdate, {
		passive: true,
	});
	scrollButton.addEventListener('click', () => {
		scrollToLatestMessage({ smooth: true, retries: 2 });
		resetUnreadIncomingCount();
	});

	checkScrollPosition();
}

/* Anonymization for export */
function anonymizeUsername(username) {
	if (!userMapForExport.has(username)) {
		userMapForExport.set(username, `Utilisateur${nextAnonymousId}`);
		nextAnonymousId++;
	}
	return userMapForExport.get(username);
}

/* Improved export chat function */
function exportChat() {
	const messages = document.querySelectorAll('.message:not(.system-message)');
	if (messages.length === 0) {
		showNotification('Aucun message à exporter', 'warning');
		return;
	}

	userMapForExport.clear();
	nextAnonymousId = 1;

	let content = `Export du chat - ${new Date().toLocaleString(getIntlLocale())}\n`;
	content += `Sondage: ${currentSurvey?.theme || 'Non spécifié'}\n`;
	content += `Question: ${currentSurvey?.question || 'Non spécifié'}\n`;
	content += `Date d'export: ${new Date().toLocaleString(getIntlLocale())}\n`;
	content += '='.repeat(50) + '\n\n';

	messages.forEach((msg, index) => {
		const userElement = msg.querySelector('.message-user span:first-child');
		const timeElement = msg.querySelector('.message-time');
		const dateElement = msg.querySelector('.message-date');
		const textElement = msg.querySelector('.message-text');

		const originalUsername = userElement?.textContent || 'Inconnu';
		const anonymizedUsername = anonymizeUsername(originalUsername);
		const time = timeElement?.textContent || '';
		const date = dateElement?.textContent || '';
		const text = textElement?.textContent || '';

		const replyPreview = msg.querySelector('.reply-preview');
		let replyInfo = '';
		if (replyPreview) {
			const replyUser = replyPreview
				.querySelector('strong')
				?.textContent.replace('↪', '')
				.replace('??', '')
				.trim();
			const replyText =
				replyPreview.querySelector('.reply-text')?.textContent || '';
			replyInfo = `\n  Réponse à ${anonymizeUsername(replyUser)}: ${replyText}`;
		}

		content += `${index + 1}. [${date} ${time}] ${anonymizedUsername}: ${text}${replyInfo}\n`;
	});

	content += `\n${'='.repeat(50)}\n`;
	content += `Total messages: ${messages.length}\n`;
	content += `Export généré par ChatRoomTv\n`;

	const blob = new Blob(['\uFEFF', content], {
		type: 'text/plain;charset=utf-8',
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `chat_${currentSurvey?.theme?.replace(/\s+/g, '_') || 'export'}_${new Date().toISOString().slice(0, 10)}.txt`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

	showNotification(
		`Chat exporté avec succès (${messages.length} messages)`,
		'success',
	);
}

/* Chat uptime counter removed in production header */
function initUptimeCounter() {}

/* Improved System message function */
function addSystemMessage(text, type = 'info', { forceScroll = false } = {}) {
	const container = document.getElementById('messages-container');
	if (!container) return;

	const messageElement = document.createElement('div');
	messageElement.className = `message system-message ${type}`;

	const now = new Date();
	const formattedTime = formatMessageClock(now);
	const formattedDate = formatMessageDate(now);
	const dateKey = getDateKey(now);

	if (dateKey !== lastDateSeparator) {
		createDateSeparator(now);
		lastDateSeparator = dateKey;
	}

	let icon = 'info-circle';
	if (type === 'error') icon = 'exclamation-circle';
	if (type === 'success') icon = 'check-circle';
	if (type === 'warning') icon = 'exclamation-triangle';

	messageElement.innerHTML = `
    <div class="message-content">
      <div class="message-header">
        <div class="message-user">
          <span class="system-label"><i class="fas fa-${icon}"></i><span>Système</span></span>
        </div>
        <div class="message-time">${formattedTime}</div>
      </div>
      <div class="message-text">${escapeHtml(text)}</div>
      <div class="message-date">${now.toLocaleDateString(getIntlLocale(), {
				weekday: 'short',
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
			})}</div>
    </div>
  `;

	const dateEl = messageElement.querySelector('.message-date');
	if (dateEl) dateEl.textContent = formattedDate;

	container.appendChild(messageElement);
	scrollToLatestMessage({
		retries: 2,
		onlyIfNearBottom: !forceScroll,
	});

	if (type === 'error' || type === 'warning') {
		showNotification(text, type);
	}
}

/* Improved User Menu Functions */
function updateChevronIcon() {
	const chevronIcon = document.querySelector('.chevron-icon');
	if (chevronIcon) {
		chevronIcon.className =
			isUserMenuOpen ?
				'fas fa-chevron-up chevron-icon'
			:	'fas fa-chevron-down chevron-icon';
	}
}

function initializeLogoutModal() {
	const closeModalBtn = document.querySelector(
		'#logout-confirm-modal .close-modal',
	);
	if (closeModalBtn) {
		closeModalBtn.addEventListener('click', () => {
			document.getElementById('logout-confirm-modal').classList.add('hidden');
			queueHeaderVisibilityUpdate();
		});
	}

	const logoutModal = document.getElementById('logout-confirm-modal');
	if (logoutModal) {
		logoutModal.addEventListener('click', (e) => {
			if (
				e.target === logoutModal ||
				e.target.classList.contains('modal-overlay')
			) {
				logoutModal.classList.add('hidden');
				queueHeaderVisibilityUpdate();
			}
		});
	}

	document.getElementById('logout-cancel')?.addEventListener('click', () => {
		document.getElementById('logout-confirm-modal').classList.add('hidden');
		queueHeaderVisibilityUpdate();
	});

	document.getElementById('logout-ok')?.addEventListener('click', () => {
		handleLogout();
		document.getElementById('logout-confirm-modal').classList.add('hidden');
		queueHeaderVisibilityUpdate();
	});
}

function handleWindowResize() {
	if (!isSharedUserMenuEnabled()) {
		const userMenuDetails = document.querySelector('.user-menu-details');
		if (userMenuDetails?.hasAttribute('open')) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	}

	const scrollButton = document.getElementById('scroll-to-bottom');
	if (scrollButton && !scrollButton.classList.contains('hidden')) {
		const messagesContainer = document.getElementById('messages-container');
		refreshScrollButtonState(messagesContainer);
	}

	queueHeaderVisibilityUpdate();
	autoResizeMessageInput();
	autoFitMessageInputWidth();
	syncComposerHeightVar();
	ensureFocusLayoutState();
	syncEmojiPickerViewport();
	if (
		document.body?.classList.contains('chat-focus-layout') &&
		!initialViewportFocusDone
	) {
		scrollToBottomAfterLayout({ passes: 2, delay: 80 });
	}
}

function handleWindowScroll() {
	if (!isSharedUserMenuEnabled()) {
		const userMenuDetails = document.querySelector('.user-menu-details');
		if (window.innerWidth <= 768 && userMenuDetails?.hasAttribute('open')) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	}

	queueHeaderVisibilityUpdate();
	if (document.body?.classList.contains('chat-focus-layout')) {
		syncFocusViewportMetrics();
	}
	refreshScrollButtonState();
}

/* Improved Logout Handler */
function handleLogout() {
	try {
		localStorage.removeItem('token');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');
		localStorage.removeItem('userEmail');

		if (socket) {
			socket.disconnect();
		}

		if (uptimeInterval) {
			clearInterval(uptimeInterval);
		}

		console.log('Déconnexion réussie, redirection vers browse-surveys.html');

		showNotification('Déconnexion réussie. Redirection...', 'success');

		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 1500);
	} catch (error) {
		console.warn('Erreur lors de la déconnexion:', error);
		showNotification('Erreur lors de la déconnexion', 'error');
		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 2000);
	}
}

/* Improved User Menu Initialization */
function initializeUserMenu() {
	const userMenuDetails = document.querySelector('.user-menu-details');
	const userMenuSummary = document.querySelector('.user-menu-summary');

	if (!userMenuDetails || !userMenuSummary) return;

	userMenuSummary.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();

		const isOpen = userMenuDetails.hasAttribute('open');
		if (isOpen) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
		} else {
			userMenuDetails.setAttribute('open', '');
			isUserMenuOpen = true;
		}
		updateChevronIcon();
		queueHeaderVisibilityUpdate();
	});

	const dropdown = userMenuDetails.querySelector('.user-dropdown');
	if (dropdown) {
		dropdown.addEventListener('click', (e) => {
			e.stopPropagation();
		});
	}

	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();

			document
				.getElementById('logout-confirm-modal')
				?.classList.remove('hidden');
			queueHeaderVisibilityUpdate();
		});
	}

	document.addEventListener('click', (e) => {
		const userMenu = document.querySelector('.user-menu-container');
		if (userMenu && !userMenu.contains(e.target) && isUserMenuOpen) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
			queueHeaderVisibilityUpdate();
		}
	});

	initializeLogoutModal();
}

/* Improved User UI Update */
function updateUserUI() {
	const token = localStorage.getItem('token');
	const userPseudo = localStorage.getItem('userPseudo');
	const userId = localStorage.getItem('userId');

	if (token && userId && userPseudo) {
		if (!currentUser) {
			currentUser = {
				id: userId,
				pseudo: userPseudo,
			};
		}

		const statusElement = document.getElementById('user-status');
		if (statusElement) {
			statusElement.innerHTML = `
        <i class="fas fa-circle status-pulse" style="color:${CONFIG.colors.success}"></i>
        <span class="status-text">${escapeHtml(
					t('chatroom.status.connected_as', 'Connecté en tant que {pseudo}', {
						pseudo: userPseudo,
					}),
				)}</span>
      `;
		}
	} else {
		const statusElement = document.getElementById('user-status');
		if (statusElement) {
			statusElement.innerHTML = `
        <i class="fas fa-circle" style="color:${CONFIG.colors.warning}"></i>
        <span class="status-text">${escapeHtml(
					t('chatroom.status.disconnected', 'Non connecté'),
				)}</span>
      `;
		}
	}
	syncComposerHeightVar();
}

/* Enhanced Application Initialization */
async function initApplication() {
	updateUserUI();

	try {
		initializeEventListeners();
	} catch (error) {
		console.error('Erreur initializeEventListeners:', error);
	}

	try {
		initializeChatFocusLayout();
	} catch (error) {
		console.error('Erreur initializeChatFocusLayout:', error);
	}

	ensureFocusLayoutState();
	queueHeaderVisibilityUpdate();
	initScrollToBottom();

	try {
		await initializeChat();
	} catch (error) {
		console.error('Erreur initializeChat:', error);
		showError('Erreur de chargement de la page');
	}

	syncFocusViewportMetrics();
	setTimeout(() => {
		ensureFocusLayoutState();
		syncFocusViewportMetrics();
		scrollToBottomAfterLayout({ passes: 4, delay: 85 });
	}, 220);

	initializeFooter();

	setTimeout(() => {
		const welcomeMessage = document.querySelector('.welcome-message');
		if (welcomeMessage) {
			welcomeMessage.style.animation = 'fadeIn 1s ease-out';
		}
	}, 500);
}

/* Enhanced Event Listeners */
function initializeEventListeners() {
	ensureReplyIndicatorPlacement();
	updateLeaveChatButtonUI();

	document.getElementById('leave-chat-btn')?.addEventListener('click', () => {
		leaveChatRoomAndExit();
	});

	document.getElementById('refresh-btn')?.addEventListener('click', () => {
		loadChatMessages();
		showNotification('Chat actualisé', 'info');

		const refreshBtn = document.getElementById('refresh-btn');
		refreshBtn.style.transform = 'rotate(360deg)';
		setTimeout(() => {
			refreshBtn.style.transform = '';
		}, 500);
	});

	document.getElementById('participants-btn')?.addEventListener('click', () => {
		togglePanel('participants-panel');
		updateOnlineUsersList();
	});

	document.getElementById('info-btn')?.addEventListener('click', () => {
		togglePanel('info-panel');
	});

	document.getElementById('send-btn')?.addEventListener('click', sendMessage);

	document.getElementById('login-btn')?.addEventListener('click', () => {
		window.location.href = '/api/auth/google';
	});

	const messageInput = document.getElementById('message-input');
	if (messageInput) {
		messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});
		messageInput.addEventListener('input', () => {
			updateCharCount();
			autoResizeMessageInput();
			autoFitMessageInputWidth();
		});
		messageInput.addEventListener('focus', () => {
			messageInput.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.2)';
		});
		messageInput.addEventListener('blur', () => {
			messageInput.style.boxShadow = '';
		});
		autoResizeMessageInput();
		autoFitMessageInputWidth();
		updateCharCount();
	}

	document
		.getElementById('emoji-btn')
		?.addEventListener('click', toggleEmojiPicker);
	document.getElementById('emoji-btn')?.setAttribute('aria-expanded', 'false');
	document
		.getElementById('emoji-btn')
		?.setAttribute('aria-controls', 'emoji-picker');
	document
		.getElementById('quick-hello-btn')
		?.setAttribute('aria-controls', 'quick-hello-thought');

	initializeQuickHelloAction();
	initializeNotificationSoundToggle();

	document.addEventListener('site:language-changed', () => {
		updateLeaveChatButtonUI();
		updateChatLayoutToggleUI();
	});

	document
		.getElementById('participants-btn')
		?.setAttribute('aria-controls', 'participants-panel');
	document
		.getElementById('info-btn')
		?.setAttribute('aria-controls', 'info-panel');

	document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
		if (confirm("Voulez-vous vraiment effacer l'affichage du chat ?")) {
			const container = document.getElementById('messages-container');
			if (container) {
				container.innerHTML =
					'<div class="welcome-message"><i class="fas fa-comments"></i><h3>Bienvenue dans le ChatRoomTv !</h3><p>Discutez en temps réel avec les autres participants</p></div>';
				showNotification('Chat effacé', 'info');
				lastDateSeparator = null;
				resetUnreadIncomingCount();
				refreshScrollButtonState(container);
			}
		}
	});

	document
		.getElementById('export-chat-btn')
		?.addEventListener('click', exportChat);

	document.querySelectorAll('.close-panel').forEach((btn) => {
		btn.addEventListener('click', () => {
			closeAllPanels();
			queueHeaderVisibilityUpdate();
		});
	});

	document
		.getElementById('panel-overlay')
		?.addEventListener('click', () => {
			closeAllPanels();
			queueHeaderVisibilityUpdate();
		});

	document.querySelectorAll('.emoji').forEach((emoji) => {
		emoji.addEventListener('click', (e) => {
			const emojiChar = emoji.dataset.emoji || emoji.textContent || '';
			const input = document.getElementById('message-input');
			if (input) {
				const start = input.selectionStart || 0;
				const end = input.selectionEnd || 0;
				input.value =
					input.value.slice(0, start) + emojiChar + input.value.slice(end);
				input.focus();
				input.selectionStart = input.selectionEnd = start + emojiChar.length;
				updateCharCount();
				autoResizeMessageInput();
				autoFitMessageInputWidth();

				emoji.style.transform = 'scale(1.3)';
				setTimeout(() => {
					emoji.style.transform = '';
				}, 200);
			}

			const picker = document.getElementById('emoji-picker');
			if (picker) {
				picker.classList.add('hidden');
				picker.setAttribute('aria-hidden', 'true');
			}
			const emojiBtn = document.getElementById('emoji-btn');
			emojiBtn?.setAttribute('aria-expanded', 'false');
			queueHeaderVisibilityUpdate();
		});
	});

	document.querySelector('.close-emoji')?.addEventListener('click', () => {
		const picker = document.getElementById('emoji-picker');
		if (picker) {
			picker.classList.add('hidden');
			picker.setAttribute('aria-hidden', 'true');
		}
		const emojiBtn = document.getElementById('emoji-btn');
		emojiBtn?.setAttribute('aria-expanded', 'false');
		queueHeaderVisibilityUpdate();
	});

	if (document.body?.dataset?.sharedUserMenu !== 'true') {
		initializeUserMenu();
	}

	window.addEventListener('resize', handleWindowResize);
	window.addEventListener('scroll', handleWindowScroll);
	queueHeaderVisibilityUpdate();

	setupKeyboardShortcuts();

	const cancelReplyBtn = document.getElementById('cancel-reply');
	if (cancelReplyBtn) {
		cancelReplyBtn.addEventListener('click', () => {
			cancelReply(true);
		});
	}

	const toggleUsersBtn = document.querySelector('.toggle-users-btn');
	if (toggleUsersBtn) {
		toggleUsersBtn.addEventListener('click', () => {
			const usersList = document.getElementById('mobile-users-list');
			const icon = toggleUsersBtn.querySelector('i');

			if (usersList.classList.contains('collapsed')) {
				usersList.classList.remove('collapsed');
				icon.classList.remove('fa-chevron-down');
				icon.classList.add('fa-chevron-up');
				isMobileUsersExpanded = true;
			} else {
				usersList.classList.add('collapsed');
				icon.classList.remove('fa-chevron-up');
				icon.classList.add('fa-chevron-down');
				isMobileUsersExpanded = false;
			}
		});
	}

	if (!chatLifecycleBound) {
		chatLifecycleBound = true;

		window.addEventListener('pageshow', (event) => {
			if (event.persisted) {
				updateUserUI();
				ensureRealtimeConnection({ reloadData: true });
			}
		});

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				ensureRealtimeConnection({ reloadData: false });
			}
		});

		window.addEventListener('online', () => {
			ensureRealtimeConnection({ reloadData: true });
		});
	}
}

/* Keyboard Shortcuts */
function setupKeyboardShortcuts() {
	document.addEventListener(
		'keydown',
		(event) => {
			if (event.key === 'Escape') {
				handleEscapeKey(event);
			}

			if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
				handleCtrlEnter(event);
			}

			if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
				event.preventDefault();
				const input = document.getElementById('message-input');
				input?.focus();
				showNotification('Champ de message sélectionné', 'info', 1000);
			}
		},
		true,
	);
}

function handleEscapeKey(event) {
	if (replyingToMessage) {
		event.preventDefault();
		cancelReply(true);
		return;
	}

	const picker = document.getElementById('emoji-picker');
	if (picker && !picker.classList.contains('hidden')) {
		event.preventDefault();
		picker.classList.add('hidden');
		picker.setAttribute('aria-hidden', 'true');
		document
			.getElementById('emoji-btn')
			?.setAttribute('aria-expanded', 'false');
		queueHeaderVisibilityUpdate();
		return;
	}

	const openPanel = document.querySelector('.side-panel.active');
	if (openPanel) {
		event.preventDefault();
		closeAllPanels();
		showNotification('Panel fermé', 'info', 1000);
		queueHeaderVisibilityUpdate();
	}

	const logoutModal = document.getElementById('logout-confirm-modal');
	if (logoutModal && !logoutModal.classList.contains('hidden')) {
		event.preventDefault();
		if (isSharedUserMenuEnabled() && window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(logoutModal);
		} else {
			logoutModal.classList.add('hidden');
		}
		queueHeaderVisibilityUpdate();
	}
}

function handleCtrlEnter(event) {
	const activeElement = document.activeElement;
	if (
		activeElement &&
		(activeElement.tagName === 'INPUT' ||
			activeElement.tagName === 'TEXTAREA') &&
		activeElement.id !== 'message-input'
	)
		return;

	event.preventDefault();
	event.stopPropagation();

	const input = document.getElementById('message-input');
	if (input && input.value.trim()) {
		sendMessage();

		const sendBtn = document.getElementById('send-btn');
		sendBtn.style.transform = 'scale(1.1)';
		setTimeout(() => {
			sendBtn.style.transform = '';
		}, 200);
	} else {
		input?.focus();
		showNotification("Veuillez taper un message d'abord", 'warning', 2000);
	}
}

/* Enhanced Chat Initialization */
async function initializeChat() {
	const params = new URLSearchParams(window.location.search);
	const surveyId = params.get('surveyId');
	const type = params.get('type');

	if (!surveyId || !type) {
		showError("Paramètres manquants dans l'URL");
		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 3000);
		return;
	}

	currentSurveyType = type;
	currentSurveyId = surveyId;
	initialViewportFocusDone = false;

	try {
		showLoading(true);
		const token = localStorage.getItem('token');
		const userPseudo = localStorage.getItem('userPseudo');
		const userId = localStorage.getItem('userId');

		if (!token || !userPseudo || !userId) {
			showError('Veuillez vous connecter pour accéder au chat');
			setTimeout(() => {
				window.location.href = '/api/auth/google';
			}, 2000);
			return;
		}

		currentUser = { id: userId, pseudo: userPseudo };
		initializeQuickHelloParticipationState();
		ensureFocusLayoutState();
		syncFocusViewportMetrics();

		await fetchSurveyInfo(surveyId, type);

		initializeSocket(surveyId);

		await Promise.all([loadChatMessages(surveyId), loadChatStats(surveyId)]);
		scrollToBottomAfterLayout({ passes: 6, delay: 70 });
		startQuickHelloPromptLoop();

		showLoading(false);
		const chatContainer = document.querySelector('.chat-container');
		if (chatContainer) {
			chatContainer.classList.remove('hidden');
			chatContainer.style.transition = 'opacity 0.28s ease';
			chatContainer.style.opacity = '0';
			window.requestAnimationFrame(() => {
				chatContainer.style.opacity = '1';
			});
			setTimeout(() => {
				chatContainer.style.removeProperty('transition');
				chatContainer.style.removeProperty('opacity');
				ensureFocusLayoutState();
				syncFocusViewportMetrics();
				scrollToBottomAfterLayout({ passes: 7, delay: 85 });
			}, 360);
		} else {
			ensureFocusLayoutState();
			syncFocusViewportMetrics();
			scrollToBottomAfterLayout({ passes: 4, delay: 80 });
		}

		addSystemMessage(
			`Bienvenue dans le chat du sondage "${currentSurvey?.theme || ''}"`,
			'info',
			{ forceScroll: true },
		);
		scrollToBottomAfterLayout({ passes: 6, delay: 95 });
		scheduleInitialChatViewportFocus({ passes: 8, delay: 120 });
		setTimeout(() => {
			scheduleInitialChatViewportFocus({ passes: 4, delay: 120 });
		}, 650);
	} catch (error) {
		console.error('Erreur initialisation chat:', error);
		showError("Erreur lors de l'initialisation du chat");
		showLoading(false);
	}
}

/* Fetch Survey Info */
async function fetchSurveyInfo(surveyId, type) {
	const token = localStorage.getItem('token');
	const endpoint =
		type === 'binary' ?
			`${CONFIG.api.endpoints.getSurvey}/${surveyId}`
		:	`${CONFIG.api.endpoints.getSurveyMultiple}/${surveyId}`;

	try {
		const response = await fetch(`${endpoint}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		currentSurvey = await response.json();

		const surveyTitle = document.getElementById('survey-title');
		const infoTheme = document.getElementById('info-theme');
		const infoQuestion = document.getElementById('info-question');
		const statusEl = document.getElementById('info-status');

		if (surveyTitle) {
			surveyTitle.textContent = currentSurvey.theme || 'Sondage';
			surveyTitle.title = currentSurvey.theme || '';
		}

		if (infoTheme) {
			infoTheme.textContent = currentSurvey.theme || 'Non spécifié';
			infoTheme.title = currentSurvey.theme || '';
		}

		if (infoQuestion) {
			infoQuestion.textContent = currentSurvey.question || 'Non spécifié';
			infoQuestion.title = currentSurvey.question || '';
		}

		if (statusEl) {
			statusEl.textContent = currentSurvey.isClosed ? 'Clôturé' : 'Actif';
			statusEl.className = `status-badge ${currentSurvey.isClosed ? 'closed' : 'active'}`;
			statusEl.title =
				currentSurvey.isClosed ?
					'Ce sondage est clôturé'
				:	'Ce sondage est actif';
		}

		setChatReadOnly(Boolean(currentSurvey?.isClosed), { showNotice: false });
	} catch (error) {
		console.error('Erreur fetchSurveyInfo:', error);
		showNotification(
			'Erreur de chargement des informations du sondage',
			'error',
		);
	}
}

/* Socket Initialization */
function initializeSocket(surveyId) {
	const token = localStorage.getItem('token');
	const userPseudo = localStorage.getItem('userPseudo');
	const userId = localStorage.getItem('userId');

	if (!token || !userPseudo || !userId) {
		showError('Informations utilisateur manquantes');
		return;
	}

	currentSurveyId = surveyId;
	currentUser = { id: userId, pseudo: userPseudo };

	if (socket) {
		disconnectSocket({ notifyServer: false });
	}

	socket = io(CONFIG.socket.url, {
		auth: { token },
		transports: ['websocket', 'polling'],
		reconnection: true,
		reconnectionAttempts: 12,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000,
	});

	socket.on('connect', () => {
		isConnected = true;
		console.log('Socket connected:', socket.id);

		joinCurrentChatRoom();

		updateConnectionStatus(true);
		showNotification('Connecté au chat', 'success', 2000);
	});

	socket.on('disconnect', (reason) => {
		isConnected = false;
		console.log('Socket disconnected:', reason);
		updateConnectionStatus(false);

		if (reason === 'io server disconnect') {
			showNotification('Déconnecté par le serveur. Reconnexion...', 'warning');
		} else {
			showNotification('Connexion perdue. Reconnexion...', 'warning');
		}
	});

	socket.on('connect_error', (error) => {
		console.error('Erreur connexion Socket.IO:', error);
		showNotification('Erreur de connexion au chat', 'error');
		updateConnectionStatus(false);
	});

	socket.on('reconnect', (attemptNumber) => {
		console.log('Reconnected after', attemptNumber, 'attempts');
		isConnected = true;
		updateConnectionStatus(true);
		showNotification('Reconnecté au chat', 'success');

		joinCurrentChatRoom();
	});

	socket.on('reconnect_error', (error) => {
		console.error('Reconnection error:', error);
	});

	socket.on('reconnect_failed', () => {
		showNotification(
			'Impossible de se reconnecter. Rafraîchissez la page.',
			'error',
		);
	});

	socket.on('newMessage', (message) => {
		addMessageToChat(message);
		updateMessageCount();

		if (message.replyTo && message.replyToInfo) {
			const repliedToUserId = message.replyToInfo.userId;
			if (
				repliedToUserId === currentUser?.id &&
				message.user.id !== currentUser.id
			) {
				showIntelligentNotification(
					message.user.pseudo,
					message.message,
					message.id,
				);
			}
		}

		if (
			notificationSoundEnabled &&
			!message.isSystemMessage &&
			message.user &&
			message.user.id !== currentUser?.id
		) {
			playNotificationSound();
		}
	});

	socket.on('messageUpdated', (data) => {
		updateMessageReactions(data);
	});

	socket.on('onlineUsersState', ({ users = [], onlineCount } = {}) => {
		onlineUsers.clear();
		users.forEach((user) => {
			if (!user?.userId) return;
			const normalizedId = String(user.userId);
			onlineUsers.set(normalizedId, {
				userId: normalizedId,
				pseudo: user.pseudo || 'Utilisateur',
				picture: user.picture || null,
			});
		});

		const count =
			typeof onlineCount === 'number' ? onlineCount : onlineUsers.size;
		updateOnlineUsersList(count);
	});

	socket.on('userJoined', (data) => {
		const pseudo = String(data?.pseudo || 'Un participant');
		showNotification(
			t('chatroom.toast.user_joined', '{pseudo} a rejoint le chat', { pseudo }),
			'info',
			2200,
		);
	});

	socket.on('userLeft', (data) => {
		const pseudo = String(data?.pseudo || 'Un participant');
		showNotification(
			t('chatroom.toast.user_left', '{pseudo} a quitté le chat', { pseudo }),
			'warning',
			2200,
		);
	});

	socket.on('error', (data) => {
		showNotification(data.message, 'error');
	});

	socket.on('replyNotification', (data) => {
		if (data.targetUserId === currentUser?.id) {
			showIntelligentNotification(data.fromUser, data.message, data.messageId);
		}
	});

}

/* Intelligent Notification System */
function showIntelligentNotification(fromUser, message, messageId) {
	const notification = document.createElement('div');
	notification.className = 'intelligent-notification';

	const truncatedMessage =
		message.length > 50 ? message.substring(0, 50) + '...' : message;

	notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-header">
        <i class="fas fa-reply"></i>
        <strong>${escapeHtml(fromUser)} vous a répondu</strong>
      </div>
      <div class="notification-body">
        <p>${escapeHtml(truncatedMessage)}</p>
      </div>
      <div class="notification-footer">
        <button class="btn-notification-view" data-message-id="${messageId}">
          <i class="fas fa-arrow-right"></i> Voir la réponse
        </button>
        <button class="btn-notification-dismiss">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>
  `;

	notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 320px;
    max-width: 90vw;
    background: linear-gradient(135deg, var(--card-bg), #1a2238);
    border: 2px solid var(--primary-color);
    border-radius: 1rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 1400;
    animation: slideInNotification 0.3s ease-out;
    overflow: hidden;
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  `;

	document.body.appendChild(notification);

	if (!document.getElementById('notification-styles')) {
		const style = document.createElement('style');
		style.id = 'notification-styles';
		style.textContent = `
      @keyframes slideInNotification {
        from { transform: translateX(100%); opacity: 0 }
        to { transform: translateX(0); opacity: 1 }
      }
      @keyframes slideOutNotification {
        from { transform: translateX(0); opacity: 1 }
        to { transform: translateX(100%); opacity: 0 }
      }
      .intelligent-notification .notification-content {
        padding: 1rem;
      }
      .intelligent-notification .notification-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
        color: var(--primary-color);
        font-size: 0.95rem;
      }
      .intelligent-notification .notification-body {
        margin-bottom: 1rem;
        font-size: 0.9rem;
        color: var(--text-secondary);
      }
      .intelligent-notification .notification-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }
      .intelligent-notification .btn-notification-view {
        flex: 1;
        padding: 0.5rem 1rem;
        background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
        border: none;
        border-radius: 0.75rem;
        color: white;
        cursor: pointer;
        font-size: 0.85rem;
        transition: var(--transition);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      .intelligent-notification .btn-notification-view:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(99, 102, 241, 0.3);
      }
      .intelligent-notification .btn-notification-dismiss {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--glass-border);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: var(--transition);
      }
      .intelligent-notification .btn-notification-dismiss:hover {
        background: rgba(239, 68, 68, 0.1);
        color: var(--danger-color);
        transform: rotate(90deg);
      }
    `;
		document.head.appendChild(style);
	}

	const viewBtn = notification.querySelector('.btn-notification-view');
	const dismissBtn = notification.querySelector('.btn-notification-dismiss');

	viewBtn.addEventListener('click', () => {
		scrollToMessage(messageId);
		removeNotification(notification);
	});

	dismissBtn.addEventListener('click', () => {
		removeNotification(notification);
	});

	setTimeout(() => {
		if (notification.parentNode) {
			removeNotification(notification);
		}
	}, 10000);
}

function removeNotification(notification) {
	notification.style.animation = 'slideOutNotification 0.3s ease-out';
	setTimeout(() => {
		if (notification.parentNode) {
			notification.parentNode.removeChild(notification);
		}
	}, 300);
}

/* Notification sound */
function playNotificationSound() {
	if (!notificationSoundEnabled) return;

	try {
		const audioContext = ensureNotificationAudioContext();
		if (!audioContext) return;
		if (audioContext.state === 'suspended') {
			audioContext.resume().catch(() => {});
		}

		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();
		const startTime = audioContext.currentTime;

		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);

		oscillator.frequency.value = 800;
		oscillator.type = 'sine';

		gainNode.gain.setValueAtTime(0.08, startTime);
		gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);

		oscillator.start(startTime);
		oscillator.stop(startTime + 0.1);
	} catch (error) {
		console.log('Notification sound unavailable');
	}
}

/* Load Messages */
async function loadChatMessages(surveyId = null) {
	try {
		if (!surveyId) {
			surveyId = new URLSearchParams(window.location.search).get('surveyId');
		}

		const container = document.getElementById('messages-container');
		if (!container) return;

		const token = localStorage.getItem('token');
		const response = await fetch(
			`${CONFIG.api.endpoints.getChatMessages}/${surveyId}/messages?type=${currentSurveyType}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			},
		);

		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();
		const messages = Array.isArray(data.messages) ? data.messages : [];
		const hasCurrentUserHistory = messages.some(
			(msg) => !msg?.isSystemMessage && isMessageFromCurrentUser(msg),
		);
		if (hasCurrentUserHistory) {
			setQuickHelloParticipation(true, {
				persist: true,
				source: 'history',
			});
		}
		container.innerHTML = '';
		lastDateSeparator = null;

		if (messages.length > 0) {
			messages.forEach((msg) => addMessageToChat(msg, true));
		} else {
			container.innerHTML = `
        <div class="welcome-message">
          <i class="fas fa-comments"></i>
          <h3>Soyez le premier à participer !</h3>
          <p>Commencez la discussion avec les autres participants</p>
        </div>
      `;
		}

		updateMessageCount(
			data.pagination?.totalMessages ||
				messages.length,
		);
		resetUnreadIncomingCount();
		refreshScrollButtonState(container);

		const surveyClosed =
			Boolean(data.surveyClosed) ||
			Boolean(data.surveyInfo?.isClosed) ||
			Boolean(currentSurvey?.isClosed);
		setChatReadOnly(surveyClosed, { showNotice: surveyClosed });
		syncFocusViewportMetrics();
		scrollToBottomAfterLayout({ passes: 5, delay: 80 });

	} catch (error) {
		console.error('Erreur loadChatMessages:', error);
		showNotification(
			'Erreur de chargement des messages: ' + (error.message || ''),
			'error',
		);
	}
}

function getHeaderOffsetHeight() {
	const subheader = document.getElementById('chat-subheader');
	if (!subheader) return 0;
	if (document.body.classList.contains('header-hidden')) return 0;

	const computed = window.getComputedStyle(subheader);
	const position = computed.position;
	if (position === 'fixed') {
		return Math.ceil(subheader.getBoundingClientRect().height);
	}

	if (position === 'sticky' && window.scrollY <= HEADER_TOP_REVEAL) {
		return Math.ceil(subheader.getBoundingClientRect().height);
	}
	return 0;
}

function isLastMessageVisible(container) {
	const messages = container.querySelectorAll('.message');
	if (!messages.length) return true;
	const lastMessage = messages[messages.length - 1];
	const containerRect = container.getBoundingClientRect();
	const messageRect = lastMessage.getBoundingClientRect();
	return (
		messageRect.bottom <= containerRect.bottom + 2 &&
		messageRect.top >= containerRect.top - 2
	);
}

function applyInitialMessagesFocus({ passes = 4, delay = 80 } = {}) {
	const container = document.getElementById('messages-container');
	if (!container) return;
	const isFocusLayout = document.body?.classList.contains('chat-focus-layout');

	let remaining = Math.max(1, Number(passes) || 1);

	const step = () => {
		if (isUserMenuExpanded()) {
			window.requestAnimationFrame(() => {
				setTimeout(step, delay);
			});
			return;
		}

		queueHeaderVisibilityUpdate();
		if (isFocusLayout) {
			scrollToLatestMessage({ retries: 2, smooth: false });
			remaining -= 1;
			if (remaining <= 0 || isLastMessageVisible(container)) return;
			window.requestAnimationFrame(() => {
				setTimeout(step, delay);
			});
			return;
		}

		const headerOffset = getHeaderOffsetHeight();
		const rect = container.getBoundingClientRect();
		const targetY = Math.max(
			0,
			Math.floor(window.scrollY + rect.top - headerOffset - 8),
		);
		window.scrollTo({ top: targetY, behavior: 'auto' });
		scrollToLatestMessage({ retries: 2 });

		remaining -= 1;
		if (remaining <= 0 || isLastMessageVisible(container)) return;
		window.requestAnimationFrame(() => {
			setTimeout(step, delay);
		});
	};

	step();
}

function scheduleInitialChatViewportFocus({ passes = 6, delay = 120 } = {}) {
	if (initialViewportFocusDone) return;

	const container = document.getElementById('messages-container');
	const chatContainer = document.querySelector('.chat-container');
	if (!container || !chatContainer) return;
	const isFocusLayout = document.body?.classList.contains('chat-focus-layout');

	let remaining = Math.max(2, Number(passes) || 4);
	const run = () => {
		if (initialViewportFocusDone) return;
		if (isUserMenuExpanded()) {
			window.requestAnimationFrame(() => {
				setTimeout(run, delay);
			});
			return;
		}

		const isContainerVisible =
			!chatContainer.classList.contains('hidden') &&
			chatContainer.getBoundingClientRect().height > 0;
		if (!isContainerVisible) {
			if (remaining <= 0) return;
			remaining -= 1;
			window.requestAnimationFrame(() => {
				setTimeout(run, delay);
			});
			return;
		}

		queueHeaderVisibilityUpdate();
		if (isFocusLayout) {
			syncFocusViewportMetrics();
			scrollToBottomAfterLayout({
				passes: Math.max(4, remaining),
				delay: Math.max(70, delay - 20),
			});
			initialViewportFocusDone = true;
			return;
		}

		const headerOffset = getHeaderOffsetHeight();
		const rect = container.getBoundingClientRect();
		const targetY = Math.max(
			0,
			Math.floor(window.scrollY + rect.top - headerOffset - 8),
		);
		window.scrollTo({ top: targetY, behavior: 'auto' });
		scrollToLatestMessage({ retries: 2, smooth: false });

		remaining -= 1;
		if (remaining <= 0 || isLastMessageVisible(container)) {
			initialViewportFocusDone = true;
			return;
		}

		window.requestAnimationFrame(() => {
			setTimeout(run, delay);
		});
	};

	window.requestAnimationFrame(() => {
		setTimeout(run, 120);
	});
}

/* Enhanced Add Message to Chat */
function addMessageToChat(message, isHistory = false) {
	const container = document.getElementById('messages-container');
	if (!container) return;

	const messageId = message.id || message._id || '';
	if (
		messageId &&
		document.querySelector(`.message[data-message-id="${messageId}"]`)
	) {
		return;
	}

	const isCurrentUser = isMessageFromCurrentUser(message);
	if (isCurrentUser && !message.isSystemMessage) {
		setQuickHelloParticipation(true, {
			persist: true,
			source: isHistory ? 'history-render' : 'live-render',
		});
	}
	const messageElement = document.createElement('div');
	messageElement.className = `message ${isCurrentUser ? 'user-message' : ''} ${
		message.isSystemMessage ? 'system-message' : ''
	}`;
	messageElement.dataset.messageId = messageId;
	if (isCurrentUser) {
		messageElement.classList.add('self-message');
	} else if (!message.isSystemMessage) {
		messageElement.classList.add('other-message');
	}

	const messageDate = new Date(message.createdAt || Date.now());
	const formattedTime = formatMessageClock(messageDate);
	const formattedDate = formatMessageDate(messageDate);
	const dateKey = getDateKey(messageDate);

	if (!isHistory && dateKey !== lastDateSeparator) {
		createDateSeparator(messageDate);
		lastDateSeparator = dateKey;
	}

	const avatarUrl =
		message.user?.picture ||
		'https://ui-avatars.com/api/?name=' +
			encodeURIComponent(message.user?.pseudo || 'Utilisateur') +
			'&background=6366f1&color=fff';

	const isReply = message.replyTo && message.replyToInfo;

	messageElement.innerHTML = `
    <div class="message-avatar">
      <img src="${avatarUrl}" alt="${message.user?.pseudo || 'Utilisateur'}" 
           title="${message.user?.pseudo || 'Utilisateur'}"
           loading="lazy">
    </div>
    <div class="message-content">
      <div class="message-header">
        <div class="message-user">
          <span title="${message.user?.pseudo || 'Utilisateur'}">
            ${escapeHtml(message.user?.pseudo || 'Utilisateur')}
          </span>
          ${isCurrentUser ? '<span class="you-badge" title="C\'est vous">Vous</span>' : ''}
          ${
						isReply ?
							'<span class="reply-badge" title="Message de réponse"><i class="fas fa-reply"></i> Réponse</span>'
						:	''
					}
        </div>
        <div class="message-time" title="${messageDate.toLocaleString(getIntlLocale())}">
          <i class="far fa-clock"></i> ${formattedTime}
        </div>
      </div>

      ${
				isReply ?
					`
        <div class="reply-preview" onclick="scrollToMessage('${
					message.replyToInfo.messageId || ''
				}')" title="Cliquer pour voir le message original">
          <div class="reply-preview-content">
            <strong><i class="fas fa-reply fa-rotate-180"></i> ${escapeHtml(
							message.replyToInfo.pseudo || 'Utilisateur',
						)}</strong>
            <p class="reply-text">${escapeHtml(
							(message.replyToInfo.message || '').substring(0, 100),
						)}${
							(message.replyToInfo.message || '').length > 100 ? '...' : ''
						}</p>
          </div>
        </div>
      `
				:	''
			}

      <div class="message-text">${escapeHtml(message.message || '')}</div>
      
      <div class="message-date" title="${messageDate.toLocaleDateString(
				getIntlLocale(),
				{
					weekday: 'long',
					day: 'numeric',
					month: 'long',
					year: 'numeric',
				},
			)}">
        ${formattedDate}
      </div>

      ${
				!message.isSystemMessage && !chatReadOnly ?
					`
        <div class="message-actions d-flex flex-wrap gap-2">
          <button class="message-reaction ${
						message.userLiked ? 'liked' : ''
					}" data-action="like" data-message-id="${message.id || ''}" 
                     title="${message.userLiked ? 'Retirer le like' : 'Aimer ce message'}">
            <i class="fas fa-thumbs-up"></i> <span class="like-count">${
							message.likeCount || 0
						}</span>
          </button>
          <button class="message-reaction" data-action="reply" data-message-id="${
						message.id || ''
					}" title="Répondre à ce message">
            <i class="fas fa-reply"></i> Répondre
          </button>
        </div>
      `
				:	''
			}
    </div>
  `;

	container.appendChild(messageElement);

	if (!message.isSystemMessage && !chatReadOnly) {
		const likeBtn = messageElement.querySelector('[data-action="like"]');
		const replyBtn = messageElement.querySelector('[data-action="reply"]');

		likeBtn &&
			likeBtn.addEventListener('click', () =>
				handleMessageReaction(message.id || message._id, 'like'),
			);
		replyBtn &&
			replyBtn.addEventListener('click', () =>
				handleMessageReply(
					message.id || message._id,
					message.user?.pseudo,
					message.message,
					message.user?.id,
				),
			);
	}

	if (!isHistory) {
		scrollToLatestMessage({ smooth: false, retries: 2 });
		resetUnreadIncomingCount();
		refreshScrollButtonState(container);
	}

	if (!isHistory) {
		messageElement.style.animation = 'messageAppear 0.3s ease-out';
	}
}

/* Scroll to Message */
function scrollToMessage(messageId) {
	const messageElement = document.querySelector(
		`[data-message-id="${messageId}"]`,
	);
	if (messageElement) {
		messageElement.classList.add('highlighted');
		messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

		messageElement.style.transform = 'scale(1.02)';
		setTimeout(() => {
			messageElement.style.transform = '';
		}, 300);

		setTimeout(() => {
			messageElement.classList.remove('highlighted');
		}, 3000);
	} else {
		showNotification(
			"Le message original n'est plus visible dans le chat",
			'info',
		);
	}
}

/* Load Stats */
async function loadChatStats(surveyId) {
	try {
		const token = localStorage.getItem('token');
		const response = await fetch(
			`${CONFIG.api.endpoints.getChatStats}/${surveyId}/stats?type=${currentSurveyType}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			},
		);

		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();
		const activeAuthors = data.activeUsers || 0;
		const online = typeof data.onlineUsers === 'number' ? data.onlineUsers : 0;
		if (typeof data.isClosed === 'boolean') {
			setChatReadOnly(data.isClosed, { showNotice: data.isClosed });
		}

		const participantsDisplayed = Math.max(activeAuthors, online);
		if (onlineUsers.size > 0) return;

		const activeUsersEl = document.getElementById('active-users');
		const participantsCountEl = document.getElementById('participants-count');
		const onlineCountEl = document.getElementById('online-count');
		const mobileOnlineCount = document.getElementById('mobile-online-count');

		if (activeUsersEl) {
			activeUsersEl.textContent = participantsDisplayed;
			activeUsersEl.title = `${participantsDisplayed} participant(s) actif(s)`;
		}

		if (participantsCountEl) {
			participantsCountEl.textContent = online || participantsDisplayed;
		}

		if (onlineCountEl) {
			onlineCountEl.textContent = online || participantsDisplayed;
			onlineCountEl.title = `${online || participantsDisplayed} utilisateur(s) en ligne`;
		}

		if (mobileOnlineCount) {
			mobileOnlineCount.textContent = online || participantsDisplayed;
		}
	} catch (error) {
		console.error('Erreur loadChatStats:', error);
	}
}

function emitChatMessage(message, { includeReply = true } = {}) {
	const safeMessage = String(message || '').trim();
	const params = new URLSearchParams(window.location.search);
	const surveyId = params.get('surveyId');

	if (!safeMessage) return false;

	if (safeMessage.length > 500) {
		showNotification('Le message est trop long (max 500 caractères)', 'error');
		return false;
	}

	if (!isConnected || !socket) {
		showNotification('Connexion au chat perdue', 'error');
		return false;
	}

	if (chatReadOnly || currentSurvey?.isClosed) {
		showNotification(
			t(
				'chatroom.read_only.send_blocked',
				'Le sondage est cloture. Vous ne pouvez plus envoyer de messages.',
			),
			'error',
		);
		return false;
	}

	if (!currentUser?.id || !currentUser?.pseudo) {
		showNotification('Utilisateur non identifié', 'error');
		return false;
	}

	const messageData = {
		surveyId,
		userId: currentUser.id,
		pseudo: currentUser.pseudo,
		message: safeMessage,
		type: currentSurveyType,
	};

	if (includeReply && replyingToMessage) {
		messageData.replyTo = replyingToMessage.id;
		messageData.replyToPseudo = replyingToMessage.pseudo;
		messageData.replyToText = replyingToMessage.text;
		messageData.replyToUserId = replyingToMessage.userId;

		socket.emit('replyNotification', {
			targetUserId: replyingToMessage.userId,
			fromUser: currentUser.pseudo,
			message: safeMessage,
			messageId: Date.now().toString(),
			surveyId,
		});
	}

	socket.emit('sendMessage', messageData);
	setQuickHelloParticipation(true, { persist: true, source: 'emit' });
	return true;
}

function hideQuickHelloThought({ immediate = false } = {}) {
	const thought = document.getElementById('quick-hello-thought');
	if (!thought) return;

	window.clearTimeout(quickHelloHideTimeoutId);
	quickHelloHideTimeoutId = null;

	thought.classList.remove('is-visible');
	if (immediate) {
		thought.classList.remove('is-fading');
		thought.classList.add('hidden');
		return;
	}

	thought.classList.add('is-fading');
	window.setTimeout(() => {
		thought.classList.remove('is-fading');
		thought.classList.add('hidden');
	}, 240);
}

function showQuickHelloThought() {
	const thought = document.getElementById('quick-hello-thought');
	if (!thought || document.hidden || !isQuickHelloPromptEligible()) return;

	thought.classList.remove('hidden', 'is-fading');
	thought.classList.add('is-visible');

	window.clearTimeout(quickHelloHideTimeoutId);
	quickHelloHideTimeoutId = window.setTimeout(() => {
		hideQuickHelloThought();
	}, QUICK_HELLO_VISIBLE_MS);
}

function stopQuickHelloPromptLoop() {
	window.clearInterval(quickHelloIntervalId);
	quickHelloIntervalId = null;
	window.clearTimeout(quickHelloHideTimeoutId);
	quickHelloHideTimeoutId = null;
}

function startQuickHelloPromptLoop() {
	stopQuickHelloPromptLoop();
	if (!isQuickHelloPromptEligible()) {
		hideQuickHelloThought({ immediate: true });
		return;
	}
	if (document.hidden) return;
	quickHelloIntervalId = window.setInterval(() => {
		showQuickHelloThought();
	}, QUICK_HELLO_INTERVAL_MS);
}

function sendQuickHelloMessage() {
	if (chatReadOnly) {
		showNotification(
			t(
				'chatroom.read_only.send_blocked',
				'Le sondage est cloture. Vous ne pouvez plus envoyer de messages.',
			),
			'info',
			1600,
		);
		return;
	}

	const fallbackPseudo = String(
		currentUser?.pseudo || localStorage.getItem('userPseudo') || 'Utilisateur',
	);
	const helloMessage = t(
		'chatroom.quick_hello.message_template',
		'{pseudo} a dit bonjour',
		{ pseudo: fallbackPseudo },
	);

	if (!emitChatMessage(helloMessage, { includeReply: false })) return;

	hideQuickHelloThought({ immediate: true });
	showNotification(t('chatroom.quick_hello.label', 'Dire bonjour'), 'success', 1100);
}

function initializeQuickHelloAction() {
	const quickHelloBtn = document.getElementById('quick-hello-btn');
	const quickHelloThought = document.getElementById('quick-hello-thought');
	if (!quickHelloBtn || !quickHelloThought) return;

	initializeQuickHelloParticipationState();

	quickHelloBtn.addEventListener('click', () => {
		sendQuickHelloMessage();
	});

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopQuickHelloPromptLoop();
			hideQuickHelloThought({ immediate: true });
			return;
		}
		if (isQuickHelloPromptEligible()) {
			startQuickHelloPromptLoop();
		}
	});

	startQuickHelloPromptLoop();
}

/* Send Message */
function sendMessage() {
	const messageInput = document.getElementById('message-input');
	const message = messageInput?.value.trim();

	if (!message) {
		showNotification('Le message ne peut pas être vide', 'warning');
		messageInput?.focus();
		return;
	}

	if (!emitChatMessage(message, { includeReply: true })) return;

	messageInput.value = '';
	updateCharCount();
	autoResizeMessageInput();
	autoFitMessageInputWidth();

	if (replyingToMessage) {
		cancelReply(false);
	}

	messageInput.focus();

	const sendBtn = document.getElementById('send-btn');
	if (sendBtn) {
		sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
		setTimeout(() => {
			sendBtn.innerHTML =
				'<i class="fas fa-paper-plane"></i> <span class="d-none d-md-inline">Envoyer</span>';
		}, 500);
	}
}
/* Enhanced Reply Handling */
function handleMessageReply(messageId, userPseudo, messageText, userId) {
	try {
		if (chatReadOnly) {
			showNotification(
				t(
					'chatroom.read_only.notice',
					'Le sondage est cloture. Le chat est en lecture seule.',
				),
				'info',
			);
			return;
		}

		if (!messageId || !userPseudo || !messageText) {
			showNotification('Informations du message incomplètes', 'error');
			return;
		}

		const originalMessage = document.querySelector(
			`[data-message-id="${messageId}"]`,
		);
		if (!originalMessage) {
			showNotification('Le message original est introuvable', 'error');
			return;
		}

		if (replyingToMessage && replyingToMessage.id === messageId) {
			showNotification('Vous répondez déjà à ce message', 'warning');
			return;
		}

		replyingToMessage = {
			id: messageId,
			pseudo: userPseudo,
			text: messageText,
			userId: userId,
			timestamp: Date.now(),
		};

		updateReplyUI();

		const input = document.getElementById('message-input');
		if (input) {
			input.focus();
			input.select();
		}

		showNotification(`Réponse à ${userPseudo}`, 'info', 3000);

		originalMessage.classList.add('highlighted');
		setTimeout(() => {
			originalMessage.classList.remove('highlighted');
		}, 3000);
	} catch (error) {
		console.error('Erreur handleMessageReply:', error);
		showNotification('Erreur lors de la préparation de la réponse', 'error');
	}
}

function updateReplyUI() {
	const replyIndicator = document.getElementById('reply-indicator');
	const replyToUser = document.getElementById('reply-to-user');
	const replyToText = document.getElementById('reply-to-text');
	const messageInput = document.getElementById('message-input');

	if (!replyIndicator || !replyToUser || !replyToText) return;

	if (replyingToMessage) {
		replyToUser.textContent = replyingToMessage.pseudo;
		replyToText.textContent =
			replyingToMessage.text.length > 100 ?
				replyingToMessage.text.substring(0, 100) + '...'
			:	replyingToMessage.text;

		replyIndicator.classList.remove('hidden');
		replyIndicator.style.animation = 'slideIn 0.3s ease-out';

		if (messageInput) {
			messageInput.placeholder = `Répondre à ${replyingToMessage.pseudo}...`;
			messageInput.focus();
			autoFitMessageInputWidth();
		}
	} else {
		replyIndicator.classList.add('hidden');
		if (messageInput) {
			messageInput.placeholder =
				'Tapez votre message ici... (Entrée pour envoyer, Shift+Entrée pour aller à la ligne)';
			autoFitMessageInputWidth();
		}
	}
	syncComposerHeightVar();
}

function cancelReply(showNote = true) {
	const wasReplying = !!replyingToMessage;
	replyingToMessage = null;
	updateReplyUI();

	if (showNote && wasReplying) {
		showNotification('Réponse annulée', 'info');
	}
}

/* Reactions */
function handleMessageReaction(messageId, action) {
	if (chatReadOnly) {
		showNotification(
			t(
				'chatroom.read_only.chat_only',
				'Le chat est en lecture seule.',
			),
			'info',
		);
		return;
	}

	if (!socket || !isConnected) {
		showNotification('Connexion au chat perdue. Réessayez.', 'error');
		return;
	}

	socket.emit('messageReaction', {
		messageId,
		userId: currentUser?.id,
		action,
	});

	const messageElement = document.querySelector(
		`[data-message-id="${messageId}"]`,
	);
	if (messageElement) {
		const reactionBtn = messageElement.querySelector(
			`[data-action="${action}"]`,
		);
		if (reactionBtn) {
			reactionBtn.style.transform = 'scale(1.2)';
			setTimeout(() => {
				reactionBtn.style.transform = '';
			}, 300);
		}
	}
}

function updateMessageReactions(data) {
	const messageElements = document.querySelectorAll(
		`[data-message-id="${data.messageId}"]`,
	);
	if (!messageElements.length) return;

	const isActorCurrentUser =
		!!currentUser?.id &&
		!!data.actorUserId &&
		String(currentUser.id) === String(data.actorUserId);

	messageElements.forEach((messageElement) => {
		const likeBtn = messageElement.querySelector('[data-action="like"]');

		if (likeBtn) {
			const likeCount = likeBtn.querySelector('.like-count');
			if (likeCount) likeCount.textContent = data.likeCount || 0;
			if (isActorCurrentUser) {
				likeBtn.classList.toggle('liked', !!data.actorUserLiked);
				likeBtn.title =
					data.actorUserLiked ? 'Retirer le like' : 'Aimer ce message';
			}
		}

		messageElement.style.animation = 'highlightMessage 0.5s ease';
		setTimeout(() => {
			messageElement.style.animation = '';
		}, 500);
	});
}

/* Online Users Management */
function addOnlineUser(user) {
	if (!user || !user.userId) return;

	onlineUsers.set(user.userId, user);
	updateOnlineUsersList();

	const badge = document.getElementById('online-count');
	if (badge) {
		badge.style.transform = 'scale(1.2)';
		setTimeout(() => {
			badge.style.transform = '';
		}, 300);
	}
}

function removeOnlineUser(userId) {
	onlineUsers.delete(userId);
	updateOnlineUsersList();
}

function updateOnlineUsersList(onlineCountOverride = null) {
	const usersList = document.getElementById('users-list');
	const participantsList = document.getElementById('participants-list');
	const mobileUsersList = document.getElementById('mobile-users-list');

	if (usersList) usersList.innerHTML = '';
	if (participantsList) participantsList.innerHTML = '';
	if (mobileUsersList) mobileUsersList.innerHTML = '';

	onlineUsers.forEach((user) => {
		const pseudo = user.pseudo || 'Utilisateur';
		const avatarUrl =
			user.picture ||
			'https://ui-avatars.com/api/?name=' +
				encodeURIComponent(pseudo) +
				'&background=6366f1&color=fff';

		const userElement = document.createElement('div');
		userElement.className = 'user-item';
		userElement.innerHTML = `
      <div class="user-avatar">
        <img src="${avatarUrl}" alt="${pseudo}" title="${pseudo}">
      </div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(pseudo)}</div>
        <div class="user-status">
          <span class="status-dot"></span> En ligne
        </div>
      </div>
    `;

		if (usersList) usersList.appendChild(userElement);
		if (participantsList)
			participantsList.appendChild(userElement.cloneNode(true));
		if (mobileUsersList)
			mobileUsersList.appendChild(userElement.cloneNode(true));
	});

	const count =
		typeof onlineCountOverride === 'number' ?
			onlineCountOverride
		:	onlineUsers.size;

	const countElements = [
		document.getElementById('participants-count'),
		document.getElementById('online-count'),
		document.getElementById('active-users'),
		document.getElementById('mobile-online-count'),
	];

	countElements.forEach((el) => {
		if (el) {
			el.textContent = count;
			el.title = `${count} utilisateur(s) en ligne`;
		}
	});
}

function autoResizeMessageInput() {
	const input = document.getElementById('message-input');
	if (!input) return;

	input.style.height = 'auto';
	let maxHeight = 140;
	if (window.innerWidth <= 768) {
		maxHeight = 112;
	}
	const nextHeight = Math.min(maxHeight, Math.max(42, input.scrollHeight));
	input.style.height = `${nextHeight}px`;
	input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'visible';
	input.style.overflowX = 'visible';
	syncComposerHeightVar();
}

function autoFitMessageInputWidth() {
	const input = document.getElementById('message-input');
	if (!input) return;

	const container = input.closest('.input-container');
	if (!container) return;

	if (document.body?.classList.contains('chat-focus-layout')) {
		input.style.flex = '1 1 auto';
		input.style.width = '100%';
		input.style.maxWidth = '100%';
		return;
	}

	if (window.innerWidth <= 768) {
		input.style.flex = '1 1 auto';
		input.style.width = '100%';
		input.style.maxWidth = '100%';
		return;
	}

	const actions = container.querySelector('.input-actions');
	const actionsWidth = actions ? Math.ceil(actions.getBoundingClientRect().width) : 0;
	const containerStyle = window.getComputedStyle(container);
	const gap =
		Number.parseFloat(containerStyle.columnGap || '') ||
		Number.parseFloat(containerStyle.gap || '') ||
		0;
	const availableWidth = Math.max(260, Math.floor(container.clientWidth - actionsWidth - gap));

	const style = window.getComputedStyle(input);
	const probe = document.createElement('span');
	probe.setAttribute('aria-hidden', 'true');
	probe.style.position = 'fixed';
	probe.style.top = '-9999px';
	probe.style.left = '-9999px';
	probe.style.visibility = 'hidden';
	probe.style.whiteSpace = 'pre';
	probe.style.font = style.font;
	probe.style.letterSpacing = style.letterSpacing;
	probe.textContent = String(input.value || input.placeholder || ' ').split('\n').reduce(
		(longest, line) => (line.length > longest.length ? line : longest),
		' ',
	);

	document.body.appendChild(probe);
	const measuredTextWidth = Math.ceil(probe.getBoundingClientRect().width);
	probe.remove();

	const paddingX =
		(Number.parseFloat(style.paddingLeft || '') || 0) +
		(Number.parseFloat(style.paddingRight || '') || 0);
	const minimumWidth = Math.min(
		availableWidth,
		Math.max(210, Math.floor(availableWidth * 0.42)),
	);
	const desiredWidth = Math.min(
		availableWidth,
		Math.max(minimumWidth, measuredTextWidth + paddingX + 30),
	);

	input.style.flex = '0 1 auto';
	input.style.width = `${desiredWidth}px`;
	input.style.maxWidth = `${availableWidth}px`;
	syncComposerHeightVar();
}

function ensureReplyIndicatorPlacement() {
	const chatInputSection = document.querySelector('.chat-input-section');
	const replyIndicator = document.getElementById('reply-indicator');
	const inputContainer = chatInputSection?.querySelector('.input-container');
	if (!chatInputSection || !replyIndicator || !inputContainer) return;

	if (
		replyIndicator.parentElement !== chatInputSection ||
		replyIndicator.nextElementSibling !== inputContainer
	) {
		chatInputSection.insertBefore(replyIndicator, inputContainer);
	}
}

/* Character Counter */
function updateCharCount() {
	const input = document.getElementById('message-input');
	const counter = document.getElementById('char-count');

	if (!input || !counter) return;

	const count = input.value.length;
	counter.textContent = `${count}/500 caractères`;

	if (count > 490) {
		counter.style.color = CONFIG.colors.danger;
		counter.style.fontWeight = 'bold';
	} else if (count > 450) {
		counter.style.color = CONFIG.colors.warning;
		counter.style.fontWeight = 'bold';
	} else if (count > 400) {
		counter.style.color = CONFIG.colors.info;
		counter.style.fontWeight = 'normal';
	} else {
		counter.style.color = 'var(--text-secondary)';
		counter.style.fontWeight = 'normal';
	}
}

/* Message Counter */
function updateMessageCount(count) {
	const el = document.getElementById('message-count');
	if (!el) return;

	if (typeof count === 'number') {
		chatMessages = count;
	} else {
		chatMessages++;
	}

	el.textContent = chatMessages;
	el.title = `${chatMessages} message(s)`;

	el.style.transform = 'scale(1.2)';
	setTimeout(() => {
		el.style.transform = '';
	}, 300);
}

/* Connection Status */
function updateConnectionStatus(connected) {
	const status = document.getElementById('user-status');
	if (!status) return;

	const statusText = status.querySelector('.status-text');
	const statusIcon = status.querySelector('.fa-circle');

	if (connected) {
		statusIcon.style.color = CONFIG.colors.success;
		statusIcon.classList.add('status-pulse');
		if (statusText) {
			statusText.textContent = 'Connecté';
			statusText.title = 'Connecté au chat en temps réel';
		}
		status.style.borderColor = CONFIG.colors.success;
	} else {
		statusIcon.style.color = CONFIG.colors.danger;
		statusIcon.classList.remove('status-pulse');
		if (statusText) {
			statusText.textContent = 'Déconnecté';
			statusText.title = 'Déconnecté du chat';
		}
		status.style.borderColor = CONFIG.colors.danger;
	}
}

/* Panels Management */
function togglePanel(panelId) {
	const panel = document.getElementById(panelId);
	const overlay = document.getElementById('panel-overlay');

	if (!panel || !overlay) return;

	const picker = document.getElementById('emoji-picker');
	if (picker && !picker.classList.contains('hidden')) {
		picker.classList.add('hidden');
		picker.setAttribute('aria-hidden', 'true');
		document
			.getElementById('emoji-btn')
			?.setAttribute('aria-expanded', 'false');
	}

	const isVisible = panel.classList.contains('active');

	if (isVisible) {
		panel.classList.remove('active');
		panel.setAttribute('aria-hidden', 'true');
		overlay.classList.add('hidden');
		overlay.setAttribute('aria-hidden', 'true');
		document.body.style.overflow = '';
		showNotification('Panel fermé', 'info', 800);
	} else {
		document.querySelectorAll('.side-panel').forEach((p) => {
			p.classList.remove('active');
			p.setAttribute('aria-hidden', 'true');
		});

		panel.classList.add('active');
		panel.setAttribute('aria-hidden', 'false');
		overlay.classList.remove('hidden');
		overlay.removeAttribute('aria-hidden');
		document.body.style.overflow = 'hidden';

		if (panelId === 'participants-panel') {
			updateOnlineUsersList();
		}
	}

	queueHeaderVisibilityUpdate();
}

function closeAllPanels() {
	document.querySelectorAll('.side-panel').forEach((panel) => {
		panel.classList.remove('active');
		panel.setAttribute('aria-hidden', 'true');
	});

	const overlay = document.getElementById('panel-overlay');
	if (overlay) {
		overlay.classList.add('hidden');
		overlay.setAttribute('aria-hidden', 'true');
	}

	document.body.style.overflow = '';
	queueHeaderVisibilityUpdate();
}

function syncEmojiPickerViewport() {
	const picker = document.getElementById('emoji-picker');
	if (!picker || !document.body?.classList.contains('chat-focus-layout')) return;

	['top', 'left', 'right', 'bottom', 'width', 'max-height', 'z-index'].forEach(
		(prop) => picker.style.removeProperty(prop),
	);
}

/* Emoji Picker */
function toggleEmojiPicker() {
	const picker = document.getElementById('emoji-picker');
	if (!picker) return;

	closeAllPanels();

	const isHidden = picker.classList.contains('hidden');
	picker.classList.toggle('hidden', !isHidden);
	picker.setAttribute('aria-hidden', String(!isHidden));
	if (isHidden) {
		syncEmojiPickerViewport();
	}

	const emojiBtn = document.getElementById('emoji-btn');
	if (emojiBtn) {
		emojiBtn.setAttribute('aria-expanded', String(isHidden));
		emojiBtn.title = isHidden ? 'Fermer les émojis' : 'Ouvrir les émojis';
	}

	if (!isHidden) {
		showNotification('Sélecteur émojis ouvert', 'info', 1200);
	}

	queueHeaderVisibilityUpdate();
}

/* Helper Functions */
function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function showLoading(show) {
	const loading = document.getElementById('loading');
	const chatContainer = document.querySelector('.chat-container');

	if (loading) {
		loading.style.display = show ? 'flex' : 'none';
		if (show) {
			loading.style.animation = 'fadeIn 0.5s ease-out';
		}
	}

	if (chatContainer) {
		chatContainer.style.opacity = show ? '0.5' : '1';
		chatContainer.style.pointerEvents = show ? 'none' : 'auto';
	}
}

function showError(message) {
	console.error('Erreur:', message);
	showNotification(message, 'error');
}

/* Notification System */
function showNotification(message, type = 'info', duration = 5000) {
	const existing = document.querySelector('.notification');
	existing && existing.remove();
	const translatedMessage =
		window.SiteI18n?.translateText?.(String(message || '').trim()) ||
		String(message || '').trim();

	const notification = document.createElement('div');
	notification.className = `notification ${type}`;

	let icon = 'info-circle';
	let bgColor = CONFIG.colors.info;

	switch (type) {
		case 'error':
			icon = 'exclamation-circle';
			bgColor = CONFIG.colors.danger;
			break;
		case 'warning':
			icon = 'exclamation-triangle';
			bgColor = CONFIG.colors.warning;
			break;
		case 'success':
			icon = 'check-circle';
			bgColor = CONFIG.colors.success;
			break;
	}

	notification.innerHTML = `<i class="fas fa-${icon}"></i><span>${escapeHtml(translatedMessage)}</span>`;
	notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; padding: 1rem 1.25rem; border-radius: .75rem;
    background: ${bgColor}; color: white; display: flex; align-items: center; gap: .75rem;
    box-shadow: 0 6px 20px rgba(0,0,0,0.35); z-index:1300; animation: slideIn .3s ease-out;
    max-width: min(400px, 90vw); word-wrap: break-word;
  `;

	document.body.appendChild(notification);

	setTimeout(() => {
		if (notification.parentNode) {
			notification.style.animation = 'slideOut .3s ease-out';
			setTimeout(() => notification.remove(), 300);
		}
	}, duration);

	notification.addEventListener('click', () => {
		notification.style.animation = 'slideOut .3s ease-out';
		setTimeout(() => notification.remove(), 300);
	});
}

(function addNotificationKeyframes() {
	if (!document.getElementById('notif-keys')) {
		const style = document.createElement('style');
		style.id = 'notif-keys';
		style.textContent = `
      @keyframes slideIn { 
        from { transform: translateX(100%); opacity: 0 } 
        to { transform: translateX(0); opacity: 1 } 
      }
      @keyframes slideOut { 
        from { transform: translateX(0); opacity: 1 } 
        to { transform: translateX(100%); opacity: 0 } 
      }
    `;
		document.head.appendChild(style);
	}
})();

/* Enhanced Footer Functions */
function initializeNewsletter() {
	// Newsletter handled by shared/newsletter.js
}


function validateEmail(email) {
	const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return re.test(email);
}

function initializeLanguageSelector() {
	// Language selector handled by shared/i18n.js
}


function getLanguageName(code) {
	const languages = {
		fr: 'Français',
		en: 'Anglais',
		es: 'Espagnol',
		de: 'Allemand',
	};
	return languages[code] || code;
}

function initializeFooter() {
	// Newsletter handled by shared/newsletter.js
	// Language selector handled by shared/i18n.js

	const footer = document.querySelector('.site-footer');
	if (!footer) return;

	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					entry.target.style.opacity = '1';
					entry.target.style.transform = 'translateY(0)';
				}
			});
		},
		{ threshold: 0.1 },
	);

	footer.style.opacity = '0';
	footer.style.transform = 'translateY(20px)';
	footer.style.transition = 'opacity 0.8s ease, transform 0.8s ease';

	setTimeout(() => {
		observer.observe(footer);
	}, 1000);
}

/* Cleanup on page unload */
window.addEventListener('beforeunload', () => {
	if (uptimeInterval) {
		clearInterval(uptimeInterval);
	}
	window.clearTimeout(focusLayoutEnsureTimeoutId);
	stopQuickHelloPromptLoop();
	disconnectSocket({ notifyServer: true });
});

/* Global Error Handlers */
window.addEventListener('error', (event) => {
	console.error('Erreur globale:', event.error);
	showNotification('Une erreur est survenue', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
	console.error('Promesse non gérée:', event.reason);
	showNotification('Une erreur est survenue', 'error');
});

// Initialize the application
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initApplication);
} else {
	initApplication();
}





