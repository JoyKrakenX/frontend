/** @format */

// =============================================================
// Configuration
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			mySurveys: '/api/my-surveys',
			authMe: '/api/auth/me',
			googleAuth: '/api/auth/google',
			surveyResults: {
				binary: '/api/survey',
				multiple: '/api/survey_2',
			},
			closeSurvey: {
				binary: '/api/survey',
				multiple: '/api/survey_2',
			},
		},
	},
	colors: {
		primary: '#6366f1',
		success: '#10b981',
		danger: '#ef4444',
		warning: '#f59e0b',
	},
};

// =============================================================
// Variables globales
// =============================================================
let currentUser = null;
let surveysData = [];
let filteredSurveys = []; // <-- AJOUT0 pour la recherche
let pendingTermination = null;
let isRedirecting = false;
const SURVEY_FEED_REFRESH_DEBOUNCE_MS = 700;
const SURVEY_FEED_EVENT_CACHE_LIMIT = 250;

let surveysFeedSocket = null;
let surveysFeedRefreshTimer = null;
let isSilentFeedRefreshInFlight = false;
const processedSurveyFeedEventIds = new Set();
let requestActiveSurveyColumnScroll = null;

const i18n = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';

function queueActiveSurveyColumnScroll({
	force = true,
	mobileOnly = true,
} = {}) {
	if (typeof requestActiveSurveyColumnScroll !== 'function') return;
	requestActiveSurveyColumnScroll({ force, mobileOnly });
}

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

function renderVotesNode(votesCount) {
	return `
		<i class="fas fa-users"></i>
		<span>${formatVotesText(votesCount)}</span>
	`;
}

function updateSurveyVotesDom(surveyId, votesCount) {
	const votesElement = document.getElementById(`votes-${surveyId}`);
	if (!votesElement) return;
	votesElement.innerHTML = renderVotesNode(votesCount);
}

// =============================================================
// Fonction utilitaire de redirection
// =============================================================
function redirectToBrowseSurveys(message = '', type = 'info') {
	if (isRedirecting) return;

	isRedirecting = true;
	disconnectSurveyFeedSocket();

	if (message) {
		showNotification(message, type);
	}

	setTimeout(() => {
		window.location.href = 'browse-surveys.html';
	}, 1000);
}

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	resetTransientModalStateOnBoot();
	normalizePageScrollOwner();
	// Mettre à jour le nom d'utilisateur AVANT l'initialisation
	updateUserPseudoFromLocalStorage();
	initializeFooter();
	initializeEventListeners();
	initializeApp();

	// --- LOGIN BUTTON LOGIC ---
	const googleLoginBtn = document.getElementById('google-login-btn');
	if (googleLoginBtn) {
		googleLoginBtn.addEventListener('click', (e) => {
			setButtonLoading(e.target, true);
			window.location.href = `${CONFIG.api.endpoints.googleAuth}`;
		});
	}

	window.addEventListener('beforeunload', () => {
		disconnectSurveyFeedSocket();
	});
});

window.addEventListener('pageshow', (event) => {
	if (!event.persisted) return;
	resetTransientModalStateOnBoot();
	normalizePageScrollOwner();
	const token = getAuthTokenForSocket();
	if (!token) return;

	initializeSurveyFeedRealtime();
	loadUserSurveys({ silent: true }).catch(() => {});
});

// =============================================================
// Fonctions utilitaires
// =============================================================

// --- LOGOUT HANDLER ---
function handleLogout() {
	disconnectSurveyFeedSocket();

	try {
		// Nettoyer le stockage local
		localStorage.removeItem('token');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');
	} catch (error) {
		console.warn('Erreur lors du nettoyage du localStorage:', error);
	}

	// Réinitialiser l'utilisateur courant
	currentUser = null;

	// Rediriger vers la page de navigation des sondages
	redirectToBrowseSurveys('Déconnexion réussie', 'success');
}

function setButtonLoading(button, isLoading) {
	if (isLoading) {
		const originalContent = button.innerHTML;
		button.setAttribute('data-original-content', originalContent);
		button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
		button.disabled = true;
	} else {
		const originalContent = button.getAttribute('data-original-content');
		if (originalContent) {
			button.innerHTML = originalContent;
			button.removeAttribute('data-original-content');
		}
		button.disabled = false;
	}
}

