/** @format */

// =============================================================
// Configuration
// =============================================================
const CONFIG = {
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
	api: {
		endpoints: {
			survey: '/api/survey_2',
			detailedResults: '/detailed-results',
			opinion: '/api/opinion_2',
		},
	},
};

// =============================================================
// Variables globales
// =============================================================
let chart = null;
let opinionsData = [];
let filteredOpinions = [];
let surveyLabels = {};
let surveyOptionKeys = [];
let userReactions = new Map();
let chartColors = {};
const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
let isUserMenuOpen = false;
const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';
const LEGACY_OPTION_KEYS = [
	'reponse_1',
	'reponse_2',
	'reponse_3',
	'reponse_4',
	'reponse_5',
	'reponse_6',
];

function getOpinionTimestamp(opinion) {
	const parsed = new Date(opinion?.createdAt || 0).getTime();
	return Number.isFinite(parsed) ? parsed : 0;
}

function sortOpinionsWithPinned(opinions = []) {
	return [...opinions].sort((left, right) => {
		const leftPinned = left?.isOwnOpinion ? 1 : 0;
		const rightPinned = right?.isOwnOpinion ? 1 : 0;
		if (leftPinned !== rightPinned) return rightPinned - leftPinned;
		return getOpinionTimestamp(right) - getOpinionTimestamp(left);
	});
}

function isOpinionCommentVisible(opinion) {
	return (
		!opinion?.commentModeration?.isDeleted &&
		Boolean(String(opinion?.reason || '').trim())
	);
}

function buildPinnedBadge(opinion) {
	if (!opinion?.isOwnOpinion) return '';
	return `
		<span class="opinion-pin-badge">
			<i class="fas fa-thumbtack" aria-hidden="true"></i>
			${t('shared.surveys.my_comment_badge', 'Mon commentaire')}
		</span>
	`;
}

