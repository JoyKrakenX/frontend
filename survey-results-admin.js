/** @format */

// =============================================================
// Configuration
// =============================================================
const config = {
	chartColors: [
		'#6366f1',
		'#10b981',
		'#f59e0b',
		'#ef4444',
		'#8b5cf6',
		'#3b82f6',
		'#06b6d4',
		'#ec4899',
		'#84cc16',
		'#f97316',
	],
};

// =============================================================
// Variables globales
// =============================================================
let allOpinionsData = [];
let opinionsData = [];
let filteredOpinions = [];
let surveyLabels = {};
let surveyOptionKeys = [];
let currentSurvey = null;
let isUserMenuOpen = false;
let demographicFiltersAvailable = false;
let flashDetailsRefreshTimer = null;
let isRefreshingFlashDetails = false;
let lastFlashTotalOpinions = null;
let cachedPdfLogoDataUrl = '';
let membershipRefreshTimer = null;
let isAccessRevoked = false;
let currentAnalyticsSnapshot = null;
let isAnalyticsLoading = false;
let analyticsRefreshTimer = null;
let selectedCommentModerationOpinionId = null;
let commentModerationPressTimer = null;
let activeLongPressOpinionCard = null;
let selectedAdminVoteValue = null;
let isSubmittingAdminVote = false;
const MEMBERSHIP_REFRESH_DEBOUNCE_MS = 420;
const ACCESS_REVOKED_REDIRECT_MS = 1100;
const COMMENT_LONG_PRESS_MS = 520;
const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';
const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';

function setHeaderPseudo(pseudo) {
	const resolvedPseudo = String(pseudo || '').trim() || 'Utilisateur';
	if (window.SiteUserMenu?.setPseudo) {
		window.SiteUserMenu.setPseudo(resolvedPseudo);
		return;
	}

	const pseudoText = document.getElementById('pseudo-text');
	if (pseudoText) {
		pseudoText.textContent = resolvedPseudo;
		return;
	}

	const userName = document.getElementById('user-name');
	if (userName) userName.textContent = resolvedPseudo;
}

// =============================================================
// Lecture paramètres URL
// =============================================================
const params = new URLSearchParams(window.location.search);
const id = params.get('Id');
const type = params.get('type'); // binary | multiple
const requestedFlashMode =
	params.get('flash') === '1' || params.get('flash') === 'true';
let isFlashMode = requestedFlashMode;
const hasValidSurveyContext = Boolean(id && type);

// =============================================================
// Vérification token
// =============================================================
const token = localStorage.getItem('token');
const hasAuthToken = Boolean(token);

async function requestAdminJson(path, options = {}) {
	if (!window.SiteApi?.request) {
		const error = new Error('Client API indisponible. Rechargez la page.');
		error.status = 503;
		throw error;
	}
	return window.SiteApi.request(path, {
		...options,
		auth: true,
	});
}

function ensureBroadcastStudioLinks() {
	if (!hasValidSurveyContext) return;
	const query = new URLSearchParams({ Id: String(id), type: String(type || 'binary') });
	if (isFlashMode) {
		query.set('flash', '1');
	}
	const href = `broadcast-studio.html?${query.toString()}`;

	const toolbar = document.getElementById('results-toolbar');
	if (toolbar && !toolbar.querySelector('.broadcast-studio-link')) {
		const link = document.createElement('a');
		link.href = href;
		link.className = 'btn-export btn-export-glass broadcast-studio-link';
		link.innerHTML = `<i class="fas fa-tower-broadcast"></i> ${t(
			'broadcast.studio.title',
			'Studio broadcast',
		)}`;
		toolbar.appendChild(link);
	}

	const pageActions = document.getElementById('page-actions');
	if (pageActions && !pageActions.querySelector('.broadcast-studio-header-link')) {
		const link = document.createElement('a');
		link.href = href;
		link.className = 'btn-secondary broadcast-studio-header-link';
		link.title = t('broadcast.studio.title', 'Studio broadcast');
		link.innerHTML = `<i class="fas fa-tower-broadcast"></i><span>${t(
			'broadcast.studio.short_title',
			'Studio',
		)}</span>`;
		pageActions.prepend(link);
	}
}

// =============================================================
// API dynamique
// =============================================================
const STANDARD_BASE_URL =
	type === 'binary' ?
		'/api/survey'
	:	'/api/survey_2';
const FLASH_BASE_URL =
	type === 'binary' ? '/api/survey-flash' : '/api/survey-2-flash';

// =============================================================
// SOCKET.IO
// =============================================================
let socketDependencyWarned = false;

function logDependencyIssue(code, context = {}) {
	console.warn(`[${code}]`, {
		page: 'survey-results-admin',
		surveyId: id,
		type,
		flash: isFlashMode,
		...context,
	});
}

const socketConfig = {
	auth: token ? { token } : undefined,
};

const createFallbackSocket = () => ({
	connected: false,
	on: () => {},
	once: () => {},
	emit: () => {},
});

function isMembershipEventRelevant(payload = {}) {
	const eventOrgId = String(payload?.organizationId || payload?.orgId || '').trim();
	const surveyOrgId = String(currentSurvey?.organizationId || '').trim();
	if (!eventOrgId || !surveyOrgId) return true;
	return eventOrgId === surveyOrgId;
}

function handleAdminAccessRevoked(message) {
	if (isAccessRevoked) return;
	isAccessRevoked = true;

	if (membershipRefreshTimer) {
		window.clearTimeout(membershipRefreshTimer);
		membershipRefreshTimer = null;
	}
	if (flashDetailsRefreshTimer) {
		window.clearTimeout(flashDetailsRefreshTimer);
		flashDetailsRefreshTimer = null;
	}

	leaveLiveRoom();

	const safeMessage =
		String(message || '').trim() ||
		t(
			'shared.surveys.admin_access_revoked',
			'Vos droits admin sur ce sondage ont ete retires.',
		);
	showNotification(safeMessage, 'warning');

	window.setTimeout(() => {
		window.location.href = 'my-surveys.html';
	}, ACCESS_REVOKED_REDIRECT_MS);
}

function scheduleMembershipAccessRefresh(payload = {}) {
	if (isAccessRevoked) return;
	if (!isMembershipEventRelevant(payload)) return;

	if (membershipRefreshTimer) {
		window.clearTimeout(membershipRefreshTimer);
	}

	membershipRefreshTimer = window.setTimeout(() => {
		membershipRefreshTimer = null;
		void getSurveyDetails({ silent: true, reason: 'membership-update' });
	}, MEMBERSHIP_REFRESH_DEBOUNCE_MS);
}

const socket =
	typeof window.io === 'function' ? window.io(socketConfig) : createFallbackSocket();

if (typeof window.io !== 'function') {
	socketDependencyWarned = true;
	logDependencyIssue('DEPENDENCY_SOCKET_MISSING');
}

socket.on('connect', () => {
	if (!currentSurvey) return;
	joinLiveRoom();
});

socket.on('updateOpinionLikes', ({ opinionId, likeCount, dislikeCount }) => {
	updateOpinionLikes(opinionId, likeCount, dislikeCount);
});

socket.on('flash:counts', (payload) => {
	if (!isFlashMode || !isFlashPayloadForCurrentSurvey(payload)) return;
	applyLiveCounts(payload);
});

socket.on('flash:new-opinion', (payload) => {
	if (!isFlashMode || !payload) return;
	if (String(payload.surveyId || '') !== String(id)) return;
	upsertLiveOpinion(payload);
});

socket.on('flash:reaction', (payload) => {
	if (!isFlashMode || !payload?.opinionId) return;
	updateOpinionLikes(
		payload.opinionId,
		payload.likeCount || 0,
		payload.dislikeCount || 0,
	);
});

socket.on('flash:comment-deleted', (payload) => {
	if (!isFlashMode || !isFlashPayloadForCurrentSurvey(payload)) return;
	markOpinionCommentDeletedLocally(payload.opinionId, payload.deletedAt);
});

socket.on('flash:closed', (payload) => {
	if (!isFlashMode || !isFlashPayloadForCurrentSurvey(payload)) return;
	if (currentSurvey) {
		currentSurvey.isClosed = true;
		renderSurveyHeader(currentSurvey);
	}
	showNotification('Sondage clôturé. Les votes sont figés.', 'info');
	scheduleLiveDetailedRefresh(180);
});

socket.on('classic:counts', (payload) => {
	if (!isClassicPayloadForCurrentSurvey(payload)) return;
	applyLiveCounts(payload);
});

socket.on('classic:new-opinion', (payload) => {
	if (!isClassicPayloadForCurrentSurvey(payload)) return;
	upsertLiveOpinion(payload);
});

socket.on('classic:reaction', (payload) => {
	if (!isClassicPayloadForCurrentSurvey(payload) || !payload?.opinionId) return;
	updateOpinionLikes(
		payload.opinionId,
		payload.likeCount || 0,
		payload.dislikeCount || 0,
	);
});

socket.on('classic:comment-deleted', (payload) => {
	if (!isClassicPayloadForCurrentSurvey(payload)) return;
	markOpinionCommentDeletedLocally(payload.opinionId, payload.deletedAt);
});

socket.on('classic:closed', (payload) => {
	if (!isClassicPayloadForCurrentSurvey(payload)) return;
	if (currentSurvey) {
		currentSurvey.isClosed = true;
		renderSurveyHeader(currentSurvey);
	}
	showNotification('Sondage clôturé. Les votes sont figés.', 'info');
	scheduleLiveDetailedRefresh(180);
});

socket.on('analytics:update', (payload) => {
	if (!payload || String(payload.surveyId || '') !== String(id)) return;
	scheduleAnalyticsRefresh(220);
});

socket.on('classic:error', (payload) => {
	if (!payload?.message) return;
	showNotification(String(payload.message), 'warning');
	if (String(payload.code || '').toUpperCase() === 'FORBIDDEN') {
		handleAdminAccessRevoked(payload.message);
	}
});

socket.on('flash:error', (payload) => {
	if (!payload?.message) return;
	if (!isFlashMode) return;
	showNotification(String(payload.message), 'warning');
	if (String(payload.code || '').toUpperCase() === 'FORBIDDEN') {
		handleAdminAccessRevoked(payload.message);
	}
});

socket.on('organizations:membership:update', (payload) => {
	scheduleMembershipAccessRefresh(payload || {});
});

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	if (!USE_SHARED_USER_MENU()) {
		checkUserLoginState(); // Legacy fallback
	}
	ensureBroadcastStudioLinks();
	initializeEventListeners();
	initializeFooter();

	if (!hasValidSurveyContext) {
		renderResultsAdminState({
			title: 'Résultat indisponible',
			message:
				"Le lien de résultats administrateur est incomplet. Rouvrez ce sondage depuis votre espace pour accéder à ses résultats.",
			variant: 'error',
			icon: 'fa-link-slash',
		});
		return;
	}

	if (!hasAuthToken) {
		renderResultsAdminState({
			title: 'Connexion requise',
			message:
				'Connectez-vous avec un compte autorisé pour consulter les résultats administrateur de ce sondage.',
			variant: 'warning',
			icon: 'fa-user-lock',
			allowLogin: true,
		});
		return;
	}

	if (socketDependencyWarned) {
		showNotification(
			t(
				'shared.surveys.live_updates_unavailable',
				'Mises a jour en temps reel indisponibles. Rafraichissez la page.',
			),
			'warning',
		);
	}
	getSurveyDetails();
});

document.addEventListener('site:language-changed', () => {
	if (!id || !type || !token) return;
	getSurveyDetails();
});

// =============================================================
// Gestionnaires d'événements
// =============================================================
function renderResultsAdminState({
	title,
	message,
	variant = 'warning',
	icon = 'fa-circle-info',
	allowLogin = false,
} = {}) {
	document.getElementById('loading')?.classList.add('hidden');
	document.getElementById('survey-header')?.classList.add('hidden');
	document.getElementById('results-toolbar')?.classList.add('hidden');
	document.getElementById('admin-analytics-dashboard')?.classList.add('hidden');
	document.getElementById('admin-vote-gate')?.classList.add('hidden');
	document.querySelector('.dashboard-container')?.classList.add('hidden');
	const container = document.querySelector('main .container') || document.querySelector('main');
	if (!container) return;

	const actions = [
		{
			label: 'Mes sondages',
			icon: 'fa-folder-open',
			href: 'my-surveys.html',
		},
		{
			label: 'Parcourir les sondages',
			icon: 'fa-list',
			href: 'browse-surveys.html',
			secondary: true,
		},
	];

	if (allowLogin) {
		actions.unshift({
			label: 'Se connecter',
			icon: 'fa-right-to-bracket',
			onClick: () => window.SiteApi?.beginGoogleAuth?.(),
		});
	}

	window.SiteUI?.renderPageState?.({
		mount: container,
		variant,
		icon,
		title,
		message,
		actions,
	});
}

function initializeEventListeners() {
	// Bouton retour
	document.getElementById('back-btn')?.addEventListener('click', () => {
		window.history.back();
	});

	// Bouton export
	document
		.getElementById('export-btn')
		?.addEventListener('click', showExportModal);
	document
		.getElementById('admin-vote-options')
		?.addEventListener('click', (event) => {
			const button = event.target.closest('.admin-vote-option');
			if (!button) return;
			selectedAdminVoteValue = String(button.dataset.value || '').trim();
			document.querySelectorAll('.admin-vote-option').forEach((node) => {
				node.classList.toggle('is-selected', node === button);
			});
			const submitButton = document.getElementById('admin-vote-submit');
			if (submitButton) submitButton.disabled = !selectedAdminVoteValue;
		});
	document
		.getElementById('admin-vote-submit')
		?.addEventListener('click', () => {
			void submitAdminVoteFromResultsPage();
		});

	// Fermer la modale d'export en cliquant à l'extérieur
	document.getElementById('export-modal')?.addEventListener('click', (e) => {
		if (e.target === e.currentTarget) {
			hideExportModal();
		}
	});

	// Options d'export
	document.querySelectorAll('.export-option').forEach((option) => {
		option.addEventListener('click', () => {
			const format = option.dataset.format;
			exportResults(format);
		});
	});

	// Fermeture robuste du modal export (X + Annuler/Fermer)
	document
		.querySelectorAll('#export-modal [data-modal-close], #export-modal .close-modal')
		.forEach((button) => {
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				hideExportModal();
			});
		});

	// Recherche avec debounce pour performances
	let searchTimeout;
	document.getElementById('search-opinions')?.addEventListener('input', (e) => {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			filterOpinions();
		}, 300);
	});

	// Filtres
	document
		.getElementById('filter-answer')
		?.addEventListener('change', filterOpinions);
	document
		.getElementById('sort-by')
		?.addEventListener('change', filterOpinions);
	document
		.getElementById('filter-gender')
		?.addEventListener('change', filterOpinions);
	document
		.getElementById('age-from')
		?.addEventListener('input', filterOpinions);
	document
		.getElementById('age-to')
		?.addEventListener('input', filterOpinions);

	document
		.getElementById('comment-delete-confirm-btn')
		?.addEventListener('click', () => {
			void deleteSelectedComment();
		});

	document
		.querySelectorAll(
			'#comment-moderation-modal [data-comment-moderation-close], #comment-moderation-modal .close-modal',
		)
		.forEach((button) => {
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				closeCommentModerationModal();
			});
		});

	document
		.getElementById('comment-moderation-modal')
		?.addEventListener('click', (event) => {
			if (event.target === event.currentTarget) {
				closeCommentModerationModal();
			}
		});

	document.getElementById('opinions-list')?.addEventListener('click', (event) => {
		const trigger = event.target?.closest?.('[data-comment-moderation-trigger]');
		if (!trigger) return;
		const opinionId = String(trigger.getAttribute('data-opinion-id') || '').trim();
		if (!opinionId) return;
		event.preventDefault();
		event.stopPropagation();
		openCommentModerationModal(opinionId);
	});

	document
		.getElementById('opinions-list')
		?.addEventListener('pointerdown', handleCommentModerationPointerDown);
	document
		.getElementById('opinions-list')
		?.addEventListener('pointerup', clearCommentModerationPressState);
	document
		.getElementById('opinions-list')
		?.addEventListener('pointerleave', clearCommentModerationPressState);
	document
		.getElementById('opinions-list')
		?.addEventListener('pointercancel', clearCommentModerationPressState);

	if (!USE_SHARED_USER_MENU()) {
		document.getElementById('login-btn')?.addEventListener('click', () => {
			window.redirectToGoogleAuth?.();
		});

		document.getElementById('logout-btn')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const userMenuDetails = document.querySelector('.user-menu-details');
			if (userMenuDetails?.hasAttribute('open')) {
				userMenuDetails.removeAttribute('open');
				isUserMenuOpen = false;
				updateChevronIcon();
			}
			document.getElementById('logout-confirm-modal')?.classList.remove('hidden');
		});

		document.getElementById('logout-cancel')?.addEventListener('click', () => {
			document.getElementById('logout-confirm-modal').classList.add('hidden');
		});

		document.getElementById('logout-ok')?.addEventListener('click', () => {
			handleLogout();
		});

		window.addEventListener('resize', handleWindowResize);
		window.addEventListener('scroll', handleWindowScroll);
	}

	window.addEventListener('pageshow', () => {
		refreshChartLayout();
	});
	window.addEventListener('orientationchange', () => {
		window.setTimeout(refreshChartLayout, 150);
	});
}