function announceToScreenReader(message) {
	// Créer un élément caché pour les lecteurs d'écran
	const announcement = document.createElement('div');
	announcement.setAttribute('aria-live', 'polite');
	announcement.setAttribute('aria-atomic', 'true');
	announcement.style.cssText = `
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	`;
	announcement.textContent = message;
	document.body.appendChild(announcement);

	setTimeout(() => {
		announcement.remove();
	}, 1000);
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

function normalizePageScrollOwner() {
	// Let CSS own scroll behavior to avoid overriding modal lock styles.
	document.documentElement.style.removeProperty('overflow');
	document.documentElement.style.removeProperty('overflow-y');
	document.documentElement.style.removeProperty('overflow-x');
	document.body.style.removeProperty('overflow');
	document.body.style.removeProperty('overflow-y');
	document.body.style.removeProperty('overflow-x');
}

function resetTransientModalStateOnBoot() {
	window.SiteModalSheet?.closeAll?.();
	document.body.classList.remove('modal-open');

	// Defensive cleanup in case a modal remained visible after navigation restore.
	document.querySelectorAll('.modal:not(.hidden)').forEach((modal) => {
		modal.classList.add('hidden');
		modal.setAttribute('aria-hidden', 'true');
		modal.dataset.modalOpen = 'false';
	});

	normalizePageScrollOwner();
}

function isAnyModalOpen() {
	return Boolean(document.querySelector('.modal:not(.hidden)'));
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

function findSurveyIndexByIdentity(list, surveyId, type) {
	return list.findIndex((survey) => {
		if (String(survey?._id || '') !== String(surveyId || '')) return false;
		if (!type) return true;
		return normalizeSurveyType(survey?.type) === normalizeSurveyType(type);
	});
}

function rerenderMySurveyListsPreservingFilter() {
	const searchInput = document.getElementById('survey-search');
	const searchTerm = String(searchInput?.value || '')
		.toLowerCase()
		.trim();

	if (searchTerm) {
		filterSurveys(searchTerm);
		return;
	}

	filteredSurveys = [...surveysData];
	displaySurveys();
	updateSurveyCounts();
	updateStats(surveysData);
}

function applySurveyFeedLocalPatch(payload = {}) {
	const surveyId = String(payload.surveyId || '').trim();
	if (!surveyId) return false;

	const surveyType = normalizeSurveyType(payload.type);
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

	const currentIndex = findSurveyIndexByIdentity(surveysData, surveyId, surveyType);
	if (currentIndex >= 0) {
		const current = surveysData[currentIndex];
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
			isClosed:
				action === 'closed' ? true
				: payload.isClosed !== undefined ? Boolean(payload.isClosed)
				: Boolean(current.isClosed),
			createdAt: payload.createdAt || current.createdAt,
			endedAt:
				action === 'closed' ?
					payload.endedAt || new Date().toISOString()
				:	payload.endedAt || current.endedAt || null,
			totalVotes: nextVotes,
			opinionsCount: nextVotes,
		};
		surveysData[currentIndex] = nextSurvey;
		const filteredIndex = findSurveyIndexByIdentity(
			filteredSurveys,
			surveyId,
			surveyType,
		);
		if (filteredIndex >= 0) {
			filteredSurveys[filteredIndex] = nextSurvey;
		}

		if (action === 'vote') {
			updateSurveyVotesDom(surveyId, nextVotes);
			updateStats(surveysData);
			return true;
		}

		rerenderMySurveyListsPreservingFilter();
		return true;
	}

	if (action === 'vote') return false;
	if (action !== 'created') return false;

	const createdAt = payload.createdAt || payload.occurredAt || new Date().toISOString();
	const initialVotes = hasIncomingVotes ? incomingVotes : 0;
	surveysData.unshift({
		_id: surveyId,
		type: surveyType,
		explain: payload.explain === false ? false : true,
		isClosed: Boolean(payload.isClosed),
		createdAt,
		endedAt: payload.endedAt || null,
		theme: '#NouveauSondage',
		question: '',
		totalVotes: initialVotes,
		opinionsCount: initialVotes,
	});

	rerenderMySurveyListsPreservingFilter();
	return true;
}

function scheduleSilentMySurveysRefresh() {
	if (surveysFeedRefreshTimer) {
		clearTimeout(surveysFeedRefreshTimer);
	}

	surveysFeedRefreshTimer = setTimeout(async () => {
		surveysFeedRefreshTimer = null;
		if (isAnyModalOpen()) {
			scheduleSilentMySurveysRefresh();
			return;
		}
		if (isSilentFeedRefreshInFlight) return;
		isSilentFeedRefreshInFlight = true;
		try {
			await loadUserSurveys({ silent: true });
		} catch (error) {
			const normalizedMessage = String(error?.message || '')
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '');
			const isSessionError =
				normalizedMessage.includes('session expiree') ||
				normalizedMessage.includes('token manquant');
			if (!isSessionError) {
				console.error('Erreur refresh silencieux my-surveys:', error);
			}
		} finally {
			isSilentFeedRefreshInFlight = false;
		}
	}, SURVEY_FEED_REFRESH_DEBOUNCE_MS);
}

