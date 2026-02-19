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
	chartOptions: {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				position: 'bottom',
				labels: {
					padding: 20,
					color: '#f1f5f9',
					font: {
						size: 14,
					},
				},
			},
			datalabels: {
				color: '#fff',
				font: {
					weight: 'bold',
					size: 14,
				},
				formatter: (value, ctx) => {
					const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
					const percentage = Math.round((value / total) * 100);
					return percentage > 5 ? `${percentage}%` : '';
				},
			},
			tooltip: {
				backgroundColor: 'rgba(30, 41, 59, 0.9)',
				titleColor: '#f1f5f9',
				bodyColor: '#94a3b8',
				borderColor: '#475569',
				borderWidth: 1,
				cornerRadius: 8,
				callbacks: {
					label: (context) => {
						const label = context.label || '';
						const value = context.raw || 0;
						const total = context.dataset.data.reduce((a, b) => a + b, 0);
						const percentage = Math.round((value / total) * 100);
						return `${label}: ${value} votes (${percentage}%)`;
					},
				},
			},
		},
	},
};

// =============================================================
// Variables globales
// =============================================================
let chart = null;
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
const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';
const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;

// =============================================================
// Lecture paramètres URL
// =============================================================
const params = new URLSearchParams(window.location.search);
const id = params.get('Id');
const type = params.get('type'); // binary | multiple
const requestedFlashMode =
	params.get('flash') === '1' || params.get('flash') === 'true';
let isFlashMode = requestedFlashMode;

if (!id || !type) {
	showNotification('Paramètres du sondage invalides.', 'error');
	setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
}

// =============================================================
// Vérification token
// =============================================================
const token = localStorage.getItem('token');

if (!token) {
	showNotification('Vous devez être connecté.', 'error');
	setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
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
const socket = io();

socket.on('updateOpinionLikes', ({ opinionId, likeCount, dislikeCount }) => {
	updateOpinionLikes(opinionId, likeCount, dislikeCount);
});

socket.on('flash:counts', (payload) => {
	if (!isFlashMode || !isFlashPayloadForCurrentSurvey(payload)) return;
	applyFlashCounts(payload);
});

socket.on('flash:new-opinion', (payload) => {
	if (!isFlashMode || !payload) return;
	if (String(payload.surveyId || '') !== String(id)) return;
	upsertFlashOpinion(payload);
});

socket.on('flash:reaction', (payload) => {
	if (!isFlashMode || !payload?.opinionId) return;
	updateOpinionLikes(
		payload.opinionId,
		payload.likeCount || 0,
		payload.dislikeCount || 0,
	);
});

socket.on('flash:closed', (payload) => {
	if (!isFlashMode || !isFlashPayloadForCurrentSurvey(payload)) return;
	if (currentSurvey) {
		currentSurvey.isClosed = true;
		renderSurveyHeader(currentSurvey);
	}
	showNotification('Sondage Flash clôturé. Les votes sont figés.', 'info');
});

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	if (!USE_SHARED_USER_MENU()) {
		checkUserLoginState(); // Legacy fallback
	}
	initializeEventListeners();
	getSurveyDetails();
	initializeFooter();
});