// =============================================================
// GESTION DU MENU UTILISATEUR (Responsive Design)
// =============================================================
function initializeUserMenuListeners() {
	const userMenuDetails = document.querySelector('.user-menu-details');
	const userMenuSummary = document.querySelector('.user-menu-summary');

	if (!userMenuDetails || !userMenuSummary) return;

	// Gestion de l'ouverture/fermeture du menu
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
	});

	// Empêcher la fermeture automatique lors du clic dans le menu
	const dropdown = userMenuDetails.querySelector('.user-dropdown');
	if (dropdown) {
		dropdown.addEventListener('click', (e) => {
			e.stopPropagation();
		});
	}

	// Gestion du clic en dehors du menu utilisateur pour le fermer
	document.addEventListener('click', (e) => {
		const userMenu = document.querySelector('.user-menu-container');

		if (userMenu && !userMenu.contains(e.target) && isUserMenuOpen) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	});
}

// =============================================================
// FONCTIONS UTILITAIRES POUR LE MENU UTILISATEUR
// =============================================================
function updateChevronIcon() {
	const chevronIcon = document.querySelector('.chevron-icon');
	if (chevronIcon) {
		if (isUserMenuOpen) {
			chevronIcon.className = 'fas fa-chevron-up chevron-icon';
		} else {
			chevronIcon.className = 'fas fa-chevron-down chevron-icon';
		}
	}
}

// Gestion du redimensionnement de la fenêtre (responsive)
function handleWindowResize() {
	const userMenuDetails = document.querySelector('.user-menu-details');

	// Fermer le menu utilisateur lors du changement de taille d'écran
	if (userMenuDetails?.hasAttribute('open')) {
		userMenuDetails.removeAttribute('open');
		isUserMenuOpen = false;
		updateChevronIcon();
	}
}

// Gestion du défilement sur mobile/tablette
function handleWindowScroll() {
	const userMenuDetails = document.querySelector('.user-menu-details');

	// Fermer le menu utilisateur lors du défilement sur mobile/tablette
	if (window.innerWidth <= 768 && userMenuDetails?.hasAttribute('open')) {
		userMenuDetails.removeAttribute('open');
		isUserMenuOpen = false;
		updateChevronIcon();
	}
}

// =============================================================
// GESTION DE LA DÉCONNEXION
// =============================================================
function handleLogout() {
	try {
		// Nettoyer le stockage local
		localStorage.removeItem('token');
		localStorage.removeItem('user');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');

		// Fermer le modal
		document.getElementById('logout-confirm-modal').classList.add('hidden');

		// Afficher une notification
		showNotification('Déconnexion réussie', 'success');

		// Mettre à jour l'interface utilisateur
		checkUserLoginState();

		// Rediriger après un court délai
		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 1500);
	} catch (error) {
		console.warn('Erreur lors de la déconnexion:', error);
		showNotification('Erreur lors de la déconnexion', 'error');
	}
}

// =============================================================
// Vérifier l'état de connexion de l'utilisateur
// =============================================================
function checkUserLoginState() {
	if (USE_SHARED_USER_MENU()) return;

	const userMenu = document.getElementById('user-menu');
	const loginBtn = document.getElementById('login-btn');

	// Récupérer les données d'authentification
	const token = localStorage.getItem('token');
	const user = JSON.parse(localStorage.getItem('user'));
	const userId = localStorage.getItem('userId');
	const userPseudo = localStorage.getItem('userPseudo');

	// Vérifier si l'utilisateur est connecté
	const isLoggedIn = !!(token && (user || userId || userPseudo));

	if (isLoggedIn) {
		// Utilisateur connecté : afficher le menu utilisateur, masquer le bouton de connexion
		userMenu.classList.remove('hidden');
		loginBtn.classList.add('hidden');

		// Mettre à jour le nom d'utilisateur
		const displayName = userPseudo || (user && user.pseudo) || 'Utilisateur';
		setHeaderPseudo(displayName);

		// Initialiser les écouteurs du menu utilisateur
		initializeUserMenuListeners();
	} else {
		// Utilisateur non connecté : masquer le menu utilisateur, afficher le bouton de connexion
		userMenu.classList.add('hidden');
		loginBtn.classList.remove('hidden');
	}
}

