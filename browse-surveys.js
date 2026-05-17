/** @format */

// =============================================================
// Configuration et variables d'état
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			allSurveys: '/api/all-surveys',
			authMe: '/api/auth/me',
			googleAuth: '/api/auth/google',
		},
	},
	colors: {
		primary: '#6366f1',
		secondary: '#8b5cf6',
		success: '#10b981',
		danger: '#ef4444',
		warning: '#f59e0b',
	},
	animation: {
		duration: 300, // ms
		easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
	},
};

let currentUser = null;
let isInitializing = true;
let lastFocusedElement = null;
let modalStack = [];
const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';
let surveys = []; // <-- AJOUTÉ
let filteredSurveys = []; // <-- AJOUTÉ

const i18n = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
let isBrowseAuthenticated = false;
const SURVEY_STATUS_PUBLIC = 'public';
const SURVEY_STATUS_PRIVATE = 'privée';

function toSafeVoteCount(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return Math.trunc(parsed);
}

function getSurveyVotesTotal(survey = {}) {
	return toSafeVoteCount(survey.totalVotes ?? survey.opinionsCount ?? 0);
}

function formatVotesText(votesCount) {
	return `${toSafeVoteCount(votesCount)} ${i18n(
		'survey_flash_binary.votes_label',
		'vote(s)',
	)}`;
}

function updateSurveyVotesDom(surveyId, surveyType, votesCount) {
	const safeId = String(surveyId || '').trim();
	const normalizedType = normalizeSurveyType(surveyType);
	if (!safeId) return;

	const selector =
		`.survey-card[data-id="${safeId}"][data-type="${normalizedType}"] .survey-votes-value`;
	document.querySelectorAll(selector).forEach((node) => {
		node.textContent = formatVotesText(votesCount);
	});
}

