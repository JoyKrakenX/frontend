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
let opinionsData = [];
let filteredOpinions = [];
let surveyLabels = {};
let currentSurvey = null;
let isUserMenuOpen = false;
const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';

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
	if (!isFlashMode || !payload || payload.surveyId !== id) return;
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
	const yes =
		isFlashMode ?
			Number(data.counts?.yes || 0)
		:	(data.opinions?.filter((o) => o.answer).length || 0);
	const no =
		isFlashMode ?
			Number(data.counts?.no || 0)
		:	Math.max(0, (data.totalOpinions || 0) - yes);
	const total = Number(data.totalOpinions || yes + no);
	const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
	const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;

	// Mettre à jour les statistiques
	document.getElementById('total-votes').textContent = total;

	// Créer le graphique avec pourcentages
	createBinaryChart(yes, no, total, yesPercentage, noPercentage);

	// Afficher les statistiques détaillées avec pourcentages
	renderBinaryStats(yes, no, total, yesPercentage, noPercentage);

	// Stocker et afficher uniquement les commentaires non vides
	opinionsData = (data.opinions || []).filter(hasOpinionComment);
	renderBinaryOpinions(opinionsData, total);

	// Mettre à jour les filtres
	updateBinaryFilters();
}

function createBinaryChart(yes, no, total, yesPercentage, noPercentage) {
	if (chart) {
		chart.destroy();
		chart = null;
	}

	const renderFn = (ctx) => {
		if (isFlashMode) {
			chart = new Chart(ctx, {
				type: 'bar',
				data: {
					labels: ['Oui', 'Non'],
					datasets: [
						{
							label: 'Votes',
							data: [yes, no],
							backgroundColor: ['rgba(16, 185, 129, 0.35)', 'rgba(239, 68, 68, 0.35)'],
							borderColor: ['rgb(16, 185, 129)', 'rgb(239, 68, 68)'],
							borderWidth: 1,
						},
					],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: {
						y: { beginAtZero: true },
					},
					plugins: {
						...config.chartOptions.plugins,
						datalabels: {
							display: false,
						},
						tooltip: {
							...config.chartOptions.plugins.tooltip,
							callbacks: {
								label: (context) => {
									const index = Number(context.dataIndex || 0);
									const label = context.chart?.data?.labels?.[index] || `Option ${index + 1}`;
									const value = Number(context.raw ?? context.parsed?.y ?? context.parsed ?? 0);
									return `${label}: ${value} vote${value > 1 ? 's' : ''}`;
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
			type: 'doughnut',
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

	if (!opinions || opinions.length === 0) {
		list.innerHTML = '';
		noResults.classList.remove('hidden');
		return;
	}

	noResults.classList.add('hidden');

	list.innerHTML = opinions
		.map(
			(opinion) => `
        <div class="opinion-card" id="opinion-${opinion._id}">
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
                ${sanitizeInlineHtml(opinion.reason || '-')}
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

	filteredOpinions = [...opinions];
}

function updateBinaryFilters() {
	const filterSelect = document.getElementById('filter-answer');
	filterSelect.innerHTML = `
        <option value="all">Toutes les réponses</option>
        <option value="yes">Oui seulement</option>
        <option value="no">Non seulement</option>
    `;
}

// =============================================================
// Traitement résultats multiples
// =============================================================
function handleMultipleResults(data, survey) {
	const total = Number(data.totalOpinions || 0);
	let labels = Object.values(data.labels || {});
	let counts = Object.values(data.counts || {});

	if (isFlashMode) {
		surveyLabels = {
			reponse_1: data.labels?.reponse_1 || survey?.reponse_1 || 'Option 1',
			reponse_2: data.labels?.reponse_2 || survey?.reponse_2 || 'Option 2',
			reponse_3: data.labels?.reponse_3 || survey?.reponse_3 || 'Option 3',
		};
		labels = Object.values(surveyLabels);
		counts = [
			Number(data.counts?.reponse_1 || 0),
			Number(data.counts?.reponse_2 || 0),
			Number(data.counts?.reponse_3 || 0),
		];
	}

	// Calculer les pourcentages
	const percentages = counts.map((count) =>
		total > 0 ? Math.round((count / total) * 100) : 0,
	);

	// Stocker les labels dans une variable globale
	if (!isFlashMode) {
		surveyLabels = data.labels || {};
	}

	// Mettre à jour les statistiques
	document.getElementById('total-votes').textContent = total;

	// Créer le graphique avec pourcentages
	createMultipleChart(labels, counts, total, percentages);

	// Afficher les statistiques détaillées avec pourcentages
	renderMultipleStats(data, total, percentages);

	// Stocker et afficher les opinions
	opinionsData = isFlashMode ? (data.opinions || []).filter(hasOpinionComment) : (data.opinions || []);
	renderMultipleOpinions(opinionsData, total);

	// Mettre à jour les filtres
	updateMultipleFilters();
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
			const points = counts.map((value, index) => ({
				x: index + 1,
				y: Number(value || 0),
			}));

			chart = new Chart(ctx, {
				type: 'scatter',
				data: {
					datasets: [
						{
							label: 'Votes',
							data: points,
							pointRadius: 8,
							pointHoverRadius: 10,
							backgroundColor: backgroundColors,
							borderColor: backgroundColors,
						},
					],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: {
						x: {
							min: 0.5,
							max: labels.length + 0.5,
							ticks: {
								stepSize: 1,
								callback: (value) => labels[value - 1] || value,
							},
						},
						y: {
							beginAtZero: true,
						},
					},
					plugins: {
						...config.chartOptions.plugins,
						tooltip: {
							...config.chartOptions.plugins.tooltip,
							callbacks: {
								label: (context) => {
									const index = Number(context.dataIndex || 0);
									const optionLabel = labels[index] || `Option ${index + 1}`;
									const value = Number(context.raw?.y ?? context.parsed?.y ?? 0);
									return `${optionLabel}: ${value} vote${value > 1 ? 's' : ''}`;
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
	const labels = Object.values(data.labels || {});
	const counts = Object.values(data.counts || {});
	const answerKeys = Object.keys(data.labels || {});

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

	if (!opinions || opinions.length === 0) {
		list.innerHTML = '';
		noResults.classList.remove('hidden');
		return;
	}

	noResults.classList.add('hidden');

	list.innerHTML = opinions
		.map((opinion) => {
			const answerLabel =
				surveyLabels[opinion.answer] || `Option ${opinion.answer}`;
			const answerKeys = Object.keys(surveyLabels);
			const answerIndex = answerKeys.indexOf(opinion.answer);
			const answerColor =
				config.chartColors[answerIndex % config.chartColors.length] ||
				config.chartColors[0];

			return `
            <div class="opinion-card" id="opinion-${opinion._id}">
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
                    ${sanitizeInlineHtml(opinion.reason || '-')}
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

	filteredOpinions = [...opinions];
}

function updateMultipleFilters() {
	const filterSelect = document.getElementById('filter-answer');
	let options = '<option value="all">Toutes les réponses</option>';

	Object.entries(surveyLabels).forEach(([key, label]) => {
		options += `<option value="${key}">${label}</option>`;
	});

	filterSelect.innerHTML = options;
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

	if (!hasOpinionComment(normalized)) {
		filterOpinions();
		return;
	}

	const existingIndex = opinionsData.findIndex(
		(opinion) => String(opinion._id) === String(normalized._id),
	);

	if (existingIndex >= 0) {
		opinionsData[existingIndex] = {
			...opinionsData[existingIndex],
			...normalized,
		};
	} else {
		opinionsData.unshift(normalized);
	}

	filterOpinions();
}

function applyFlashCounts(payload) {
	if (!payload) return;

	const totalOpinions = Number(payload.totalOpinions || 0);
	document.getElementById('total-votes').textContent = totalOpinions;

	if (type === 'binary') {
		const yes = Number(payload.counts?.yes || 0);
		const no = Number(payload.counts?.no || 0);
		const total = totalOpinions || yes + no;
		const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
		const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;

		createBinaryChart(yes, no, total, yesPercentage, noPercentage);
		renderBinaryStats(yes, no, total, yesPercentage, noPercentage);
	} else {
		const labelsMap = {
			reponse_1: surveyLabels.reponse_1 || currentSurvey?.reponse_1 || 'Option 1',
			reponse_2: surveyLabels.reponse_2 || currentSurvey?.reponse_2 || 'Option 2',
			reponse_3: surveyLabels.reponse_3 || currentSurvey?.reponse_3 || 'Option 3',
		};
		surveyLabels = labelsMap;

		const countsMap = {
			reponse_1: Number(payload.counts?.reponse_1 || 0),
			reponse_2: Number(payload.counts?.reponse_2 || 0),
			reponse_3: Number(payload.counts?.reponse_3 || 0),
		};

		const labels = Object.values(labelsMap);
		const counts = Object.values(countsMap);
		const total =
			totalOpinions ||
			counts.reduce((sum, count) => sum + Number(count || 0), 0);
		const percentages = counts.map((count) =>
			total > 0 ? Math.round((Number(count || 0) / total) * 100) : 0,
		);

		createMultipleChart(labels, counts, total, percentages);
		renderMultipleStats({ labels: labelsMap, counts: countsMap }, total, percentages);
		updateMultipleFilters();
	}

	if (payload.isClosed && currentSurvey && !currentSurvey.isClosed) {
		currentSurvey.isClosed = true;
		renderSurveyHeader(currentSurvey);
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
	const filterValue = document.getElementById('filter-answer').value;
	const sortBy = document.getElementById('sort-by').value;

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
		if (type === 'binary') {
			filtered = filtered.filter((opinion) =>
				filterValue === 'yes' ? opinion.answer : !opinion.answer,
			);
		} else {
			filtered = filtered.filter(
				(opinion) => String(opinion.answer) === String(filterValue),
			);
		}
	}

	// Tri
	filtered.sort((a, b) => {
		switch (sortBy) {
			case 'date':
				return new Date(b.createdAt) - new Date(a.createdAt);
			case 'likes':
				return (b.likeCount || 0) - (a.likeCount || 0);
			case 'alphabetical':
				return (a.userPseudo || '').localeCompare(b.userPseudo || '');
			default:
				return 0;
		}
	});

	filteredOpinions = filtered;
	renderFilteredOpinions();
}

function renderFilteredOpinions() {
	const list = document.getElementById('opinions-list');
	const noResults = document.getElementById('no-results');

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
	const opinionData = opinionsData.find(
		(opinion) => String(opinion._id) === String(opinionId),
	);
	if (opinionData) {
		opinionData.likeCount = likeCount || 0;
		opinionData.dislikeCount = dislikeCount || 0;
	}

	const opinionElement = document.getElementById(`opinion-${opinionId}`);
	if (!opinionElement) {
		console.warn(`Opinion ${opinionId} non trouvée dans le DOM`);
		return;
	}

	const likeElement = opinionElement.querySelector('.readonly-like');
	const dislikeElement = opinionElement.querySelector('.readonly-dislike');

	// Animation de mise à jour
	if (likeElement) {
		likeElement.textContent = likeCount || 0;
		likeElement.parentElement.classList.add('like-updated');
		setTimeout(() => {
			likeElement.parentElement.classList.remove('like-updated');
		}, 500);
	}

	if (dislikeElement) {
		dislikeElement.textContent = dislikeCount || 0;
		dislikeElement.parentElement.classList.add('like-updated');
		setTimeout(() => {
			dislikeElement.parentElement.classList.remove('like-updated');
		}, 500);
	}

	// Animation sur la carte entière
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
function calculatePercentagesForExport() {
	if (type === 'binary') {
		const total = opinionsData.length;
		const yes = opinionsData.filter((o) => o.answer).length;
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
	} else {
		const total = opinionsData.length;
		const counts = {};

		// Compter les votes par option
		opinionsData.forEach((opinion) => {
			const key = opinion.answer;
			const label = surveyLabels[key] || `Option ${key}`;
			if (!counts[label]) {
				counts[label] = {
					count: 0,
					percentage: 0,
					key: key,
				};
			}
			counts[label].count++;
		});

		// Calculer les pourcentages
		Object.keys(counts).forEach((label) => {
			counts[label].percentage =
				total > 0 ? Math.round((counts[label].count / total) * 100) : 0;
		});

		return counts;
	}
}

async function exportResults(format) {
	try {
		showNotification(`Export ${format.toUpperCase()} en cours...`, 'info');

		// Calculer les pourcentages pour l'export
		const percentages = calculatePercentagesForExport();
		const totalVotes = opinionsData.length;

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
				uniqueVoters: [...new Set(opinionsData.map((o) => o.userId))].length,
				averageOpinionsPerVoter:
					opinionsData.length > 0 ?
						(
							opinionsData.length /
							[...new Set(opinionsData.map((o) => o.userId))].length
						).toFixed(2)
					:	0,
			},
			opinions: opinionsData.map((opinion) => ({
				id: opinion._id,
				userId: opinion.userId,
				userPseudo: opinion.userPseudo || 'Anonyme',
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
				content = generatePDFContentEnriched(exportData);
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
	lines.push('');

	// Section des opinions
	lines.push('OPINIONS DÉTAILLÉES');
	lines.push('==================');
	lines.push(
		'"ID Opinion","ID Utilisateur","Pseudo","Réponse","Réponse (libellé)","Pourcentage de la réponse","Raison","Likes","Dislikes","Date"',
	);

	data.opinions.forEach((opinion) => {
		lines.push(
			[
				`"${opinion.id}"`,
				`"${opinion.userId || ''}"`,
				`"${opinion.userPseudo.replace(/"/g, '""')}"`,
				`"${opinion.answer}"`,
				`"${opinion.answerLabel.replace(/"/g, '""')}"`,
				`"${opinion.answerPercentage}%"`,
				`"${(opinion.reason || '').replace(/"/g, '""')}"`,
				opinion.likeCount,
				opinion.dislikeCount,
				`"${new Date(opinion.createdAt).toLocaleString('fr-FR')}"`,
			].join(','),
		);
	});

	return lines.join('\n');
}

function generatePDFContentEnriched(data) {
	function escapeHtml(str) {
		return String(str || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	return `
<!DOCTYPE html>
<html>
<head>
    <title>Résultats du sondage - ${escapeHtml(data.survey.theme || 'Sans titre')}</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            padding: 20px; 
            color: #111;
            font-size: 12px;
            line-height: 1.4;
        }
        .header { 
            text-align: center; 
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 15px;
        }
        h1 { 
            color: #333; 
            margin: 0 0 10px 0;
            font-size: 24px;
        }
        h2 { 
            color: #444; 
            margin: 25px 0 15px 0;
            font-size: 18px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
        }
        h3 { 
            color: #555; 
            margin: 20px 0 10px 0;
            font-size: 16px;
        }
        .meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
            margin: 20px 0;
        }
        .meta-item {
            padding: 10px;
            background: #f5f5f5;
            border-radius: 5px;
        }
        .meta-label {
            font-weight: bold;
            color: #666;
            font-size: 11px;
            margin-bottom: 5px;
        }
        .meta-value {
            color: #333;
            font-size: 13px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            font-size: 11px;
        }
        th {
            background-color: #f2f2f2;
            font-weight: bold;
            text-align: left;
            padding: 8px;
            border: 1px solid #ddd;
        }
        td {
            padding: 8px;
            border: 1px solid #ddd;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        .percentage-bar {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .bar-container {
            flex: 1;
            height: 6px;
            background: #e0e0e0;
            border-radius: 3px;
            overflow: hidden;
        }
        .bar-fill {
            height: 100%;
            background: #4CAF50;
        }
        .summary {
            background: #e8f4f8;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .summary-item {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
        }
        .footer {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            text-align: center;
            color: #777;
            font-size: 10px;
        }
        @media print {
            .page-break {
                page-break-before: always;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${escapeHtml(data.survey.theme || 'Sondage')}</h1>
        <p style="color: #666; font-size: 14px;">${escapeHtml(data.survey.question || '')}</p>
    </div>
    
    <div class="meta-grid">
        <div class="meta-item">
            <div class="meta-label">ID du sondage</div>
            <div class="meta-value">${escapeHtml(data.survey.id)}</div>
        </div>
        <div class="meta-item">
            <div class="meta-label">Type</div>
            <div class="meta-value">${data.survey.type === 'binary' ? 'Binaire' : 'Multiple'}</div>
        </div>
        <div class="meta-item">
            <div class="meta-label">Total votes</div>
            <div class="meta-value">${data.survey.totalVotes}</div>
        </div>
        <div class="meta-item">
            <div class="meta-label">Date d'export</div>
            <div class="meta-value">${new Date(data.survey.exportDate).toLocaleString('fr-FR')}</div>
        </div>
    </div>
    
    <div class="summary">
        <h3>Résumé statistique</h3>
        <div class="summary-item">
            <span>Votants uniques:</span>
            <strong>${data.statistics.uniqueVoters}</strong>
        </div>
        <div class="summary-item">
            <span>Moyenne votes par votant:</span>
            <strong>${data.statistics.averageOpinionsPerVoter}</strong>
        </div>
    </div>
    
    <h2>Pourcentages par réponse</h2>
    <table>
        <thead>
            <tr>
                <th>Réponse</th>
                ${data.survey.type === 'multiple' ? '<th>Clé</th>' : ''}
                <th>Votes</th>
                <th>Pourcentage</th>
                <th>Visualisation</th>
            </tr>
        </thead>
        <tbody>
            ${Object.entries(data.percentages)
							.map(
								([label, info]) => `
                <tr>
                    <td>${escapeHtml(label)}</td>
                    ${data.survey.type === 'multiple' ? `<td>${info.key}</td>` : ''}
                    <td>${info.count}</td>
                    <td><strong>${info.percentage}%</strong></td>
                    <td>
                        <div class="percentage-bar">
                            <div class="bar-container">
                                <div class="bar-fill" style="width: ${info.percentage}%"></div>
                            </div>
                            <span>${info.percentage}%</span>
                        </div>
                    </td>
                </tr>
            `,
							)
							.join('')}
        </tbody>
    </table>
    
    <div class="page-break"></div>
    
    <h2>Détails des opinions (${data.opinions.length} au total)</h2>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Pseudo</th>
                <th>Réponse</th>
                <th>Pourcentage</th>
                <th>Raison</th>
                <th>Likes</th>
                <th>Dislikes</th>
                <th>Date</th>
            </tr>
        </thead>
        <tbody>
            ${data.opinions
							.map(
								(opinion, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(opinion.userPseudo)}</td>
                    <td>${escapeHtml(opinion.answerLabel)}</td>
                    <td>${opinion.answerPercentage}%</td>
                    <td style="max-width: 200px;">${escapeHtml(opinion.reason || '-')}</td>
                    <td>${opinion.likeCount}</td>
                    <td>${opinion.dislikeCount}</td>
                    <td>${new Date(opinion.createdAt).toLocaleString('fr-FR')}</td>
                </tr>
            `,
							)
							.join('')}
        </tbody>
    </table>
    
    <div class="footer">
        <p>Document généré le ${new Date().toLocaleString('fr-FR')} | SurveyApp © ${new Date().getFullYear()}</p>
        <p>ID de session: ${data.survey.id} | Type: ${data.survey.type} | Total: ${data.survey.totalVotes} votes</p>
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