// =============================================================
// Récupération des données
// =============================================================
async function getSurveyDetails({ silent = false, reason = 'manual' } = {}) {
	if (isAccessRevoked) return;

	try {
		if (!silent) {
			showLoading(true);
		}

		const surveyRes = await fetch(`${STANDARD_BASE_URL}/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (surveyRes.status === 403) {
			const payload = await surveyRes.json().catch(() => ({}));
			handleAdminAccessRevoked(
				payload.message ||
					t(
						'shared.surveys.admin_access_revoked',
						'Vos droits admin sur ce sondage ont ete retires.',
					),
			);
			return;
		}
		if (!surveyRes.ok) {
			throw new Error('Erreur lors de la récupération du sondage');
		}
		const survey = await surveyRes.json();

		// Store for exports
		currentSurvey = survey;
		isFlashMode = survey.explain === false || requestedFlashMode;
		if (survey.explain !== false) {
			isFlashMode = false;
		}

		const resultsBaseUrl = isFlashMode ? FLASH_BASE_URL : STANDARD_BASE_URL;
		const resultsRes = await fetch(`${resultsBaseUrl}/${id}/detailed-results`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (resultsRes.status === 403) {
			const payload = await resultsRes.json().catch(() => ({}));
			if (String(payload?.code || '').toUpperCase() === 'ADMIN_VOTE_REQUIRED') {
				renderSurveyHeader(survey);
				renderAdminVoteGate(survey, payload);
				if (!silent) showLoading(false);
				return;
			}
			renderResultsAdminState({
				title: 'Vote requis',
				message:
					payload.message ||
					'Votez pour accéder aux résultats en temps réel.',
				variant: 'warning',
				icon: 'fa-vote-yea',
			});
			return;
		}
		if (!resultsRes.ok) {
			const errorPayload = await resultsRes.json().catch(() => ({}));
			throw new Error(
				errorPayload.message || 'Erreur lors de la récupération des résultats',
			);
		}
		const results = await resultsRes.json();

		// Render header & results according to type
		renderSurveyHeader(survey);
		hideAdminVoteGate();
		const dashboard = document.querySelector('.dashboard-container');
		dashboard?.classList.remove('hidden');
		document.getElementById('results-toolbar')?.classList.remove('hidden');

		if (type === 'binary') {
			handleBinaryResults(results, survey);
		} else {
			handleMultipleResults(results, survey);
		}
		await fetchAdminAnalytics({ silent: true });
		joinLiveRoom();

		if (!silent) {
			showLoading(false);
		}
		refreshChartLayout();
	} catch (err) {
		console.error(`Erreur getSurveyDetails (${reason}):`, err);
		if (!silent) {
			showNotification(err.message || 'Erreur lors du chargement', 'error');
			showLoading(false);
		}
	}
}

function formatAnalyticsNumber(value, fallback = '0') {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return number.toLocaleString(getIntlLocale());
}

function formatAnalyticsDate(value) {
	const date = value ? new Date(value) : null;
	if (!date || Number.isNaN(date.getTime())) return 'Non disponible';
	return date.toLocaleString(getIntlLocale(), {
		month: 'short',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function setAnalyticsText(idOrNode, value) {
	const node =
		typeof idOrNode === 'string' ? document.getElementById(idOrNode) : idOrNode;
	if (!node) return;
	node.textContent = String(value ?? '');
}

function getAnalyticsEndpoint() {
	const query = new URLSearchParams({
		type: type === 'multiple' ? 'multiple' : 'binary',
		flash: isFlashMode ? '1' : '0',
	});
	return `/api/survey-analytics/${encodeURIComponent(id)}/admin?${query.toString()}`;
}

function scheduleAnalyticsRefresh(delay = 300) {
	if (analyticsRefreshTimer) {
		window.clearTimeout(analyticsRefreshTimer);
	}
	analyticsRefreshTimer = window.setTimeout(() => {
		analyticsRefreshTimer = null;
		void fetchAdminAnalytics({ silent: true });
	}, Math.max(0, Number(delay) || 0));
}

async function fetchAdminAnalytics({ silent = false } = {}) {
	if (!id || !type || !token || isAccessRevoked || isAnalyticsLoading) return null;
	isAnalyticsLoading = true;
	try {
		const response = await fetch(getAnalyticsEndpoint(), {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (response.status === 403) {
			const payload = await response.json().catch(() => ({}));
			handleAdminAccessRevoked(payload.message);
			return null;
		}
		if (!response.ok) {
			throw new Error('Analytics administrateur indisponibles.');
		}
		currentAnalyticsSnapshot = await response.json();
		renderAdminAnalytics(currentAnalyticsSnapshot);
		return currentAnalyticsSnapshot;
	} catch (error) {
		if (!silent) {
			showNotification(error?.message || 'Analytics indisponibles.', 'warning');
		}
		return null;
	} finally {
		isAnalyticsLoading = false;
	}
}

function renderAnalyticsRows(containerId, rows = []) {
	const container = document.getElementById(containerId);
	if (!container) return;
	container.innerHTML = rows
		.map(
			(row) => `
				<div class="analytics-row">
					<span>${sanitizeInlineHtml(row.label)}</span>
					<strong>${sanitizeInlineHtml(row.value)}</strong>
				</div>
			`,
		)
		.join('');
}

function renderAnalyticsSourceGrid(sources = {}) {
	const labels = {
		tv: 'TV',
		social: 'Social',
		direct: 'Lien direct',
	};
	const container = document.getElementById('analytics-sources');
	if (!container) return;
	container.innerHTML = Object.entries(labels)
		.map(
			([key, label]) => `
				<div class="analytics-source-item">
					<span>${label}</span>
					<strong>${formatAnalyticsNumber(sources[key] || 0)}</strong>
				</div>
			`,
		)
		.join('');
}

function renderAnalyticsBars(containerId, items = [], { labelKey = 'label', valueKey = 'count' } = {}) {
	const container = document.getElementById(containerId);
	if (!container) return;
	const max = Math.max(1, ...items.map((item) => Number(item?.[valueKey] || 0)));
	container.innerHTML = items.length ?
		items
			.map((item) => {
				const label = item?.[labelKey] || item?.countryName || item?.countryCode || 'N/A';
				const value = Number(item?.[valueKey] || 0);
				const width = Math.max(4, Math.round((value / max) * 100));
				return `
					<div class="analytics-timeline-item">
						<b>${sanitizeInlineHtml(label)}</b>
						<small>${formatAnalyticsNumber(value)}</small>
						<div class="analytics-bar"><i style="width:${width}%"></i></div>
					</div>
				`;
			})
			.join('')
		:	'<div class="analytics-row"><span>Aucune donnée</span><strong>0</strong></div>';
}

function isKnownAnalyticsCountry(country = {}) {
	const code = String(country?.countryCode || '').trim().toUpperCase();
	const name = String(country?.countryName || '').trim().toLowerCase();
	return Boolean(code && code !== 'XX' && name && name !== 'unknown' && name !== 'inconnu');
}

function filterKnownAnalyticsCountries(countries = []) {
	return (Array.isArray(countries) ? countries : []).filter(isKnownAnalyticsCountry);
}

function renderAnalyticsSparkline(containerId, points = []) {
	const container = document.getElementById(containerId);
	if (!container) return;
	const max = Math.max(1, ...points.map((point) => Number(point?.count || 0)));
	const bars = points.length ?
		points
			.slice(-24)
			.map((point) => {
				const height = Math.max(8, Math.round((Number(point?.count || 0) / max) * 100));
				return `<span title="${sanitizeInlineHtml(formatAnalyticsDate(point?.minute))}: ${formatAnalyticsNumber(point?.count || 0)} scan(s)" style="height:${height}%"></span>`;
			})
			.join('')
		:	'<span title="Aucune donnée" style="height:8%"></span>';
	container.innerHTML = `
		<div class="analytics-sparkline-bars" aria-hidden="true">${bars}</div>
		<p class="analytics-sparkline-caption">Chaque colonne représente une minute de scans QR. Plus la colonne est haute, plus le QR a été ouvert à cette minute.</p>
	`;
}

function renderAnalyticsEmojiLineChart(containerId, emojiTimeline = {}) {
	const container = document.getElementById(containerId);
	if (!container) return;
	const series = Array.isArray(emojiTimeline.series) ? emojiTimeline.series.slice(0, 5) : [];
	const points = Array.isArray(emojiTimeline.points) ? emojiTimeline.points.slice(-24) : [];
	if (!series.length || !points.length) {
		container.innerHTML = '<div class="analytics-row"><span>Aucune variation emoji</span><strong>0</strong></div>';
		return;
	}

	const width = 420;
	const height = 150;
	const padding = 18;
	const maxValue = Math.max(
		1,
		...points.flatMap((point) =>
			series.map((item) => Number(point?.values?.[item.emoji] || 0)),
		),
	);
	const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
	const colors = ['#a78bfa', '#22d3ee', '#f472b6', '#34d399', '#fbbf24'];
	const lines = series
		.map((item, seriesIndex) => {
			const coordinates = points
				.map((point, pointIndex) => {
					const value = Number(point?.values?.[item.emoji] || 0);
					const x = padding + pointIndex * xStep;
					const y = height - padding - (value / maxValue) * (height - padding * 2);
					return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`;
				})
				.join(' ');
			const color = colors[seriesIndex % colors.length];
			return `<polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
		})
		.join('');
	const dots = series
		.map((item, seriesIndex) => {
			const color = colors[seriesIndex % colors.length];
			return points
				.map((point, pointIndex) => {
					const value = Number(point?.values?.[item.emoji] || 0);
					if (value <= 0) return '';
					const x = padding + pointIndex * xStep;
					const y = height - padding - (value / maxValue) * (height - padding * 2);
					return `<circle cx="${Number(x.toFixed(2))}" cy="${Number(y.toFixed(2))}" r="3.5" fill="${color}"><title>${sanitizeInlineHtml(item.emoji)} · ${formatAnalyticsDate(point.minute)}: ${formatAnalyticsNumber(value)}</title></circle>`;
				})
				.join('');
		})
		.join('');
	const legend = series
		.map((item, index) => {
			const color = colors[index % colors.length];
			return `<span class="analytics-emoji-legend-item"><i style="background:${color}"></i><strong>${sanitizeInlineHtml(item.emoji)}</strong><small>${formatAnalyticsNumber(item.count || 0)}</small></span>`;
		})
		.join('');

	container.innerHTML = `
		<div class="analytics-emoji-chart" role="img" aria-label="Variations des emojis dans le chat">
			<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
				<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(226,232,240,.2)" stroke-width="1"></line>
				<line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="rgba(226,232,240,.16)" stroke-width="1"></line>
				${lines}
				${dots}
			</svg>
		</div>
		<div class="analytics-emoji-legend">${legend}</div>
	`;
}

function renderAdminAnalytics(snapshot = {}) {
	document.getElementById('admin-analytics-dashboard')?.classList.remove('hidden');
	const acquisition = snapshot.acquisition || {};
	const conversion = snapshot.conversion || {};
	const opinions = snapshot.opinions || {};
	const chat = snapshot.chat || {};
	const profile = snapshot.profile || {};
	const retention = snapshot.retention || {};
	const reliability = snapshot.reliability || {};

	setAnalyticsText('analytics-kpi-scans', formatAnalyticsNumber(acquisition.totalScans || 0));
	setAnalyticsText(
		'analytics-kpi-scans-meta',
		`${formatAnalyticsNumber((acquisition.scansPerMinute || []).at(-1)?.count || 0)}/min`,
	);
	setAnalyticsText('analytics-kpi-voters', formatAnalyticsNumber(conversion.votersRealtime || 0));
	setAnalyticsText('analytics-kpi-conversion', `${Number(conversion.scanToVoteRate || 0)}% scan vers vote`);
	setAnalyticsText('analytics-kpi-messages', formatAnalyticsNumber(chat.totalMessages || 0));
	setAnalyticsText('analytics-kpi-chatters', `${formatAnalyticsNumber(chat.activeParticipants || 0)} participants actifs`);
	setAnalyticsText('analytics-kpi-retention', `${Number(retention.voterRetentionRate || 0)}%`);
	setAnalyticsText('analytics-kpi-returning', `${formatAnalyticsNumber(retention.returningVoters || 0)} votants revenus`);

	renderAnalyticsBars('analytics-top-countries', filterKnownAnalyticsCountries(acquisition.topCountries || []), {
		labelKey: 'countryName',
		valueKey: 'count',
	});
	renderAnalyticsSourceGrid(acquisition.sources || {});
	renderAnalyticsSparkline('analytics-scans-minute', acquisition.scansPerMinute || []);
	renderAnalyticsRows('analytics-conversion-funnel', [
		{ label: 'Scans mesurés', value: formatAnalyticsNumber(acquisition.totalScans || 0) },
		{ label: 'Votes temps réel', value: formatAnalyticsNumber(conversion.votersRealtime || 0) },
		{ label: 'Temps moyen scan → vote', value: `${formatAnalyticsNumber(conversion.averageScanToVoteSeconds || 0)} s` },
		{ label: 'Pic de votes', value: conversion.peakVotesMinute ? `${formatAnalyticsNumber(conversion.peakVotesMinute.count)} · ${formatAnalyticsDate(conversion.peakVotesMinute.minute)}` : 'Non disponible' },
		{ label: 'Sondage précédent', value: `${formatAnalyticsNumber(conversion.previousSurveyVoters || 0)} votants` },
	]);
	renderAnalyticsSparkline('analytics-opinion-timeline', opinions.votesPerMinute || []);
	renderAnalyticsRows('analytics-chat-activity', [
		{ label: 'Participants chat', value: formatAnalyticsNumber(chat.activeParticipants || 0) },
		{ label: 'Actifs en temps réel', value: formatAnalyticsNumber(chat.activeUsersRealtime || 0) },
		{ label: 'Pic messages', value: chat.peakMessagesMinute ? `${formatAnalyticsNumber(chat.peakMessagesMinute.count)} · ${formatAnalyticsDate(chat.peakMessagesMinute.minute)}` : 'Non disponible' },
		{ label: 'Taux votants → chat', value: `${Number(chat.voterToChatParticipantRate || 0)}%` },
	]);
	const emojiNode = document.getElementById('analytics-emoji-peaks');
	if (emojiNode) {
		renderAnalyticsEmojiLineChart('analytics-emoji-peaks', chat.emojiTimeline || {});
	}
	renderAnalyticsRows('analytics-profile', [
		{ label: 'Âge dominant', value: profile.topAgeBand?.label || 'Non renseigné' },
		{ label: 'Genre dominant', value: profile.dominantGender?.label || 'Non renseigné' },
		{ label: 'Pays dominant', value: profile.dominantCountry?.countryName || profile.dominantCountry?.countryCode || 'Non renseigné' },
	]);
	renderAnalyticsRows('analytics-retention', [
		{ label: 'Votants revenus', value: formatAnalyticsNumber(retention.returningVoters || 0) },
		{ label: 'Chatters revenus', value: formatAnalyticsNumber(retention.returningChatParticipants || 0) },
		{ label: 'Rétention chat', value: `${Number(retention.chatRetentionRate || 0)}%` },
	]);
	setAnalyticsText(
		'analytics-reliability-note',
		reliability.note ||
			'Community mesure une audience participante active, pas une audience TV représentative totale.',
	);
}

function getAdminVoteEndpoint() {
	const baseUrl = isFlashMode ? FLASH_BASE_URL : STANDARD_BASE_URL;
	return `${baseUrl}/${encodeURIComponent(id)}/answer`;
}

function getAdminBinaryLabels(survey = currentSurvey) {
	const labels = survey?.binaryLabels || {};
	return {
		yes: String(labels.yes || '').trim() || t('shared.answers.yes', 'Oui'),
		no: String(labels.no || '').trim() || t('shared.answers.no', 'Non'),
	};
}

function getAdminVoteOptions(survey) {
	if (type === 'binary') {
		const labels = getAdminBinaryLabels(survey);
		return [
			{ value: 'true', label: labels.yes, icon: 'fa-check-circle' },
			{ value: 'false', label: labels.no, icon: 'fa-times-circle' },
		];
	}
	const optionPayload = resolveMultipleOptionData({}, survey);
	return optionPayload.optionKeys.map((key, index) => ({
		value: key,
		label: optionPayload.labelsMap[key] || `Option ${index + 1}`,
		icon: 'fa-circle-dot',
	}));
}

function renderAdminVoteGate(survey, payload = {}) {
	currentSurvey = survey;
	selectedAdminVoteValue = null;
	document.getElementById('loading')?.classList.add('hidden');
	document.getElementById('survey-header')?.classList.remove('hidden');
	document.getElementById('results-toolbar')?.classList.add('hidden');
	document.getElementById('admin-analytics-dashboard')?.classList.add('hidden');
	document.querySelector('.dashboard-container')?.classList.add('hidden');

	const gate = document.getElementById('admin-vote-gate');
	const optionsNode = document.getElementById('admin-vote-options');
	const messageNode = document.getElementById('admin-vote-message');
	const submitButton = document.getElementById('admin-vote-submit');
	if (!gate || !optionsNode) return;

	const canVote = payload?.canVote !== false && !survey?.isClosed;
	gate.classList.remove('hidden');
	if (messageNode) {
		messageNode.textContent =
			payload?.message ||
			'Votez depuis cette page administrateur pour afficher les résultats.';
	}
	optionsNode.innerHTML = getAdminVoteOptions(survey)
		.map(
			(option) => `
				<button class="admin-vote-option" type="button" data-value="${sanitizeInlineHtml(option.value)}" ${canVote ? '' : 'disabled'}>
					<i class="fas ${sanitizeInlineHtml(option.icon)}"></i>
					<span>${sanitizeInlineHtml(option.label)}</span>
				</button>
			`,
		)
		.join('');

	const reasonWrap = document.getElementById('admin-vote-reason-wrap');
	const reasonInput = document.getElementById('admin-vote-reason');
	const needsComment = survey?.explain !== false;
	reasonWrap?.classList.toggle('hidden', !needsComment || !canVote);
	if (reasonInput) {
		reasonInput.value = '';
		reasonInput.placeholder = needsComment ?
			'Commentaire obligatoire pour ce sondage...'
		:	'Commentaire facultatif...';
	}
	if (submitButton) {
		submitButton.disabled = true;
		submitButton.classList.toggle('hidden', !canVote);
	}
}

function hideAdminVoteGate() {
	document.getElementById('admin-vote-gate')?.classList.add('hidden');
	selectedAdminVoteValue = null;
}

async function submitAdminVoteFromResultsPage() {
	if (!selectedAdminVoteValue || isSubmittingAdminVote) return;
	isSubmittingAdminVote = true;
	const submitButton = document.getElementById('admin-vote-submit');
	if (submitButton) submitButton.disabled = true;

	try {
		const reason = String(document.getElementById('admin-vote-reason')?.value || '').trim();
		const body =
			type === 'binary' ?
				{ answer: selectedAdminVoteValue === 'true', reason }
			:	{ choice: selectedAdminVoteValue, reason };
		await requestAdminJson(getAdminVoteEndpoint(), {
			method: 'POST',
			data: body,
		});
		showNotification('Vote enregistré. Chargement des résultats...', 'success');
		await getSurveyDetails({ silent: true, reason: 'admin-vote' });
	} catch (error) {
		showNotification(
			error?.payload?.message || error.message || 'Impossible d enregistrer le vote.',
			'error',
		);
		if (submitButton) submitButton.disabled = false;
	} finally {
		isSubmittingAdminVote = false;
	}
}

// =============================================================
// Affichage en-tete du sondage
// =============================================================
function refreshChartLayout() {
	// Les anciens graphiques Chart.js ont été remplacés par les cartes broadcast.
}

function isOpinionCommentVisible(opinion) {
	return (
		!opinion?.commentModeration?.isDeleted &&
		String(opinion?.reason || '').trim().length > 0
	);
}

function hasOpinionComment(opinion) {
	return isOpinionCommentVisible(opinion);
}

function sanitizeInlineHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function formatQuotedComment(value) {
	const cleanValue = String(value || '').trim();
	if (!cleanValue) {
		return '<em class="comment-empty">Aucun commentaire</em>';
	}
	return `<span class="comment-quote-text">"${sanitizeInlineHtml(cleanValue)}"</span>`;
}

function getCommentDeleteEndpoint(opinionId) {
	const baseUrl =
		isFlashMode ?
			type === 'binary' ?
				'/api/survey-flash'
			:	'/api/survey-2-flash'
		: type === 'binary' ?
			'/api/survey'
		:	'/api/survey_2';

	return `${baseUrl}/${encodeURIComponent(id)}/comments/${encodeURIComponent(String(opinionId || '').trim())}/delete`;
}

function findOpinionById(opinionId) {
	const normalizedId = String(opinionId || '').trim();
	if (!normalizedId) return null;
	return (
		allOpinionsData.find((opinion) => String(opinion?._id || '') === normalizedId) ||
		opinionsData.find((opinion) => String(opinion?._id || '') === normalizedId) ||
		null
	);
}

function isCommentModerationAvailable(opinion) {
	return isOpinionCommentVisible(opinion);
}

function buildCommentModerationPreview(opinion) {
	if (!opinion) return '';

	const pseudo = sanitizeInlineHtml(opinion.userPseudo || 'Anonyme');
	const answerLabel = sanitizeInlineHtml(resolveAnswerLabelForExport(opinion.answer));
	const reasonMarkup = formatQuotedComment(opinion.reason || '');

	return `
		<div class="comment-moderation-preview-meta">
			<div class="comment-moderation-preview-line">
				<span class="comment-moderation-preview-label">${sanitizeInlineHtml(
					t('shared.surveys.comment_moderation_preview_author', 'Auteur'),
				)}</span>
				<strong>${pseudo}</strong>
			</div>
			<div class="comment-moderation-preview-line">
				<span class="comment-moderation-preview-label">${sanitizeInlineHtml(
					t('shared.surveys.comment_moderation_preview_answer', 'Reponse'),
				)}</span>
				<strong>${answerLabel}</strong>
			</div>
		</div>
		<div class="comment-moderation-preview-body">${reasonMarkup}</div>
	`;
}

function openCommentModerationModal(opinionId) {
	const opinion = findOpinionById(opinionId);
	if (!opinion || !isCommentModerationAvailable(opinion)) return;

	selectedCommentModerationOpinionId = String(opinionId);
	const preview = document.getElementById('comment-moderation-preview');
	if (preview) {
		preview.innerHTML = buildCommentModerationPreview(opinion);
	}

	const modal = document.getElementById('comment-moderation-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open(modal);
	} else {
		modal.classList.remove('hidden');
	}
}

function closeCommentModerationModal() {
	selectedCommentModerationOpinionId = null;
	const modal = document.getElementById('comment-moderation-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close(modal);
	} else {
		modal.classList.add('hidden');
	}
}

function isMobileCommentModerationViewport() {
	if (typeof window.matchMedia === 'function') {
		return window.matchMedia('(max-width: 767px)').matches;
	}
	return Number(window.innerWidth || 0) < 768;
}

function clearCommentModerationPressState() {
	if (commentModerationPressTimer) {
		window.clearTimeout(commentModerationPressTimer);
		commentModerationPressTimer = null;
	}
	activeLongPressOpinionCard?.classList.remove('comment-moderation-pressing');
	activeLongPressOpinionCard = null;
}

function handleCommentModerationPointerDown(event) {
	if (!isMobileCommentModerationViewport()) return;
	if (event.pointerType === 'mouse') return;

	const card = event.target?.closest?.('.opinion-card[data-opinion-id]');
	if (!card) return;
	if (
		event.target?.closest?.(
			'button, a, input, textarea, select, [data-comment-moderation-trigger]',
		)
	) {
		return;
	}

	const opinionId = String(card.getAttribute('data-opinion-id') || '').trim();
	const opinion = findOpinionById(opinionId);
	if (!opinion || !isCommentModerationAvailable(opinion)) return;

	clearCommentModerationPressState();
	activeLongPressOpinionCard = card;
	card.classList.add('comment-moderation-pressing');
	commentModerationPressTimer = window.setTimeout(() => {
		openCommentModerationModal(opinionId);
		clearCommentModerationPressState();
	}, COMMENT_LONG_PRESS_MS);
}

function markOpinionCommentDeletedLocally(opinionId, deletedAt = null) {
	const normalizedId = String(opinionId || '').trim();
	if (!normalizedId) return;

	let didMutate = false;
	allOpinionsData = allOpinionsData.map((opinion) => {
		if (String(opinion?._id || '') !== normalizedId) return opinion;
		didMutate = true;
		return {
			...opinion,
			reason: '',
			commentVisible: false,
			commentModeration: {
				...(opinion?.commentModeration || {}),
				isDeleted: true,
				deletedAt: deletedAt || opinion?.commentModeration?.deletedAt || null,
			},
		};
	});

	if (!didMutate) {
		opinionsData = opinionsData.filter(
			(opinion) => String(opinion?._id || '') !== normalizedId,
		);
		filteredOpinions = filteredOpinions.filter(
			(opinion) => String(opinion?._id || '') !== normalizedId,
		);
		filterOpinions();
		if (selectedCommentModerationOpinionId === normalizedId) {
			closeCommentModerationModal();
		}
		return;
	}
	syncOpinionDatasets(allOpinionsData);
	filterOpinions();

	if (selectedCommentModerationOpinionId === normalizedId) {
		closeCommentModerationModal();
	}
}

async function deleteSelectedComment() {
	const opinionId = String(selectedCommentModerationOpinionId || '').trim();
	if (!opinionId) return;

	try {
		const payload = await requestAdminJson(getCommentDeleteEndpoint(opinionId), {
			method: 'POST',
		});
		markOpinionCommentDeletedLocally(opinionId, payload?.deletedAt || null);
		closeCommentModerationModal();
		showNotification(
			t(
				'shared.surveys.comment_moderation_delete_success',
				'Commentaire supprimé. Le vote reste comptabilisé.',
			),
			'success',
		);
	} catch (error) {
		if (
			error?.payload?.code === 'SURVEY_COMMENT_ALREADY_DELETED' ||
			error?.payload?.code === 'SURVEY_COMMENT_UNAVAILABLE'
		) {
			markOpinionCommentDeletedLocally(opinionId);
			closeCommentModerationModal();
			showNotification(
				t(
					'shared.surveys.comment_moderation_delete_success',
					'Commentaire supprimé. Le vote reste comptabilisé.',
				),
				'info',
			);
			return;
		}
		showNotification(
			error?.message ||
				t(
					'shared.surveys.comment_moderation_delete_failed',
					'Impossible de supprimer ce commentaire pour le moment.',
				),
			'error',
		);
	}
}

function buildPinnedBadge(opinion) {
	if (!opinion?.isOwnOpinion) return '';
	return `
		<span class="opinion-pin-badge">
			<i class="fas fa-thumbtack" aria-hidden="true"></i>
			<span>${sanitizeInlineHtml(
				t('shared.surveys.my_comment_badge', 'Mon commentaire'),
			)}</span>
		</span>
	`;
}

function buildCommentModerationTrigger(opinion) {
	if (!isCommentModerationAvailable(opinion)) return '';
	return `
		<button
			class="comment-moderation-trigger"
			type="button"
			data-comment-moderation-trigger
			data-opinion-id="${sanitizeInlineHtml(String(opinion?._id || ''))}"
			aria-label="${sanitizeInlineHtml(
				t(
					'shared.surveys.comment_moderation_title',
					'Moderer le commentaire',
				),
			)}"
			title="${sanitizeInlineHtml(
				t(
					'shared.surveys.comment_moderation_title',
					'Moderer le commentaire',
				),
			)}"
		>
			<i class="fas fa-ellipsis"></i>
		</button>
	`;
}

function prioritizeOwnOpinions(opinions = []) {
	const list = Array.isArray(opinions) ? [...opinions] : [];
	list.sort((left, right) => {
		const ownDelta =
			Number(Boolean(right?.isOwnOpinion)) - Number(Boolean(left?.isOwnOpinion));
		if (ownDelta !== 0) return ownDelta;
		return new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0);
	});
	return list;
}

function sortOpinionsWithPinned(opinions = [], sortBy = 'date') {
	const pinned = [];
	const others = [];
	const source = Array.isArray(opinions) ? opinions : [];

	source.forEach((opinion) => {
		if (opinion?.isOwnOpinion) pinned.push(opinion);
		else others.push(opinion);
	});

	others.sort((a, b) => {
		switch (sortBy) {
			case 'likes':
				return (b?.likeCount || 0) - (a?.likeCount || 0);
			case 'alphabetical':
				return (a?.userPseudo || '').localeCompare(b?.userPseudo || '');
			case 'date':
			default:
				return new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);
		}
	});

	pinned.sort(
		(a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0),
	);

	return [...pinned, ...others];
}

function animateFilterRefresh() {
	const dashboard = document.querySelector('.dashboard-container');
	if (!dashboard) return;
	dashboard.classList.add('dashboard-filter-updating');
	window.clearTimeout(animateFilterRefresh._timerId);
	animateFilterRefresh._timerId = window.setTimeout(() => {
		dashboard.classList.remove('dashboard-filter-updating');
	}, 290);
}

function parseOptionKeyIndex(optionKey) {
	const match = String(optionKey || '').match(/^reponse_(\d+)$/);
	if (!match) return -1;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed - 1 : -1;
}

function sortOptionKeys(optionKeys = []) {
	return [...optionKeys].sort(
		(left, right) => parseOptionKeyIndex(left) - parseOptionKeyIndex(right),
	);
}

function buildLegacyOptionKeysFromSurvey(survey) {
	return ['reponse_1', 'reponse_2', 'reponse_3', 'reponse_4', 'reponse_5', 'reponse_6']
		.filter((key) => String(survey?.[key] || '').trim());
}

function resolveMultipleOptionData(payload = {}, survey = null) {
	const payloadOptionKeys = Array.isArray(payload.optionKeys)
		? payload.optionKeys
		: [];
	const payloadLabelKeys = Object.keys(payload.labels || {});
	const payloadCountKeys = Object.keys(payload.counts || {});
	const surveyOptionKeysFromApi = Array.isArray(survey?.optionKeys)
		? survey.optionKeys
		: [];
	const surveyOptions = Array.isArray(survey?.options) ? survey.options : [];

	const optionKeys = sortOptionKeys(
		payloadOptionKeys.length ?
			payloadOptionKeys
		: payloadLabelKeys.length ?
			payloadLabelKeys
		: payloadCountKeys.length ?
			payloadCountKeys
		: surveyOptionKeysFromApi.length ?
			surveyOptionKeysFromApi
		: surveyOptions.length ?
			surveyOptions.map((_, index) => `reponse_${index + 1}`)
		: surveyOptionKeys.length ?
			surveyOptionKeys
		: buildLegacyOptionKeysFromSurvey(survey),
	);
	const safeOptionKeys = optionKeys.length ? optionKeys : ['reponse_1', 'reponse_2', 'reponse_3'];

	const labelsMap = {};
	const countsMap = {};

	safeOptionKeys.forEach((key, index) => {
		labelsMap[key] = String(
			payload.labels?.[key] ||
				surveyLabels[key] ||
				survey?.labels?.[key] ||
				surveyOptions[index] ||
				survey?.[key] ||
				`Option ${index + 1}`,
		).trim();
		countsMap[key] = Number(payload.counts?.[key] || 0);
	});

	return {
		optionKeys: safeOptionKeys,
		labelsMap,
		countsMap,
	};
}

function normalizeGenderValue(value) {
	return value === 'homme' || value === 'femme' ? value : 'non_renseigne';
}

function parseAgeInput(value) {
	const parsed = Number.parseInt(String(value || '').trim(), 10);
	if (!Number.isFinite(parsed) || parsed < 13 || parsed > 120) return null;
	return parsed;
}

function setAgeRangeValidationState(isInvalid) {
	const ageFromInput = document.getElementById('age-from');
	const ageToInput = document.getElementById('age-to');
	const ageRangeError = document.getElementById('age-range-error');
	const validationMessage = isInvalid ?
			"L'age minimum doit etre strictement inferieur a l'age maximum."
		:	'';

	[ageFromInput, ageToInput].forEach((input) => {
		if (!input) return;
		input.classList.toggle('input-invalid', Boolean(isInvalid));
		input.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
		input.setCustomValidity(validationMessage);
	});

	if (ageRangeError) {
		ageRangeError.classList.toggle('hidden', !isInvalid);
	}
}

function getOpinionAge(opinion) {
	const age = Number(opinion?.adminProfile?.age);
	if (!Number.isFinite(age)) return null;
	if (age < 0 || age > 130) return null;
	return age;
}

function getDemographicFiltersFromUI() {
	const genderSelect = document.getElementById('filter-gender');
	const ageFromInput = document.getElementById('age-from');
	const ageToInput = document.getElementById('age-to');

	const gender = String(genderSelect?.value || 'all');
	let ageFrom = parseAgeInput(ageFromInput?.value);
	let ageTo = parseAgeInput(ageToInput?.value);

	if (ageFrom !== null && ageTo !== null && ageFrom > ageTo) {
		const temp = ageFrom;
		ageFrom = ageTo;
		ageTo = temp;

		if (ageFromInput) ageFromInput.value = String(ageFrom);
		if (ageToInput) ageToInput.value = String(ageTo);
	}
	const ageRangeInvalid =
		ageFrom !== null && ageTo !== null && ageFrom === ageTo;
	setAgeRangeValidationState(ageRangeInvalid);

	if (ageRangeInvalid) {
		ageFrom = null;
		ageTo = null;
	}

	return {
		gender,
		ageFrom,
		ageTo,
		ageRangeInvalid,
	};
}

function updateDemographicFilterAvailability(isAvailable) {
	demographicFiltersAvailable = Boolean(isAvailable);
	const groups = [
		document.getElementById('gender-filter-group'),
		document.getElementById('age-filter-group'),
	];

	groups.forEach((group) => {
		if (!group) return;
		group.classList.toggle('hidden', !demographicFiltersAvailable);
	});

	if (!demographicFiltersAvailable) {
		const genderSelect = document.getElementById('filter-gender');
		const ageFromInput = document.getElementById('age-from');
		const ageToInput = document.getElementById('age-to');
		if (genderSelect) genderSelect.value = 'all';
		if (ageFromInput) ageFromInput.value = '';
		if (ageToInput) ageToInput.value = '';
		setAgeRangeValidationState(false);
	}
}

function hasActiveDemographicFilters() {
	if (!demographicFiltersAvailable) return false;
	const { gender, ageFrom, ageTo } = getDemographicFiltersFromUI();
	return gender !== 'all' || (ageFrom !== null && ageTo !== null);
}

function isOpinionEligibleForList(opinion) {
	return hasOpinionComment(opinion);
}

function syncOpinionDatasets(opinions = []) {
	allOpinionsData = Array.isArray(opinions) ? [...opinions] : [];
	opinionsData = allOpinionsData.filter(isOpinionEligibleForList);
}

function applyDemographicAndAnswerFilters(sourceOpinions = []) {
	const filters = getDemographicFiltersFromUI();
	const answerFilter = String(
		document.getElementById('filter-answer')?.value || 'all',
	);

	let filtered = Array.isArray(sourceOpinions) ? [...sourceOpinions] : [];

	if (demographicFiltersAvailable) {
		filtered = filtered.filter((opinion) => {
			if (filters.gender !== 'all') {
				const opinionGender = normalizeGenderValue(opinion?.adminProfile?.gender);
				if (opinionGender !== filters.gender) return false;
			}

			if (filters.ageFrom !== null && filters.ageTo !== null) {
				const age = getOpinionAge(opinion);
				if (age === null) return false;
				if (age < filters.ageFrom || age > filters.ageTo) return false;
			}

			return true;
		});
	}

	if (answerFilter !== 'all') {
		if (type === 'binary') {
			filtered = filtered.filter((opinion) =>
				answerFilter === 'yes' ? Boolean(opinion.answer) : !opinion.answer,
			);
		} else {
			filtered = filtered.filter(
				(opinion) => String(opinion.answer) === String(answerFilter),
			);
		}
	}

	return filtered;
}

function updateBinaryVisualsFromFilteredOpinions(filteredForStats = []) {
	const total = filteredForStats.length;
	const yes = filteredForStats.filter((opinion) => Boolean(opinion.answer)).length;
	const no = total - yes;
	const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
	const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;

	document.getElementById('total-votes').textContent = total;
	createBinaryChart(yes, no, total, yesPercentage, noPercentage);
	renderBinaryStats(yes, no, total, yesPercentage, noPercentage);
}

function updateMultipleVisualsFromFilteredOpinions(filteredForStats = []) {
	const optionKeys = surveyOptionKeys.length ? surveyOptionKeys : ['reponse_1', 'reponse_2'];
	const countsMap = {};
	optionKeys.forEach((key) => {
		countsMap[key] = 0;
	});

	filteredForStats.forEach((opinion) => {
		const key = String(opinion?.answer || '').trim();
		if (!key) return;
		if (!Object.prototype.hasOwnProperty.call(countsMap, key)) {
			countsMap[key] = 0;
		}
		countsMap[key] += 1;
	});

	const labels = optionKeys.map((key, index) => surveyLabels[key] || `Option ${index + 1}`);
	const counts = optionKeys.map((key) => Number(countsMap[key] || 0));
	const total = counts.reduce((sum, value) => sum + Number(value || 0), 0);
	const percentages = counts.map((value) =>
		total > 0 ? Math.round((Number(value || 0) / total) * 100) : 0,
	);

	document.getElementById('total-votes').textContent = total;
	createMultipleChart(labels, counts, total, percentages);
	renderMultipleStats(
		{
			optionKeys,
			labels: surveyLabels,
			counts: countsMap,
		},
		total,
		percentages,
	);
}

function updateVisualsFromFilteredOpinions(filteredForStats = []) {
	if (type === 'binary') {
		updateBinaryVisualsFromFilteredOpinions(filteredForStats);
		return;
	}
	updateMultipleVisualsFromFilteredOpinions(filteredForStats);
}

function getDetailedResultsEndpoint() {
	const resultsBaseUrl = isFlashMode ? FLASH_BASE_URL : STANDARD_BASE_URL;
	return `${resultsBaseUrl}/${id}/detailed-results`;
}

async function refreshLiveDetailedResults() {
	if (isAccessRevoked) return;
	if (isRefreshingFlashDetails) return;
	isRefreshingFlashDetails = true;

	try {
		const response = await fetch(getDetailedResultsEndpoint(), {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (response.status === 403) {
			const payload = await response.json().catch(() => ({}));
			if (String(payload?.code || '').toUpperCase() === 'ADMIN_VOTE_REQUIRED') {
				renderAdminVoteGate(currentSurvey, payload);
				return;
			}
			handleAdminAccessRevoked(
				payload.message ||
					t(
						'shared.surveys.admin_access_revoked',
						'Vos droits admin sur ce sondage ont ete retires.',
					),
			);
			return;
		}
		if (!response.ok) return;

		const data = await response.json();
		lastFlashTotalOpinions = Number(data?.totalOpinions || 0);

		if (type === 'binary') {
			handleBinaryResults(data, currentSurvey);
		} else {
			handleMultipleResults(data, currentSurvey);
		}
		void fetchAdminAnalytics({ silent: true });
	} catch (error) {
		console.warn('Refresh detailed results failed:', error);
	} finally {
		isRefreshingFlashDetails = false;
	}
}

function scheduleLiveDetailedRefresh(delay = 260) {
	if (isAccessRevoked) return;
	if (flashDetailsRefreshTimer) {
		clearTimeout(flashDetailsRefreshTimer);
	}

	flashDetailsRefreshTimer = window.setTimeout(() => {
		flashDetailsRefreshTimer = null;
		void refreshLiveDetailedResults();
	}, Math.max(0, Number(delay) || 0));
}


function renderSurveyHeader(survey) {
	document.getElementById('survey-theme').textContent = survey.theme;
	document.getElementById('survey-question').textContent = survey.question;
	const typeLabel =
		type === 'binary' ?
			isFlashMode ? 'Binaire Flash'
			:	'Binaire'
		:	isFlashMode ? 'Multiple Flash'
		:	'Multiple';
	document.getElementById('survey-meta').innerHTML = `
        <span>ID: ${survey._id}</span> <span aria-hidden="true">&bull;</span> 
        <span>Type: ${typeLabel}</span>
    `;

	if (survey.createdAt) {
		const date = new Date(survey.createdAt).toLocaleDateString(getIntlLocale(), {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		});
		document.getElementById('survey-date').textContent = date;
	}

	const statusNode = document.getElementById('survey-status');
	if (statusNode) {
		statusNode.innerHTML = survey.isClosed ?
				'<i class="fas fa-lock"></i> clôturé'
			:	'<i class="fas fa-unlock"></i> ouvert';
	}

	document.getElementById('survey-header').classList.remove('hidden');
}

// =============================================================
// Traitement résultats binaires
// =============================================================
function handleBinaryResults(data, survey) {
	updateDemographicFilterAvailability(
		Boolean(data?.meta?.demographicFiltersAvailable),
	);
	lastFlashTotalOpinions = Number(data?.totalOpinions || 0);
	syncOpinionDatasets(data.opinions || []);
	updateBinaryFilters();
	filterOpinions();
}
function createBinaryChart(yes, no, total, yesPercentage, noPercentage) {
	const labels = getAdminBinaryLabels();
	renderAdminOverlayResultCard(
		[
			{ key: 'yes', label: labels.yes, value: yes },
			{ key: 'no', label: labels.no, value: no },
		],
		total,
		t('survey.overlay_type', 'Sondage binaire'),
	);
}

function renderAdminOverlayResultCard(items, total, typeLabel) {
	const host = document.getElementById('admin-overlay-result-card');
	if (!host) return;

	let card = host.querySelector('.overlay-card.results');
	if (!card) {
		host.innerHTML = `
			<div class="overlay-card results">
				<span class="overlay-eyebrow"><i class="fas fa-tower-broadcast"></i> <span data-overlay-type></span></span>
				<h2 class="overlay-title"></h2>
				<p class="overlay-subtitle" data-overlay-question></p>
				<div class="overlay-result-bars"></div>
				<p class="overlay-subtitle" data-overlay-summary></p>
			</div>
		`;
		card = host.querySelector('.overlay-card.results');
	}

	const safeTotal = Number(total || 0);
	card.querySelector('[data-overlay-type]').textContent =
		String(typeLabel || '').trim() || t('shared.surveys.results', 'Résultats');
	card.querySelector('.overlay-title').textContent =
		currentSurvey?.theme || t('shared.surveys.survey_fallback_title', 'Sondage');
	card.querySelector('[data-overlay-question]').textContent =
		currentSurvey?.question ||
		t('shared.surveys.question_unavailable', 'Question indisponible');
	card.querySelector('[data-overlay-summary]').textContent =
		`${formatAdminVoteCount(safeTotal)} · ${getAdminSurveyStateLabel()}`;

	renderAdminOverlayBars(card.querySelector('.overlay-result-bars'), items, safeTotal);
}

function renderAdminOverlayBars(container, items, total) {
	if (!container) return;
	const nextKeys = new Set(items.map((item) => String(item.key)));
	container.querySelectorAll('[data-result-key]').forEach((row) => {
		if (!nextKeys.has(row.getAttribute('data-result-key'))) row.remove();
	});

	items.forEach((item) => {
		const key = String(item.key);
		const value = Number(item.value || 0);
		const pct = total > 0 ? Math.round((value / total) * 100) : 0;
		let row = container.querySelector(`[data-result-key="${escapeCssIdentifier(key)}"]`);
		const wasCreated = !row;
		if (!row) {
			row = document.createElement('div');
			row.className = 'overlay-result-bar';
			row.setAttribute('data-result-key', key);
			row.innerHTML = `
				<span class="overlay-result-label"></span>
				<div class="overlay-result-track"><div class="overlay-result-fill"></div></div>
				<span class="overlay-result-value"></span>
			`;
			container.appendChild(row);
		}
		row.querySelector('.overlay-result-label').textContent = String(item.label || '-');
		row.querySelector('.overlay-result-value').textContent = `${value} · ${pct}%`;
		const fill = row.querySelector('.overlay-result-fill');
		if (!fill) return;
		if (wasCreated) {
			fill.style.width = '0%';
			window.requestAnimationFrame(() => {
				fill.style.width = `${pct}%`;
			});
		} else {
			fill.style.width = `${pct}%`;
		}
	});
}

function formatAdminVoteCount(total) {
	return `${total} vote${total > 1 ? 's' : ''}`;
}

function getAdminSurveyStateLabel() {
	return currentSurvey?.isClosed ?
			t('shared.surveys.status_closed', 'Sondage clôturé')
		:	t('shared.surveys.status_open', 'Sondage ouvert');
}

function escapeCssIdentifier(value) {
	if (window.CSS?.escape) return window.CSS.escape(String(value));
	return String(value).replace(/["\\]/g, '\\$&');
}

function renderBinaryStats() {
	// Legacy detailed-stats card removed; the broadcast overlay and analytics dashboard now carry the results.
}

function updateBinaryFilters() {
	const filterSelect = document.getElementById('filter-answer');
	if (!filterSelect) return;
	const currentValue = String(filterSelect.value || 'all');
	const labels = getAdminBinaryLabels();
	filterSelect.innerHTML = `
        <option value="all">Toutes les reponses</option>
        <option value="yes">${sanitizeInlineHtml(labels.yes)} seulement</option>
        <option value="no">${sanitizeInlineHtml(labels.no)} seulement</option>
    `;
	filterSelect.value =
		currentValue === 'yes' || currentValue === 'no' ? currentValue : 'all';
}

// =============================================================
// Traitement résultats multiples
// =============================================================
function handleMultipleResults(data, survey) {
	const { optionKeys, labelsMap } = resolveMultipleOptionData(data, survey);
	surveyOptionKeys = optionKeys;
	surveyLabels = labelsMap;
	updateDemographicFilterAvailability(
		Boolean(data?.meta?.demographicFiltersAvailable),
	);
	lastFlashTotalOpinions = Number(data?.totalOpinions || 0);
	syncOpinionDatasets(data.opinions || []);
	updateMultipleFilters();
	filterOpinions();
}
function createMultipleChart(labels, counts, total, percentages) {
	renderAdminOverlayResultCard(
		labels.map((label, index) => ({
			key: `option_${index}`,
			label,
			value: Number(counts[index] || 0),
		})),
		total,
		t('survey_choices.overlay_type', 'Sondage multiple'),
	);
}

function renderMultipleStats() {
	// Legacy detailed-stats card removed; the broadcast overlay and analytics dashboard now carry the results.
}

function updateMultipleFilters() {
	const filterSelect = document.getElementById('filter-answer');
	if (!filterSelect) return;
	const previousValue = String(filterSelect.value || 'all');
	let options = '<option value="all">Toutes les reponses</option>';

	surveyOptionKeys.forEach((key) => {
		const label = surveyLabels[key] || key;
		options += `<option value="${key}">${label}</option>`;
	});

	filterSelect.innerHTML = options;
	filterSelect.value =
		previousValue === 'all' || surveyOptionKeys.includes(previousValue) ?
			previousValue
		:	'all';
}

function isFlashPayloadForCurrentSurvey(payload) {
	return (
		!!payload &&
		String(payload.surveyId || '') === String(id) &&
		String(payload.type || '') === String(type)
	);
}

function isClassicPayloadForCurrentSurvey(payload) {
	return (
		!isFlashMode &&
		!!payload &&
		String(payload.surveyId || '') === String(id) &&
		String(payload.type || '') === String(type)
	);
}

function joinFlashRoom() {
	if (!isFlashMode || !socket || !id || !type) return;

	const emitJoin = () => {
		socket.emit('flash:join', { surveyId: id, type });
	};

	if (socket.connected) {
		emitJoin();
	} else {
		socket.once('connect', emitJoin);
	}
}

function leaveFlashRoom() {
	if (!isFlashMode || !socket?.connected || !id || !type) return;
	socket.emit('flash:leave', { surveyId: id, type });
}

function joinClassicRoom() {
	if (isFlashMode || !socket || !id || !type) return;

	const emitJoin = () => {
		socket.emit('classic:join', { surveyId: id, type });
	};

	if (socket.connected) {
		emitJoin();
	} else {
		socket.once('connect', emitJoin);
	}
}

function leaveClassicRoom() {
	if (isFlashMode || !socket?.connected || !id || !type) return;
	socket.emit('classic:leave', { surveyId: id, type });
}

function joinLiveRoom() {
	if (isAccessRevoked) return;
	if (isFlashMode) {
		joinFlashRoom();
		return;
	}
	joinClassicRoom();
}

function leaveLiveRoom() {
	if (isFlashMode) {
		leaveFlashRoom();
		return;
	}
	leaveClassicRoom();
}

window.addEventListener('beforeunload', () => {
	leaveLiveRoom();
	if (membershipRefreshTimer) {
		window.clearTimeout(membershipRefreshTimer);
		membershipRefreshTimer = null;
	}
	if (flashDetailsRefreshTimer) {
		window.clearTimeout(flashDetailsRefreshTimer);
		flashDetailsRefreshTimer = null;
	}
});

function upsertLiveOpinion(payload) {
	const normalized = {
		...payload,
		likeCount: Number(payload.likeCount || 0),
		dislikeCount: Number(payload.dislikeCount || 0),
	};

	const existingAllIndex = allOpinionsData.findIndex(
		(opinion) => String(opinion._id) === String(normalized._id),
	);

	if (existingAllIndex >= 0) {
		allOpinionsData[existingAllIndex] = {
			...allOpinionsData[existingAllIndex],
			...normalized,
		};
	} else {
		allOpinionsData.unshift(normalized);
	}

	syncOpinionDatasets(allOpinionsData);
	filterOpinions();
	scheduleLiveDetailedRefresh(280);
}

function applyLiveCounts(payload) {
	if (!payload) return;

	const totalOpinions = Number(payload.totalOpinions || 0);
	const previousTotal = lastFlashTotalOpinions;
	lastFlashTotalOpinions = totalOpinions;
	const hasAnswerFilter = String(
		document.getElementById('filter-answer')?.value || 'all',
	) !== 'all';
	const shouldRenderOptimistic =
		!hasAnswerFilter && !hasActiveDemographicFilters();

	if (shouldRenderOptimistic) {
		if (type === 'binary') {
			const yes = Number(payload.counts?.yes || 0);
			const no = Number(payload.counts?.no || 0);
			const total = totalOpinions || yes + no;
			const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
			const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;
			document.getElementById('total-votes').textContent = total;

			createBinaryChart(yes, no, total, yesPercentage, noPercentage);
			renderBinaryStats(yes, no, total, yesPercentage, noPercentage);
		} else {
			const { optionKeys, labelsMap, countsMap } = resolveMultipleOptionData(
				payload,
				currentSurvey,
			);
			surveyOptionKeys = optionKeys;
			surveyLabels = labelsMap;

			const labels = surveyOptionKeys.map((key) => surveyLabels[key] || key);
			const counts = surveyOptionKeys.map((key) => Number(countsMap[key] || 0));
			const total =
				totalOpinions ||
				counts.reduce((sum, count) => sum + Number(count || 0), 0);
			document.getElementById('total-votes').textContent = total;
			const percentages = counts.map((count) =>
				total > 0 ? Math.round((Number(count || 0) / total) * 100) : 0,
			);

			createMultipleChart(labels, counts, total, percentages);
			renderMultipleStats(
				{
					optionKeys: surveyOptionKeys,
					labels: surveyLabels,
					counts: countsMap,
				},
				total,
				percentages,
			);
			updateMultipleFilters();
		}
	}

	if (payload.isClosed && currentSurvey && !currentSurvey.isClosed) {
		currentSurvey.isClosed = true;
		renderSurveyHeader(currentSurvey);
	}

	if (totalOpinions !== previousTotal) {
		scheduleLiveDetailedRefresh(260);
	}
}

// =============================================================
// Fonctions utilitaires
// =============================================================
function formatDate(dateString) {
	if (!dateString) return 'Date inconnue';

	const date = new Date(dateString);
	return date.toLocaleDateString(getIntlLocale(), {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function showLoading(show) {
	const loading = document.getElementById('loading');
	const toolbar = document.getElementById('results-toolbar');
	if (show) {
		loading.classList.remove('hidden');
		toolbar?.classList.add('hidden');
	} else {
		loading.classList.add('hidden');
	}
}

function showNotification(message, type = 'info') {
	// Supprimer les notifications existantes
	const existing = document.querySelector('.notification');
	if (existing) existing.remove();

	const notification = document.createElement('div');
	notification.className = `notification ${type}`;
	notification.innerHTML = `
        <i class="fas fa-${
					type === 'error' ? 'exclamation-circle'
					: type === 'warning' ? 'exclamation-triangle'
					: 'info-circle'
				}"></i>
        <span>${message}</span>
    `;

	// Style de notification
	notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 0.75rem;
        background: ${
					type === 'error' ? '#ef4444'
					: type === 'warning' ? '#f59e0b'
					: '#10b981'
				};
        color: white;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
        max-width: 90vw;
        word-break: break-word;
    `;

	document.body.appendChild(notification);

	// Supprimer après 5 secondes
	setTimeout(() => {
		notification.style.animation = 'slideOut 0.3s ease';
		setTimeout(() => notification.remove(), 300);
	}, 5000);
}