function escapeHtml(value) {
	return String(value || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

function updateBrowsePageTitle(isAuthenticated) {
	const titleElement = document.getElementById('browse-page-title');

	const key =
		isAuthenticated ?
			'headers.browse_surveys.title'
		:	'headers.browse_surveys.login_required';
	const fallback = isAuthenticated ? 'Explorer les sondages' : 'Connexion requise';
	const translated = i18n(key, fallback);

	if (titleElement) {
		titleElement.textContent = translated;
		titleElement.setAttribute('data-i18n', key);
		titleElement.setAttribute('data-i18n-fallback-text', fallback);
	}
	document.title = i18n('seo.home.title', 'Community - Plateforme de sondage interactif');
}

const SURVEYS_FETCH_TIMEOUT_MS = 15000;
const SURVEYS_FETCH_RETRY_DELAY_MS = 700;
const SURVEYS_FETCH_MAX_RETRIES = 1;
const SURVEY_FEED_REFRESH_DEBOUNCE_MS = 700;
const SURVEY_FEED_EVENT_CACHE_LIMIT = 250;
const GLOBAL_ERROR_NOTIFICATION_COOLDOWN_MS = 2500;
const BF_CACHE_ERROR_SUPPRESSION_MS = 1800;

let surveysFeedSocket = null;
let surveysFeedRefreshTimer = null;
let isSilentFeedRefreshInFlight = false;
const processedSurveyFeedEventIds = new Set();
let lastGlobalErrorNotificationAt = 0;
let suppressGlobalErrorNotificationsUntil = 0;

const waitMs = (duration) =>
	new Promise((resolve) => {
		setTimeout(resolve, duration);
	});

function extractHttpStatus(error) {
	const match = /^HTTP_(\d{3})$/.exec(String(error?.message || '').trim());
	return match ? Number(match[1]) : null;
}

function isLikelyNetworkFetchError(error) {
	if (!error) return false;
	if (error.name === 'TypeError') return true;

	const message = String(error.message || '').toLowerCase();
	return (
		message.includes('failed to fetch') ||
		message.includes('networkerror') ||
		message.includes('network request failed') ||
		message.includes('load failed') ||
		message.includes('fetch failed')
	);
}

function getGlobalErrorMessage(errorLike) {
	if (!errorLike) return '';
	if (typeof errorLike === 'string') return errorLike;
	return String(errorLike?.message || errorLike?.reason || '');
}

function shouldSuppressGlobalErrorMessage(message = '') {
	const normalized = String(message || '').trim().toLowerCase();
	if (!normalized) return false;

	return (
		normalized.includes('script error') ||
		normalized.includes('resizeobserver loop limit exceeded') ||
		normalized.includes('failed to fetch') ||
		normalized.includes('network request failed') ||
		normalized.includes('networkerror') ||
		normalized.includes('aborterror') ||
		normalized.includes('the operation was aborted') ||
		normalized.includes('load failed') ||
		normalized.includes('fetch failed')
	);
}

function shouldSuppressGlobalErrorNotification(message = '') {
	if (document.visibilityState === 'hidden') return true;
	if (Date.now() < suppressGlobalErrorNotificationsUntil) return true;
	return shouldSuppressGlobalErrorMessage(message);
}

function notifyGlobalErrorOnce(message, type = 'error') {
	const now = Date.now();
	if (
		now - lastGlobalErrorNotificationAt <
		GLOBAL_ERROR_NOTIFICATION_COOLDOWN_MS
	) {
		return;
	}
	lastGlobalErrorNotificationAt = now;
	showNotification(message, type);
}

function getAuthTokenForSocket() {
	return (
		window.SiteApi?.getToken?.() ||
		localStorage.getItem('token') ||
		localStorage.getItem('jwt_token') ||
		''
	)
		.toString()
		.trim();
}

function markSurveyFeedEventProcessed(eventId) {
	const normalizedEventId = String(eventId || '').trim();
	if (!normalizedEventId) return;
	processedSurveyFeedEventIds.add(normalizedEventId);

	if (processedSurveyFeedEventIds.size <= SURVEY_FEED_EVENT_CACHE_LIMIT) return;
	const oldest = processedSurveyFeedEventIds.values().next().value;
	if (oldest) processedSurveyFeedEventIds.delete(oldest);
}

function hasSurveyFeedEventBeenProcessed(eventId) {
	const normalizedEventId = String(eventId || '').trim();
	if (!normalizedEventId) return false;
	return processedSurveyFeedEventIds.has(normalizedEventId);
}

function normalizeSurveyType(type) {
	return type === 'multiple' ? 'multiple' : 'binary';
}

function normalizeSurveyStatus(status) {
	const value = String(status || '')
		.trim()
		.toLowerCase();
	if (
		value === SURVEY_STATUS_PRIVATE ||
		value === 'privee' ||
		value === 'private' ||
		value === 'privé' ||
		value === 'prive'
	) {
		return SURVEY_STATUS_PRIVATE;
	}
	return SURVEY_STATUS_PUBLIC;
}

function isPrivateSurveyStatus(status) {
	return normalizeSurveyStatus(status) === SURVEY_STATUS_PRIVATE;
}

function findSurveyIndexByIdentity(list, surveyId, type) {
	return list.findIndex((survey) => {
		if (String(survey?._id || '') !== String(surveyId || '')) return false;
		if (!type) return true;
		return normalizeSurveyType(survey?.type) === normalizeSurveyType(type);
	});
}

function rerenderSurveyListsPreservingFilter() {
	const searchInput = document.getElementById('survey-search');
	const searchTerm = String(searchInput?.value || '')
		.toLowerCase()
		.trim();

	if (searchTerm) {
		filterSurveys(searchTerm);
		return;
	}

	filteredSurveys = [...surveys];
	displaySurveys();
	updateSurveyCounts();
}

function applySurveyFeedLocalPatch(payload = {}) {
	const surveyId = String(payload.surveyId || '').trim();
	if (!surveyId) return false;

	const surveyType = normalizeSurveyType(payload.type);
	const hasIncomingStatus =
		payload.status !== null &&
		payload.status !== undefined &&
		String(payload.status).trim() !== '';
	const incomingStatus =
		hasIncomingStatus ? normalizeSurveyStatus(payload.status) : null;
	const action =
		payload.action === 'closed' ? 'closed'
		: payload.action === 'vote' ? 'vote'
		: 'created';
	const hasIncomingVotes =
		payload.totalOpinions !== null &&
		payload.totalOpinions !== undefined &&
		Number.isFinite(Number(payload.totalOpinions)) &&
		Number(payload.totalOpinions) >= 0;
	const incomingVotes = hasIncomingVotes ? toSafeVoteCount(payload.totalOpinions) : 0;

	const currentIndex = findSurveyIndexByIdentity(surveys, surveyId, surveyType);
	if (currentIndex >= 0) {
		const current = surveys[currentIndex];
		const currentVotes = getSurveyVotesTotal(current);
		const nextVotes =
			action === 'vote' ?
				current.isClosed ? currentVotes
				: hasIncomingVotes ? incomingVotes
				: currentVotes
			: action === 'closed' ?
				hasIncomingVotes ? incomingVotes
				: currentVotes
			: currentVotes;
		const nextSurvey = {
			...current,
			type: surveyType,
			explain: payload.explain === false ? false : true,
			status:
				incomingStatus || normalizeSurveyStatus(current.status || SURVEY_STATUS_PUBLIC),
			isClosed:
				action === 'closed' ? true
				: payload.isClosed !== undefined ? Boolean(payload.isClosed)
				: Boolean(current.isClosed),
			createdAt: payload.createdAt || current.createdAt,
			endedAt:
				action === 'closed' ?
					payload.endedAt || new Date().toISOString()
				:	payload.endedAt || current.endedAt || null,
			creatorName: payload.creatorName || current.creatorName || 'Administrateur',
			totalVotes: nextVotes,
			opinionsCount: nextVotes,
		};
		surveys[currentIndex] = nextSurvey;
		const filteredIndex = findSurveyIndexByIdentity(
			filteredSurveys,
			surveyId,
			surveyType,
		);
		if (filteredIndex >= 0) {
			filteredSurveys[filteredIndex] = nextSurvey;
		}

		if (action === 'vote') {
			updateSurveyVotesDom(surveyId, surveyType, nextVotes);
			return true;
		}

		rerenderSurveyListsPreservingFilter();
		return true;
	}

	if (action === 'vote') return false;
	if (action !== 'created') return false;
	const createdSurveyStatus = incomingStatus || SURVEY_STATUS_PUBLIC;
	if (isPrivateSurveyStatus(createdSurveyStatus)) return false;

	const createdAt = payload.createdAt || payload.occurredAt || new Date().toISOString();
	const initialVotes = hasIncomingVotes ? incomingVotes : 0;
	surveys.unshift({
		_id: surveyId,
		type: surveyType,
		explain: payload.explain === false ? false : true,
		status: createdSurveyStatus,
		isClosed: Boolean(payload.isClosed),
		createdAt,
		endedAt: payload.endedAt || null,
		theme: '#NouveauSondage',
		question: '',
		creatorName: payload.creatorName || 'Administrateur',
		opinionsCount: initialVotes,
		totalVotes: initialVotes,
		hasParticipated: false,
	});

	rerenderSurveyListsPreservingFilter();
	return true;
}

function scheduleSilentSurveyRefresh() {
	if (surveysFeedRefreshTimer) {
		clearTimeout(surveysFeedRefreshTimer);
	}

	surveysFeedRefreshTimer = setTimeout(async () => {
		surveysFeedRefreshTimer = null;
		if (isSilentFeedRefreshInFlight) return;
		isSilentFeedRefreshInFlight = true;
		try {
			await fetchSurveys({ retryCount: 0, silent: true });
		} finally {
			isSilentFeedRefreshInFlight = false;
		}
	}, SURVEY_FEED_REFRESH_DEBOUNCE_MS);
}

function handleSurveyFeedUpdateEvent(payload = {}) {
	if (hasSurveyFeedEventBeenProcessed(payload.eventId)) return;
	markSurveyFeedEventProcessed(payload.eventId);
	applySurveyFeedLocalPatch(payload);
	scheduleSilentSurveyRefresh();
}

function disconnectSurveyFeedSocket() {
	if (surveysFeedRefreshTimer) {
		clearTimeout(surveysFeedRefreshTimer);
		surveysFeedRefreshTimer = null;
	}

	if (surveysFeedSocket) {
		surveysFeedSocket.removeAllListeners();
		surveysFeedSocket.disconnect();
		surveysFeedSocket = null;
	}
}

function initializeSurveyFeedRealtime() {
	if (surveysFeedSocket || typeof window.io !== 'function') return;

	const token = getAuthTokenForSocket();
	if (!token) return;

	surveysFeedSocket = window.io({
		auth: { token },
		query: { token },
		transports: ['websocket', 'polling'],
	});

	surveysFeedSocket.on('connect', () => {
		scheduleSilentSurveyRefresh();
	});

	surveysFeedSocket.on('surveys:browse:update', (payload) => {
		handleSurveyFeedUpdateEvent(payload);
	});

	surveysFeedSocket.io?.on?.('reconnect', () => {
		scheduleSilentSurveyRefresh();
	});
}

// =============================================================
// Fonctions d'assistance générales
// =============================================================

/**
 * Masque un élément de manière accessible avec animation
 */
function hideElementAccessibly(element) {
	if (!element) return;

	element.style.transition = `opacity ${CONFIG.animation.duration}ms ${CONFIG.animation.easing}`;
	element.style.opacity = '0';

	setTimeout(() => {
		element.classList.add('hidden');
		element.style.opacity = '';
		element.style.transition = '';
	}, CONFIG.animation.duration);
}

/**
 * Affiche un élément de manière accessible avec animation
 */
function showElementAccessibly(element) {
	if (!element) return;

	element.classList.remove('hidden');
	element.style.opacity = '0';

	// Force reflow
	element.offsetHeight;

	element.style.transition = `opacity ${CONFIG.animation.duration}ms ${CONFIG.animation.easing}`;
	element.style.opacity = '1';

	setTimeout(() => {
		element.style.opacity = '';
		element.style.transition = '';
	}, CONFIG.animation.duration);
}

/**
 * Annonce un message aux lecteurs d'écran
 */
function announceToScreenReader(message, priority = 'polite') {
	const ariaLive = document.getElementById('aria-live-region');
	if (!ariaLive) {
		const liveRegion = document.createElement('div');
		liveRegion.id = 'aria-live-region';
		liveRegion.className = 'sr-only';
		liveRegion.setAttribute('aria-live', priority);
		liveRegion.setAttribute('aria-atomic', 'true');
		document.body.appendChild(liveRegion);
	}

	const liveRegion = document.getElementById('aria-live-region');
	liveRegion.textContent = message;

	// Effacer après un court délai pour permettre les annonces répétées
	setTimeout(() => {
		liveRegion.textContent = '';
	}, 1000);
}

// =============================================================
// Gestion de l'authentification et de l'interface
// =============================================================

/**
 * Met à jour l'interface en fonction de l'état d'authentification
 */
async function updateAuthUI(isAuthenticated, userData = null) {
	const loginBtn = document.getElementById('login-btn');
	const userMenu = document.getElementById('user-menu');
	const mySurveyBtn = document.getElementById('my-survey-button');
	const createSurveyBtn = document.getElementById('create-survey-btn');
	const loginPromptContainer = document.getElementById(
		'login-prompt-container',
	);
	const dashboard = document.querySelector('.dashboard-container');
	const searchContainer = document.getElementById('search-container');
	const useSharedUserMenu = USE_SHARED_USER_MENU();
	isBrowseAuthenticated = Boolean(isAuthenticated);
	updateBrowsePageTitle(isBrowseAuthenticated);

	const statusMessage =
		isAuthenticated ?
			'Vous etes maintenant connecte'
		: 	'Vous etes maintenant deconnecte';
	announceToScreenReader(statusMessage);

	if (isAuthenticated) {
		if (!useSharedUserMenu && loginBtn) hideElementAccessibly(loginBtn);
		if (!useSharedUserMenu && userMenu) showElementAccessibly(userMenu);
		if (mySurveyBtn) showElementAccessibly(mySurveyBtn);
		if (createSurveyBtn) showElementAccessibly(createSurveyBtn);
		if (loginPromptContainer) hideElementAccessibly(loginPromptContainer);
		if (dashboard) showElementAccessibly(dashboard);
		if (searchContainer) showElementAccessibly(searchContainer);

		if (userData) {
			updateUserInfo(userData);
		}
	} else {
		if (!useSharedUserMenu && loginBtn) showElementAccessibly(loginBtn);
		if (!useSharedUserMenu && userMenu) hideElementAccessibly(userMenu);
		if (mySurveyBtn) hideElementAccessibly(mySurveyBtn);
		if (createSurveyBtn) hideElementAccessibly(createSurveyBtn);
		if (loginPromptContainer) showElementAccessibly(loginPromptContainer);
		if (dashboard) hideElementAccessibly(dashboard);
		if (searchContainer) hideElementAccessibly(searchContainer);
	}
}

// =============================================================
// Gestion des états de chargement
// =============================================================

/**
 * Affiche/masque le spinner de chargement global
 */
function showLoading(show) {
	const loading = document.getElementById('loading');
	if (!loading) return;

	if (show) {
		loading.classList.remove('hidden');
		announceToScreenReader('Chargement en cours');
	} else {
		loading.classList.add('hidden');
	}
}

/**
 * Définit l'état de chargement d'un bouton
 */
function setButtonLoading(button, isLoading) {
	if (!button) return;

	const originalContent = button.dataset.originalContent || button.innerHTML;

	if (isLoading) {
		button.dataset.originalContent = originalContent;
		button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
	} else {
		button.innerHTML = originalContent;
		button.disabled = false;
		button.removeAttribute('aria-busy');
	}
}

// =============================================================
// Gestion de la session
// =============================================================

/**
 * Gère l'expiration de session
 */
function handleSessionExpired() {
	disconnectSurveyFeedSocket();

	try {
		localStorage.removeItem('token');
		localStorage.removeItem('jwt_token');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');
		localStorage.removeItem('userEmail');
		localStorage.removeItem('userData');
	} catch (e) {
		console.warn('Erreur lors du nettoyage du localStorage:', e);
	}

	currentUser = null;
	showNotification('Session expirée, veuillez vous reconnecter', 'warning');
	updateAuthUI(false);
}

/**
 * Récupère le token depuis l'URL (retour OAuth Google)
 */
async function handleOAuthCallback() {
	const tokenFromURL = window.SiteApi?.absorbTokenFromUrl?.();

	if (tokenFromURL) {
		try {
			if (window.SiteApi?.redirectToPostLoginTarget?.()) {
				return true;
			}
			showNotification('Connexion réussie !', 'success');
			announceToScreenReader('Connexion réussie, chargement de vos données');
			return true; // Indique qu'un token OAuth a été traité
		} catch (error) {
			console.error('Erreur lors du traitement du token OAuth:', error);
			showNotification('Erreur lors de la connexion', 'error');
			return false;
		}
	}
	return false;
}

// =============================================================
// Système de notifications
// =============================================================

/**
 * Affiche une notification temporaire
 */
function showNotification(message, type = 'info') {
	// Supprimer les notifications existantes
	const existingNotifications = document.querySelectorAll('.notification');
	existingNotifications.forEach((notification) => {
		notification.remove();
	});

	// Créer la notification
	const notification = document.createElement('div');
	notification.className = `notification notification-${type}`;
	notification.setAttribute('role', 'alert');
	notification.setAttribute('aria-live', 'assertive');

	let icon = 'info-circle';
	switch (type) {
		case 'error':
			icon = 'exclamation-circle';
			break;
		case 'warning':
			icon = 'exclamation-triangle';
			break;
		case 'success':
			icon = 'check-circle';
			break;
	}

	notification.innerHTML = `
    <i class="fas fa-${icon}" aria-hidden="true"></i>
    <span>${message}</span>
  `;

	document.body.appendChild(notification);

	// Annoncer immédiatement aux lecteurs d'écran
	announceToScreenReader(message, 'assertive');

	// Supprimer automatiquement après 5 secondes
	setTimeout(() => {
		if (notification.parentNode) {
			notification.style.opacity = '0';
			notification.style.transform = 'translateX(100%)';

			setTimeout(() => {
				if (notification.parentNode) {
					notification.remove();
				}
			}, 300);
		}
	}, 5000);
}

// =============================================================
// Système de modales
// =============================================================

/**
 * Piège le focus dans une modale
 */
function trapFocus(modal) {
	const focusableElements = modal.querySelectorAll(
		'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
	);

	if (focusableElements.length === 0) return () => {};

	const firstElement = focusableElements[0];
	const lastElement = focusableElements[focusableElements.length - 1];

	function handleTabKey(e) {
		if (e.key !== 'Tab') return;

		if (e.shiftKey) {
			// Shift + Tab
			if (document.activeElement === firstElement) {
				e.preventDefault();
				lastElement.focus();
			}
		} else {
			// Tab seul
			if (document.activeElement === lastElement) {
				e.preventDefault();
				firstElement.focus();
			}
		}
	}

	modal.addEventListener('keydown', handleTabKey);

	// Retourner la fonction de nettoyage
	return () => {
		modal.removeEventListener('keydown', handleTabKey);
	};
}

/**
 * Affiche une modale de confirmation
 */
function showConfirmModal(message, onConfirm) {
	const modal = document.getElementById('confirm-modal');
	const messageElement = document.getElementById('confirm-message');
	const confirmButton = document.getElementById('confirm-ok');
	const cancelButton = document.getElementById('confirm-cancel');

	if (!modal || !messageElement || !confirmButton) {
		console.warn('Éléments de modale manquants');
		return;
	}

	// Sauvegarder l'élément actif
	lastFocusedElement = document.activeElement;

	// Mettre à jour le message
	messageElement.textContent = message;

	// Nettoyer les écouteurs précédents
	const newConfirmButton = confirmButton.cloneNode(true);
	confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);

	const newCancelButton = cancelButton.cloneNode(true);
	cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);

	// Ajouter les nouveaux écouteurs
	document.getElementById('confirm-ok').addEventListener('click', () => {
		if (onConfirm) {
			onConfirm();
		}
		hideConfirmModal();
	});

	document
		.getElementById('confirm-cancel')
		.addEventListener('click', hideConfirmModal);

	// Afficher la modale
	modal.classList.remove('hidden');
	modal.setAttribute('aria-hidden', 'false');
	document.body.style.overflow = 'hidden';

	// Piéger le focus
	const cleanupFocusTrap = trapFocus(modal);

	// Focus sur le bouton d'annulation (meilleure pratique UX)
	setTimeout(() => {
		document.getElementById('confirm-cancel').focus();
	}, 100);

	// Gestion de la touche Escape
	function handleEscapeKey(e) {
		if (e.key === 'Escape') {
			hideConfirmModal();
		}
	}

	document.addEventListener('keydown', handleEscapeKey);

	// Stocker dans la pile de modales
	modalStack.push({
		modal,
		cleanup: () => {
			cleanupFocusTrap();
			document.removeEventListener('keydown', handleEscapeKey);
		},
	});

	// Annoncer l'ouverture
	announceToScreenReader('Fenêtre de confirmation ouverte. ' + message);
}

