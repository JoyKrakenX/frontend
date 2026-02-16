/** @format */

// =============================================================
// Configuration
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			survey: '/api/survey',
			detailedResults: '/detailed-results',
			like: '/api/opinion',
			dislike: '/api/opinion',
		},
	},
	colors: {
		yes: '#10b981',
		no: '#ef4444',
		primary: '#6366f1',
	},
};

// =============================================================
// Variables globales
// =============================================================
let chart = null;
let opinionsData = [];
let filteredOpinions = [];
let userReactions = new Map();
let isUserMenuOpen = false;
let userMenuClickHandler = null;
let isHandlingLogout = false;

// =============================================================
// Lecture paramètres URL
// =============================================================
const params = new URLSearchParams(window.location.search);
const id = params.get('id');

if (!id) {
	showNotification('Sondage invalide.', 'error');
	setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
}

// =============================================================
// Vérification token et état de connexion
// =============================================================
const token = localStorage.getItem('token');

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
	checkUserLoginState();
	initializeEventListeners();
	initializeFooter();

	if (!token) {
		showNotification('Vous devez être connecté pour voir ce sondage.', 'error');
		setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
		return;
	}

	getSurveyDetails();
});

// =============================================================
// SOCKET.IO
// =============================================================
const socket = io();

socket.on('updateOpinionLikes', ({ opinionId, likeCount, dislikeCount }) => {
	updateOpinionCounters(opinionId, likeCount, dislikeCount);
});

// =============================================================
// Vérifier l'état de connexion de l'utilisateur
// =============================================================
function checkUserLoginState() {
	const userMenu = document.getElementById('user-menu');
	const loginBtn = document.getElementById('login-btn');
	const userPseudo = localStorage.getItem('userPseudo');

	if (token) {
		// Utilisateur connecté
		userMenu.classList.remove('hidden');
		loginBtn.classList.add('hidden');

		// Mettre à jour le pseudo depuis le localStorage
		if (userPseudo) {
			document.getElementById('user-name').textContent = userPseudo;
		} else {
			// Si pas de pseudo dans localStorage, essayer de récupérer depuis l'API
			document.getElementById('user-name').textContent = 'Utilisateur';
			fetchUserProfile();
		}
	} else {
		// Utilisateur non connecté
		userMenu.classList.add('hidden');
		loginBtn.classList.remove('hidden');
	}
}

// =============================================================
// Récupérer le profil utilisateur depuis l'API
// =============================================================
async function fetchUserProfile() {
	try {
		const response = await fetch(`/api/auth/me`, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (response.ok) {
			const userData = await response.json();
			if (userData.pseudo) {
				localStorage.setItem('userPseudo', userData.pseudo);
				document.getElementById('user-name').textContent = userData.pseudo;
			}
		}
	} catch (error) {
		console.warn('Impossible de récupérer le profil utilisateur:', error);
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
		getSurveyDetails();
	});

	// Bouton de connexion
	document.getElementById('login-btn').addEventListener('click', () => {
		window.location.href = '/api/auth/google';
	});

	// Recherche
	document
		.getElementById('search-opinions')
		.addEventListener('input', filterOpinions);

	// Modaux - boutons de fermeture
	document.querySelectorAll('.close-modal').forEach((btn) => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.modal').forEach((modal) => {
				modal.classList.add('hidden');
				document.body.style.overflow = 'auto';
			});
			if (isHandlingLogout) {
				isHandlingLogout = false;
			}
		});
	});

	// LOGOUT MODAL BUTTONS
	document.getElementById('logout-cancel')?.addEventListener('click', () => {
		document.getElementById('logout-confirm-modal').classList.add('hidden');
		document.body.style.overflow = 'auto';
		isHandlingLogout = false;
	});

	document.getElementById('logout-ok')?.addEventListener('click', () => {
		handleLogout();
		document.getElementById('logout-confirm-modal').classList.add('hidden');
		document.body.style.overflow = 'auto';
		isHandlingLogout = false;
	});

	// Fermer les modaux en cliquant à l'extérieur
	document.querySelectorAll('.modal').forEach((modal) => {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('hidden');
				document.body.style.overflow = 'auto';
				if (modal.id === 'logout-confirm-modal') {
					isHandlingLogout = false;
				}
			}
		});
	});

	// Initialiser le menu utilisateur si connecté
	if (token) {
		initializeUserMenu();
	}

	// Gestion du redimensionnement de la fenêtre
	window.addEventListener('resize', handleWindowResize);

	// Gestion du défilement sur mobile
	window.addEventListener('scroll', handleWindowScroll);

	// Gestion du toucher sur mobile/tablette
	document.addEventListener('touchstart', handleTouchStart, { passive: true });
}