// =============================================================
// Filtrage et tri
// =============================================================
function filterOpinions() {
	animateFilterRefresh();
	const filteredForStats = applyDemographicAndAnswerFilters(allOpinionsData);
	updateVisualsFromFilteredOpinions(filteredForStats);
	filteredOpinions = sortOpinionsWithPinned(
		filteredForStats.filter(isOpinionEligibleForList),
		'date',
	);
}

function renderFilteredOpinions() {
	// Legacy opinions UI removed from the admin dashboard.
}

// =============================================================
// Mise ? jour des likes/dislikes en temps réel
// =============================================================
function updateOpinionLikes(opinionId, likeCount, dislikeCount) {
	const safeLikeCount = Number(likeCount || 0);
	const safeDislikeCount = Number(dislikeCount || 0);

	const patchLikes = (dataset) => {
		const target = dataset.find(
			(opinion) => String(opinion._id) === String(opinionId),
		);
		if (!target) return;
		target.likeCount = safeLikeCount;
		target.dislikeCount = safeDislikeCount;
	};

	patchLikes(allOpinionsData);
	patchLikes(opinionsData);

	const opinionElement = document.getElementById(`opinion-${opinionId}`);
	if (!opinionElement) {
		console.warn(`Opinion ${opinionId} non trouvee dans le DOM`);
		return;
	}

	const likeElement = opinionElement.querySelector('.readonly-like');
	const dislikeElement = opinionElement.querySelector('.readonly-dislike');

	if (likeElement) {
		likeElement.textContent = safeLikeCount;
		likeElement.parentElement.classList.add('like-updated');
		setTimeout(() => {
			likeElement.parentElement.classList.remove('like-updated');
		}, 500);
	}

	if (dislikeElement) {
		dislikeElement.textContent = safeDislikeCount;
		dislikeElement.parentElement.classList.add('like-updated');
		setTimeout(() => {
			dislikeElement.parentElement.classList.remove('like-updated');
		}, 500);
	}

	opinionElement.style.transform = 'scale(1.02)';
	opinionElement.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.3)';
	setTimeout(() => {
		opinionElement.style.transform = '';
		opinionElement.style.boxShadow = '';
	}, 300);
}