/**
 * Masque la modale de confirmation
 */
function hideConfirmModal() {
	const modal = document.getElementById('confirm-modal');
	if (!modal) return;

	// Récupérer et exécuter le cleanup
	const modalData = modalStack.pop();
	if (modalData && modalData.cleanup) {
		modalData.cleanup();
	}

	// Masquer la modale
	modal.classList.add('hidden');
	modal.setAttribute('aria-hidden', 'true');
	document.body.style.overflow = '';

	// Restaurer le focus
	if (lastFocusedElement) {
		setTimeout(() => {
			lastFocusedElement.focus();
		}, 100);
	}

	// Annoncer la fermeture
	announceToScreenReader('Fenêtre de confirmation fermée');
}

/**
 * Affiche le modal de déconnexion
 */
function showLogoutModal() {
	if (USE_SHARED_USER_MENU()) {
		const sharedModal = document.getElementById('logout-confirm-modal');
		if (sharedModal && window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(sharedModal);
		}
		return;
	}

	const modal = document.getElementById('logout-confirm-modal');
	if (!modal) return;

	// Sauvegarder l'élément actif
	lastFocusedElement = document.activeElement;

	// Afficher la modale
	modal.classList.remove('hidden');
	modal.setAttribute('aria-hidden', 'false');
	document.body.style.overflow = 'hidden';

	// Piéger le focus
	const cleanupFocusTrap = trapFocus(modal);

	// Focus sur le bouton d'annulation
	setTimeout(() => {
		document.getElementById('logout-cancel').focus();
	}, 100);

	// Gestion de la touche Escape
	function handleEscapeKey(e) {
		if (e.key === 'Escape') {
			hideLogoutModal();
		}
	}

	document.addEventListener('keydown', handleEscapeKey);

	// Stocker dans la pile de modales
	modalStack.push({
		modal,
		cleanup: () => {
			cleanupFocusTrap();
			document.removeEventListener('keydown', handleEscapeKey);
		},
	});

	// Annoncer l'ouverture
	announceToScreenReader('Fenêtre de confirmation de déconnexion ouverte');
}

/**
 * Masque le modal de déconnexion
 */
function hideLogoutModal() {
	if (USE_SHARED_USER_MENU()) {
		const sharedModal = document.getElementById('logout-confirm-modal');
		if (sharedModal && window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(sharedModal);
		}
		return;
	}

	const modal = document.getElementById('logout-confirm-modal');
	if (!modal) return;

	// Récupérer et exécuter le cleanup
	const modalData = modalStack.pop();
	if (modalData && modalData.cleanup) {
		modalData.cleanup();
	}

	// Masquer la modale
	modal.classList.add('hidden');
	modal.setAttribute('aria-hidden', 'true');
	document.body.style.overflow = '';

	// Restaurer le focus
	if (lastFocusedElement) {
		setTimeout(() => {
			lastFocusedElement.focus();
		}, 100);
	}

	// Annoncer la fermeture
	announceToScreenReader('Fenêtre de confirmation de déconnexion fermée');
}

/**
 * Affiche le modal de création de sondage
 */
function showCreateModal() {
	if (window.SiteCreateSurveyModal?.open) {
		window.SiteCreateSurveyModal.open();
		return;
	}

	const modal = document.getElementById('create-modal');
	if (!modal) return;

	// Sauvegarder l'élément actif
	lastFocusedElement = document.activeElement;

	// Afficher la modale
	modal.classList.remove('hidden');
	modal.setAttribute('aria-hidden', 'false');
	document.body.style.overflow = 'hidden';

	// Piéger le focus
	const cleanupFocusTrap = trapFocus(modal);

	// Focus sur le premier bouton
	setTimeout(() => {
		const firstBtn = modal.querySelector('.survey-type-btn');
		if (firstBtn) firstBtn.focus();
	}, 100);

	// Gestion de la touche Escape
	function handleEscapeKey(e) {
		if (e.key === 'Escape') {
			hideCreateModal();
		}
	}

	document.addEventListener('keydown', handleEscapeKey);

	// Stocker dans la pile de modales
	modalStack.push({
		modal,
		cleanup: () => {
			cleanupFocusTrap();
			document.removeEventListener('keydown', handleEscapeKey);
		},
	});

	// Annoncer l'ouverture
	announceToScreenReader('Fenêtre de création de sondage ouverte');
}