function escapeHtml(value) {
	return String(value || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function formatQuotedComment(reason) {
	const safeReason = escapeHtml(String(reason || '').trim());
	if (!safeReason) {
		return '<em class="comment-empty">Aucun commentaire</em>';
	}
	return `<span class="comment-quote-text">"${safeReason}"</span>`;
}

// =============================================================
// Lecture paramètres URL
// =============================================================
const params = new URLSearchParams(window.location.search);
const surveyId = params.get('Id') || params.get('id');

if (!surveyId) {
	showNotification('Sondage invalide.', 'error');
	setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
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

function resolveOptionKeysFromPayload(payload = {}) {
	if (Array.isArray(payload.optionKeys) && payload.optionKeys.length) {
		return sortOptionKeys(payload.optionKeys);
	}

	const labelKeys = Object.keys(payload.labels || {});
	if (labelKeys.length) {
		return sortOptionKeys(labelKeys);
	}

	const countKeys = Object.keys(payload.counts || {});
	if (countKeys.length) {
		return sortOptionKeys(countKeys);
	}

	const legacyKeys = LEGACY_OPTION_KEYS.filter((key) =>
		String(payload[key] || '').trim(),
	);
	if (legacyKeys.length) {
		return sortOptionKeys(legacyKeys);
	}

	return [];
}

function buildLabelsForOptionKeys(payload = {}, optionKeys = []) {
	const labels = {};
	optionKeys.forEach((key, index) => {
		const fallbackLabel = `Option ${index + 1}`;
		labels[key] = String(payload.labels?.[key] || payload[key] || fallbackLabel);
	});
	return labels;
}

function buildCountsForOptionKeys(counts = {}, optionKeys = []) {
	const map = {};
	optionKeys.forEach((key) => {
		map[key] = Number(counts?.[key] || 0);
	});
	return map;
}

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	checkUserLoginState();
	initializeEventListeners();
	initializeFooter();
	if (localStorage.getItem('token')) {
		getSurveyDetails();
	}
});

document.addEventListener('site:language-changed', () => {
	if (!surveyId || !localStorage.getItem('token')) return;
	getSurveyDetails();
});

// =============================================================
// Vérifier l'état de connexion de l'utilisateur
// =============================================================
function checkUserLoginState() {
	const userMenu = document.getElementById('user-menu');
	const loginBtn = document.getElementById('login-btn');
	const userPseudo = localStorage.getItem('userPseudo');
	const token = localStorage.getItem('token');

	if (token) {
		// Utilisateur connecté
		userMenu.classList.remove('hidden');
		loginBtn.classList.add('hidden');

		// Mettre à jour le pseudo
		if (userPseudo) {
			document.getElementById('user-name').textContent = userPseudo;
		} else {
			// Si pas de pseudo, essayer de récupérer depuis l'API ou utiliser une valeur par défaut
			document.getElementById('user-name').textContent = 'Utilisateur';
		}

		// Initialiser le menu utilisateur (legacy uniquement)
		if (!USE_SHARED_USER_MENU()) {
			initializeUserMenu();
		}
	} else {
		// Utilisateur non connecté
		userMenu.classList.add('hidden');
		loginBtn.classList.remove('hidden');

		// Afficher un message et rediriger après un délai
		showNotification(
			'Veuillez vous connecter pour voir les résultats.',
			'warning',
		);
		setTimeout(() => {
			window.redirectToGoogleAuth?.();
		}, 2000);
	}
}

// =============================================================
// Gestionnaires d'événements
// =============================================================
function initializeEventListeners() {
	// Bouton retour
	document.getElementById('back-btn').addEventListener('click', () => {
		window.history.back();
	});

	// Bouton actualiser
	document.getElementById('refresh-btn').addEventListener('click', () => {
		if (localStorage.getItem('token')) {
			getSurveyDetails();
		} else {
			showNotification('Veuillez vous connecter pour actualiser.', 'warning');
		}
	});

	// Bouton de connexion
	document.getElementById('login-btn').addEventListener('click', () => {
		window.redirectToGoogleAuth?.();
	});

	// Recherche
	document
		.getElementById('search-opinions')
		.addEventListener('input', filterOpinions);

	// Filtre par réponse
	document
		.getElementById('filter-answer')
		.addEventListener('change', filterOpinions);

	// Gestion du redimensionnement de la fenêtre
	if (!USE_SHARED_USER_MENU()) {
		// Gestion du redimensionnement de la fenetre
		window.addEventListener('resize', handleWindowResize);

		// Gestion du defilement sur mobile
		window.addEventListener('scroll', handleWindowScroll);
	}
}

// =============================================================
// GESTION DU MENU UTILISATEUR (Responsive Design)
// =============================================================
function initializeUserMenu() {
	if (USE_SHARED_USER_MENU()) return;

	const userMenuDetails = document.querySelector('.user-menu-details');
	const userMenuSummary = document.querySelector('.user-menu-summary');
	const chevronIcon = document.querySelector('.chevron-icon');

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

	// --- LOGOUT BUTTON LOGIC ---
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Fermer le menu déroulant
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();

			// Afficher la modal de confirmation
			document
				.getElementById('logout-confirm-modal')
				?.classList.remove('hidden');
		});
	}

	// LOGOUT MODAL BUTTONS
	document.getElementById('logout-cancel')?.addEventListener('click', () => {
		document.getElementById('logout-confirm-modal').classList.add('hidden');
	});

	document.getElementById('logout-ok')?.addEventListener('click', () => {
		handleLogout();
		document.getElementById('logout-confirm-modal').classList.add('hidden');
	});

	// Gestion du clic en dehors du menu utilisateur pour le fermer
	document.addEventListener('click', (e) => {
		const userMenu = document.querySelector('.user-menu-container');

		if (userMenu && !userMenu.contains(e.target) && isUserMenuOpen) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	});

	// Initialiser les événements de la modal de déconnexion
	initializeLogoutModal();
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

function initializeLogoutModal() {
	// Ajouter l'écouteur pour le bouton de fermeture de la modal
	const closeModalBtn = document.querySelector(
		'#logout-confirm-modal .close-modal',
	);
	if (closeModalBtn) {
		closeModalBtn.addEventListener('click', () => {
			document.getElementById('logout-confirm-modal').classList.add('hidden');
		});
	}

	// Fermer la modal en cliquant à l'extérieur
	const logoutModal = document.getElementById('logout-confirm-modal');
	if (logoutModal) {
		logoutModal.addEventListener('click', (e) => {
			if (e.target === logoutModal) {
				logoutModal.classList.add('hidden');
			}
		});
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
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');

		// Si l'utilisateur a utilisé Google Login, révoquer le token si nécessaire
		if (typeof gapi !== 'undefined' && gapi.auth2) {
			const auth2 = gapi.auth2.getAuthInstance();
			if (auth2) {
				auth2.signOut().then(() => {
					console.log('User signed out from Google');
				});
			}
		}

		console.log('Déconnexion réussie, redirection vers browse-surveys.html');

		// Afficher un message de confirmation
		showNotification('Déconnexion réussie. Redirection...', 'success');

		// Rediriger vers la page de parcours des sondages
		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 1500);
	} catch (error) {
		console.warn('Erreur lors de la déconnexion:', error);
		// Rediriger même en cas d'erreur
		window.location.href = 'browse-surveys.html';
	}
}