function handleSurveyFeedUpdateEvent(payload = {}) {
	if (hasSurveyFeedEventBeenProcessed(payload.eventId)) return;
	markSurveyFeedEventProcessed(payload.eventId);
	applySurveyFeedLocalPatch(payload);
	scheduleSilentMySurveysRefresh();
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
		scheduleSilentMySurveysRefresh();
	});

	surveysFeedSocket.on('surveys:my:update', (payload) => {
		handleSurveyFeedUpdateEvent(payload);
	});

	surveysFeedSocket.io?.on?.('reconnect', () => {
		scheduleSilentMySurveysRefresh();
	});
}

// =============================================================
// Gestion de la barre de recherche
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
		filteredSurveys = [...surveysData];
		displaySurveys();
		updateSurveyCounts();
		if (userInitiated) {
			queueActiveSurveyColumnScroll({ force: false, mobileOnly: false });
		}
		return;
	}

	filteredSurveys = surveysData.filter((survey) => {
		const theme = survey.theme?.toLowerCase() || '';
		const question = survey.question?.toLowerCase() || '';

		return theme.includes(searchTerm) || question.includes(searchTerm);
	});

	displaySurveys();
	updateSurveyCounts();
	if (userInitiated) {
		queueActiveSurveyColumnScroll({ force: false, mobileOnly: false });
	}
}

function updateSurveyCounts() {
	let openCountFiltered = 0;
	let closedCountFiltered = 0;
	let openCountAll = 0;
	let closedCountAll = 0;

	if (Array.isArray(filteredSurveys)) {
		filteredSurveys.forEach((survey) => {
			if (survey.isClosed) {
				closedCountFiltered++;
			} else {
				openCountFiltered++;
			}
		});
	}

	if (Array.isArray(surveysData)) {
		surveysData.forEach((survey) => {
			if (survey.isClosed) {
				closedCountAll++;
			} else {
				openCountAll++;
			}
		});
	}

	const openCountElement = document.getElementById('open-count');
	const closedCountElement = document.getElementById('closed-count');
	if (openCountElement) openCountElement.textContent = openCountAll;
	if (closedCountElement) closedCountElement.textContent = closedCountAll;

	document.getElementById('open-badge').textContent = openCountFiltered;
	document.getElementById('closed-badge').textContent = closedCountFiltered;

	const mobileOpenBadgeEl = document.getElementById('mobile-open-badge');
	if (mobileOpenBadgeEl) mobileOpenBadgeEl.textContent = openCountFiltered;

	const mobileClosedBadgeEl = document.getElementById('mobile-closed-badge');
	if (mobileClosedBadgeEl) mobileClosedBadgeEl.textContent = closedCountFiltered;

	const noOpenSurveys = document.getElementById('no-open-surveys');
	const noClosedSurveys = document.getElementById('no-closed-surveys');

	if (noOpenSurveys) {
		if (openCountFiltered > 0) {
			noOpenSurveys.classList.add('hidden');
		} else {
			noOpenSurveys.classList.remove('hidden');
		}
	}

	if (noClosedSurveys) {
		if (closedCountFiltered > 0) {
			noClosedSurveys.classList.add('hidden');
		} else {
			noClosedSurveys.classList.remove('hidden');
		}
	}
}