/**
 * Masque le modal de création de sondage
 */
function hideCreateModal() {
	if (window.SiteCreateSurveyModal?.close) {
		window.SiteCreateSurveyModal.close();
	}

	const modal = document.getElementById('create-modal');
	if (!modal) return;

	// Récupérer et exécuter le cleanup
	const modalData = modalStack.pop();
	if (modalData && modalData.cleanup) {
		modalData.cleanup();
	}

	// Masquer la modale
	modal.classList.add('hidden');
	modal.setAttribute('aria-hidden', 'true');
	document.body.style.overflow = '';

	// Restaurer le focus
	if (lastFocusedElement) {
		setTimeout(() => {
			lastFocusedElement.focus();
		}, 100);
	}

	// Annoncer la fermeture
	announceToScreenReader('Fenêtre de création de sondage fermée');
}

// =============================================================
// Gestion des événements UI
// =============================================================

/**
 * Initialise tous les écouteurs d'événements
 */
function initializeEventListeners() {
	// Bouton "Mes Sondages"
	const mySurveyButton = document.getElementById('my-survey-button');
	if (mySurveyButton) {
		mySurveyButton.addEventListener('click', () => {
			if (currentUser && currentUser.userId) {
				window.location.href = `my-surveys.html?Id=${currentUser.userId}`;
			} else {
				showNotification("Veuillez vous connecter d'abord", 'warning');
			}
		});
	}

	// Bouton "Créer un sondage"
	const createSurveyBtn = document.getElementById('create-survey-btn');
	if (createSurveyBtn) {
		createSurveyBtn.addEventListener('click', showCreateModal);
	}

	// Bouton de création depuis l'état vide
	const createOpenPrompt = document.getElementById('create-open-prompt');
	if (createOpenPrompt) {
		createOpenPrompt.addEventListener('click', showCreateModal);
	}

	// Bouton de déconnexion dans le menu
	if (!USE_SHARED_USER_MENU()) {
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Fermer le menu déroulant
			const userMenuDetails = document.querySelector('.user-menu-details');
			if (userMenuDetails) {
				userMenuDetails.removeAttribute('open');
			}

			showLogoutModal();
		});
	}

	// Boutons de confirmation de déconnexion
	const logoutCancel = document.getElementById('logout-cancel');
	const logoutOk = document.getElementById('logout-ok');

	if (logoutCancel) {
		logoutCancel.addEventListener('click', hideLogoutModal);
	}

	if (logoutOk) {
		logoutOk.addEventListener('click', () => {
			handleLogout();
			hideLogoutModal();
		});
	}

	// Bouton de connexion principal
	const loginBtn = document.getElementById('login-btn');
	if (loginBtn) {
		loginBtn.addEventListener('click', (e) => {
			setButtonLoading(e.target, true);
			window.redirectToGoogleAuth?.();
		});
	}

	// Bouton de connexion Google dans le prompt
	const googleLoginBtn = document.getElementById('google-login-btn');
	if (googleLoginBtn) {
		googleLoginBtn.addEventListener('click', (e) => {
			setButtonLoading(e.target, true);
			window.redirectToGoogleAuth?.();
		});
	}

	// Gestion du menu utilisateur (accessibilité améliorée)
	const userMenuDetails = document.querySelector('.user-menu-details');
	if (userMenuDetails) {
		const summary = userMenuDetails.querySelector('summary');

		// Navigation clavier dans le menu
		if (summary) {
			summary.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					userMenuDetails.hasAttribute('open') ?
						userMenuDetails.removeAttribute('open')
					:	userMenuDetails.setAttribute('open', '');
				} else if (e.key === 'Escape' && userMenuDetails.hasAttribute('open')) {
					userMenuDetails.removeAttribute('open');
					summary.focus();
				}
			});
		}

		// Fermer le menu quand on clique ailleurs
		document.addEventListener('click', (event) => {
			if (!userMenuDetails.contains(event.target)) {
				userMenuDetails.removeAttribute('open');
			}
		});

		// Empêcher la fermeture quand on clique dans le menu
		userMenuDetails.addEventListener('click', (event) => {
			event.stopPropagation();
		});
	}
	}

	const googleLoginBtn = document.getElementById('google-login-btn');
	if (googleLoginBtn) {
		googleLoginBtn.addEventListener('click', (e) => {
			setButtonLoading(e.target, true);
			window.redirectToGoogleAuth?.();
		});
	}

	// Modal de confirmation: fermer via X / backdrop
	const confirmModal = document.getElementById('confirm-modal');
	const confirmCloseBtn = confirmModal?.querySelector('.close-modal');
	if (confirmCloseBtn) {
		confirmCloseBtn.addEventListener('click', hideConfirmModal);
	}
	if (confirmModal) {
		confirmModal.addEventListener('click', (e) => {
			if (e.target === confirmModal) {
				hideConfirmModal();
			}
		});
	}

	// Boutons de type de sondage
	document.querySelectorAll('.survey-type-btn').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			const type = e.currentTarget.dataset.type;
			createNewSurvey(type);
		});
	});

	// Gestion des touches pour les boutons de type de sondage
	document.querySelectorAll('.survey-type-btn').forEach((btn) => {
		btn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				btn.click();
			}
		});
	});

	// Contrôle mobile avec debounce
	let resizeTimeout;
	function handleResize() {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(applyMobileToggle, 250);
	}

	window.addEventListener('resize', handleResize);

	// Initialisation du contrôle mobile
	applyMobileToggle();

	// Gestion des changements d'onglets mobiles
	const inputOpen = document.getElementById('view-open');
	const inputClosed = document.getElementById('view-closed');

	if (inputOpen) {
		inputOpen.addEventListener('change', () => {
			applyMobileToggle({ userInitiated: true });
			announceToScreenReader('Affichage des sondages ouverts');
		});
	}

	if (inputClosed) {
		inputClosed.addEventListener('change', () => {
			applyMobileToggle({ userInitiated: true });
			announceToScreenReader('Affichage des sondages clôturés');
		});
	}

	// Gestion du modal d'édition de pseudo
	const editPseudoModal = document.getElementById('edit-pseudo-modal');
	if (editPseudoModal) {
		// Fermer le modal avec le bouton X
		const closeBtn = editPseudoModal.querySelector('.close-modal');
		if (closeBtn) {
			closeBtn.addEventListener('click', hideEditPseudoModal);
		}

		// Fermer le modal avec le bouton Annuler
		const cancelEditBtn = document.getElementById('cancel-edit-pseudo');
		if (cancelEditBtn) {
			cancelEditBtn.addEventListener('click', hideEditPseudoModal);
		}

		// Enregistrer avec le bouton Confirmer
		const confirmEditBtn = document.getElementById('confirm-edit-pseudo');
		if (confirmEditBtn) {
			confirmEditBtn.addEventListener('click', submitEditPseudo);
		}

		// Fermer en cliquant à l'extérieur
		editPseudoModal.addEventListener('click', function (e) {
			if (e.target === editPseudoModal) {
				hideEditPseudoModal();
			}
		});

		// Valider avec Entrée dans le champ de saisie
		const pseudoInput = document.getElementById('new-pseudo-input');
		if (pseudoInput) {
			pseudoInput.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') {
					e.preventDefault();
					submitEditPseudo();
				}
			});
		}
	}

	// Initialisation de la barre de recherche
	initializeSearch(); // <-- AJOUTÉ ICI
}

/**
 * Applique l'affichage mobile/desktop des colonnes
 */
function isMobileToggleViewport() {
	return window.matchMedia('(max-width: 768px)').matches;
}