// =============================================================
// GESTION DU MENU UTILISATEUR (Responsive Design)
// =============================================================
function initializeUserMenu() {
	const userMenuDetails = document.querySelector('.user-menu-details');
	const userMenuSummary = document.querySelector('.user-menu-summary');
	const chevronIcon = document.querySelector('.chevron-icon');

	if (!userMenuDetails || !userMenuSummary) return;

	// Désactiver le comportement par défaut de <details> pour un meilleur contrôle
	userMenuDetails.addEventListener('toggle', (e) => {
		e.preventDefault();
	});

	// Gestion de l'ouverture/fermeture du menu
	userMenuSummary.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();

		toggleUserMenu();
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

			// Empêcher la fermeture du menu lors du clic sur déconnexion
			if (!isHandlingLogout) {
				isHandlingLogout = true;

				// Fermer le menu d'abord
				closeUserMenu();

				// Afficher la modal de confirmation après un petit délai
				setTimeout(() => {
					const modal = document.getElementById('logout-confirm-modal');
					if (modal) {
						modal.classList.remove('hidden');
						// Empêcher le défilement du body quand le modal est ouvert
						document.body.style.overflow = 'hidden';

						// Focus sur le bouton annuler pour faciliter la navigation
						setTimeout(() => {
							document.getElementById('logout-cancel')?.focus();
						}, 100);
					}
				}, 50);
			}
		});
	}

	// Gestion du clic en dehors du menu utilisateur pour le fermer
	document.removeEventListener('click', userMenuClickHandler);
	userMenuClickHandler = (e) => {
		const userMenu = document.querySelector('.user-menu-container');

		// Ne pas fermer le menu si nous sommes en train de gérer la déconnexion
		if (isHandlingLogout) return;

		if (userMenu && !userMenu.contains(e.target) && isUserMenuOpen) {
			closeUserMenu();
		}
	};
	document.addEventListener('click', userMenuClickHandler);

	// Gestion de la touche Escape pour fermer le menu
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && isUserMenuOpen) {
			closeUserMenu();
		}
		// Fermer la modal avec Escape
		if (
			e.key === 'Escape' &&
			!document
				.getElementById('logout-confirm-modal')
				.classList.contains('hidden')
		) {
			document.getElementById('logout-confirm-modal').classList.add('hidden');
			document.body.style.overflow = 'auto';
			isHandlingLogout = false;
		}
	});
}

// Fonctions pour gérer l'état du menu utilisateur
function toggleUserMenu() {
	const userMenuDetails = document.querySelector('.user-menu-details');

	if (isUserMenuOpen) {
		closeUserMenu();
	} else {
		openUserMenu();
	}
}

function openUserMenu() {
	const userMenuDetails = document.querySelector('.user-menu-details');
	if (!userMenuDetails) return;

	// Forcer l'ouverture du menu
	userMenuDetails.setAttribute('open', '');
	isUserMenuOpen = true;
	updateChevronIcon();

	// Ajouter une classe pour les styles spécifiques
	document.querySelector('.user-dropdown')?.classList.add('open');
}