function initializeEventListeners() {
	// Bouton retour
	const backBtn = document.getElementById('back-btn');
	if (backBtn) {
		backBtn.addEventListener('click', () => {
			window.history.back();
		});
	}

	// Bouton nouveau sondage
	const newSurveyBtn = document.getElementById('new-survey-btn');
	if (newSurveyBtn) {
		newSurveyBtn.addEventListener('click', showCreateModal);
	}

	// Bouton actualiser
	const refreshBtn = document.getElementById('refresh-btn');
	if (refreshBtn) {
		refreshBtn.addEventListener('click', () => {
			setButtonLoading(refreshBtn, true);
			loadUserSurveys().finally(() => {
				setButtonLoading(refreshBtn, false);
			});
		});
	}

	// Bouton création (état vide)
	const createOpenBtn = document.getElementById('create-open-btn');
	if (createOpenBtn) {
		createOpenBtn.addEventListener('click', showCreateModal);
	}
	// Fermeture du modal de confirmation
	document.querySelectorAll('#confirm-modal .close-modal').forEach((btn) => {
		btn.addEventListener('click', hideConfirmModal);
	});

	// Modal de confirmation de clôture
	const confirmCancel = document.getElementById('confirm-cancel');
	if (confirmCancel) {
		confirmCancel.addEventListener('click', hideConfirmModal);
	}

	const confirmOk = document.getElementById('confirm-ok');
	if (confirmOk) {
		confirmOk.addEventListener('click', confirmTermination);
	}
	// Fermer la modale de confirmation en cliquant à l'extérieur
	document.querySelectorAll('#confirm-modal').forEach((modal) => {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				hideConfirmModal();
			}
		});
	});

	// Initialiser le contrôle mobile pour basculer entre ouverts/clôturés
	initializeMobileToggle();

	// Initialiser la barre de recherche
	initializeSearch(); // <-- AJOUT0 ICI
}

// =============================================================
// Initialisation de l'application
// =============================================================
async function initializeApp() {
	const token = localStorage.getItem('token');

	if (!token) {
		// Utilisateur non connecté : redirection simple
		redirectToBrowseSurveys(
			'Vous devez être connecté pour accéder à cette page',
			'warning',
		);
		return;
	}

	try {
		showLoading(true);
		await fetchUserData(token);
		await loadUserSurveys();
		initializeSurveyFeedRealtime();
		showLoading(false);

		// Afficher la barre de recherche une fois connecté
		const searchContainer = document.getElementById('search-container');
		if (searchContainer) {
			searchContainer.classList.remove('hidden');
		}
	} catch (error) {
		console.error("Erreur lors de l'initialisation:", error);
		disconnectSurveyFeedSocket();

		if (error.message === 'Session expirée') {
			redirectToBrowseSurveys(
				'Session expirée, veuillez vous reconnecter',
				'warning',
			);
		} else {
			showNotification('Erreur de chargement', 'error');
			showLoading(false);
		}
	}
}