function prefersReducedMotion() {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getHeaderOffset() {
	const header = document.querySelector('header');
	if (!header) return 8;
	return Math.max(8, Math.ceil(header.getBoundingClientRect().height) + 8);
}

function isElementMostlyVisible(element) {
	if (!element) return true;
	const rect = element.getBoundingClientRect();
	const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
	if (!viewportHeight || rect.height <= 0) return true;
	const visibleTop = Math.max(rect.top, 0);
	const visibleBottom = Math.min(rect.bottom, viewportHeight);
	const visibleHeight = Math.max(0, visibleBottom - visibleTop);
	return visibleHeight >= Math.min(rect.height, viewportHeight) * 0.55;
}

function scrollToActiveColumnIfNeeded({ force = false, mobileOnly = true } = {}) {
	if (mobileOnly && !isMobileToggleViewport()) return;
	const inputOpen = document.getElementById('view-open');
	const inputClosed = document.getElementById('view-closed');
	const openCol = document.getElementById('open-column');
	const closedCol = document.getElementById('closed-column');
	const targetColumn =
		inputClosed && inputClosed.checked ? closedCol
		: inputOpen && inputOpen.checked ? openCol
		: null;
	if (!targetColumn) return;
	if (!force && isElementMostlyVisible(targetColumn)) return;

	const top = window.scrollY + targetColumn.getBoundingClientRect().top - getHeaderOffset();
	window.scrollTo({
		top: Math.max(0, Math.round(top)),
		behavior: prefersReducedMotion() ? 'auto' : 'smooth',
	});
}

function queueActiveColumnSmoothScroll({
	force = true,
	mobileOnly = true,
} = {}) {
	window.requestAnimationFrame(() => {
		scrollToActiveColumnIfNeeded({ force, mobileOnly });
	});
}

function applyMobileToggle({ userInitiated = false } = {}) {
	const isMobile = isMobileToggleViewport();
	const inputOpen = document.getElementById('view-open');
	const inputClosed = document.getElementById('view-closed');
	const openCol = document.getElementById('open-column');
	const closedCol = document.getElementById('closed-column');

	if (!openCol || !closedCol) return;

	if (!isMobile) {
		// Desktop/tablet : afficher les deux colonnes
		openCol.style.display = 'block';
		closedCol.style.display = 'block';
		openCol.removeAttribute('aria-hidden');
		closedCol.removeAttribute('aria-hidden');
	} else {
		// Mobile : afficher seulement la colonne sélectionnée
		if (inputOpen && inputOpen.checked) {
			openCol.style.display = 'block';
			closedCol.style.display = 'none';
			openCol.removeAttribute('aria-hidden');
			closedCol.setAttribute('aria-hidden', 'true');
		} else if (inputClosed && inputClosed.checked) {
			openCol.style.display = 'none';
			closedCol.style.display = 'block';
			openCol.setAttribute('aria-hidden', 'true');
			closedCol.removeAttribute('aria-hidden');
		}
	}

	if (userInitiated) {
		queueActiveColumnSmoothScroll({ force: true, mobileOnly: true });
	}
}

// =============================================================
// Gestion des données utilisateur
// =============================================================

/**
 * Récupère les données utilisateur avec gestion d'erreurs améliorée
 */
async function fetchUserData(token) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10000);

	try {
		const response = await fetch(
			`${CONFIG.api.endpoints.authMe}`,
			{
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				signal: controller.signal,
			},
		);

		clearTimeout(timeoutId);

		if (response.status === 401) {
			throw new Error('SESSION_EXPIRED');
		}

		if (!response.ok) {
			throw new Error(`HTTP_${response.status}`);
		}

		const data = await response.json();
		currentUser = data;

		// Stocker TOUTES les données utilisateur de manière synchronisée
		try {
			if (data.userId) localStorage.setItem('userId', data.userId);
			if (data.id) localStorage.setItem('userId', data.id); // Alternative
			if (data.pseudo) localStorage.setItem('userPseudo', data.pseudo);
			if (data.email) localStorage.setItem('userEmail', data.email);

			// Stocker l'objet utilisateur complet pour référence
			localStorage.setItem('userData', JSON.stringify(data));
		} catch (storageError) {
			console.warn('Impossible de stocker dans localStorage:', storageError);
		}

		return data;
	} catch (error) {
		clearTimeout(timeoutId);
		const httpStatus = extractHttpStatus(error);
		console.error(
			'Erreur lors de la récupération des données utilisateur:',
			error,
		);

		if (error.name === 'AbortError') {
			showNotification('Le serveur met trop de temps à répondre', 'warning');
		} else if (error.message === 'SESSION_EXPIRED') {
			handleSessionExpired();
		} else if (error.message.startsWith('HTTP_')) {
			showNotification(
				`Erreur serveur (${error.message.replace('HTTP_', '')})`,
				'error',
			);
		} else if (isLikelyNetworkFetchError(error)) {
			showNotification('Impossible de contacter le serveur', 'error');
		} else if (Number.isInteger(httpStatus) && httpStatus >= 500) {
			showNotification(
				'Serveur temporairement indisponible. Merci de réessayer.',
				'error',
			);
		} else {
			showNotification(
				'Erreur lors du chargement des données utilisateur',
				'error',
			);
		}

		return null;
	}
}

/**
 * Synchronise les données utilisateur avec le localStorage
 */
function syncUserDataToLocalStorage(userData) {
	if (!userData) return;

	try {
		// Créer un objet de données synchronisées
		const syncedData = {
			userId: userData.userId || userData.id,
			pseudo: userData.pseudo,
			email: userData.email,
			lastSync: new Date().toISOString(),
		};

		// Stocker chaque valeur individuellement
		Object.keys(syncedData).forEach((key) => {
			if (syncedData[key]) {
				localStorage.setItem(key, syncedData[key]);
			}
		});

		// Stocker l'objet complet pour référence
		localStorage.setItem('userData', JSON.stringify(userData));

		return true;
	} catch (error) {
		console.error('Erreur de synchronisation avec localStorage:', error);
		return false;
	}
}

/**
 * Récupère les données utilisateur depuis le localStorage
 */
function getUserDataFromLocalStorage() {
	try {
		const userDataStr = localStorage.getItem('userData');
		if (userDataStr) {
			return JSON.parse(userDataStr);
		}

		// Fallback: reconstruire à partir des clés individuelles
		return {
			userId: localStorage.getItem('userId'),
			pseudo: localStorage.getItem('userPseudo'),
			email: localStorage.getItem('userEmail'),
		};
	} catch (error) {
		console.error('Erreur de lecture du localStorage:', error);
		return null;
	}
}

/**
 * Vérifie et synchronise les données utilisateur au démarrage
 */
async function checkAndSyncUserData() {
	const token = window.SiteApi?.getToken?.() || localStorage.getItem('token');
	if (!token) return null;

	// Récupérer les données depuis le serveur
	const serverData = await fetchUserData(token);

	if (!serverData) {
		// Utiliser les données du localStorage comme fallback
		const localData = getUserDataFromLocalStorage();
		if (localData && localData.pseudo) {
			currentUser = localData;
			updateUserInfo(currentUser);
		}
		return localData;
	}

	// Les données du serveur sont fraîches, les utiliser
	currentUser = serverData;
	updateUserInfo(currentUser);
	return serverData;
}

/**
 * Met à jour les informations utilisateur dans le menu
 */
function updateUserInfo(userData) {
	const userName = document.getElementById('user-name');

	// Synchroniser avec localStorage d'abord
	syncUserDataToLocalStorage(userData);

	if (userName && userData.pseudo) {
		if (window.SiteUserMenu?.setPseudo) {
			window.SiteUserMenu.setPseudo(userData.pseudo);
			return;
		}

		userName.innerHTML = `
      <span id="pseudo-text">${userData.pseudo}</span>
      <button id="edit-pseudo-btn" class="edit-pseudo-btn" title="Modifier le pseudo" aria-label="Modifier le pseudo">
        <i class="fa fa-pencil"></i>
      </button>
    `;

		// Ajouter les styles inline pour s'assurer qu'ils sont appliqués
		const editBtn = document.getElementById('edit-pseudo-btn');
		if (editBtn) {
			editBtn.style.cssText =
				'background:none;border:none;padding:0;margin-left:8px;cursor:pointer;color:var(--primary-color);';

			// Utiliser onclick directement pour éviter les conflits
			editBtn.onclick = function (e) {
				e.preventDefault();
				e.stopPropagation();
				showEditPseudoModal();
			};
		}
	}

}

/**
 * Gère la déconnexion
 */
function handleLogout() {
	disconnectSurveyFeedSocket();

	try {
		localStorage.removeItem('token');
		localStorage.removeItem('jwt_token');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');
		localStorage.removeItem('userEmail');
		localStorage.removeItem('userData');
	} catch (error) {
		console.warn('Erreur lors du nettoyage du localStorage:', error);
	}

	currentUser = null;
	showNotification('Déconnexion réussie', 'success');
	updateAuthUI(false);

	// Annoncer la déconnexion
	announceToScreenReader('Vous êtes maintenant déconnecté');
}

/**
 * Crée un nouveau sondage
 */
function createNewSurvey(type) {
	hideCreateModal();
	if (type === 'binary') {
		window.location.href = 'create-survey.html';
	} else {
		window.location.href = 'create-survey-choices.html';
	}
}

// =============================================================
// Gestion des sondages
// =============================================================

/**
 * Récupère les sondages avec gestion d'erreurs
 */