// =============================================================
// Gestionnaires d'événements
// =============================================================
function initializeEventListeners() {
	// Bouton retour
	document.getElementById('back-btn')?.addEventListener('click', () => {
		window.history.back();
	});

	// Bouton export
	document
		.getElementById('export-btn')
		?.addEventListener('click', showExportModal);

	// Fermer modal export en cliquant à l'extérieur
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

	if (!USE_SHARED_USER_MENU()) {
		document.getElementById('login-btn')?.addEventListener('click', () => {
			window.location.href = '/api/auth/google';
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
		// Utilisateur connecté : Afficher le menu utilisateur, masquer le bouton de connexion
		userMenu.classList.remove('hidden');
		loginBtn.classList.add('hidden');

		// Mettre à jour le nom d'utilisateur
		const displayName = userPseudo || (user && user.pseudo) || 'Utilisateur';
		document.getElementById('user-name').textContent = displayName;

		// Initialiser les écouteurs du menu utilisateur
		initializeUserMenuListeners();
	} else {
		// Utilisateur non connecté : Masquer le menu utilisateur, afficher le bouton de connexion
		userMenu.classList.add('hidden');
		loginBtn.classList.remove('hidden');
	}
}

// =============================================================
// Récupération des données
// =============================================================
async function getSurveyDetails() {
	try {
		showLoading(true);

		const surveyRes = await fetch(`${STANDARD_BASE_URL}/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
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
		if (!resultsRes.ok) {
			const errorPayload = await resultsRes.json().catch(() => ({}));
			throw new Error(
				errorPayload.message || 'Erreur lors de la récupération des résultats',
			);
		}
		const results = await resultsRes.json();

		// If survey is not closed, show a warning and redirect (no results available yet)
		if (!survey.isClosed && !isFlashMode) {
			showNotification("Ce sondage n'est pas encore clôturé.", 'warning');
			setTimeout(() => (window.location.href = 'browse-surveys.html'), 3000);
			return;
		}

		// Render header & results according to type
		renderSurveyHeader(survey);
		const dashboard = document.querySelector('.dashboard-container');
		dashboard?.classList.remove('hidden');
		document.getElementById('results-toolbar')?.classList.remove('hidden');

		if (type === 'binary') {
			handleBinaryResults(results, survey);
		} else {
			handleMultipleResults(results, survey);
		}
		if (isFlashMode) {
			joinFlashRoom();
		}

		showLoading(false);
		refreshChartLayout();
	} catch (err) {
		console.error('Erreur:', err);
		showNotification(err.message || 'Erreur lors du chargement', 'error');
		showLoading(false);
	}
}

// =============================================================
// Affichage en-tête du sondage
// =============================================================
function refreshChartLayout() {
	if (!chart) return;
	try {
		chart.resize();
		chart.update('none');
	} catch (_error) {
		// noop
	}
}

function showChartFallback(message) {
	const container = document.querySelector('.chart-container');
	if (!container) return;
	container.innerHTML = `
		<div class="chart-fallback" role="status">
			<i class="fas fa-chart-simple"></i>
			<span>${message || 'Graphique indisponible pour le moment.'}</span>
		</div>
	`;
}

function renderChartWhenVisible(renderFn, { maxAttempts = 10, attempt = 0 } = {}) {
	const canvas = document.getElementById('resultsChart');
	const chartCard = canvas?.closest('.chart-card');

	if (!canvas || !chartCard) {
		showChartFallback('Zone de graphique introuvable.');
		return;
	}

	const isReady =
		chartCard.offsetParent !== null &&
		canvas.clientWidth > 0 &&
		canvas.clientHeight > 0;

	if (isReady) {
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			showChartFallback('Impossible d’afficher le graphique.');
			return;
		}
		renderFn(ctx);
		refreshChartLayout();
		return;
	}

	if (attempt >= maxAttempts) {
		showChartFallback('Graphique temporairement indisponible.');
		return;
	}

	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			renderChartWhenVisible(renderFn, {
				maxAttempts,
				attempt: attempt + 1,
			});
		});
	});
}

function hasOpinionComment(opinion) {
	return String(opinion?.reason || '').trim().length > 0;
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
	return !isFlashMode || hasOpinionComment(opinion);
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

async function refreshFlashDetailedResults() {
	if (!isFlashMode || isRefreshingFlashDetails) return;
	isRefreshingFlashDetails = true;

	try {
		const response = await fetch(getDetailedResultsEndpoint(), {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) return;

		const data = await response.json();
		lastFlashTotalOpinions = Number(data?.totalOpinions || 0);

		if (type === 'binary') {
			handleBinaryResults(data, currentSurvey);
		} else {
			handleMultipleResults(data, currentSurvey);
		}
	} catch (error) {
		console.warn('Refresh flash detailed results failed:', error);
	} finally {
		isRefreshingFlashDetails = false;
	}
}

function scheduleFlashDetailedRefresh(delay = 260) {
	if (!isFlashMode) return;
	if (flashDetailsRefreshTimer) {
		clearTimeout(flashDetailsRefreshTimer);
	}

	flashDetailsRefreshTimer = window.setTimeout(() => {
		flashDetailsRefreshTimer = null;
		void refreshFlashDetailedResults();
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
        <span>ID: ${survey._id}</span> • 
        <span>Type: ${typeLabel}</span>
    `;

	if (survey.createdAt) {
		const date = new Date(survey.createdAt).toLocaleDateString('fr-FR', {
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
	if (chart) {
		chart.destroy();
		chart = null;
	}

	const renderFn = (ctx) => {
		if (isFlashMode) {
			chart = new Chart(ctx, {
				type: 'doughnut',
				data: {
					labels: ['Oui', 'Non'],
					datasets: [
						{
							data: [yes, no],
							backgroundColor: ['rgba(16, 185, 129, 0.45)', 'rgba(239, 68, 68, 0.45)'],
							borderColor: ['rgb(16, 185, 129)', 'rgb(239, 68, 68)'],
							borderWidth: 2,
							hoverOffset: 10,
						},
					],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					cutout: '50%',
					animation: {
						animateRotate: true,
						animateScale: false,
					},
					plugins: {
						...config.chartOptions.plugins,
						tooltip: {
							...config.chartOptions.plugins.tooltip,
							callbacks: {
								label: (context) => {
									const index = Number(context.dataIndex || 0);
									const label = context.chart?.data?.labels?.[index] || `Option ${index + 1}`;
									const value = Number(context.raw ?? 0);
									const total = [yes, no].reduce((sum, count) => sum + Number(count || 0), 0);
									const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
									return `${label}: ${value} vote${value > 1 ? 's' : ''} (${percentage}%)`;
								},
							},
						},
						title: {
							display: true,
							text: 'Votes en temps reel',
							color: '#f1f5f9',
							font: {
								size: 16,
								weight: 'bold',
							},
							padding: { bottom: 20 },
						},
					},
				},
			});
			return;
		}

		chart = new Chart(ctx, {
			type: 'pie',
			data: {
				labels: ['Oui', 'Non'],
				datasets: [
					{
						data: [yes, no],
						backgroundColor: [config.chartColors[1], config.chartColors[3]],
						borderColor: '#1e293b',
						borderWidth: 2,
						hoverOffset: 15,
					},
				],
			},
			options: {
				...config.chartOptions,
				animation: {
					duration: 800,
					animateRotate: true,
					animateScale: true,
				},
				plugins: {
					...config.chartOptions.plugins,
					title: {
						display: true,
						text: 'Repartition des votes',
						color: '#f1f5f9',
						font: {
							size: 16,
							weight: 'bold',
						},
						padding: { bottom: 20 },
					},
				},
			},
		});
	};

	renderChartWhenVisible(renderFn);

	renderChartLegend(
		['Oui', 'Non'],
		[config.chartColors[1], config.chartColors[3]],
		[yesPercentage, noPercentage],
	);
}

function renderBinaryStats(yes, no, total, yesPercentage, noPercentage) {
	document.getElementById('detailed-stats').innerHTML = `
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-value">${total}</div>
                <div class="stat-label">Total votes</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${yes} <small style="color: #10b981">(${yesPercentage}%)</small></div>
                <div class="stat-label">Votes "Oui"</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${no} <small style="color: #ef4444">(${noPercentage}%)</small></div>
                <div class="stat-label">Votes "Non"</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${
									total > 0 ? Math.round((Math.max(yes, no) / total) * 100) : 0
								}%</div>
                <div class="stat-label">Majorité</div>
            </div>
        </div>
        <div class="detailed-table">
            <h4 style="margin-bottom: 1rem;">Détails des pourcentages</h4>
            <table>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Votes</th>
                        <th>Pourcentage</th>
                        <th>Barre de progression</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Oui</td>
                        <td>${yes}</td>
                        <td><strong style="color: #10b981;">${yesPercentage}%</strong></td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <div style="flex: 1; height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                                    <div style="width: ${yesPercentage}%; height: 100%; background: #10b981;"></div>
                                </div>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td>Non</td>
                        <td>${no}</td>
                        <td><strong style="color: #ef4444;">${noPercentage}%</strong></td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <div style="flex: 1; height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                                    <div style="width: ${noPercentage}%; height: 100%; background: #ef4444;"></div>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function renderBinaryOpinions(opinions, total) {
	const list = document.getElementById('opinions-list');
	const noResults = document.getElementById('no-results');
	const orderedOpinions = prioritizeOwnOpinions(opinions);

	if (!orderedOpinions || orderedOpinions.length === 0) {
		list.innerHTML = '';
		noResults.classList.remove('hidden');
		return;
	}

	noResults.classList.add('hidden');

	list.innerHTML = orderedOpinions
		.map(
			(opinion) => `
        <div class="opinion-card ${opinion.isOwnOpinion ? 'is-own-opinion' : ''}" id="opinion-${opinion._id}">
            <div class="opinion-header">
                <div class="opinion-user">
                    <div class="user-avatar">
                        ${
													opinion.userPseudo ?
														opinion.userPseudo.charAt(0).toUpperCase()
													:	'?'
												}
                    </div>
                    <div class="user-info">
                        <span class="user-pseudo">${
													opinion.userPseudo || 'Anonyme'
												}</span>
						${buildPinnedBadge(opinion)}
                        <span class="opinion-date">${formatDate(
													opinion.createdAt,
												)}</span>
                    </div>
                </div>
                <div class="opinion-answer ${
									opinion.answer ? 'answer-yes' : 'answer-no'
								}">
                    ${opinion.answer ? 'Oui' : 'Non'}
                </div>
            </div>
            
            <div class="opinion-content">
                ${formatQuotedComment(opinion.reason)}
            </div>
            
            <div class="opinion-footer">
                <div class="opinion-likes">
                    <div class="like-count">
                        <i class="fas fa-thumbs-up"></i>
                        <span class="readonly-like">${
													opinion.likeCount || 0
												}</span>
                    </div>
                    <div class="dislike-count">
                        <i class="fas fa-thumbs-down"></i>
                        <span class="readonly-dislike">${
													opinion.dislikeCount || 0
												}</span>
                    </div>
                </div>
            </div>
        </div>
    `,
		)
		.join('');

	filteredOpinions = [...orderedOpinions];
}

function updateBinaryFilters() {
	const filterSelect = document.getElementById('filter-answer');
	if (!filterSelect) return;
	const currentValue = String(filterSelect.value || 'all');
	filterSelect.innerHTML = `
        <option value="all">Toutes les reponses</option>
        <option value="yes">Oui seulement</option>
        <option value="no">Non seulement</option>
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
	if (chart) {
		chart.destroy();
		chart = null;
	}

	const backgroundColors = labels.map(
		(_, index) => config.chartColors[index % config.chartColors.length],
	);

	const renderFn = (ctx) => {
		if (isFlashMode) {
			chart = new Chart(ctx, {
				type: 'doughnut',
				data: {
					labels,
					datasets: [
						{
							data: counts,
							backgroundColor: backgroundColors,
							borderColor: backgroundColors,
							borderWidth: 2,
							hoverOffset: 10,
						},
					],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					cutout: '50%',
					animation: {
						animateRotate: true,
						animateScale: false,
					},
					plugins: {
						...config.chartOptions.plugins,
						tooltip: {
							...config.chartOptions.plugins.tooltip,
							callbacks: {
								label: (context) => {
									const index = Number(context.dataIndex || 0);
									const optionLabel = labels[index] || `Option ${index + 1}`;
									const value = Number(context.raw ?? 0);
									const total = counts.reduce((sum, count) => sum + Number(count || 0), 0);
									const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
									return `${optionLabel}: ${value} vote${value > 1 ? 's' : ''} (${percentage}%)`;
								},
							},
						},
						title: {
							display: true,
							text: 'Votes en temps reel',
							color: '#f1f5f9',
							font: {
								size: 16,
								weight: 'bold',
							},
							padding: { bottom: 20 },
						},
					},
				},
			});
			return;
		}

		chart = new Chart(ctx, {
			type: 'pie',
			data: {
				labels: labels,
				datasets: [
					{
						data: counts,
						backgroundColor: backgroundColors,
						borderColor: '#1e293b',
						borderWidth: 2,
						hoverOffset: 15,
					},
				],
			},
			options: {
				...config.chartOptions,
				animation: {
					duration: 800,
					animateRotate: true,
					animateScale: true,
				},
				plugins: {
					...config.chartOptions.plugins,
					title: {
						display: true,
						text: 'Distribution des choix',
						color: '#f1f5f9',
						font: {
							size: 16,
							weight: 'bold',
						},
						padding: { bottom: 20 },
					},
				},
			},
		});
	};

	renderChartWhenVisible(renderFn);

	renderChartLegend(labels, backgroundColors, percentages);
}

function renderMultipleStats(data, total, percentages) {
	const optionKeys =
		Array.isArray(data.optionKeys) && data.optionKeys.length ?
			data.optionKeys
		:	sortOptionKeys(Object.keys(data.labels || {}));
	const labels = optionKeys.map(
		(key, index) => data.labels?.[key] || `Option ${index + 1}`,
	);
	const counts = optionKeys.map((key) => Number(data.counts?.[key] || 0));

	let statsHTML = '<div class="stats-grid">';

	// Statistique totale
	statsHTML += `
        <div class="stat-box">
            <div class="stat-value">${total}</div>
            <div class="stat-label">Total votes</div>
        </div>
    `;

	// Trouver l'option la plus populaire
	if (counts.length > 0) {
		const maxCount = Math.max(...counts);
		const maxIndex = counts.indexOf(maxCount);
		const mostPopular = labels[maxIndex];
		const percentage = percentages[maxIndex];

		statsHTML += `
            <div class="stat-box">
                <div class="stat-value">${mostPopular}</div>
                <div class="stat-label">Plus populaire (${percentage}%)</div>
            </div>
        `;
	}

	// Nombre d'options
	statsHTML += `
        <div class="stat-box">
            <div class="stat-value">${labels.length}</div>
            <div class="stat-label">Options</div>
        </div>
    `;

	// Option la moins populaire
	const positiveCounts = counts.filter((c) => c > 0);
	if (counts.length > 1 && positiveCounts.length > 0) {
		const minCount = Math.min(...positiveCounts);
		const minIndex = counts.indexOf(minCount);
		const leastPopular = labels[minIndex];
		const leastPercentage = percentages[minIndex];

		statsHTML += `
            <div class="stat-box">
                <div class="stat-value">${leastPopular}</div>
                <div class="stat-label">Moins populaire (${leastPercentage}%)</div>
            </div>
        `;
	}

	statsHTML += '</div>';

	// Ajouter un tableau détaillé avec pourcentages
	statsHTML += `
        <div class="detailed-table">
            <h4 style="margin-bottom: 1rem;">Détails par option avec pourcentages</h4>
            <table>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Votes</th>
                        <th>Pourcentage</th>
                        <th>Barre de progression</th>
                    </tr>
                </thead>
                <tbody>
                    ${labels
											.map((label, index) => {
												const count = counts[index] || 0;
												const percentage = percentages[index];
												const color =
													config.chartColors[index % config.chartColors.length];
												return `
                                <tr>
                                    <td>${label}</td>
                                    <td>${count}</td>
                                    <td><strong style="color: ${color};">${percentage}%</strong></td>
                                    <td>
                                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                                            <div style="flex: 1; height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                                                <div style="width: ${percentage}%; height: 100%; background: ${color};"></div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `;
											})
											.join('')}
                </tbody>
            </table>
        </div>
    `;

	document.getElementById('detailed-stats').innerHTML = statsHTML;
}

function renderMultipleOpinions(opinions, total) {
	const list = document.getElementById('opinions-list');
	const noResults = document.getElementById('no-results');
	const orderedOpinions = prioritizeOwnOpinions(opinions);

	if (!orderedOpinions || orderedOpinions.length === 0) {
		list.innerHTML = '';
		noResults.classList.remove('hidden');
		return;
	}

	noResults.classList.add('hidden');

	list.innerHTML = orderedOpinions
		.map((opinion) => {
			const answerLabel =
				surveyLabels[opinion.answer] || `Option ${opinion.answer}`;
			const answerKeys = surveyOptionKeys.length ? surveyOptionKeys : Object.keys(surveyLabels);
			const answerIndex = answerKeys.indexOf(opinion.answer);
			const answerColor =
				config.chartColors[answerIndex % config.chartColors.length] ||
				config.chartColors[0];

			return `
            <div class="opinion-card ${opinion.isOwnOpinion ? 'is-own-opinion' : ''}" id="opinion-${opinion._id}">
                <div class="opinion-header">
                    <div class="opinion-user">
                        <div class="user-avatar">
                            ${
															opinion.userPseudo ?
																opinion.userPseudo.charAt(0).toUpperCase()
															:	'?'
														}
                        </div>
                        <div class="user-info">
                            <span class="user-pseudo">${
															opinion.userPseudo || 'Anonyme'
														}</span>
							${buildPinnedBadge(opinion)}
                            <span class="opinion-date">${formatDate(
															opinion.createdAt,
														)}</span>
                        </div>
                    </div>
                    <div class="opinion-answer" style="background: ${answerColor}20; color: ${answerColor};">
                        ${answerLabel}
                    </div>
                </div>
                
                <div class="opinion-content">
                    ${formatQuotedComment(opinion.reason)}
                </div>
                
                <div class="opinion-footer">
                    <div class="opinion-likes">
                        <div class="like-count">
                            <i class="fas fa-thumbs-up"></i>
                            <span class="readonly-like">${
															opinion.likeCount || 0
														}</span>
                        </div>
                        <div class="dislike-count">
                            <i class="fas fa-thumbs-down"></i>
                            <span class="readonly-dislike">${
															opinion.dislikeCount || 0
														}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
		})
		.join('');

	filteredOpinions = [...orderedOpinions];
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

function joinFlashRoom() {
	if (!isFlashMode || !id || !type) return;

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

window.addEventListener('beforeunload', leaveFlashRoom);

function upsertFlashOpinion(payload) {
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

	if (isOpinionEligibleForList(normalized)) {
		const existingListIndex = opinionsData.findIndex(
			(opinion) => String(opinion._id) === String(normalized._id),
		);
		if (existingListIndex >= 0) {
			opinionsData[existingListIndex] = {
				...opinionsData[existingListIndex],
				...normalized,
			};
		} else {
			opinionsData.unshift(normalized);
		}
	}

	filterOpinions();
	scheduleFlashDetailedRefresh(280);
}

function applyFlashCounts(payload) {
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
		scheduleFlashDetailedRefresh(260);
	}
}

// =============================================================
// Fonctions utilitaires
// =============================================================
function formatDate(dateString) {
	if (!dateString) return 'Date inconnue';

	const date = new Date(dateString);
	return date.toLocaleDateString('fr-FR', {
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
	const searchTerm = document
		.getElementById('search-opinions')
		.value.toLowerCase();
	const sortBy = document.getElementById('sort-by').value;
	animateFilterRefresh();
	const filteredForStats = applyDemographicAndAnswerFilters(allOpinionsData);
	updateVisualsFromFilteredOpinions(filteredForStats);

	let filtered = filteredForStats.filter(isOpinionEligibleForList);

	if (searchTerm) {
		filtered = filtered.filter(
			(opinion) =>
				opinion.userPseudo?.toLowerCase().includes(searchTerm) ||
				opinion.reason?.toLowerCase().includes(searchTerm),
		);
	}

	filteredOpinions = sortOpinionsWithPinned(filtered, sortBy);
	renderFilteredOpinions();
}

function renderFilteredOpinions() {
	const list = document.getElementById('opinions-list');
	const noResults = document.getElementById('no-results');
	if (!list || !noResults) return;

	if (filteredOpinions.length === 0) {
		list.innerHTML = '';
		noResults.classList.remove('hidden');
		return;
	}

	noResults.classList.add('hidden');

	if (type === 'binary') {
		renderBinaryOpinions(filteredOpinions, filteredOpinions.length);
	} else {
		renderMultipleOpinions(filteredOpinions, filteredOpinions.length);
	}
}

// =============================================================
// Mise à jour des likes/dislikes en temps réel
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
		const total = sourceOpinions.length;
		const yes = sourceOpinions.filter((o) => o.answer).length;
		const no = total - yes;
		const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
		const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;

		return {
			Oui: {
				count: yes,
				percentage: yesPercentage,
			},
			Non: {
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

function getOpinionIdentityKey(opinion) {
	const voterKey = String(opinion?.voterKey || '').trim();
	if (voterKey) return voterKey;
	return String(opinion?._id || '').trim();
}

function getUniqueVotersCount(sourceOpinions = []) {
	return new Set((sourceOpinions || []).map(getOpinionIdentityKey).filter(Boolean))
		.size;
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
			filters.push(`Reponse: ${answerFilter === 'yes' ? 'Oui' : 'Non'}`);
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
	if (chart && typeof chart.toBase64Image === 'function') {
		const imageData = chart.toBase64Image();
		if (imageData) return imageData;
	}
	const canvas = document.getElementById('resultsChart');
	if (!canvas || typeof canvas.toDataURL !== 'function') return '';
	try {
		return canvas.toDataURL('image/png');
	} catch (_error) {
		return '';
	}
}

function buildPdfVisualContext() {
	const logoUrl = new URL('assets/logo.svg', window.location.href).href;
	return {
		chartImage: getChartImageDataForExport(),
		legendItems: collectChartLegendForExport(),
		appliedFilters: getActiveChartFiltersForExport(),
		logoUrl,
	};
}

async function exportResults(format) {
	try {
		showNotification(`Export ${format.toUpperCase()} en cours...`, 'info');

		// Calculer les pourcentages pour l'export
		const chartSourceOpinions = applyDemographicAndAnswerFilters(allOpinionsData);
		const exportOpinions =
			filteredOpinions.length > 0 ?
				[...filteredOpinions]
			: chartSourceOpinions.length > 0 ?
				[...chartSourceOpinions]
			:	[...(allOpinionsData.length ? allOpinionsData : opinionsData)];
		const percentages = calculatePercentagesForExport(exportOpinions);
		const totalVotes = exportOpinions.length;
		const uniqueVoters = getUniqueVotersCount(exportOpinions);
		const averageOpinionsPerVoter =
			totalVotes > 0 && uniqueVoters > 0 ?
				(totalVotes / uniqueVoters).toFixed(2)
			:	'0';
		const pdfVisualContext = buildPdfVisualContext();

		// Données à exporter
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
			},
			filters: {
				applied: getActiveChartFiltersForExport(),
			},
			opinions: exportOpinions.map((opinion) => ({
				id: opinion._id,
				userPseudo: opinion.userPseudo || 'Anonyme',
				voterKey: opinion.voterKey || '',
				answer: opinion.answer,
				answerLabel:
					type === 'binary' ?
						opinion.answer ?
							'Oui'
						:	'Non'
					:	surveyLabels[opinion.answer] || `Option ${opinion.answer}`,
				reason: opinion.reason || '',
				likeCount: opinion.likeCount || 0,
				dislikeCount: opinion.dislikeCount || 0,
				age:
					Number.isFinite(Number(opinion?.adminProfile?.age)) ?
						Number(opinion.adminProfile.age)
					:	null,
				gender: normalizeGenderValue(opinion?.adminProfile?.gender),
				createdAt: opinion.createdAt,
				answerPercentage:
					percentages[
						type === 'binary' ?
							opinion.answer ?
								'Oui'
							:	'Non'
						:	surveyLabels[opinion.answer] || `Option ${opinion.answer}`
					]?.percentage || 0,
			})),
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
				printWindow.document.write(content);
				printWindow.document.close();
				printWindow.focus();
				printWindow.print();
				hideExportModal();
				showNotification('PDF généré avec succès', 'success');
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
		showNotification("Erreur lors de l'export", 'error');
	}
}

function convertToCSV(data) {
	const lines = [];

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
		`"Date de création","${new Date(data.survey.createdAt).toLocaleString('fr-FR')}"`,
	);
	lines.push(
		`"Date d'export","${new Date(data.survey.exportDate).toLocaleString('fr-FR')}"`,
	);
	lines.push('');

	// Section des pourcentages
	lines.push('STATISTIQUES PAR RÉPONSE');
	lines.push('=======================');
	if (data.survey.type === 'binary') {
		lines.push('"Réponse","Votes","Pourcentage"');
		lines.push(
			`"Oui","${data.percentages.Oui.count}","${data.percentages.Oui.percentage}%"`,
		);
		lines.push(
			`"Non","${data.percentages.Non.count}","${data.percentages.Non.percentage}%"`,
		);
	} else {
		lines.push('"Réponse","Clé","Votes","Pourcentage"');
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

	// Section des opinions
	lines.push('OPINIONS DÉTAILLÉES');
	lines.push('==================');
	lines.push(
		'"ID Opinion","VoterKey","Pseudo","Réponse","Réponse (libellé)","Pourcentage de la réponse","Raison","Likes","Dislikes","Age","Sexe","Date"',
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
				Number.isFinite(Number(opinion.age)) ? Number(opinion.age) : '',
				`"${(opinion.gender || 'non_renseigne').replace(/"/g, '""')}"`,
				`"${new Date(opinion.createdAt).toLocaleString('fr-FR')}"`,
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
	const nowLabel = now.toLocaleString('fr-FR');
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
					<td>${Number.isFinite(Number(opinion.age)) ? Number(opinion.age) : '-'}</td>
					<td>${escapeHtml(opinion.gender || 'non_renseigne')}</td>
					<td style="max-width: 220px;">${escapeHtml(opinion.reason || '-')}</td>
					<td>${Number(opinion.likeCount || 0)}</td>
					<td>${Number(opinion.dislikeCount || 0)}</td>
					<td>${new Date(opinion.createdAt).toLocaleString('fr-FR')}</td>
				</tr>
			`,
		)
		.join('');

	return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="utf-8" />
	<title>Resultats du sondage - ${escapeHtml(data.survey.theme || 'Sans titre')}</title>
	<style>
		@page { margin: 16mm 12mm 22mm; }
		body {
			font-family: Arial, sans-serif;
			margin: 0;
			padding: 0;
			color: #111;
			font-size: 12px;
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
		.chart-block {
			margin: 14px 0 18px;
			padding: 12px;
			border: 1px solid #e5e7eb;
			border-radius: 8px;
			background: #f9fafb;
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
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 8px;
			margin: 10px 0 6px;
		}
		.chart-legend-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px 8px;
			border: 1px solid #e5e7eb;
			border-radius: 999px;
			background: #fff;
		}
		.chart-legend-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
		.chart-legend-label { font-weight: 600; }
		.chart-legend-value { margin-left: auto; color: #374151; font-size: 11px; }
		.filters-note { margin: 8px 0 4px; color: #374151; }
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
		<div class="meta-item"><div class="meta-label">Date export</div><div class="meta-value">${new Date(data.survey.exportDate).toLocaleString('fr-FR')}</div></div>
	</div>

	<div class="summary">
		<h3>Resume statistique</h3>
		<div class="summary-item"><span>Votants uniques:</span><strong>${Number(data.statistics.uniqueVoters || 0)}</strong></div>
		<div class="summary-item"><span>Moyenne votes par votant:</span><strong>${escapeHtml(data.statistics.averageOpinionsPerVoter || '0')}</strong></div>
	</div>

	<h2>Diagramme ChartJS des resultats</h2>
	<div class="chart-block">
		<div class="chart-image-wrap">
			${hasChartImage ? `<img class="chart-image" src="${chartImage}" alt="Diagramme des votes" />` : '<div class="chart-placeholder">Diagramme indisponible pour cet export.</div>'}
		</div>
		${filterMarkup}
		${legendItems.length > 0 ? `<div class="chart-legend">${chartLegendMarkup}</div>` : ''}
		<div class="chart-copyright">
			<img src="${escapeHtml(logoUrl)}" alt="Logo SurveyApp" />
			<span>© ${currentYear} SurveyApp - Tous droits reserves</span>
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
				<th>Age</th>
				<th>Sexe</th>
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
			<img src="${escapeHtml(logoUrl)}" alt="Logo SurveyApp" />
			<span>© ${currentYear} SurveyApp - Document genere le ${nowLabel}</span>
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