// =============================================================
// Récupération des données utilisateur
// =============================================================
async function fetchUserData(token) {
	try {
		const response = await fetch(`${CONFIG.api.endpoints.authMe}`, {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
		});

		if (response.status === 401) {
			localStorage.removeItem('token');
			throw new Error('Session expirée');
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const data = await response.json();
		currentUser = data;

		// Mettre à jour le header avec les infos utilisateur
		updateUserHeader(data);

		return data;
	} catch (error) {
		console.error(
			'Erreur lors de la récupération des données utilisateur:',
			error,
		);
		throw error;
	}
}

// Fonction pour mettre à jour le pseudo à partir du localStorage
function updateUserPseudoFromLocalStorage() {
	const userName = document.getElementById('user-name');
	const userPseudo = localStorage.getItem('userPseudo');

	if (userName && userPseudo) {
		userName.textContent = userPseudo;
		console.log('Pseudo mis à jour depuis localStorage:', userPseudo);
	}
}

function updateUserHeader(userData) {
	const userName = document.getElementById('user-name');

	// Mettre à jour le nom d'utilisateur dans le menu
	// Priorité : userPseudo du localStorage > pseudo API
	if (userName) {
		const userPseudo = localStorage.getItem('userPseudo');

		if (userPseudo) {
			// Utiliser le pseudo du localStorage
			userName.textContent = userPseudo;
			console.log('Pseudo affiché (localStorage):', userPseudo);
		} else if (userData?.pseudo) {
			userName.textContent = userData.pseudo;
			console.log('Pseudo affiché (API):', userData.pseudo);
		} else {
			// Par défaut
			userName.textContent = 'Utilisateur';
		}
	}
}

// =============================================================
// Chargement des sondages utilisateur
// =============================================================
async function loadUserSurveys({ silent = false } = {}) {
	try {
		const token = localStorage.getItem('token');

		// Cette vérification ne devrait normalement pas être nécessaire
		// car initializeApp l'a déjà fait, mais on la garde pour sécurité
		if (!token) {
			throw new Error('Token manquant');
		}

		const response = await fetch(`${CONFIG.api.endpoints.mySurveys}`, {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
		});

		if (response.status === 401) {
			localStorage.removeItem('token');
			throw new Error('Session expirée');
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const surveys = await response.json();
		surveysData = surveys;
		filteredSurveys = [...surveys]; // <-- AJOUT0

		// Afficher les sondages
		displaySurveys();


		// Mettre à jour les statistiques
		updateStats(surveys);

		document.querySelector('.dashboard-container').classList.remove('hidden');
		document.getElementById('login-prompt')?.classList.add('hidden');

		// Mettre à jour les compteurs de recherche
		updateSurveyCounts(); // <-- AJOUT0
	} catch (error) {
		console.error('Erreur lors du chargement des sondages:', error);

		if (
			error.message === 'Session expirée' ||
			error.message === 'Token manquant'
		) {
			// Ne pas rediriger ici - laissez initializeApp gérer
			throw error;
		} else if (!silent) {
			showNotification('Erreur de chargement des sondages', 'error');
		}

		if (silent) {
			return [];
		}
	}
}

// =============================================================
// Affichage des sondages
// =============================================================
function displaySurveys() {
	// <-- MODIFI0 (pas de paramètre)
	const openContainer = document.getElementById('open-surveys');
	const closedContainer = document.getElementById('closed-surveys');

	// Réinitialiser les conteneurs
	if (openContainer) openContainer.innerHTML = '';
	if (closedContainer) closedContainer.innerHTML = '';

	// Utiliser filteredSurveys au lieu de surveysData
	filteredSurveys.forEach((survey) => {
		const surveyCard = createSurveyCard(survey);

		if (survey.isClosed) {
			if (closedContainer) closedContainer.appendChild(surveyCard);
		} else {
			if (openContainer) openContainer.appendChild(surveyCard);
		}
	});
}

function createSurveyCard(survey) {
	const isFlashSurvey = survey.explain === false;
	const card = document.createElement('div');
	card.className = `survey-card ${survey.isClosed ? 'closed' : ''} ${
		isFlashSurvey ? 'survey-card--flash' : ''
	}`.trim();
	card.dataset.id = survey._id;
	card.dataset.type = survey.type;

	// Formater la date
	const createdDate = new Date(survey.createdAt);
	const formattedDate = createdDate.toLocaleDateString(getIntlLocale(), {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});

	// Icône selon le type
	const typeIcon =
		survey.type === 'binary' ? 'fas fa-check-double' : 'fas fa-list-check';
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
	const flashQuery = isFlashSurvey ? '&flash=1' : '';
	const surveyVotes = getSurveyVotesTotal(survey);

	card.innerHTML = `
        <div class="survey-card-header">
            <div class="survey-theme">${survey.theme}</div>
            <div class="survey-status ${survey.isClosed ? 'closed' : 'open'}">
                <i class="fas ${survey.isClosed ? 'fa-lock' : 'fa-unlock'}"></i>
                ${survey.isClosed ? 'Clôturé' : 'En cours'}
            </div>
        </div>
        
        <div class="survey-question">
            ${survey.question}
        </div>
        
        <div class="survey-details">
            <div class="detail-item detail-item--type">
                <i class="${typeIcon}" aria-hidden="true"></i>
                <span class="survey-type-label">${typeLabel}</span>
                ${flashIndicatorMarkup}
            </div>
            <div class="detail-item">
                <i class="fas fa-calendar"></i>
                <span>${formattedDate}</span>
            </div>
            <div class="votes-count" id="votes-${survey._id}">
                ${renderVotesNode(surveyVotes)}
            </div>
        </div>
        
        <div class="survey-actions">
            ${
							survey.isClosed ?
								`
                <button class="results-btn" data-id="${survey._id}" data-type="${survey.type}">
                    <i class="fas fa-chart-bar"></i> Résultats
                </button>
            `
							:	`
                <button class="terminate-btn" data-id="${survey._id}" data-type="${survey.type}">
                    <i class="fas fa-lock"></i> Clôturer
                </button>
                <button class="results-btn" data-id="${survey._id}" data-type="${survey.type}">
                    <i class="fas fa-chart-line"></i> Résultats live
                </button>
                <button class="details-btn" data-id="${survey._id}" data-type="${survey.type}">
                    <i class="fas fa-eye"></i> Voir
                </button>
            `
						}
        </div>
    `;

	// Ajouter les événements
	const terminateBtn = card.querySelector('.terminate-btn');
	const resultsBtn = card.querySelector('.results-btn');
	const detailsBtn = card.querySelector('.details-btn');

	if (terminateBtn) {
		terminateBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			showConfirmTermination(survey._id, survey.type, survey.theme);
		});
	}

	if (resultsBtn) {
		resultsBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			window.location.href = `survey-results-admin.html?Id=${survey._id}&type=${survey.type}${flashQuery}`;
		});
	}

	if (detailsBtn) {
		detailsBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (survey.isClosed) {
				window.location.href = `survey-results-admin.html?Id=${survey._id}&type=${survey.type}${flashQuery}`;
			} else {
				if (isFlashSurvey && survey.type === 'binary') {
					window.location.href = `survey-flash-binary.html?id=${survey._id}`;
				} else if (isFlashSurvey && survey.type === 'multiple') {
					window.location.href = `survey-flash-multiple.html?id=${survey._id}`;
				} else if (survey.type === 'binary') {
					window.location.href = `survey.html?id=${survey._id}`;
				} else {
					window.location.href = `survey-choices.html?id=${survey._id}`;
				}
			}
		});
	}

	// 0vénement sur toute la carte
	card.addEventListener('click', (e) => {
		if (!e.target.closest('button')) {
			if (survey.isClosed) {
				window.location.href = `survey-results-admin.html?Id=${survey._id}&type=${survey.type}${flashQuery}`;
			} else {
				if (isFlashSurvey && survey.type === 'binary') {
					window.location.href = `survey-flash-binary.html?id=${survey._id}`;
				} else if (isFlashSurvey && survey.type === 'multiple') {
					window.location.href = `survey-flash-multiple.html?id=${survey._id}`;
				} else if (survey.type === 'binary') {
					window.location.href = `survey.html?id=${survey._id}`;
				} else {
					window.location.href = `survey-choices.html?id=${survey._id}`;
				}
			}
		}
	});

	return card;
}