function closeUserMenu() {
	const userMenuDetails = document.querySelector('.user-menu-details');
	if (!userMenuDetails) return;

	userMenuDetails.removeAttribute('open');
	isUserMenuOpen = false;
	updateChevronIcon();

	// Retirer la classe pour les styles spécifiques
	document.querySelector('.user-dropdown')?.classList.remove('open');
}

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
	// Fermer le menu utilisateur lors du changement de taille d'écran
	if (isUserMenuOpen && !isHandlingLogout) {
		closeUserMenu();
	}

	// Ajuster les styles spécifiques pour mobile/tablette
	const isMobile = window.innerWidth <= 768;
	const dropdown = document.querySelector('.user-dropdown');
	if (dropdown) {
		if (isMobile) {
			dropdown.style.position = 'fixed';
			dropdown.style.top = 'auto';
			dropdown.style.bottom = '0';
			dropdown.style.left = '0';
			dropdown.style.right = '0';
			dropdown.style.width = '100%';
			dropdown.style.maxWidth = '100%';
			dropdown.style.borderRadius = '12px 12px 0 0';
			dropdown.style.boxShadow = '0 -4px 20px rgba(0, 0, 0, 0.15)';
			dropdown.style.zIndex = '1002';
		} else {
			dropdown.style.position = 'absolute';
			dropdown.style.top = '100%';
			dropdown.style.bottom = 'auto';
			dropdown.style.left = 'auto';
			dropdown.style.right = '0';
			dropdown.style.width = '280px';
			dropdown.style.maxWidth = '280px';
			dropdown.style.borderRadius = '12px';
			dropdown.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.15)';
			dropdown.style.zIndex = '1000';
		}
	}
}

// Gestion du défilement sur mobile/tablette
function handleWindowScroll() {
	// Fermer le menu utilisateur lors du défilement sur mobile/tablette
	if (window.innerWidth <= 768 && isUserMenuOpen && !isHandlingLogout) {
		closeUserMenu();
	}
}