async function fetchSurveys({ retryCount = 0, silent = false } = {}) {
	const controller = new AbortController();
	const timeoutId = setTimeout(
		() => controller.abort(),
		SURVEYS_FETCH_TIMEOUT_MS,
	);

	try {
		const token =
			window.SiteApi?.getToken?.() ||
			localStorage.getItem('token') ||
			localStorage.getItem('jwt_token');
		if (!token) {
			throw new Error('NO_TOKEN');
		}

		const response = await fetch(
			`${CONFIG.api.endpoints.allSurveys}`,
			{
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				signal: controller.signal,
			},
		);

		clearTimeout(timeoutId);

		if (response.status === 401) {
			throw new Error('SESSION_EXPIRED');
		}

		if (!response.ok) {
			throw new Error(`HTTP_${response.status}`);
		}

		surveys = (await response.json()).map((survey) => ({
			...survey,
			status: normalizeSurveyStatus(survey?.status),
		})); // <-- MODIFIÉ
		filteredSurveys = [...surveys]; // <-- AJOUTÉ
		displaySurveys(); // <-- MODIFIÉ (pas de paramètre)
		updateSurveyCounts(); // <-- AJOUTÉ
		return surveys;
	} catch (error) {
		clearTimeout(timeoutId);
		const httpStatus = extractHttpStatus(error);
		const shouldRetry =
			retryCount < SURVEYS_FETCH_MAX_RETRIES &&
			(isLikelyNetworkFetchError(error) ||
				(Number.isInteger(httpStatus) && httpStatus >= 500));

		if (shouldRetry) {
			await waitMs(SURVEYS_FETCH_RETRY_DELAY_MS);
			return fetchSurveys({ retryCount: retryCount + 1, silent });
		}

		console.error('Erreur lors du chargement des sondages:', error);

		if (silent && error.message !== 'SESSION_EXPIRED') {
			return [];
		}

		if (document.visibilityState === 'hidden') {
			return [];
		}

		if (error.name === 'AbortError') {
			showNotification('Chargement des sondages trop long', 'warning');
		} else if (error.message === 'SESSION_EXPIRED') {
			handleSessionExpired();
		} else if (error.message === 'NO_TOKEN') {
			// Pas de token, c'est normal si l'utilisateur n'est pas connecté
			return [];
		} else if (isLikelyNetworkFetchError(error)) {
			showNotification('Impossible de contacter le serveur', 'error');
		} else if (Number.isInteger(httpStatus) && httpStatus >= 500) {
			showNotification(
				'Serveur temporairement indisponible. Merci de réessayer.',
				'error',
			);
		} else {
			showNotification('Erreur de chargement des sondages', 'error');
		}

		// Afficher le dashboard vide
		const dashboard = document.querySelector('.dashboard-container');
		if (dashboard) {
			showElementAccessibly(dashboard);
		}

		return [];
	}
}

/**
 * Vérifie que les éléments critiques sont présents dans le DOM
 */
function ensureCriticalElements() {
	const requiredElements = [
		'open-surveys',
		'closed-surveys',
		'dashboard-container',
		'loading',
		'login-btn',
		'user-menu',
	];

	for (const id of requiredElements) {
		if (!document.getElementById(id)) {
			console.warn(`Élément critique manquant: ${id}`);
			return false;
		}
	}
	return true;
}

/**
 * Attend qu'un élément soit présent dans le DOM
 */