// =============================================================
// Légende du graphique avec pourcentages
// =============================================================
function renderChartLegend(labels, colors, percentages = []) {
	const legend = document.getElementById('chart-legend');
	legend.innerHTML = labels
		.map(
			(label, index) => `
        <div class="legend-item">
            <div class="legend-color" style="background: ${colors[index]}"></div>
            <span>${label} ${percentages[index] ? `(${percentages[index]}%)` : ''}</span>
        </div>
    `,
		)
		.join('');
}

// =============================================================
// Export des résultats
// =============================================================
function showExportModal() {
	const modal = document.getElementById('export-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open(modal);
	} else {
		modal.classList.remove('hidden');
	}
}

function hideExportModal() {
	const modal = document.getElementById('export-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close(modal);
	} else {
		modal.classList.add('hidden');
	}
}

// Calcul des pourcentages pour l'export
function calculatePercentagesForExport(sourceOpinions = []) {
	if (type === 'binary') {
		const labels = getAdminBinaryLabels();
		const total = sourceOpinions.length;
		const yes = sourceOpinions.filter((o) => o.answer).length;
		const no = total - yes;
		const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
		const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;

		return {
			[labels.yes]: {
				count: yes,
				percentage: yesPercentage,
			},
			[labels.no]: {
				count: no,
				percentage: noPercentage,
			},
		};
	}

	const total = sourceOpinions.length;
	const counts = {};

	sourceOpinions.forEach((opinion) => {
		const key = opinion.answer;
		const label = surveyLabels[key] || `Option ${key}`;
		if (!counts[label]) {
			counts[label] = {
				count: 0,
				percentage: 0,
				key,
			};
		}
		counts[label].count += 1;
	});

	Object.keys(counts).forEach((label) => {
		counts[label].percentage =
			total > 0 ? Math.round((counts[label].count / total) * 100) : 0;
	});

	return counts;
}

function resolveAnswerLabelForExport(answer) {
	if (type === 'binary') {
		const labels = getAdminBinaryLabels();
		return answer === true || String(answer) === 'true' ? labels.yes : labels.no;
	}
	const key = String(answer || '').trim();
	return surveyLabels[key] || key || 'Option inconnue';
}

function buildAnswerDistributionForExport(sourceRows = []) {
	const distribution = {};
	(sourceRows || []).forEach((row) => {
		const label = resolveAnswerLabelForExport(row?.answer);
		if (!distribution[label]) {
			distribution[label] = {
				count: 0,
				percentage: 0,
			};
		}
		distribution[label].count += 1;
	});
	const total = Object.values(distribution).reduce(
		(sum, entry) => sum + Number(entry?.count || 0),
		0,
	);
	Object.entries(distribution).forEach(([label, entry]) => {
		distribution[label] = {
			count: Number(entry?.count || 0),
			percentage:
				total > 0 ?
					Math.round((Number(entry?.count || 0) / total) * 100)
				:	0,
		};
	});
	return distribution;
}

function mapOpinionForExport(opinion, percentagesMap = {}) {
	const answerLabel = resolveAnswerLabelForExport(opinion?.answer);
	return {
		id: opinion?._id,
		userPseudo: opinion?.exportUserPseudo || opinion?.userPseudo || 'Anonyme',
		voterKey: opinion?.voterKey || '',
		answer: opinion?.answer,
		answerLabel,
		reason: opinion?.reason || '',
		likeCount: opinion?.likeCount || 0,
		dislikeCount: opinion?.dislikeCount || 0,
		createdAt: opinion?.createdAt,
		answerPercentage: Number(percentagesMap?.[answerLabel]?.percentage || 0),
	};
}

function getOpinionIdentityKey(opinion) {
	const voterKey = String(opinion?.voterKey || '').trim();
	if (voterKey) return voterKey;
	return String(opinion?._id || '').trim();
}

function getUniqueVotersCount(sourceOpinions = []) {
	return new Set((sourceOpinions || []).map(getOpinionIdentityKey).filter(Boolean))
		.size;
}

const EXPORT_AGE_BANDS = [
	{ label: '13-17', min: 13, max: 17 },
	{ label: '18-24', min: 18, max: 24 },
	{ label: '25-34', min: 25, max: 34 },
	{ label: '35-44', min: 35, max: 44 },
	{ label: '45-54', min: 45, max: 54 },
	{ label: '55-64', min: 55, max: 64 },
	{ label: '65+', min: 65, max: 120 },
];

function getExportSafeAge(opinion) {
	const age = Number(opinion?.adminProfile?.age);
	if (!Number.isFinite(age)) return null;
	if (age < 13 || age > 120) return null;
	return Math.floor(age);
}

function resolveAgeBandLabel(age) {
	if (!Number.isFinite(age)) return null;
	const band = EXPORT_AGE_BANDS.find(
		(item) => age >= item.min && age <= item.max,
	);
	return band?.label || null;
}

function getGenderLabel(genderValue) {
	switch (normalizeGenderValue(genderValue)) {
		case 'homme':
			return 'Homme';
		case 'femme':
			return 'Femme';
		default:
			return 'Non renseigne';
	}
}