// Gestion du toucher sur mobile/tablette
function handleTouchStart(e) {
	// Fermer le menu si on touche en dehors sur mobile
	if (window.innerWidth <= 768 && isUserMenuOpen && !isHandlingLogout) {
		const userMenu = document.querySelector('.user-menu-container');
		const touchTarget = e.target;

		if (userMenu && !userMenu.contains(touchTarget)) {
			closeUserMenu();
		}
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

		// Gérer la déconnexion Google si l'utilisateur était connecté via Google
		if (typeof gapi !== 'undefined') {
			const auth2 = gapi.auth2.getAuthInstance();
			if (auth2) {
				auth2
					.signOut()
					.then(() => {
						console.log('User signed out from Google');
					})
					.catch((error) => {
						console.warn('Error signing out from Google:', error);
					});
			}
		}

		console.log('Déconnexion réussie, redirection vers browse-surveys.html');

		// Fermer le menu
		closeUserMenu();
		isHandlingLogout = false;

		// Rediriger vers la page de parcours des sondages
		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 300);
	} catch (error) {
		console.warn('Erreur lors de la déconnexion:', error);
		isHandlingLogout = false;
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

		const response = await fetch(`${CONFIG.api.endpoints.survey}/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (response.status === 401) {
			localStorage.removeItem('token');
			localStorage.removeItem('userPseudo');
			checkUserLoginState();
			showNotification('Session expirée, veuillez vous reconnecter', 'warning');
			setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
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

	const formattedCreated = createdAt.toLocaleDateString('fr-FR', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

	const formattedEnded =
		endedAt ?
			endedAt.toLocaleDateString('fr-FR', {
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
		const response = await fetch(
			`${CONFIG.api.endpoints.survey}/${id}${CONFIG.api.endpoints.detailedResults}`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const data = await response.json();

		const total = data.totalOpinions || 0;
		const yes = data.opinions?.filter((o) => o.answer).length || 0;
		const no = total - yes;

		// Mettre à jour les statistiques
		document.getElementById('total-votes').textContent = total;
		document.getElementById('votes-count').textContent = `${total} votes`;

		// Créer le graphique
		createChart(yes, no, total);

		// Mettre à jour le résumé
		updateResultsSummary(yes, no, total);

		// Afficher les opinions
		opinionsData = data.opinions || [];
		renderOpinions(opinionsData);

		filteredOpinions = [...opinionsData];
	} catch (err) {
		console.error('Erreur lors de la récupération des résultats:', err);
		showNotification('Erreur de chargement des résultats', 'error');
	}
}

// =============================================================
// Création du graphique
// =============================================================
function createChart(yes, no, total) {
	const ctx = document.getElementById('resultsChart').getContext('2d');

	if (chart) {
		chart.destroy();
	}

	chart = new Chart(ctx, {
		type: 'doughnut',
		data: {
			labels: ['Oui', 'Non'],
			datasets: [
				{
					data: [yes, no],
					backgroundColor: [CONFIG.colors.yes, CONFIG.colors.no],
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
	});

	// Mettre à jour la légende
	renderChartLegend(['Oui', 'Non'], [CONFIG.colors.yes, CONFIG.colors.no]);
}

// =============================================================
// Mise à jour du résumé
// =============================================================
function updateResultsSummary(yes, no, total) {
	const yesPercentage = total > 0 ? Math.round((yes / total) * 100) : 0;
	const noPercentage = total > 0 ? Math.round((no / total) * 100) : 0;

	document.querySelector('#yes-result .result-count').textContent = yes;
	document.querySelector('#yes-result .result-percentage').textContent =
		`${yesPercentage}%`;

	document.querySelector('#no-result .result-count').textContent = no;
	document.querySelector('#no-result .result-percentage').textContent =
		`${noPercentage}%`;
}

// =============================================================
// Affichage des opinions
// =============================================================
function renderOpinions(opinions) {
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
			// Vérifier si l'utilisateur a déjà réagi
			const userReaction = userReactions.get(opinion._id);
			const likeActive = userReaction === 'like' ? 'active' : '';
			const dislikeActive = userReaction === 'dislike' ? 'active' : '';

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
                    <div class="opinion-answer ${
											opinion.answer ? 'answer-yes' : 'answer-no'
										}">
                        ${opinion.answer ? 'Oui' : 'Non'}
                    </div>
                </div>
                
                <div class="opinion-content">
                    ${
											opinion.reason ||
											'<em style="color: #94a3b8; font-style: italic;">Aucun commentaire</em>'
										}
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

	if (!searchTerm) {
		filteredOpinions = [...opinionsData];
	} else {
		filteredOpinions = opinionsData.filter(
			(opinion) =>
				opinion.userPseudo?.toLowerCase().includes(searchTerm) ||
				opinion.reason?.toLowerCase().includes(searchTerm) ||
				(opinion.answer ? 'oui' : 'non').includes(searchTerm),
		);
	}

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
		const response = await fetch(
			`${CONFIG.api.endpoints.like}/${opinionId}/${type}`,
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
			setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
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
		console.error(`Erreur ${type}:`, err);
		showNotification(err.message || `Erreur lors du ${type}`, 'error');
	}
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
					type === 'error' ? CONFIG.colors.no
					: type === 'warning' ? '#f59e0b'
					: CONFIG.colors.yes
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

function renderChartLegend(labels, colors) {
	const legend = document.getElementById('chart-legend');
	legend.innerHTML = labels
		.map(
			(label, index) => `
        <div class="legend-item">
            <div class="legend-color" style="background: ${colors[index]}"></div>
            <span>${label}</span>
        </div>
    `,
		)
		.join('');
}

// Ajouter les animations CSS pour les notifications
const style = document.createElement('style');
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