// =============================================================
// Récupération des statistiques de votes
// =============================================================
function updateStats(surveys) {
	// Calculer le total des votes
	let totalVotes = 0;
	surveys.forEach((survey) => {
		totalVotes += getSurveyVotesTotal(survey);
	});

	const totalVotesEl = document.getElementById('total-votes');
	if (totalVotesEl) {
		totalVotesEl.textContent = totalVotes;
	}
}

// =============================================================
// Gestion de la clôture des sondages
// =============================================================
function showConfirmTermination(surveyId, surveyType, surveyTheme) {
	pendingTermination = { surveyId, surveyType };

	document.getElementById('confirm-message').textContent =
		`Etes-vous sûr de vouloir clôturer le sondage "${surveyTheme}" ? Cette action est irréversible.`;

	const modal = document.getElementById('confirm-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open(modal);
	} else {
		modal.classList.remove('hidden');
	}
}

function hideConfirmModal() {
	const modal = document.getElementById('confirm-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close(modal);
	} else {
		modal.classList.add('hidden');
	}
	pendingTermination = null;
}

async function confirmTermination() {
	if (!pendingTermination) return;

	const { surveyId, surveyType } = pendingTermination;

	try {
		const token = localStorage.getItem('token');
		const endpoint =
			surveyType === 'binary' ?
				`${CONFIG.api.endpoints.closeSurvey.binary}/${surveyId}/close`
			:	`${CONFIG.api.endpoints.closeSurvey.multiple}/${surveyId}/close`;

		const response = await fetch(`${endpoint}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const result = await response.json();
		const endedAt = result?.endedAt || new Date().toISOString();

		showNotification('Sondage clôturé avec succès', 'success');
		hideConfirmModal();

		applySurveyFeedLocalPatch({
			action: 'closed',
			surveyId,
			type: surveyType,
			isClosed: true,
			endedAt,
			occurredAt: endedAt,
		});
		scheduleSilentMySurveysRefresh();
	} catch (error) {
		console.error('Erreur lors de la clôture du sondage:', error);
		showNotification(error.message || 'Erreur lors de la clôture', 'error');
		hideConfirmModal();
	}
}

// =============================================================
// Gestion de la création de sondage
// =============================================================
function showCreateModal() {
	if (window.SiteCreateSurveyModal?.open) {
		window.SiteCreateSurveyModal.init?.();
		window.SiteCreateSurveyModal.open();
		return;
	}
	window.location.href = 'create-survey.html';
}

function createNewSurvey(type) {
	if (type === 'binary') {
		window.location.href = 'create-survey.html';
	} else {
		window.location.href = 'create-survey-choices.html';
	}
}

// =============================================================
// Contrôle mobile: bascule entre sondages ouverts / clôturés
// =============================================================
function initializeMobileToggle() {
	const toggleOpen = document.getElementById('view-open');
	const toggleClosed = document.getElementById('view-closed');
	const openColumn = document.getElementById('open-column');
	const closedColumn = document.getElementById('closed-column');
	const openLabel = document.querySelector('label[for="view-open"]');
	const closedLabel = document.querySelector('label[for="view-closed"]');

	if (!toggleOpen || !toggleClosed || !openColumn || !closedColumn) return;

	const closeTransientOverlays = () => {
		document.querySelectorAll('.user-menu-details[open]').forEach((details) => {
			details.open = false;
		});
	};

	const updateAriaState = () => {
		openLabel?.setAttribute('aria-selected', toggleOpen.checked ? 'true' : 'false');
		closedLabel?.setAttribute(
			'aria-selected',
			toggleClosed.checked ? 'true' : 'false',
		);
	};

	const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;
	const prefersReducedMotion = () =>
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const getHeaderOffset = () => {
		const header = document.querySelector('header');
		if (!header) return 8;
		return Math.max(8, Math.ceil(header.getBoundingClientRect().height) + 8);
	};

	const isElementMostlyVisible = (element) => {
		if (!element) return true;
		const rect = element.getBoundingClientRect();
		const viewportHeight =
			window.innerHeight || document.documentElement.clientHeight || 0;
		if (!viewportHeight || rect.height <= 0) return true;
		const visibleTop = Math.max(rect.top, 0);
		const visibleBottom = Math.min(rect.bottom, viewportHeight);
		const visibleHeight = Math.max(0, visibleBottom - visibleTop);
		return visibleHeight >= Math.min(rect.height, viewportHeight) * 0.55;
	};

	const scrollToActiveColumnIfNeeded = ({
		force = false,
		mobileOnly = true,
	} = {}) => {
		if (mobileOnly && !isMobileViewport()) return;
		const targetColumn = toggleClosed.checked ? closedColumn : openColumn;
		if (!targetColumn) return;
		if (!force && isElementMostlyVisible(targetColumn)) return;

		const top =
			window.scrollY + targetColumn.getBoundingClientRect().top - getHeaderOffset();
		window.scrollTo({
			top: Math.max(0, Math.round(top)),
			behavior: prefersReducedMotion() ? 'auto' : 'smooth',
		});
	};

	requestActiveSurveyColumnScroll = ({ force = true, mobileOnly = true } = {}) => {
		window.requestAnimationFrame(() => {
			scrollToActiveColumnIfNeeded({ force, mobileOnly });
		});
	};

	const applyMobileToggle = () => {
		const isMobile = isMobileViewport();
		const pageBody = document.body;
		pageBody.classList.remove('is-open-view', 'is-closed-view');

		if (!isMobile) {
			openColumn.removeAttribute('aria-hidden');
			closedColumn.removeAttribute('aria-hidden');
			return;
		}

		if (toggleClosed.checked) {
			pageBody.classList.add('is-closed-view');
			openColumn.setAttribute('aria-hidden', 'true');
			closedColumn.setAttribute('aria-hidden', 'false');
			return;
		}

		pageBody.classList.add('is-open-view');
		openColumn.setAttribute('aria-hidden', 'false');
		closedColumn.setAttribute('aria-hidden', 'true');
	};

	const setSurveysView = (view, { userInitiated = false } = {}) => {
		const normalizedView = view === 'closed' ? 'closed' : 'open';
		toggleClosed.checked = normalizedView === 'closed';
		toggleOpen.checked = !toggleClosed.checked;
		closeTransientOverlays();
		applyMobileToggle();
		updateAriaState();
		if (userInitiated) {
			requestActiveSurveyColumnScroll({ force: true, mobileOnly: true });
		}
	};

	const attachLabelKeyboardHandling = (labelEl) => {
		if (!labelEl) return;
		labelEl.addEventListener('keydown', (event) => {
			if (event.key !== ' ' && event.key !== 'Enter') return;
			event.preventDefault();
			const targetId = labelEl.getAttribute('for');
			const targetInput = document.getElementById(targetId);
			if (!targetInput) return;
			targetInput.checked = true;
			targetInput.dispatchEvent(new Event('change'));
			labelEl.focus();
		});
	};

	attachLabelKeyboardHandling(openLabel);
	attachLabelKeyboardHandling(closedLabel);

	toggleOpen.addEventListener('change', () => {
		setSurveysView('open', { userInitiated: true });
		announceToScreenReader('Affichage des sondages ouverts');
	});

	toggleClosed.addEventListener('change', () => {
		setSurveysView('closed', { userInitiated: true });
		announceToScreenReader('Affichage des sondages clotures');
	});

	window.addEventListener('resize', applyMobileToggle);
	window.addEventListener('orientationchange', () => {
		window.setTimeout(applyMobileToggle, 120);
	});

	setSurveysView(toggleClosed.checked ? 'closed' : 'open', {
		userInitiated: false,
	});
}
// =============================================================
// Gestion de l'interface
// =============================================================
function showLoading(show) {
	const loading = document.getElementById('loading');
	const dashboard = document.querySelector('.dashboard-container');
	const loginPrompt = document.getElementById('login-prompt');

	if (show) {
		if (loading) loading.classList.remove('hidden');
		if (dashboard) dashboard.classList.add('hidden');
		if (loginPrompt) loginPrompt.classList.add('hidden');
	} else {
		if (loading) loading.classList.add('hidden');
	}
}

// =============================================================
// Notifications
// =============================================================
function showNotification(message, type = 'info') {
	// Supprimer les notifications existantes
	const existing = document.querySelector('.notification');
	if (existing) existing.remove();

	const notification = document.createElement('div');
	notification.className = `notification ${type}`;
	const icon =
		type === 'error' ? 'exclamation-circle'
		: type === 'warning' ? 'exclamation-triangle'
		: type === 'success' ? 'check-circle'
		: 'info-circle';
	notification.innerHTML = `<i class="fas fa-${icon}"></i><span>${message}</span>`;

	// Style de notification
	notification.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		padding: 1rem 1.5rem;
		border-radius: 0.75rem;
		background: ${
			type === 'error' ? CONFIG.colors.danger
			: type === 'warning' ? CONFIG.colors.warning
			: type === 'success' ? CONFIG.colors.success
			: CONFIG.colors.primary
		};
		color: white;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		box-shadow: 0 5px 15px rgba(0,0,0,0.3);
		z-index: 1000;
		animation: notificationSlideIn 0.3s ease;
	`;

	document.body.appendChild(notification);

	// Supprimer après 5 secondes
	setTimeout(() => {
		notification.style.animation = 'notificationSlideOut 0.3s ease';
		setTimeout(() => notification.remove(), 300);
	}, 5000);
}

// Ajouter les styles de notification une seule fois
if (!document.querySelector('#notification-styles')) {
	const style = document.createElement('style');
	style.id = 'notification-styles';
	style.textContent = `
		@keyframes notificationSlideIn {
			from { transform: translateX(100%); opacity: 0; }
			to { transform: translateX(0); opacity: 1; }
		}
		
		@keyframes notificationSlideOut {
			from { transform: translateX(0); opacity: 1; }
			to { transform: translateX(100%); opacity: 0; }
		}
		
		.hidden {
			display: none !important;
		}
	`;
	document.head.appendChild(style);
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
}