function waitForElement(selector, timeout = 5000) {
	return new Promise((resolve, reject) => {
		const element = document.querySelector(selector);
		if (element) {
			resolve(element);
			return;
		}

		const observer = new MutationObserver(() => {
			const el = document.querySelector(selector);
			if (el) {
				observer.disconnect();
				resolve(el);
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Timeout: ${selector} not found`));
		}, timeout);
	});
}

/**
 * Affiche les sondages dans l'interface
 */
async function displaySurveys() {
	// <-- MODIFIÉ (pas de paramètre)
	try {
		// Attendre que les conteneurs soient disponibles
		const [openContainer, closedContainer] = await Promise.all([
			waitForElement('#open-surveys').catch(() =>
				document.getElementById('open-surveys'),
			),
			waitForElement('#closed-surveys').catch(() =>
				document.getElementById('closed-surveys'),
			),
		]);

		if (!openContainer || !closedContainer) {
			console.error(
				'Conteneurs de sondages non trouvés, nouvelle tentative...',
			);
			// Nouvelle tentative après un délai
			setTimeout(() => displaySurveys(), 500);
			return;
		}

		const noOpenSurveys = document.getElementById('no-open-surveys');
		const noClosedSurveys = document.getElementById('no-closed-surveys');

		if (openContainer) openContainer.innerHTML = '';
		if (closedContainer) closedContainer.innerHTML = '';

		let openCount = 0;
		let closedCount = 0;

		// Vérifier que filteredSurveys est un tableau
		if (!Array.isArray(filteredSurveys)) {
			// <-- MODIFIÉ
			console.error('Les sondages ne sont pas un tableau:', filteredSurveys);
			filteredSurveys = [];
		}

		// Trier les sondages par date de création (plus récents d'abord)
		filteredSurveys.sort((a, b) => {
			// <-- MODIFIÉ
			const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
			const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
			return dateB - dateA;
		});

		// Créer un document fragment pour optimisation des performances
		const openFragment = document.createDocumentFragment();
		const closedFragment = document.createDocumentFragment();

		filteredSurveys.forEach((survey) => {
			// <-- MODIFIÉ
			const surveyCard = createSurveyCard(survey);
			if (survey.isClosed) {
				closedFragment.appendChild(surveyCard);
				closedCount++;
			} else {
				openFragment.appendChild(surveyCard);
				openCount++;
			}
		});

		// Ajouter les fragments au DOM
		if (openContainer) openContainer.appendChild(openFragment);
		if (closedContainer) closedContainer.appendChild(closedFragment);

		// Mettre à jour les compteurs
		const openCountElement = document.getElementById('open-count');
		const closedCountElement = document.getElementById('closed-count');
		if (openCountElement) openCountElement.textContent = openCount;
		if (closedCountElement) closedCountElement.textContent = closedCount;

		// Mettre à jour les compteurs mobiles
		const openCountMobile = document.getElementById('open-count-mobile');
		const closedCountMobile = document.getElementById('closed-count-mobile');
		if (openCountMobile) openCountMobile.textContent = openCount;
		if (closedCountMobile) closedCountMobile.textContent = closedCount;

		// Gérer les états vides
		if (noOpenSurveys) {
			if (openCount > 0) {
				hideElementAccessibly(noOpenSurveys);
			} else {
				showElementAccessibly(noOpenSurveys);
			}
		}

		if (noClosedSurveys) {
			if (closedCount > 0) {
				hideElementAccessibly(noClosedSurveys);
			} else {
				showElementAccessibly(noClosedSurveys);
			}
		}

		// Appliquer l'affichage mobile
		applyMobileToggle();

		// Annoncer le nombre de sondages chargés
		if (filteredSurveys.length > 0) {
			// <-- MODIFIÉ
			announceToScreenReader(`${filteredSurveys.length} sondages chargés`);
		}
	} catch (error) {
		console.error('Erreur dans displaySurveys:', error);
		// Réessayer après un délai
		setTimeout(() => displaySurveys(), 1000);
	}
}

/**
 * Crée une carte de sondage
 */
function createSurveyCard(survey) {
	const isFlashSurvey = survey.explain === false;
	const card = document.createElement('article');
	card.className = `survey-card ${survey.isClosed ? 'closed' : ''} ${
		isFlashSurvey ? 'survey-card--flash' : ''
	}`.trim();
	card.dataset.id = survey._id;
	if (survey.type) card.dataset.type = survey.type;
	card.dataset.flash = isFlashSurvey ? '1' : '0';
	card.setAttribute('aria-labelledby', `survey-title-${survey._id}`);
	card.tabIndex = 0;
	card.setAttribute('role', 'button');

	const createdDate =
		survey.createdAt ? new Date(survey.createdAt) : new Date();
	const formattedDate = createdDate.toLocaleDateString(getIntlLocale(), {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});

	const typeIconMarkup =
		survey.type === 'binary' ?
			`<span class="survey-type-binary-pill" aria-hidden="true">
        <span class="survey-type-yes">✔</span>
        <span class="survey-type-separator">/</span>
        <span class="survey-type-no">✖</span>
      </span>`
		:	`<span class="survey-type-options-icon" aria-hidden="true">
        <i class="fas fa-sliders"></i>
      </span>`;
	const typeLabel =
		survey.type === 'binary' ? 'Binaire' : 'Multiple';
	const flashIndicatorMarkup =
		isFlashSurvey ?
			`<span class="survey-flash-indicator" aria-label="Sondage flash">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13.2 1.8L5.5 12.3c-.4.6 0 1.5.8 1.5h4.2l-1 8.4c-.1.9 1 .4 1.4-.1l7.6-10.5c.4-.6 0-1.5-.8-1.5h-4.2l1-8.4c.1-.9-1-.4-1.3.1z"></path>
        </svg>
        <span>Flash</span>
      </span>`
		:	'';
	const waitingBadgeLabel = i18n(
		'browse_surveys.participation_waiting_badge',
		'Déjà participé - En attente de clôture',
	);
	const surveyVotes = getSurveyVotesTotal(survey);

	const participationBadge =
		survey.hasParticipated && !survey.isClosed ?
			`<div class="survey-participation-badge" aria-label="${waitingBadgeLabel}" title="${waitingBadgeLabel}">
        <span class="survey-participation-check" aria-hidden="true">✔</span>
      </div>`
		:	'';
	const creatorName = escapeHtml(survey.creatorName || 'Administrateur');

	card.innerHTML = `
    <div class="survey-card-header">
      <div class="survey-theme" id="survey-title-${survey._id}">${
				survey.theme || 'Sondage sans titre'
			}</div>
      <div class="survey-status ${
				survey.isClosed ? 'closed' : 'open'
			}" aria-label="${survey.isClosed ? 'Sondage clôturé' : 'Sondage ouvert'}">
        <i class="fas ${survey.isClosed ? 'fa-lock' : 'fa-unlock'}" aria-hidden="true"></i>
        ${survey.isClosed ? 'Clôturé' : 'Ouvert'}
      </div>
    </div>

    ${participationBadge}

    ${
			survey.question ?
				`
      <div class="survey-question" aria-label="Question du sondage">
        ${survey.question}
      </div>
    `
			:	''
		}

    <div class="survey-details">
      <div class="detail-item detail-item--type">
        ${typeIconMarkup}
        <span class="survey-type-label">${typeLabel}</span>
        ${flashIndicatorMarkup}
      </div>
      <div class="detail-item">
        <i class="fas fa-calendar" aria-hidden="true"></i>
        <span>${formattedDate}</span>
      </div>
      <div class="detail-item">
        <i class="fas fa-user" aria-hidden="true"></i>
        <span>${creatorName}</span>
      </div>
      <div class="detail-item">
        <i class="fas fa-users" aria-hidden="true"></i>
        <span class="survey-votes-value">${formatVotesText(surveyVotes)}</span>
      </div>
    </div>
  `;

	// Bouton chat
	const chatButton = document.createElement('button');
	chatButton.className = 'btn-secondary';
	chatButton.style.cssText =
		'margin-top: 0.5rem; padding: 0.5rem 1rem; font-size: 0.9rem;';
	chatButton.innerHTML = `<i class="fas fa-comments" aria-hidden="true"></i> ${i18n(
		'browse_surveys.card_chat_button',
		'Chat',
	)}`;
	chatButton.setAttribute(
		'aria-label',
		i18n(
			'browse_surveys.card_chat_aria',
			'Ouvrir le chat du sondage : {theme}',
			{ theme: survey.theme || 'sondage sans titre' },
		),
	);
	chatButton.addEventListener('click', (e) => {
		e.stopPropagation();
		if (survey._id && survey.type) {
			window.location.href = `chatroom.html?surveyId=${survey._id}&type=${survey.type}`;
		}
	});
	card.appendChild(chatButton);

	// Navigation clavier et clic
	const handleActivation = () => {
		if (!survey._id || !survey.type) return;

		if (isFlashSurvey) {
			if (survey.type === 'binary') {
				window.location.href = `survey-flash-binary.html?id=${survey._id}`;
			} else if (survey.type === 'multiple') {
				window.location.href = `survey-flash-multiple.html?id=${survey._id}`;
			}
			return;
		}

		if (survey.type === 'binary') {
			window.location.href = `survey.html?id=${survey._id}`;
		} else {
			window.location.href = `survey-choices.html?id=${survey._id}`;
		}
	};

	card.addEventListener('click', handleActivation);
	card.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleActivation();
		}
	});

	return card;
}

// =============================================================
// GESTION DE LA BARRE DE RECHERCHE
// =============================================================
function initializeSearch() {
	const searchInput = document.getElementById('survey-search');
	const clearButton = document.getElementById('clear-search');

	if (!searchInput || !clearButton) return;

	searchInput.addEventListener('input', function (e) {
		const searchTerm = e.target.value.toLowerCase().trim();
		filterSurveys(searchTerm, { userInitiated: true });

		// Afficher/masquer le bouton de suppression
		if (searchTerm.length > 0) {
			clearButton.classList.add('visible');
		} else {
			clearButton.classList.remove('visible');
		}
	});

	searchInput.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			searchInput.value = '';
			filterSurveys('', { userInitiated: true });
			clearButton.classList.remove('visible');
			searchInput.blur();
		}
	});

	clearButton.addEventListener('click', function () {
		searchInput.value = '';
		filterSurveys('', { userInitiated: true });
		clearButton.classList.remove('visible');
		searchInput.focus();
	});
}

function filterSurveys(searchTerm, { userInitiated = false } = {}) {
	if (!searchTerm) {
		filteredSurveys = [...surveys];
		const renderPromise = Promise.resolve(displaySurveys());
		if (userInitiated) {
			renderPromise.finally(() => {
				queueActiveColumnSmoothScroll({ force: false, mobileOnly: false });
			});
		}
		return;
	}

	filteredSurveys = surveys.filter((survey) => {
		const theme = survey.theme?.toLowerCase() || '';
		const description = survey.description?.toLowerCase() || '';
		const creator = survey.creatorName?.toLowerCase() || '';

		return (
			theme.includes(searchTerm) ||
			description.includes(searchTerm) ||
			creator.includes(searchTerm)
		);
	});

	const renderPromise = Promise.resolve(displaySurveys());
	if (userInitiated) {
		renderPromise.finally(() => {
			queueActiveColumnSmoothScroll({ force: false, mobileOnly: false });
		});
	}

	// Mettre à jour les compteurs
	updateSurveyCounts();
}

function updateSurveyCounts() {
	let openCount = 0;
	let closedCount = 0;

	if (Array.isArray(filteredSurveys)) {
		filteredSurveys.forEach((survey) => {
			if (survey.isClosed) {
				closedCount++;
			} else {
				openCount++;
			}
		});
	}

	// Mettre à jour les compteurs
	const openCountElement = document.getElementById('open-count');
	const closedCountElement = document.getElementById('closed-count');
	if (openCountElement) openCountElement.textContent = openCount;
	if (closedCountElement) closedCountElement.textContent = closedCount;

	// Mettre à jour les compteurs mobiles
	const openCountMobile = document.getElementById('open-count-mobile');
	const closedCountMobile = document.getElementById('closed-count-mobile');
	if (openCountMobile) openCountMobile.textContent = openCount;
	if (closedCountMobile) closedCountMobile.textContent = closedCount;
}

// =============================================================
// Initialisation de l'application
// =============================================================

/**
 * Initialise l'application
 */
async function initializeApp() {
	isInitializing = true;

	await handleOAuthCallback();
	showLoading(true);

	const token = window.SiteApi?.getToken?.() || localStorage.getItem('token');
	if (!token) {
		updateAuthUI(false);
		showLoading(false);
		isInitializing = false;
		return;
	}

	try {
		const userSyncPromise = checkAndSyncUserData().catch((error) => {
			console.warn('User sync background error:', error);
			return null;
		});

		await fetchSurveys();

		if (!getAuthTokenForSocket()) {
			updateAuthUI(false);
			return;
		}

		const fallbackUser = currentUser || getUserDataFromLocalStorage();
		updateAuthUI(true, fallbackUser);
		initializeSurveyFeedRealtime();

		void userSyncPromise.then((freshUser) => {
			if (!freshUser || !getAuthTokenForSocket()) return;
			updateAuthUI(true, freshUser);
		});
	} catch (error) {
		console.error("Erreur lors de l'initialisation:", error);
		disconnectSurveyFeedSocket();
		updateAuthUI(false);
	} finally {
		showLoading(false);
		isInitializing = false;
	}
}

/**
 * Attend que le DOM soit prêt
 */
function waitForDOMReady() {
	return new Promise((resolve) => {
		if (
			document.readyState === 'complete' ||
			document.readyState === 'interactive'
		) {
			// Le DOM est déjà prêt
			resolve();
		} else {
			// Attendre que le DOM soit chargé
			document.addEventListener('DOMContentLoaded', resolve);
		}
	});
}

/**
 * Initialise l'application lorsque le DOM est prêt
 */
function initializeAppOnReady() {
	// Ajouter les styles CSS pour les notifications et l'accessibilité
	if (!document.querySelector('#custom-styles')) {
		const styles = document.createElement('style');
		styles.id = 'custom-styles';
		styles.textContent = `
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      
      .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 2000;
        animation: slideIn 0.3s ease;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }
      
      .notification-success {
        background: linear-gradient(135deg, var(--success-color), #059669);
        color: white;
      }
      
      .notification-error {
        background: linear-gradient(135deg, var(--danger-color), #dc2626);
        color: white;
      }
      
      .notification-warning {
        background: linear-gradient(135deg, var(--warning-color), #d97706);
        color: white;
      }
      
      .notification-info {
        background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
        color: white;
      }
      
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      /* Amélioration de l'accessibilité pour le focus */
      button:focus-visible,
      [tabindex]:focus-visible {
        outline: 3px solid rgba(99, 102, 241, 0.4);
        outline-offset: 2px;
      }
      
      /* Transition pour les éléments masqués */
      .hidden {
        display: none !important;
      }
    `;
		document.head.appendChild(styles);
	}

	// Initialiser les écouteurs d'événements
	initializeEventListeners();

	initializeFooter();

	// Initialiser l'application
	initializeApp();
}

// =============================================================
// Point d'entrée principal
// =============================================================

/**
 * Vérifie l'état du DOM et initialise l'application
 */
function checkDOMReady() {
	if (document.readyState === 'loading') {
		// Le DOM est encore en chargement
		document.addEventListener('DOMContentLoaded', initializeAppOnReady);
	} else {
		// Le DOM est déjà chargé (cas du rafraîchissement ou de la redirection)
		// Ajouter un délai pour garantir que tous les éléments sont prêts
		initializeAppOnReady();
	}
}

// Démarrer l'initialisation
checkDOMReady();

document.addEventListener('site:language-changed', () => {
	updateBrowsePageTitle(isBrowseAuthenticated);
});

window.addEventListener('pageshow', (event) => {
	if (!event.persisted) return;
	suppressGlobalErrorNotificationsUntil =
		Date.now() + BF_CACHE_ERROR_SUPPRESSION_MS;

	const token =
		window.SiteApi?.getToken?.() ||
		localStorage.getItem('token') ||
		localStorage.getItem('jwt_token');

	if (!token) return;

	initializeSurveyFeedRealtime();
	fetchSurveys({ retryCount: 0, silent: true }).catch(() => {});
});

window.addEventListener('beforeunload', () => {
	disconnectSurveyFeedSocket();
});

// =============================================================
// Gestion des erreurs globales
// =============================================================

window.addEventListener('error', (event) => {
	console.error('Erreur globale:', event.error);
	const errorMessage = getGlobalErrorMessage(event?.error || event?.message);

	if (isInitializing) {
		showLoading(false);
		isInitializing = false;
		updateAuthUI(false);
	}

	if (shouldSuppressGlobalErrorNotification(errorMessage)) return;

	// Afficher une erreur utilisateur-friendly
	notifyGlobalErrorOnce('Une erreur inattendue est survenue', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
	console.error('Promesse non gérée:', event.reason);
	const errorMessage = getGlobalErrorMessage(event?.reason);

	if (isInitializing) {
		showLoading(false);
		isInitializing = false;
		updateAuthUI(false);
	}

	if (shouldSuppressGlobalErrorNotification(errorMessage)) return;
	notifyGlobalErrorOnce('Erreur lors du traitement', 'error');
});

// =============================================================
// Gestion de la déconnexion automatique en cas d'inactivité
// =============================================================

let inactivityTimer;

function resetInactivityTimer() {
	clearTimeout(inactivityTimer);

	// Déconnecter après 30 minutes d'inactivité
	inactivityTimer = setTimeout(
		() => {
			if (currentUser) {
				showNotification('Déconnexion automatique pour inactivité', 'warning');
				announceToScreenReader('Déconnexion automatique pour inactivité');

				try {
					localStorage.removeItem('token');
					localStorage.removeItem('jwt_token');
					localStorage.removeItem('userId');
					localStorage.removeItem('userPseudo');
					localStorage.removeItem('userEmail');
					localStorage.removeItem('userData');
				} catch (e) {
					console.warn('Erreur lors du nettoyage du localStorage:', e);
				}

				currentUser = null;
				updateAuthUI(false);
			}
		},
		30 * 60 * 1000,
	); // 30 minutes
}

// Réinitialiser le timer sur les interactions utilisateur
['click', 'keydown', 'mousemove', 'scroll'].forEach((event) => {
	document.addEventListener(event, resetInactivityTimer);
});

// Initialiser le timer
resetInactivityTimer();

// =============================================================
// Synchronisation entre les onglets
// =============================================================

window.addEventListener('storage', function (e) {
	if (e.key === 'userPseudo' && e.newValue) {
		// Mettre à jour l'interface si le pseudo change dans un autre onglet
		if (currentUser) {
			currentUser.pseudo = e.newValue;
			updateUserInfo(currentUser);
			showNotification('Pseudo mis à jour depuis un autre onglet', 'info');
		}
	}

	if (e.key === 'token' && !e.newValue) {
		// Déconnexion depuis un autre onglet
		handleLogout();
	}
});

// =============================================================
// GESTION DE LA NEWSLETTER
// =============================================================
function initializeNewsletter() {
	// Newsletter handled by shared/newsletter.js
}


// =============================================================
// VALIDATION EMAIL
// =============================================================
function validateEmail(email) {
	const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return re.test(email);
}

// =============================================================
// GESTION DU SELECTEUR DE LANGUE
// =============================================================
function initializeLanguageSelector() {
	// Language selector handled by shared/i18n.js
}


// =============================================================
// NOM DES LANGUES
// =============================================================
function getLanguageName(code) {
	const languages = {
		fr: 'Français',
		en: 'Anglais',
		es: 'Espagnol',
		de: 'Allemand',
	};
	return languages[code] || code;
}

// =============================================================
// INITIALISATION DU FOOTER
// =============================================================
function initializeFooter() {
	// Newsletter handled by shared/newsletter.js
	// Language selector handled by shared/i18n.js

	// Animation au défilement
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

	observer.observe(footer);
}

// =============================================================
// Modal d'édition de pseudo
// =============================================================

function showEditPseudoModal() {
	const modal = document.getElementById('edit-pseudo-modal');
	if (!modal) return;

	// Fermer le menu utilisateur s'il est ouvert
	const userMenuDetails = document.querySelector('.user-menu-details');
	if (userMenuDetails && userMenuDetails.hasAttribute('open')) {
		userMenuDetails.removeAttribute('open');
	}

	// Réinitialiser les erreurs et la valeur du champ
	const errorDiv = document.getElementById('pseudo-error');
	if (errorDiv) errorDiv.textContent = '';

	const pseudoInput = document.getElementById('new-pseudo-input');
	if (pseudoInput) {
		const currentPseudo = document.getElementById('pseudo-text');
		if (currentPseudo) {
			pseudoInput.value = currentPseudo.textContent.trim();
		}
		pseudoInput.focus();
		pseudoInput.select();
	}

	// Afficher le modal via le moteur partagé
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open(modal);
	} else {
		modal.classList.remove('hidden');
		modal.setAttribute('aria-hidden', 'false');
		document.body.style.overflow = 'hidden';
	}

	// Annoncer l'ouverture
	announceToScreenReader('Fenêtre de modification de pseudo ouverte');
}

function hideEditPseudoModal() {
	const modal = document.getElementById('edit-pseudo-modal');
	if (modal) {
		if (window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(modal);
		} else {
			modal.classList.add('hidden');
			modal.setAttribute('aria-hidden', 'true');
			document.body.style.overflow = '';
		}

		// Réinitialiser le champ
		const pseudoInput = document.getElementById('new-pseudo-input');
		if (pseudoInput) pseudoInput.value = '';

		const errorDiv = document.getElementById('pseudo-error');
		if (errorDiv) errorDiv.textContent = '';

		// Annoncer la fermeture
		announceToScreenReader('Fenêtre de modification de pseudo fermée');
	}
}

async function submitEditPseudo() {
	const input = document.getElementById('new-pseudo-input');
	const errorDiv = document.getElementById('pseudo-error');

	if (!input || !errorDiv) return;

	const pseudo = input.value.trim();

	// Validation
	if (pseudo.length < 3 || pseudo.length > 32) {
		errorDiv.textContent = 'Le pseudo doit comporter entre 3 et 32 caractères.';
		return;
	}

	// Vérifier que le pseudo n'est pas le même que l'actuel
	const currentPseudo = document.getElementById('pseudo-text');
	if (currentPseudo && currentPseudo.textContent.trim() === pseudo) {
		errorDiv.textContent = 'Vous utilisez déjà ce pseudo.';
		return;
	}

	try {
		const token = window.SiteApi?.getToken?.() || localStorage.getItem('token');
		if (!token) {
			errorDiv.textContent = 'Session invalide. Veuillez vous reconnecter.';
			return;
		}

		const response = await fetch(`/api/auth/pseudo`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ pseudo }),
		});

		const data = await response.json();

		if (!response.ok) {
			errorDiv.textContent = data.message || 'Erreur lors de la modification.';
			return;
		}

		// SUCCÈS - Mettre à jour localStorage ET currentUser
		hideEditPseudoModal();
		showNotification('Pseudo mis à jour avec succès !', 'success');

		// Mettre à jour l'interface
		if (currentUser) {
			currentUser.pseudo = data.pseudo;

			// Mettre à jour le localStorage
			try {
				localStorage.setItem('userPseudo', data.pseudo);

				// Mettre à jour le token si le serveur en renvoie un nouveau
				if (data.token) {
					localStorage.setItem('token', data.token);
				}

				// Si le serveur retourne des données utilisateur complètes, les stocker
				if (data.user) {
					localStorage.setItem('userId', data.user.id || data.user._id);
					if (data.user.email) {
						localStorage.setItem('userEmail', data.user.email);
					}
				}
			} catch (storageError) {
				console.warn(
					'Erreur lors de la mise à jour du localStorage:',
					storageError,
				);
				showNotification(
					'Pseudo mis à jour, mais problème de stockage local',
					'warning',
				);
			}

			updateUserInfo(currentUser);
		}

		// Annoncer la mise à jour
		announceToScreenReader(`Pseudo mis à jour : ${pseudo}`);
	} catch (err) {
		console.error('Erreur lors de la mise à jour du pseudo:', err);
		errorDiv.textContent = 'Erreur réseau. Veuillez réessayer.';
	}
}