function buildExportDemographicInsights(sourceOpinions = []) {
	const voters = new Map();

	(sourceOpinions || []).forEach((opinion) => {
		const identityKey = getOpinionIdentityKey(opinion);
		if (!identityKey) return;

		const current = voters.get(identityKey) || {
			age: null,
			gender: 'non_renseigne',
		};
		const age = getExportSafeAge(opinion);
		if (current.age === null && age !== null) {
			current.age = age;
		}
		const normalizedGender = normalizeGenderValue(opinion?.adminProfile?.gender);
		if (
			current.gender === 'non_renseigne' &&
			normalizedGender !== 'non_renseigne'
		) {
			current.gender = normalizedGender;
		}
		voters.set(identityKey, current);
	});

	const totalUniqueVoters = voters.size;
	const ageBandCounts = EXPORT_AGE_BANDS.reduce((accumulator, band) => {
		accumulator[band.label] = 0;
		return accumulator;
	}, {});
	let knownAgeVoters = 0;
	let unknownAgeVoters = 0;

	const genderCounts = {
		homme: 0,
		femme: 0,
		non_renseigne: 0,
	};

	voters.forEach((voter) => {
		const gender = normalizeGenderValue(voter.gender);
		genderCounts[gender] += 1;

		const ageBandLabel = resolveAgeBandLabel(voter.age);
		if (!ageBandLabel) {
			unknownAgeVoters += 1;
			return;
		}
		ageBandCounts[ageBandLabel] += 1;
		knownAgeVoters += 1;
	});

	const ageBands = EXPORT_AGE_BANDS.map((band) => {
		const count = Number(ageBandCounts[band.label] || 0);
		const percentage =
			knownAgeVoters > 0 ? Math.round((count / knownAgeVoters) * 100) : 0;
		return {
			label: band.label,
			count,
			percentage,
		};
	});

	const maxAgeCount =
		ageBands.length > 0 ? Math.max(...ageBands.map((band) => band.count)) : 0;
	const topAgeBands =
		knownAgeVoters > 0 && maxAgeCount > 0 ?
			ageBands.filter((band) => band.count === maxAgeCount).map((band) => band.label)
		:	[];
	const ageStatus =
		knownAgeVoters > 0 && topAgeBands.length > 0 ?
			'ok'
		:	'insufficient_age_data';
	const topAgePercentage =
		knownAgeVoters > 0 && maxAgeCount > 0 ?
			Math.round((maxAgeCount / knownAgeVoters) * 100)
		:	0;

	const comparableGenderCount =
		Number(genderCounts.homme || 0) + Number(genderCounts.femme || 0);
	const maxGenderCount = Math.max(
		Number(genderCounts.homme || 0),
		Number(genderCounts.femme || 0),
	);
	const topGenderGroups =
		comparableGenderCount > 0 && maxGenderCount > 0 ?
			['homme', 'femme']
				.filter((group) => Number(genderCounts[group] || 0) === maxGenderCount)
				.map((group) => getGenderLabel(group))
		:	[];
	const genderStatus =
		comparableGenderCount > 0 && topGenderGroups.length > 0 ?
			'ok'
		:	'insufficient_gender_data';
	const topGenderPercentage =
		comparableGenderCount > 0 && maxGenderCount > 0 ?
			Math.round((maxGenderCount / comparableGenderCount) * 100)
		:	0;

	const genderDistribution = {
		homme: {
			count: Number(genderCounts.homme || 0),
			percentage:
				totalUniqueVoters > 0 ?
					Math.round((Number(genderCounts.homme || 0) / totalUniqueVoters) * 100)
				:	0,
		},
		femme: {
			count: Number(genderCounts.femme || 0),
			percentage:
				totalUniqueVoters > 0 ?
					Math.round((Number(genderCounts.femme || 0) / totalUniqueVoters) * 100)
				:	0,
		},
		non_renseigne: {
			count: Number(genderCounts.non_renseigne || 0),
			percentage:
				totalUniqueVoters > 0 ?
					Math.round(
						(Number(genderCounts.non_renseigne || 0) / totalUniqueVoters) * 100,
					)
				:	0,
		},
	};

	return {
		populationBase: 'unique_voters',
		totalUniqueVoters,
		ageInsights: {
			status: ageStatus,
			knownAgeVoters,
			unknownAgeVoters,
			bands: ageBands,
			topAgeBands,
			topAgeCount: maxAgeCount > 0 ? maxAgeCount : 0,
			topAgePercentage,
		},
		genderInsights: {
			status: genderStatus,
			comparableVoters: comparableGenderCount,
			counts: genderDistribution,
			topGenderGroups,
			topGenderCount: maxGenderCount > 0 ? maxGenderCount : 0,
			topGenderPercentage,
		},
	};
}

function getDemographicFilterLabelText(genderValue) {
	switch (String(genderValue || 'all')) {
		case 'homme':
			return 'Homme';
		case 'femme':
			return 'Femme';
		case 'non_renseigne':
			return 'Non renseigne';
		default:
			return 'Tous';
	}
}

function getActiveChartFiltersForExport() {
	const filters = [];
	const answerFilter = String(
		document.getElementById('filter-answer')?.value || 'all',
	).trim();
	const demographics = getDemographicFiltersFromUI();

	if (demographics.gender !== 'all') {
		filters.push(`Sexe: ${getDemographicFilterLabelText(demographics.gender)}`);
	}
	if (demographics.ageFrom !== null && demographics.ageTo !== null) {
		filters.push(`Age: ${demographics.ageFrom} a ${demographics.ageTo}`);
	}
	if (answerFilter !== 'all') {
		if (type === 'binary') {
			const labels = getAdminBinaryLabels();
			filters.push(`Reponse: ${answerFilter === 'yes' ? labels.yes : labels.no}`);
		} else {
			filters.push(
				`Reponse: ${
					surveyLabels?.[answerFilter] || `Option ${String(answerFilter)}`
				}`,
			);
		}
	}

	return filters;
}

function collectChartLegendForExport() {
	if (!chart?.data?.datasets?.length) return [];
	const dataset = chart.data.datasets[0];
	const labels = Array.isArray(chart.data.labels) ? chart.data.labels : [];
	const values = Array.isArray(dataset.data) ? dataset.data : [];
	const backgroundColors = Array.isArray(dataset.backgroundColor)
		? dataset.backgroundColor
		: [];
	const total = values.reduce((sum, value) => sum + Number(value || 0), 0);

	return labels.map((label, index) => {
		const value = Number(values[index] || 0);
		const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
		return {
			label: String(label || ''),
			value,
			percentage,
			color: String(backgroundColors[index] || '#6366f1'),
		};
	});
}

function getChartImageDataForExport() {
	return '';
}

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(reader.error || new Error('FileReader error'));
		reader.readAsDataURL(blob);
	});
}

async function getLogoImageDataForExport() {
	if (cachedPdfLogoDataUrl) return cachedPdfLogoDataUrl;
	const logoAbsoluteUrl = new URL('assets/logo.png', window.location.href).href;
	try {
		const response = await fetch(logoAbsoluteUrl, {
			method: 'GET',
			cache: 'force-cache',
		});
		if (!response.ok) return logoAbsoluteUrl;
		const blob = await response.blob();
		const dataUrl = await blobToDataUrl(blob);
		cachedPdfLogoDataUrl = dataUrl || logoAbsoluteUrl;
		return cachedPdfLogoDataUrl;
	} catch (_error) {
		return logoAbsoluteUrl;
	}
}