// =============================================================
// Récupération des données
// =============================================================
async function getSurveyDetails() {
	try {
		showLoading(true);

		const token = localStorage.getItem('token');

		if (!token) {
			checkUserLoginState();
			showLoading(false);
			return;
		}

		const response = await fetch(`${CONFIG.api.endpoints.survey}/${surveyId}`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (response.status === 401) {
			localStorage.removeItem('token');
			localStorage.removeItem('userPseudo');
			checkUserLoginState();
			showNotification('Session expirée, veuillez vous reconnecter', 'warning');
			showLoading(false);
			return;
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const survey = await response.json();

		if (!survey.isClosed) {
			showNotification("Ce sondage n'est pas encore clôturé.", 'warning');
			setTimeout(() => (window.location.href = 'browse-surveys.html'), 3000);
			return;
		}

		displaySurvey(survey);
		await getSurveyResults();

		showLoading(false);
	} catch (err) {
		console.error('Erreur:', err);
		showNotification(err.message || 'Erreur lors du chargement', 'error');
		showLoading(false);
	}
}

// =============================================================
// Affichage en-tête du sondage
// =============================================================
function displaySurvey(survey) {
	// Formater les dates
	const createdAt = new Date(survey.createdAt);
	const endedAt = survey.endedAt ? new Date(survey.endedAt) : null;

	const formattedCreated = createdAt.toLocaleDateString(getIntlLocale(), {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

	const formattedEnded =
		endedAt ?
			endedAt.toLocaleDateString(getIntlLocale(), {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			})
		:	'Non spécifiée';

	// Mettre à jour l'interface
	document.getElementById('created-date').textContent =
		`Début: ${formattedCreated}`;
	document.getElementById('ended-date').textContent = `Fin: ${formattedEnded}`;
	document.getElementById('survey-theme').textContent = survey.theme;
	document.getElementById('survey-contexte').textContent =
		survey.contexte || 'Aucun contexte fourni';
	document.getElementById('survey-question').textContent = survey.question;

	// Mettre à jour les métadonnées
	document.getElementById('survey-meta').innerHTML = `
        <span>Créé par: ${survey.creatorName || 'Administrateur'}</span>
    `;

	document.querySelector('.dashboard-container').classList.remove('hidden');
}

// =============================================================
// Récupération des résultats
// =============================================================
async function getSurveyResults() {
	try {
		const token = localStorage.getItem('token');

		if (!token) {
			checkUserLoginState();
			return;
		}

		const response = await fetch(
			`${CONFIG.api.endpoints.survey}/${surveyId}${CONFIG.api.endpoints.detailedResults}`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);

		if (response.status === 401) {
			localStorage.removeItem('token');
			localStorage.removeItem('userPseudo');
			checkUserLoginState();
			showNotification('Session expirée, veuillez vous reconnecter', 'warning');
			return;
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const data = await response.json();

		surveyOptionKeys = resolveOptionKeysFromPayload(data);
		surveyLabels = buildLabelsForOptionKeys(data, surveyOptionKeys);
		const counts = buildCountsForOptionKeys(data.counts || {}, surveyOptionKeys);
		const total =
			Number(data.totalOpinions || 0) ||
			surveyOptionKeys.reduce((sum, key) => sum + Number(counts[key] || 0), 0);

		// Mettre à jour les statistiques
		document.getElementById('total-votes').textContent = total;
		document.getElementById('votes-count').textContent = `${total} votes`;

		// Créer les couleurs pour les options
		initializeChartColors(surveyOptionKeys);

		// Créer le graphique
		createChart(surveyOptionKeys, surveyLabels, counts, total);

		// Afficher les résultats détaillés
		displayDetailedResults(surveyOptionKeys, surveyLabels, counts, total);

		// Mettre à jour les filtres
		updateFilters(surveyOptionKeys, surveyLabels);

		// Afficher les opinions
		opinionsData = sortOpinionsWithPinned(
			(Array.isArray(data.opinions) ? data.opinions : []).filter(
				isOpinionCommentVisible,
			),
		);
		renderOpinions(opinionsData);

		filteredOpinions = [...opinionsData];
	} catch (err) {
		console.error('Erreur lors de la récupération des résultats:', err);
		showNotification('Erreur de chargement des résultats', 'error');
	}
}

// =============================================================
// Initialisation des couleurs du graphique
// =============================================================
function initializeChartColors(optionKeys) {
	(optionKeys || []).forEach((key, index) => {
		chartColors[key] = CONFIG.chartColors[index % CONFIG.chartColors.length];
	});
}

// =============================================================
// Création du graphique
// =============================================================
function createChart(optionKeys, labels, counts, total) {
	const ctx = document.getElementById('resultsChart').getContext('2d');

	if (chart) {
		chart.destroy();
	}

	const labelValues = (optionKeys || []).map((key) => labels[key] || key);
	const countValues = (optionKeys || []).map((key) => Number(counts[key] || 0));
	const backgroundColors = (optionKeys || []).map(
		(key) => chartColors[key] || '#6366f1',
	);

	chart = new Chart(ctx, {
		type: 'pie',
		data: {
			labels: labelValues,
			datasets: [
				{
					data: countValues,
					backgroundColor: backgroundColors,
					borderColor: '#1e293b',
					borderWidth: 2,
					hoverOffset: 15,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					position: 'right',
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
						size: 12,
					},
					formatter: (value) => {
						const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
						return percentage > 5 ? `${percentage}%` : '';
					},
				},
				tooltip: {
					callbacks: {
						label: (context) => {
							const label = context.label || '';
							const value = context.raw || 0;
							const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
							return `${label}: ${value} votes (${percentage}%)`;
						},
					},
				},
			},
		},
	});

	// Mettre à jour la légende
	renderChartLegend(optionKeys, labels, counts);
}

// =============================================================
// Affichage des résultats détaillés
// =============================================================
function displayDetailedResults(optionKeys, labels, counts, total) {
	const container = document.getElementById('detailed-results');

	container.innerHTML = (optionKeys || [])
		.map((key, index) => {
			const label = labels[key] || `Option ${index + 1}`;
			const count = Number(counts[key] || 0);
			const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
			const color =
				chartColors[key] ||
				CONFIG.chartColors[index % CONFIG.chartColors.length];

			return `
            <div class="result-item">
                <div class="result-label">
                    <div class="result-color" style="background: ${color};"></div>
                    <span class="result-name">${label}</span>
                </div>
                <div class="result-count">${count}</div>
                <div class="result-percentage">
                    <div class="percentage-bar">
                        <div class="percentage-fill" style="background: ${color}; width: ${percentage}%;"></div>
                    </div>
                    <div class="percentage-value">${percentage}%</div>
                </div>
            </div>
        `;
		})
		.join('');
}

// =============================================================
// Mise à jour des filtres
// =============================================================
function updateFilters(optionKeys, labels) {
	const filterSelect = document.getElementById('filter-answer');
	let options = '<option value="all">Toutes les reponses</option>';

	(optionKeys || []).forEach((key) => {
		const label = labels[key] || key;
		options += `<option value="${key}">${label}</option>`;
	});

	filterSelect.innerHTML = options;
}

// =============================================================
// Affichage des opinions
// =============================================================
function renderOpinions(opinions) {
	const list = document.getElementById('opinions-list');
	const noResults = document.getElementById('no-results');
	const sortedOpinions = sortOpinionsWithPinned(opinions || []).filter(
		isOpinionCommentVisible,
	);

	if (!sortedOpinions || sortedOpinions.length === 0) {
		list.innerHTML = '';
		noResults.classList.remove('hidden');
		return;
	}

	noResults.classList.add('hidden');

	list.innerHTML = sortedOpinions
		.map((opinion) => {
			const answerLabel =
				surveyLabels[opinion.answer] || `Option ${opinion.answer}`;
			const answerColor = chartColors[opinion.answer] || CONFIG.chartColors[0];

			// Vérifier si l'utilisateur a déjà réagi
			const userReaction = userReactions.get(opinion._id);
			const likeActive =
				userReaction === 'like' || (!userReaction && opinion.userLiked) ?
					'active'
				:	'';
			const dislikeActive =
				userReaction === 'dislike' || (!userReaction && opinion.userDisliked) ?
					'active'
				:	'';

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
                            <span class="user-pseudo">${opinion.userPseudo || 'Anonyme'}</span>
							${buildPinnedBadge(opinion)}
                            <span class="opinion-date">${formatDate(
															opinion.createdAt,
														)}</span>
                        </div>
                    </div>
                    <div class="opinion-answer" style="background: ${answerColor}20; color: ${answerColor}; border-color: ${answerColor}40;">
                        ${answerLabel}
                    </div>
                </div>
                
                <div class="opinion-content">
                    ${formatQuotedComment(opinion.reason)}
                </div>
                
                <div class="reaction-controls">
                    <button class="like-btn ${likeActive}" data-opinion-id="${
											opinion._id
										}">
                        <i class="fas fa-thumbs-up"></i>
                        <span class="like-count">${
													opinion.likeCount || 0
												}</span>
                    </button>
                    <button class="dislike-btn ${dislikeActive}" data-opinion-id="${
											opinion._id
										}">
                        <i class="fas fa-thumbs-down"></i>
                        <span class="dislike-count">${
													opinion.dislikeCount || 0
												}</span>
                    </button>
                </div>
            </div>
        `;
		})
		.join('');

	// Attacher les écouteurs d'événements
	attachReactionListeners();
}

// =============================================================
// Filtrage des opinions
// =============================================================
function filterOpinions() {
	const searchTerm = document
		.getElementById('search-opinions')
		.value.toLowerCase();
	const filterValue = document.getElementById('filter-answer').value;

	let filtered = [...opinionsData];

	// Filtre par recherche
	if (searchTerm) {
		filtered = filtered.filter(
			(opinion) =>
				opinion.userPseudo?.toLowerCase().includes(searchTerm) ||
				opinion.reason?.toLowerCase().includes(searchTerm),
		);
	}

	// Filtre par réponse
	if (filterValue !== 'all') {
		filtered = filtered.filter((opinion) => opinion.answer == filterValue);
	}

	filteredOpinions = sortOpinionsWithPinned(filtered);
	renderOpinions(filteredOpinions);

	// Afficher/masquer le message d'état vide
	const noResults = document.getElementById('no-results');
	if (filteredOpinions.length === 0 && opinionsData.length > 0) {
		noResults.classList.remove('hidden');
		noResults.innerHTML = `
            <i class="fas fa-search"></i>
            <p>Aucun commentaire ne correspond à votre recherche</p>
        `;
	} else if (filteredOpinions.length === 0) {
		noResults.classList.remove('hidden');
		noResults.innerHTML = `
            <i class="fas fa-inbox"></i>
            <p>Aucun commentaire pour ce sondage</p>
        `;
	} else {
		noResults.classList.add('hidden');
	}
}

// =============================================================
// Gestion des réactions (likes/dislikes)
// =============================================================
function attachReactionListeners() {
	document.querySelectorAll('.like-btn').forEach((button) => {
		button.addEventListener('click', async () => {
			const opinionId = button.dataset.opinionId;
			await handleReaction(opinionId, 'like');
		});
	});

	document.querySelectorAll('.dislike-btn').forEach((button) => {
		button.addEventListener('click', async () => {
			const opinionId = button.dataset.opinionId;
			await handleReaction(opinionId, 'dislike');
		});
	});
}

async function handleReaction(opinionId, type) {
	try {
		const token = localStorage.getItem('token');

		if (!token) {
			showNotification('Veuillez vous connecter pour réagir.', 'warning');
			checkUserLoginState();
			return;
		}

		const response = await fetch(
			`${CONFIG.api.endpoints.opinion}/${opinionId}/${type}`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
			},
		);

		if (response.status === 401) {
			localStorage.removeItem('token');
			localStorage.removeItem('userPseudo');
			checkUserLoginState();
			showNotification('Session expirée, veuillez vous reconnecter', 'warning');
			return;
		}

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || `Erreur ${type}`);
		}

		const data = await response.json();

		// Mettre à jour le compteur local
		updateOpinionCounters(opinionId, data.likeCount, data.dislikeCount);

		// Mettre à jour l'état de l'utilisateur
		if (type === 'like') {
			userReactions.set(opinionId, 'like');
		} else {
			userReactions.set(opinionId, 'dislike');
		}

		// Mettre à jour l'interface
		updateButtonState(opinionId, type);
	} catch (err) {
		if (
			err?.statusCode === 410 ||
			err?.payload?.code === 'SURVEY_COMMENT_UNAVAILABLE'
		) {
			removeOpinionComment(opinionId);
		}
		console.error(`Erreur ${type}:`, err);
		showNotification(err.message || `Erreur lors du ${type}`, 'error');
	}
}

function removeOpinionComment(opinionId) {
	const normalizedId = String(opinionId || '').trim();
	if (!normalizedId) return;
	opinionsData = opinionsData.filter(
		(opinion) => String(opinion?._id || '') !== normalizedId,
	);
	filteredOpinions = filteredOpinions.filter(
		(opinion) => String(opinion?._id || '') !== normalizedId,
	);
	filterOpinions();
}

function updateButtonState(opinionId, type) {
	const likeBtn = document.querySelector(
		`.like-btn[data-opinion-id="${opinionId}"]`,
	);
	const dislikeBtn = document.querySelector(
		`.dislike-btn[data-opinion-id="${opinionId}"]`,
	);

	if (type === 'like') {
		likeBtn.classList.add('active');
		dislikeBtn.classList.remove('active');
	} else {
		dislikeBtn.classList.add('active');
		likeBtn.classList.remove('active');
	}

	// Animation
	const updatedBtn = type === 'like' ? likeBtn : dislikeBtn;
	updatedBtn.classList.add('like-updated');
	setTimeout(() => {
		updatedBtn.classList.remove('like-updated');
	}, 300);
}

// =============================================================
// Mise à jour des compteurs
// =============================================================
function updateOpinionCounters(opinionId, likeCount, dislikeCount) {
	const likeBtn = document.querySelector(
		`.like-btn[data-opinion-id="${opinionId}"] .like-count`,
	);
	const dislikeBtn = document.querySelector(
		`.dislike-btn[data-opinion-id="${opinionId}"] .dislike-count`,
	);

	if (likeBtn) likeBtn.textContent = likeCount || 0;
	if (dislikeBtn) dislikeBtn.textContent = dislikeCount || 0;

	// Animation
	const opinionCard = document.getElementById(`opinion-${opinionId}`);
	if (opinionCard) {
		opinionCard.style.transform = 'scale(1.02)';
		setTimeout(() => {
			opinionCard.style.transform = '';
		}, 300);
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
	const dashboard = document.querySelector('.dashboard-container');

	if (show) {
		loading.classList.remove('hidden');
		if (dashboard) dashboard.classList.add('hidden');
	} else {
		loading.classList.add('hidden');
		if (dashboard) dashboard.classList.remove('hidden');
	}
}

function showNotification(message, type = 'info') {
	// Supprimer les notifications existantes
	const existing = document.querySelector('.notification');
	if (existing) existing.remove();

	const notification = document.createElement('div');
	notification.className = `notification ${type}`;

	let icon = 'info-circle';
	if (type === 'error') icon = 'exclamation-circle';
	if (type === 'warning') icon = 'exclamation-triangle';
	if (type === 'success') icon = 'check-circle';

	notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
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
    `;

	document.body.appendChild(notification);

	// Supprimer après 5 secondes
	setTimeout(() => {
		notification.style.animation = 'slideOut 0.3s ease';
		setTimeout(() => notification.remove(), 300);
	}, 5000);
}

function renderChartLegend(optionKeys, labels, counts) {
	const legend = document.getElementById('chart-legend');

	legend.innerHTML = (optionKeys || [])
		.map((key, index) => {
			const label = labels[key] || `Option ${index + 1}`;
			const count = Number(counts[key] || 0);
			const color =
				chartColors[key] ||
				CONFIG.chartColors[index % CONFIG.chartColors.length];

			return `
            <div class="legend-item">
                <div class="legend-color" style="background: ${color};"></div>
                <span>${label}</span>
                <span class="legend-count">${count}</span>
            </div>
        `;
		})
		.join('');
}

// Ajouter les animations CSS pour les notifications si elles n'existent pas
if (!document.querySelector('#notification-styles')) {
	const style = document.createElement('style');
	style.id = 'notification-styles';
	style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
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