async function buildPdfVisualContext() {
	const logoUrl = await getLogoImageDataForExport();
	return {
		chartImage: getChartImageDataForExport(),
		legendItems: collectChartLegendForExport(),
		appliedFilters: getActiveChartFiltersForExport(),
		logoUrl,
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadScriptIntoWindow(targetWindow, scriptUrl) {
	return new Promise((resolve, reject) => {
		try {
			const existing = targetWindow.document.querySelector(
				`script[data-pdf-lib="${scriptUrl}"]`,
			);
			if (existing) {
				if (existing.dataset.loaded === 'true') {
					resolve();
					return;
				}
				existing.addEventListener('load', () => resolve(), { once: true });
				existing.addEventListener(
					'error',
					() => reject(new Error(`Script load failed: ${scriptUrl}`)),
					{ once: true },
				);
				return;
			}

			const script = targetWindow.document.createElement('script');
			script.src = scriptUrl;
			script.async = true;
			script.dataset.pdfLib = scriptUrl;
			script.addEventListener(
				'load',
				() => {
					script.dataset.loaded = 'true';
					resolve();
				},
				{ once: true },
			);
			script.addEventListener(
				'error',
				() => reject(new Error(`Script load failed: ${scriptUrl}`)),
				{ once: true },
			);
			targetWindow.document.head.appendChild(script);
		} catch (error) {
			reject(error);
		}
	});
}

async function ensurePdfRuntimeInWindow(targetWindow) {
	if (typeof targetWindow.html2canvas !== 'function') {
		await loadScriptIntoWindow(
			targetWindow,
			'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
		);
	}

	const hasJsPdfRuntime = Boolean(
		targetWindow.jspdf?.jsPDF || targetWindow.jsPDF,
	);
	if (!hasJsPdfRuntime) {
		await loadScriptIntoWindow(
			targetWindow,
			'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
		);
	}

	if (typeof targetWindow.html2canvas !== 'function') {
		throw new Error('html2canvas runtime unavailable');
	}
	if (!targetWindow.jspdf?.jsPDF && !targetWindow.jsPDF) {
		throw new Error('jsPDF runtime unavailable');
	}
}

async function downloadPdfFromPreviewWindow(printWindow, filename) {
	await ensurePdfRuntimeInWindow(printWindow);

	const html2canvas = printWindow.html2canvas;
	const JsPdfCtor = printWindow.jspdf?.jsPDF || printWindow.jsPDF;
	const captureRoot = printWindow.document.body;
	if (!captureRoot) throw new Error('PDF capture root unavailable');

	const documentWidth = Math.max(
		printWindow.document.documentElement?.scrollWidth || 0,
		captureRoot.scrollWidth || 0,
		captureRoot.clientWidth || 0,
		printWindow.innerWidth || 0,
	);
	const documentHeight = Math.max(
		printWindow.document.documentElement?.scrollHeight || 0,
		captureRoot.scrollHeight || 0,
		captureRoot.clientHeight || 0,
		printWindow.innerHeight || 0,
	);
	const baseScale = Math.min(
		1.9,
		Math.max(1.15, Number(printWindow.devicePixelRatio || 1) * 1.15),
	);
	const maxCapturePixels = 6600000;
	const basePixelArea = Math.max(1, documentWidth * documentHeight);
	const estimatedPixelsAtBase = basePixelArea * baseScale * baseScale;
	const adaptiveScale =
		estimatedPixelsAtBase > maxCapturePixels ?
			Math.sqrt(maxCapturePixels / basePixelArea)
		:	baseScale;
	const captureScale = Math.max(1.05, Math.min(1.9, Number(adaptiveScale.toFixed(2))));

	const canvas = await html2canvas(captureRoot, {
		scale: captureScale,
		useCORS: true,
		backgroundColor: '#ffffff',
		logging: false,
		windowWidth: documentWidth,
		windowHeight: documentHeight,
	});

	const pdf = new JsPdfCtor({
		orientation: 'p',
		unit: 'mm',
		format: 'a4',
		compress: true,
		putOnlyUsedFonts: true,
		precision: 12,
	});
	const pageWidth = pdf.internal.pageSize.getWidth();
	const pageHeight = pdf.internal.pageSize.getHeight();
	const marginMm = 5;
	const usableWidth = pageWidth - marginMm * 2;
	const usableHeight = pageHeight - marginMm * 2;
	const imageHeight = (canvas.height * usableWidth) / canvas.width;
	const estimatedPageCount = Math.max(1, Math.ceil(imageHeight / usableHeight));
	const jpegQuality =
		estimatedPageCount >= 10 ? 0.76
		: estimatedPageCount >= 7 ? 0.8
		: estimatedPageCount >= 4 ? 0.84
		: 0.88;
	const imageData = canvas.toDataURL('image/jpeg', jpegQuality);
	const imageAlias = `pdf-preview-${String(id || 'survey')}`;
	let remainingHeight = imageHeight;
	let offsetY = 0;

	pdf.addImage(
		imageData,
		'JPEG',
		marginMm,
		marginMm + offsetY,
		usableWidth,
		imageHeight,
		imageAlias,
		'MEDIUM',
	);
	remainingHeight -= usableHeight;

	while (remainingHeight > 0) {
		offsetY -= usableHeight;
		pdf.addPage('a4', 'p');
		pdf.addImage(
			imageData,
			'JPEG',
			marginMm,
			marginMm + offsetY,
			usableWidth,
			imageHeight,
			imageAlias,
			'MEDIUM',
		);
		remainingHeight -= usableHeight;
	}

	pdf.save(filename || `sondage-${id}.pdf`);
}

async function waitForPrintableWindowReady(printWindow, timeoutMs = 2600) {
	if (!printWindow || printWindow.closed) return;
	const doc = printWindow.document;
	const hardDeadline = Date.now() + Math.max(400, Number(timeoutMs) || 2600);

	const waitWithDeadline = (promiseFactory, maxStepMs) => {
		const remaining = hardDeadline - Date.now();
		if (remaining <= 0) return Promise.resolve();
		return Promise.race([
			promiseFactory(),
			sleep(Math.max(120, Math.min(maxStepMs, remaining))),
		]);
	};

	await waitWithDeadline(() => {
		if (doc.readyState === 'complete') return Promise.resolve();
		return new Promise((resolve) => {
			const onReadyStateChange = () => {
				if (doc.readyState === 'complete') {
					doc.removeEventListener('readystatechange', onReadyStateChange);
					resolve();
				}
			};
			doc.addEventListener('readystatechange', onReadyStateChange);
			setTimeout(() => {
				doc.removeEventListener('readystatechange', onReadyStateChange);
				resolve();
			}, 900);
		});
	}, 900);

	await waitWithDeadline(async () => {
		const images = Array.from(doc.images || []);
		if (!images.length) return;
		await Promise.all(
			images.map(
				(img) =>
					new Promise((resolve) => {
						if (img.complete && img.naturalWidth > 0) {
							resolve();
							return;
						}
						const done = () => {
							img.removeEventListener('load', done);
							img.removeEventListener('error', done);
							resolve();
						};
						img.addEventListener('load', done, { once: true });
						img.addEventListener('error', done, { once: true });
						setTimeout(done, 900);
					}),
			),
		);
	}, 900);

	await waitWithDeadline(async () => {
		if (!doc.fonts?.ready) return;
		await doc.fonts.ready;
	}, 700);

	await sleep(80);
}

async function exportResults(format) {
	try {
		if (!window.SiteApi?.getToken?.()) {
			showNotification('Session invalide pour exporter les donnees.', 'error');
			return;
		}

		const exportGuardPayload = await requestAdminJson(`/api/exports/survey/${encodeURIComponent(id)}`, {
			method: 'POST',
			timeoutMs: 45000,
			data: {
				type: type === 'multiple' ? 'multiple' : 'binary',
				format,
				requestId: `exp-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			},
		});
		const regularVotersInsight = normalizeRegularVotersInsight(
			exportGuardPayload?.insights?.regularVoters,
		);

		showNotification(`Export ${format.toUpperCase()} en cours...`, 'info');

		// Base clean export = votes clean affiches dans le dashboard
		const cleanSourceOpinions =
			Array.isArray(allOpinionsData) && allOpinionsData.length > 0 ?
				allOpinionsData
			:	opinionsData;
		const cleanChartSourceOpinions = applyDemographicAndAnswerFilters(
			cleanSourceOpinions,
		);
		const cleanOpinions = [...cleanChartSourceOpinions];
		const percentages = calculatePercentagesForExport(cleanOpinions);
		const totalVotes = cleanOpinions.length;
		const demographics = buildExportDemographicInsights(cleanOpinions);
		const uniqueVoters = Number(demographics.totalUniqueVoters || 0);
		const averageOpinionsPerVoter =
			totalVotes > 0 && uniqueVoters > 0 ?
				(totalVotes / uniqueVoters).toFixed(2)
			:	'0';
		const cleanOpinionRows = cleanOpinions
			.filter(hasOpinionComment)
			.map((opinion) =>
			mapOpinionForExport(opinion, percentages),
		);
		const analyticsSnapshot =
			currentAnalyticsSnapshot || (await fetchAdminAnalytics({ silent: true })) || {};
		const pdfVisualContext = await buildPdfVisualContext();

		// Donnees a exporter
		const exportData = {
			survey: {
				id: id,
				type: type,
				theme: currentSurvey?.theme || null,
				question: currentSurvey?.question || null,
				createdAt: currentSurvey?.createdAt || null,
				isClosed: currentSurvey?.isClosed || null,
				totalVotes: totalVotes,
				exportDate: new Date().toISOString(),
			},
			percentages: percentages,
			statistics: {
				totalVotes: totalVotes,
				uniqueVoters,
				averageOpinionsPerVoter,
				demographics,
			},
			filters: {
				applied: getActiveChartFiltersForExport(),
			},
			insights: {
				regularVoters: regularVotersInsight,
			},
			analytics: analyticsSnapshot,
			measurementDisclaimer:
				'Community mesure une audience participante active, pas une audience TV représentative totale.',
			opinions: cleanOpinionRows,
		};

		let content, mimeType, filename;

		switch (format) {
			case 'csv':
				content = convertToCSV(exportData);
				mimeType = 'text/csv;charset=utf-8;';
				filename = `sondage-${id}-${new Date().toISOString().split('T')[0]}.csv`;
				break;
			case 'json':
				content = JSON.stringify(exportData, null, 2);
				mimeType = 'application/json';
				filename = `sondage-${id}-${new Date().toISOString().split('T')[0]}.json`;
				break;
			case 'pdf':
				content = generatePDFContentEnriched(exportData, pdfVisualContext);
				mimeType = 'application/pdf';
				filename = `sondage-${id}-${new Date().toISOString().split('T')[0]}.pdf`;
				// Ouvrir dans une nouvelle fenêtre pour l'impression
				const printWindow = window.open('', '_blank');
				if (!printWindow) {
					throw new Error(
						"Impossible d'ouvrir la fenêtre d'impression (pop-up bloquée).",
					);
				}
				printWindow.document.write(content);
				printWindow.document.close();
				try {
					await waitForPrintableWindowReady(printWindow);
				} catch (printPreparationError) {
					console.warn(
						'PDF print preparation fallback:',
						printPreparationError,
					);
				}
				try {
					await downloadPdfFromPreviewWindow(printWindow, filename);
					showNotification('PDF téléchargé avec succès', 'success');
				} catch (downloadFromPreviewError) {
					console.warn(
						'PDF direct download fallback to print:',
						downloadFromPreviewError,
					);
					showNotification(
						"Apercu PDF pret. Ouverture de la boite d'impression...",
						'warning',
					);
					printWindow.focus();
					setTimeout(() => {
						try {
							printWindow.print();
						} catch (printError) {
							console.warn('print() failed:', printError);
						}
					}, 120);
				}
				hideExportModal();
				return;
		}

		// Télécharger le fichier
		const blob = new Blob(['\ufeff' + content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.style.display = 'none';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		hideExportModal();
		showNotification(`Export ${format.toUpperCase()} réussi`, 'success');
	} catch (error) {
		console.error("Erreur lors de l'export:", error);
		showNotification(error?.message || "Erreur lors de l'export", 'error');
	}
}

function normalizeRegularVotersInsight(raw = {}) {
	const normalizedStatus =
		String(raw?.status || '').toLowerCase() === 'ok' ? 'ok' : 'unavailable';
	const normalizedThreshold = Math.max(
		1,
		Number.parseInt(raw?.thresholdMinSurveys, 10) || 3,
	);
	const participantCountRaw = Number(raw?.participantCount);
	const regularVoterCountRaw = Number(raw?.regularVoterCount);
	const participantCount = Number.isFinite(participantCountRaw) ?
			Math.max(0, Math.floor(participantCountRaw))
		:	0;
	const regularVoterCount = Number.isFinite(regularVoterCountRaw) ?
			Math.max(0, Math.floor(regularVoterCountRaw))
		:	0;
	const safeRegularVoterCount = Math.min(regularVoterCount, participantCount);
	const payloadRate = Number(raw?.regularVoterRate);
	const computedRate =
		participantCount > 0 ?
			Number(((safeRegularVoterCount / participantCount) * 100).toFixed(2))
		:	0;
	const regularVoterRate = Number.isFinite(payloadRate) ?
			Math.min(100, Math.max(0, payloadRate))
		:	computedRate;

	if (normalizedStatus !== 'ok') {
		return {
			status: 'unavailable',
			scope: 'creator_surveys',
			population: 'current_survey_participants',
			includeCurrentSurvey: true,
			thresholdMinSurveys: normalizedThreshold,
			participantCount: null,
			regularVoterCount: null,
			regularVoterRate: null,
			generatedAt: raw?.generatedAt || null,
		};
	}

	return {
		status: 'ok',
		scope: String(raw?.scope || 'creator_surveys'),
		population: String(raw?.population || 'current_survey_participants'),
		includeCurrentSurvey: raw?.includeCurrentSurvey !== false,
		thresholdMinSurveys: normalizedThreshold,
		participantCount,
		regularVoterCount: safeRegularVoterCount,
		regularVoterRate: regularVoterRate,
		generatedAt: raw?.generatedAt || null,
	};
}

function buildRegularVotersSummaryMessage(regularVoters = {}) {
	if (String(regularVoters?.status || '') !== 'ok') {
		return 'Indicateur indisponible pour cet export.';
	}

	const threshold = Math.max(
		1,
		Number.parseInt(regularVoters?.thresholdMinSurveys, 10) || 3,
	);
	const participantCount = Number(regularVoters?.participantCount || 0);
	const regularVoterCount = Number(regularVoters?.regularVoterCount || 0);

	if (participantCount <= 0) {
		return 'Aucun votant sur ce sondage pour mesurer la frequence.';
	}
	if (regularVoterCount <= 0) {
		return `Aucun votant n'a encore atteint le seuil de frequence (${threshold} sondages ou plus).`;
	}
	if (regularVoterCount === 1) {
		return '1 votant repond frequemment a vos differents sondages.';
	}
	return `${regularVoterCount} votants repondent frequemment a vos differents sondages.`;
}

function convertToCSV(data) {
	const lines = [];
	const demographics = data?.statistics?.demographics || {};
	const regularVoters = normalizeRegularVotersInsight(data?.insights?.regularVoters || {});
	const ageInsights = demographics?.ageInsights || {};
	const genderInsights = demographics?.genderInsights || {};
	const ageBands = Array.isArray(ageInsights?.bands) ? ageInsights.bands : [];
	const topAgeBands = Array.isArray(ageInsights?.topAgeBands) ? ageInsights.topAgeBands : [];
	const topGenderGroups =
		Array.isArray(genderInsights?.topGenderGroups) ? genderInsights.topGenderGroups : [];
	const genderCounts = genderInsights?.counts || {};
	const formatCsvValue = (value) => String(value ?? '').replace(/"/g, '""');

	// En-tête avec métadonnées du sondage
	lines.push('MÉTADONNÉES DU SONDAGE');
	lines.push('=====================');
	lines.push(`"ID du sondage","${data.survey.id}"`);
	lines.push(`"Thème","${(data.survey.theme || '').replace(/"/g, '""')}"`);
	lines.push(
		`"Question","${(data.survey.question || '').replace(/"/g, '""')}"`,
	);
	lines.push(
		`"Type","${data.survey.type === 'binary' ? 'Binaire' : 'Multiple'}"`,
	);
	lines.push(`"Total votes","${data.survey.totalVotes}"`);
	lines.push(
		`"Date de création","${new Date(data.survey.createdAt).toLocaleString(getIntlLocale())}"`,
	);
	lines.push(
		`"Date d'export","${new Date(data.survey.exportDate).toLocaleString(getIntlLocale())}"`,
	);
	lines.push('');

	// Section des pourcentages
	lines.push('STATISTIQUES PAR RÉPONSE');
	lines.push('=======================');
	if (data.survey.type === 'binary') {
		lines.push('"Réponse","Votes","Pourcentage"');
		Object.entries(data.percentages || {}).forEach(([label, info]) => {
			lines.push(
				`"${label.replace(/"/g, '""')}","${Number(info.count || 0)}","${Number(info.percentage || 0)}%"`,
			);
		});
	} else {
		lines.push('"Réponse","Cl?","Votes","Pourcentage"');
		Object.entries(data.percentages).forEach(([label, info]) => {
			lines.push(
				`"${label.replace(/"/g, '""')}","${info.key}","${info.count}","${info.percentage}%"`,
			);
		});
	}
	lines.push('');

	// Statistiques générales
	lines.push('STATISTIQUES GÉNÉRALES');
	lines.push('=====================');
	lines.push(`"Total votes","${data.statistics.totalVotes}"`);
	lines.push(`"Votants uniques","${data.statistics.uniqueVoters}"`);
	lines.push(
		`"Moyenne votes par votant","${data.statistics.averageOpinionsPerVoter}"`,
	);
	if (Array.isArray(data.filters?.applied) && data.filters.applied.length > 0) {
		lines.push(`"Filtres appliques","${data.filters.applied.join(' | ')}"`);
	} else {
		lines.push('"Filtres appliques","Aucun filtre"');
	}
	lines.push('');

	// Analyse demographique agrégée (votants uniques)
	lines.push('ANALYSE DEMOGRAPHIQUE AGREGEE');
	lines.push('==============================');
	lines.push(
		`"Base population","${formatCsvValue(demographics.populationBase || 'unique_voters')}"`,
	);
	lines.push(
		`"Total votants uniques","${Number(demographics.totalUniqueVoters || 0)}"`,
	);

	if (ageInsights.status === 'ok' && topAgeBands.length > 0) {
		const topAgeLabel =
			topAgeBands.length > 1 ?
				`Egalite: ${topAgeBands.join(' | ')}`
			:	topAgeBands[0];
		lines.push(`"Tranche(s) d'age dominante(s)","${formatCsvValue(topAgeLabel)}"`);
		lines.push(
			`"Poids tranche(s) dominante(s)","${Number(ageInsights.topAgeCount || 0)} votant(s) (${Number(ageInsights.topAgePercentage || 0)}% des ages connus)"`,
		);
	} else {
		lines.push(`"Tranche(s) d'age dominante(s)","Donnees insuffisantes"`);
	}
	lines.push(`"Votants avec age connu","${Number(ageInsights.knownAgeVoters || 0)}"`);
	lines.push(`"Votants avec age inconnu","${Number(ageInsights.unknownAgeVoters || 0)}"`);
	lines.push('"Repartition des tranches d age","Count (% ages connus)"');
	ageBands.forEach((band) => {
		lines.push(
			`"${formatCsvValue(band.label)}","${Number(band.count || 0)} (${Number(band.percentage || 0)}%)"`,
		);
	});

	if (genderInsights.status === 'ok' && topGenderGroups.length > 0) {
		const topGenderLabel =
			topGenderGroups.length > 1 ?
				`Egalite: ${topGenderGroups.join(' / ')}`
			:	topGenderGroups[0];
		lines.push(
			`"Sexe dominant (H/F)","${formatCsvValue(topGenderLabel)}"`,
		);
		lines.push(
			`"Poids sexe dominant","${Number(genderInsights.topGenderCount || 0)} votant(s) (${Number(genderInsights.topGenderPercentage || 0)}% de H/F)"`,
		);
	} else {
		lines.push(`"Sexe dominant (H/F)","Donnees insuffisantes"`);
	}

	lines.push(
		`"Repartition Homme","${Number(genderCounts?.homme?.count || 0)} (${Number(genderCounts?.homme?.percentage || 0)}%)"`,
	);
	lines.push(
		`"Repartition Femme","${Number(genderCounts?.femme?.count || 0)} (${Number(genderCounts?.femme?.percentage || 0)}%)"`,
	);
	lines.push(
		`"Repartition Non renseigne","${Number(genderCounts?.non_renseigne?.count || 0)} (${Number(genderCounts?.non_renseigne?.percentage || 0)}%)"`,
	);
	lines.push('');

	// Frequence de participation anonymisee
	lines.push('FREQUENCE DE PARTICIPATION (ANONYMEE)');
	lines.push('=====================================');
	if (regularVoters.status === 'ok') {
		lines.push(
			`"Seuil votant regulier","${Number(regularVoters.thresholdMinSurveys || 3)} sondages ou plus"`,
		);
		lines.push('"Base de calcul","Participants du sondage exporte"');
		lines.push(
			`"Total participants","${Number(regularVoters.participantCount || 0)}"`,
		);
		lines.push(
			`"Votants reguliers","${Number(regularVoters.regularVoterCount || 0)}"`,
		);
		lines.push(
			`"Taux votants reguliers","${Number(regularVoters.regularVoterRate || 0)}%"`,
		);
		lines.push(
			`"Synthese","${formatCsvValue(buildRegularVotersSummaryMessage(regularVoters))}"`,
		);
	} else {
		lines.push('"Statut","Indisponible"');
		lines.push(
			`"Synthese","${formatCsvValue(buildRegularVotersSummaryMessage(regularVoters))}"`,
		);
	}
	lines.push('');

	const analytics = data?.analytics || {};
	lines.push('ANALYTICS COMMUNITY TV');
	lines.push('======================');
	lines.push(`"Avertissement","${formatCsvValue(data?.measurementDisclaimer || analytics?.reliability?.note || 'Community mesure une audience participante active, pas une audience TV representative totale.')}"`);
	lines.push(`"Scans QR","${Number(analytics?.acquisition?.totalScans || 0)}"`);
	lines.push(`"Votants temps reel","${Number(analytics?.conversion?.votersRealtime || 0)}"`);
	lines.push(`"Taux scan vers vote","${Number(analytics?.conversion?.scanToVoteRate || 0)}%"`);
	lines.push(`"Temps moyen scan vers vote","${Number(analytics?.conversion?.averageScanToVoteSeconds || 0)} secondes"`);
	lines.push(`"Messages chat","${Number(analytics?.chat?.totalMessages || 0)}"`);
	lines.push(`"Participants chat actifs","${Number(analytics?.chat?.activeParticipants || 0)}"`);
	lines.push(`"Votants revenus","${Number(analytics?.retention?.returningVoters || 0)}"`);
	lines.push(`"Chatters revenus","${Number(analytics?.retention?.returningChatParticipants || 0)}"`);
	lines.push(`"Tranche age dominante analytics","${formatCsvValue(analytics?.profile?.topAgeBand?.label || 'Non renseigne')}"`);
	lines.push(`"Genre dominant analytics","${formatCsvValue(analytics?.profile?.dominantGender?.label || 'Non renseigne')}"`);
	lines.push(`"Pays dominant analytics","${formatCsvValue(analytics?.profile?.dominantCountry?.countryName || analytics?.profile?.dominantCountry?.countryCode || 'Non renseigne')}"`);
	lines.push('');

	const topCountries = filterKnownAnalyticsCountries(analytics?.acquisition?.topCountries || []);
	if (topCountries.length) {
		lines.push('TOP PAYS QR');
		lines.push('"Pays","Code","Scans"');
		topCountries.forEach((country) => {
			lines.push(`"${formatCsvValue(country.countryName || country.countryCode)}","${formatCsvValue(country.countryCode)}","${Number(country.count || 0)}"`);
		});
		lines.push('');
	}

	// Section des opinions
	lines.push('OPINIONS DÉTAILLÉES');
	lines.push('==================');
	lines.push(
		'"ID Opinion","VoterKey","Pseudo","Réponse","Réponse (libell?)","Pourcentage de la réponse","Raison","Likes","Dislikes","Date"',
	);

	data.opinions.forEach((opinion) => {
		lines.push(
			[
				`"${opinion.id}"`,
				`"${(opinion.voterKey || '').replace(/"/g, '""')}"`,
				`"${opinion.userPseudo.replace(/"/g, '""')}"`,
				`"${opinion.answer}"`,
				`"${opinion.answerLabel.replace(/"/g, '""')}"`,
				`"${opinion.answerPercentage}%"`,
				`"${(opinion.reason || '').replace(/"/g, '""')}"`,
				opinion.likeCount,
				opinion.dislikeCount,
				`"${new Date(opinion.createdAt).toLocaleString(getIntlLocale())}"`,
			].join(','),
		);
	});

	return lines.join('\n');
}

function generatePDFContentEnriched(data, visualContext = {}) {
	function escapeHtml(str) {
		return String(str || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	const legendItems = Array.isArray(visualContext.legendItems)
		? visualContext.legendItems
		: [];
	const chartImage = String(visualContext.chartImage || '').trim();
	const hasChartImage = Boolean(chartImage);
	const logoUrl = String(
		visualContext.logoUrl || new URL('assets/logo.svg', window.location.href).href,
	);
	const appliedFilters =
		Array.isArray(visualContext.appliedFilters) && visualContext.appliedFilters.length ?
			visualContext.appliedFilters
		: Array.isArray(data?.filters?.applied) ?
			data.filters.applied
		:	[];

	const now = new Date();
	const nowLabel = now.toLocaleString(getIntlLocale());
	const currentYear = now.getFullYear();
	const chartLegendMarkup = legendItems
		.map(
			(item) => `
				<div class="chart-legend-item">
					<span class="chart-legend-dot" style="background:${escapeHtml(item.color)}"></span>
					<span class="chart-legend-label">${escapeHtml(item.label)}</span>
					<span class="chart-legend-value">${Number(item.value || 0)} (${Number(item.percentage || 0)}%)</span>
				</div>
			`,
		)
		.join('');
	const filterMarkup =
		appliedFilters.length > 0 ?
			`<p class="filters-note"><strong>Filtres du diagramme :</strong> ${escapeHtml(appliedFilters.join(' | '))}</p>`
		:	'<p class="filters-note"><strong>Filtres du diagramme :</strong> aucun filtre actif</p>';
	const demographics = data?.statistics?.demographics || {};
	const regularVoters = normalizeRegularVotersInsight(data?.insights?.regularVoters || {});
	const ageInsights = demographics?.ageInsights || {};
	const genderInsights = demographics?.genderInsights || {};
	const ageBands = Array.isArray(ageInsights?.bands) ? ageInsights.bands : [];
	const topAgeBands = Array.isArray(ageInsights?.topAgeBands) ? ageInsights.topAgeBands : [];
	const topGenderGroups =
		Array.isArray(genderInsights?.topGenderGroups) ? genderInsights.topGenderGroups : [];
	const genderCounts = genderInsights?.counts || {};
	const regularVotersSummary = buildRegularVotersSummaryMessage(regularVoters);
	const regularVotersDetail =
		regularVoters.status === 'ok' ?
			`${Number(regularVoters.regularVoterCount || 0)} / ${Number(regularVoters.participantCount || 0)} (${Number(regularVoters.regularVoterRate || 0)}%)`
		:	'Indisponible';
	const ageDominanceLabel =
		ageInsights.status === 'ok' && topAgeBands.length > 0 ?
			topAgeBands.length > 1 ?
				`Egalite: ${topAgeBands.join(' / ')}`
			:	topAgeBands[0]
		:	'Donnees insuffisantes';
	const ageDominanceMeta =
		ageInsights.status === 'ok' &&
		Number(ageInsights.topAgeCount || 0) > 0 &&
		Number(ageInsights.knownAgeVoters || 0) > 0 ?
			`${Number(ageInsights.topAgeCount || 0)} votant(s) (${Number(ageInsights.topAgePercentage || 0)}% des ages connus)`
		:	'Aucun age exploitable dans ce sous-ensemble.';
	const genderDominanceLabel =
		genderInsights.status === 'ok' && topGenderGroups.length > 0 ?
			topGenderGroups.length > 1 ?
				`Egalite: ${topGenderGroups.join(' / ')}`
			:	topGenderGroups[0]
		:	'Donnees insuffisantes';
	const genderDominanceMeta =
		genderInsights.status === 'ok' &&
		Number(genderInsights.topGenderCount || 0) > 0 &&
		Number(genderInsights.comparableVoters || 0) > 0 ?
			`${Number(genderInsights.topGenderCount || 0)} votant(s) (${Number(genderInsights.topGenderPercentage || 0)}% de Homme/Femme)`
		:	'Aucune comparaison Homme/Femme exploitable.';
	const ageBandRows = ageBands
		.map(
			(band) => `
				<tr>
					<td>${escapeHtml(band.label)}</td>
					<td>${Number(band.count || 0)}</td>
					<td>${Number(band.percentage || 0)}%</td>
				</tr>
			`,
		)
		.join('');
	const percentageRows = Object.entries(data.percentages || {})
		.map(
			([label, info]) => `
				<tr>
					<td>${escapeHtml(label)}</td>
					${data.survey.type === 'multiple' ? `<td>${escapeHtml(info.key)}</td>` : ''}
					<td>${Number(info.count || 0)}</td>
					<td><strong>${Number(info.percentage || 0)}%</strong></td>
					<td>
						<div class="percentage-bar">
							<div class="bar-container">
								<div class="bar-fill" style="width:${Number(info.percentage || 0)}%"></div>
							</div>
							<span>${Number(info.percentage || 0)}%</span>
						</div>
					</td>
				</tr>
			`,
		)
		.join('');
	const opinionRows = (Array.isArray(data.opinions) ? data.opinions : [])
		.map(
			(opinion, index) => `
				<tr>
					<td>${index + 1}</td>
					<td>${escapeHtml(opinion.voterKey || '')}</td>
					<td>${escapeHtml(opinion.userPseudo || 'Anonyme')}</td>
					<td>${escapeHtml(opinion.answerLabel || '')}</td>
					<td>${Number(opinion.answerPercentage || 0)}%</td>
					<td style="max-width: 220px;">${escapeHtml(opinion.reason || '-')}</td>
					<td>${Number(opinion.likeCount || 0)}</td>
					<td>${Number(opinion.dislikeCount || 0)}</td>
					<td>${new Date(opinion.createdAt).toLocaleString(getIntlLocale())}</td>
				</tr>
			`,
		)
		.join('');
	const analytics = data?.analytics || {};
	const topCountriesRows = filterKnownAnalyticsCountries(analytics?.acquisition?.topCountries || [])
		.map((country) => `<tr><td>${escapeHtml(country.countryName || country.countryCode)}</td><td>${escapeHtml(country.countryCode)}</td><td>${Number(country.count || 0)}</td></tr>`)
		.join('');
	const analyticsRows = [
		['Scans QR', Number(analytics?.acquisition?.totalScans || 0)],
		['Votants temps reel', Number(analytics?.conversion?.votersRealtime || 0)],
		['Taux scan vers vote', `${Number(analytics?.conversion?.scanToVoteRate || 0)}%`],
		['Temps moyen scan vers vote', `${Number(analytics?.conversion?.averageScanToVoteSeconds || 0)} secondes`],
		['Messages chat', Number(analytics?.chat?.totalMessages || 0)],
		['Participants chat actifs', Number(analytics?.chat?.activeParticipants || 0)],
		['Votants revenus', Number(analytics?.retention?.returningVoters || 0)],
		['Chatters revenus', Number(analytics?.retention?.returningChatParticipants || 0)],
	]
		.map(([label, value]) => `<div class="summary-item"><span>${escapeHtml(label)}:</span><strong>${escapeHtml(value)}</strong></div>`)
		.join('');

	return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="utf-8" />
	<title>Résultats du sondage - ${escapeHtml(data.survey.theme || 'Sans titre')}</title>
	<style>
		@page { margin: 16mm 12mm 22mm; }
		* {
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			color: #0f172a;
			font-size: 12.5px;
			line-height: 1.45;
			padding-bottom: 76px;
		}
		.header {
			text-align: center;
			margin-bottom: 24px;
			border-bottom: 2px solid #1f2937;
			padding-bottom: 14px;
		}
		h1 { margin: 0 0 8px; color: #111827; font-size: 24px; }
		h2 {
			color: #374151;
			margin: 24px 0 12px;
			font-size: 18px;
			border-bottom: 1px solid #d1d5db;
			padding-bottom: 5px;
		}
		h3 { color: #4b5563; margin: 16px 0 8px; font-size: 15px; }
		.meta-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
			gap: 8px;
			margin: 18px 0;
		}
		.meta-item {
			padding: 10px;
			background: #f3f4f6;
			border-radius: 6px;
			border: 1px solid #e5e7eb;
		}
		.meta-label { font-weight: 700; color: #6b7280; font-size: 11px; margin-bottom: 4px; }
		.meta-value { color: #111827; font-size: 13px; }
		.summary {
			background: #eef2ff;
			border: 1px solid #dbeafe;
			padding: 12px;
			border-radius: 8px;
			margin: 16px 0;
		}
		.summary-item { display: flex; justify-content: space-between; margin: 4px 0; }
		.summary-note {
			font-size: 11px;
			color: #1f2937;
			margin: 8px 0 0;
			line-height: 1.35;
		}
		.demography-panel {
			margin: 14px 0 18px;
			padding: 14px;
			border: 1px solid #dbeafe;
			border-radius: 8px;
			background: #f8fafc;
		}
		.demography-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 10px;
			margin: 10px 0 12px;
		}
		.demography-item {
			background: #ffffff;
			border: 1px solid #dbeafe;
			border-radius: 8px;
			padding: 10px;
		}
		.demography-label {
			font-size: 11px;
			font-weight: 700;
			color: #6b7280;
			margin-bottom: 3px;
		}
		.demography-value {
			font-size: 13px;
			font-weight: 700;
			color: #111827;
		}
		.demography-note {
			font-size: 11px;
			color: #334155;
			margin-top: 4px;
			line-height: 1.4;
		}
		.demography-table {
			margin: 10px 0 0;
			font-size: 10.5px;
		}
		.demography-table th {
			background: #eff6ff;
			font-size: 10.5px;
		}
		.demography-table td {
			font-size: 10.5px;
		}
		.chart-section-title {
			color: #0f172a;
			font-size: 20px;
			font-weight: 800;
			letter-spacing: 0.2px;
			margin: 24px 0 12px;
			border-bottom: 1px solid #cbd5e1;
			padding-bottom: 6px;
		}
		.chart-block {
			margin: 14px 0 18px;
			padding: 14px;
			border: 1px solid #cbd5e1;
			border-radius: 8px;
			background: #ffffff;
		}
		.chart-image-wrap { display: flex; justify-content: center; margin: 8px 0 12px; }
		.chart-image {
			max-width: 440px;
			width: 100%;
			border-radius: 10px;
			border: 1px solid #d1d5db;
			background: #fff;
		}
		.chart-placeholder {
			text-align: center;
			color: #6b7280;
			padding: 10px 0;
			font-style: italic;
		}
		.chart-legend {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
			gap: 8px;
			margin: 12px 0 8px;
		}
		.chart-legend-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 7px 10px;
			border: 1px solid #cbd5e1;
			border-radius: 999px;
			background: #fff;
		}
		.chart-legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
		.chart-legend-label {
			font-weight: 700;
			font-size: 12.5px;
			color: #0f172a;
			line-height: 1.35;
		}
		.chart-legend-value {
			margin-left: auto;
			color: #111827;
			font-size: 12px;
			font-weight: 700;
			white-space: nowrap;
		}
		.filters-note {
			margin: 10px 0 6px;
			color: #0f172a;
			font-size: 12px;
			font-weight: 600;
		}
		.chart-copyright {
			margin: 12px 0 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
			text-align: center;
			color: #4b5563;
			font-size: 10px;
		}
		.chart-copyright img { width: 18px; height: 18px; }
		table {
			width: 100%;
			border-collapse: collapse;
			margin: 14px 0;
			font-size: 11px;
		}
		th {
			background: #f3f4f6;
			font-weight: 700;
			text-align: left;
			padding: 7px;
			border: 1px solid #d1d5db;
		}
		td {
			padding: 7px;
			border: 1px solid #d1d5db;
			vertical-align: top;
		}
		tr:nth-child(even) { background: #f9fafb; }
		.percentage-bar { display: flex; align-items: center; gap: 6px; }
		.bar-container {
			flex: 1;
			height: 6px;
			background: #e5e7eb;
			border-radius: 3px;
			overflow: hidden;
		}
		.bar-fill { height: 100%; background: #4f46e5; }
		.doc-footer {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			padding: 8px 12px 10px;
			border-top: 1px solid #d1d5db;
			background: #fff;
			text-align: center;
			font-size: 10px;
			color: #4b5563;
		}
		.doc-footer-row {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
		}
		.doc-footer img { width: 16px; height: 16px; }
		.analytics-panel {
			margin: 14px 0 18px;
			padding: 14px;
			border: 1px solid #ddd6fe;
			border-radius: 8px;
			background: #f5f3ff;
		}
		.analytics-panel p { margin: 6px 0 0; color: #4b5563; font-size: 11px; }
		.page-break { page-break-before: always; }
	</style>
</head>
<body>
	<div class="header">
		<h1>${escapeHtml(data.survey.theme || 'Sondage')}</h1>
		<p style="color:#6b7280;font-size:14px;">${escapeHtml(data.survey.question || '')}</p>
	</div>

	<div class="meta-grid">
		<div class="meta-item"><div class="meta-label">ID du sondage</div><div class="meta-value">${escapeHtml(data.survey.id)}</div></div>
		<div class="meta-item"><div class="meta-label">Type</div><div class="meta-value">${data.survey.type === 'binary' ? 'Binaire' : 'Multiple'}</div></div>
		<div class="meta-item"><div class="meta-label">Total votes</div><div class="meta-value">${Number(data.survey.totalVotes || 0)}</div></div>
		<div class="meta-item"><div class="meta-label">Date export</div><div class="meta-value">${new Date(data.survey.exportDate).toLocaleString(getIntlLocale())}</div></div>
	</div>

	<div class="summary">
		<h3>Resume statistique</h3>
		<div class="summary-item"><span>Votants uniques:</span><strong>${Number(data.statistics.uniqueVoters || 0)}</strong></div>
		<div class="summary-item"><span>Moyenne votes par votant:</span><strong>${escapeHtml(data.statistics.averageOpinionsPerVoter || '0')}</strong></div>
		<div class="summary-item"><span>Votants reguliers (>= ${Number(regularVoters.thresholdMinSurveys || 3)} sondages):</span><strong>${escapeHtml(regularVotersDetail)}</strong></div>
		<p class="summary-note">${escapeHtml(regularVotersSummary)}</p>
	</div>

	<div class="analytics-panel">
		<h3>Analytics Community TV</h3>
		${analyticsRows}
		<p>${escapeHtml(data?.measurementDisclaimer || analytics?.reliability?.note || 'Community mesure une audience participante active, pas une audience TV representative totale.')}</p>
	</div>

	<div class="demography-panel">
		<h3>Analyse demographique des votants</h3>
		<div class="demography-grid">
			<div class="demography-item">
				<div class="demography-label">Base de population</div>
				<div class="demography-value">${escapeHtml(demographics.populationBase || 'unique_voters')}</div>
				<div class="demography-note">Total votants uniques: ${Number(demographics.totalUniqueVoters || 0)}</div>
			</div>
			<div class="demography-item">
				<div class="demography-label">Tranche(s) d age dominante(s)</div>
				<div class="demography-value">${escapeHtml(ageDominanceLabel)}</div>
				<div class="demography-note">${escapeHtml(ageDominanceMeta)}</div>
				<div class="demography-note">Ages connus: ${Number(ageInsights.knownAgeVoters || 0)} | Ages inconnus: ${Number(ageInsights.unknownAgeVoters || 0)}</div>
			</div>
			<div class="demography-item">
				<div class="demography-label">Sexe dominant (H/F)</div>
				<div class="demography-value">${escapeHtml(genderDominanceLabel)}</div>
				<div class="demography-note">${escapeHtml(genderDominanceMeta)}</div>
				<div class="demography-note">H: ${Number(genderCounts?.homme?.count || 0)} | F: ${Number(genderCounts?.femme?.count || 0)} | NR: ${Number(genderCounts?.non_renseigne?.count || 0)}</div>
			</div>
		</div>
		<table class="demography-table">
			<thead>
				<tr>
					<th>Tranche d age</th>
					<th>Votants</th>
					<th>% (ages connus)</th>
				</tr>
			</thead>
			<tbody>
				${ageBandRows || '<tr><td colspan="3">Aucune donnee d age exploitable.</td></tr>'}
			</tbody>
		</table>
	</div>

	<h2 class="chart-section-title">Synthèse visuelle des résultats</h2>
	<div class="chart-block">
		<div class="chart-image-wrap">
			${hasChartImage ? `<img class="chart-image" src="${chartImage}" alt="Synthèse visuelle des votes" />` : '<div class="chart-placeholder">Synthèse graphique remplacée par les barres de résultats dans l’interface administrateur.</div>'}
		</div>
		${filterMarkup}
		${legendItems.length > 0 ? `<div class="chart-legend">${chartLegendMarkup}</div>` : ''}
		<div class="chart-copyright">
			<img src="${escapeHtml(logoUrl)}" alt="Logo Community" />
			<span>&copy; ${currentYear} Community - Tous droits reserves</span>
		</div>
	</div>

	<h2>Pourcentages par reponse</h2>
	<table>
		<thead>
			<tr>
				<th>Reponse</th>
				${data.survey.type === 'multiple' ? '<th>Cle</th>' : ''}
				<th>Votes</th>
				<th>Pourcentage</th>
				<th>Visualisation</th>
			</tr>
		</thead>
		<tbody>${percentageRows}</tbody>
	</table>

	<h2>Top pays QR</h2>
	<table>
		<thead><tr><th>Pays</th><th>Code</th><th>Scans</th></tr></thead>
		<tbody>
			${topCountriesRows || '<tr><td colspan="3">Aucune donnée pays disponible.</td></tr>'}
		</tbody>
	</table>

	<div class="page-break"></div>

	<h2>Details des opinions (${(Array.isArray(data.opinions) ? data.opinions.length : 0)} au total)</h2>
	<table>
		<thead>
			<tr>
				<th>#</th>
				<th>VoterKey</th>
				<th>Pseudo</th>
				<th>Reponse</th>
				<th>Pourcentage</th>
				<th>Raison</th>
				<th>Likes</th>
				<th>Dislikes</th>
				<th>Date</th>
			</tr>
		</thead>
		<tbody>${opinionRows}</tbody>
	</table>

	<div class="doc-footer">
		<div class="doc-footer-row">
			<img src="${escapeHtml(logoUrl)}" alt="Logo Community" />
			<span>&copy; ${currentYear} Community - Document généré le ${nowLabel}</span>
		</div>
		<div>ID sondage: ${escapeHtml(data.survey.id)} | Type: ${escapeHtml(data.survey.type)} | Total: ${Number(data.survey.totalVotes || 0)} votes</div>
	</div>
</body>
</html>`;
}

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
