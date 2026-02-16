/** @format */
// =============================================================
// Configuration
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			generateQR: '/api/qrcode/generate',
			getSurvey: '/api/survey',
			getSurveyMultiple: '/api/survey_2',
			authMe: '/api/auth/me',
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
let currentSurvey = null;
let qrData = null;
let isLoaded = false;
let isUserMenuOpen = false;
const FRONTEND_BASE_URL = `${window.location.origin}/frontend`;

function isFlashSurvey() {
	return currentSurvey?.explain === false;
}

function resolveSurveyPage(type, { results = false } = {}) {
	const flash = isFlashSurvey();
	if (flash) {
		return type === 'binary' ?
				'survey-flash-binary.html'
			:	'survey-flash-multiple.html';
	}

	if (results) {
		return type === 'binary' ? 'survey-results.html' : 'survey-choices-results.html';
	}

	return type === 'binary' ? 'survey.html' : 'survey-choices.html';
}

function buildSurveyUrl(surveyId, type, { results = false } = {}) {
	if (!surveyId || !type) return '';
	const targetPage = resolveSurveyPage(type, { results });
	return `${FRONTEND_BASE_URL}/${targetPage}?id=${encodeURIComponent(surveyId)}&type=${encodeURIComponent(type)}`;
}

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	checkUserLoginState();
	initializeEventListeners();
	initializeFooter();
	loadQR();
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
			// Si pas de pseudo, Récupérer depuis l'API
			fetchUserData(token);
		}

		// Initialiser le menu utilisateur
		initializeUserMenu();
	} else {
		// Utilisateur non connecté
		userMenu.classList.add('hidden');
		loginBtn.classList.remove('hidden');
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

	// Bouton partager
	document.getElementById('share-btn').addEventListener('click', () => {
		document.getElementById('share-modal').classList.remove('hidden');
		updateShareLink();
	});

	// Bouton connexion
	document.getElementById('login-btn').addEventListener('click', () => {
		window.location.href = '/api/auth/google';
	});

	// Bouton actualiser
	document.getElementById('refresh-btn').addEventListener('click', () => {
		loadQR(true);
	});

	// Bouton Régénérer QR
	document.getElementById('new-qr-btn').addEventListener('click', () => {
		loadQR(true);
	});

	// Bouton télécharger
	document
		.getElementById('download-btn')
		.addEventListener('click', downloadQRCode);

	// Bouton copier lien
	document
		.getElementById('copy-link-btn')
		.addEventListener('click', copySurveyLink);

	// Bouton copier lien partage
	document
		.getElementById('copy-share-link')
		.addEventListener('click', copyShareLink);

	// Bouton voir Résultats
	document.getElementById('view-results-btn').addEventListener('click', () => {
		const params = new URLSearchParams(window.location.search);
		const surveyId = params.get('surveyId');
		const type = params.get('type');
		const targetUrl = buildSurveyUrl(surveyId, type, { results: true });
		if (!targetUrl) {
			showNotification('Lien de résultats indisponible', 'error');
			return;
		}
		window.location.href = targetUrl;
	});

	// Bouton tester sondage
	document.getElementById('test-survey-btn').addEventListener('click', () => {
		const params = new URLSearchParams(window.location.search);
		const surveyId = params.get('surveyId');
		const type = params.get('type');
		const targetUrl = buildSurveyUrl(surveyId, type);
		if (!targetUrl) {
			showNotification('Lien de test indisponible', 'error');
			return;
		}
		window.location.href = targetUrl;
	});

	// Bouton tableau de bord
	document
		.getElementById('manage-surveys-btn')
		.addEventListener('click', () => {
			window.location.href = 'my-surveys.html';
		});

	// Modaux
	document.querySelectorAll('.close-modal').forEach((btn) => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.modal').forEach((modal) => {
				modal.classList.add('hidden');
			});
		});
	});

	// Options de partage
	document.querySelectorAll('.share-option').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			const platform = e.currentTarget.dataset.platform;
			shareOnPlatform(platform);
		});
	});

	// Fermer les modaux en cliquant à l'extérieur
	document.querySelectorAll('.modal').forEach((modal) => {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('hidden');
			}
		});
	});

	// Écouter les changements dans l'input de lien
	document.getElementById('survey-link').addEventListener('click', function () {
		this.select();
	});

	document
		.getElementById('share-link-input')
		.addEventListener('click', function () {
			this.select();
		});

	// Gestion du redimensionnement de la fenêtre
	window.addEventListener('resize', handleWindowResize);

	// Gestion du défilement sur mobile
	window.addEventListener('scroll', handleWindowScroll);
}

// =============================================================
// GESTION DU MENU UTILISATEUR (Responsive Design)
// =============================================================
function initializeUserMenu() {
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
				.classList.remove('hidden');
		});
	}

	// LOGOUT MODAL BUTTONS
	document.getElementById('logout-cancel').addEventListener('click', () => {
		document.getElementById('logout-confirm-modal').classList.add('hidden');
	});

	document.getElementById('logout-ok').addEventListener('click', () => {
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

	// Initialiser les événements de la modal de DÉCONNEXION
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
		console.warn('Erreur lors de la DÉCONNEXION:', error);
		// Rediriger même en cas d'erreur
		window.location.href = 'browse-surveys.html';
	}
}

// =============================================================
// récupération des données utilisateur
// =============================================================
async function fetchUserData(token) {
	try {
		const response = await fetch(
			`${CONFIG.api.endpoints.authMe}`,
			{
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
			},
		);

		if (response.status === 401) {
			localStorage.removeItem('token');
			showNotification('Session expirée, veuillez vous reconnecter', 'warning');
			checkUserLoginState();
			throw new Error('Session expirée');
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const data = await response.json();

		// Mettre à jour le nom d'utilisateur dans le menu
		if (data.username || data.email) {
			const userName = data.username || data.email.split('@')[0];
			document.getElementById('user-name').textContent = userName;
			localStorage.setItem('userPseudo', userName);
		}

		return data;
	} catch (error) {
		console.error(
			'Erreur lors de la récupération des données utilisateur:',
			error,
		);
		throw error;
	}
}

// =============================================================
// Chargement du QR Code
// =============================================================
async function loadQR(forceRefresh = false) {
	// Empêcher le rechargement multiple
	if (isLoaded && !forceRefresh) return;
	isLoaded = true;

	const params = new URLSearchParams(window.location.search);
	const surveyId = params.get('surveyId');
	const type = params.get('type');

	if (!surveyId || !type) {
		showError("paramètres manquants dans l'URL");
		return;
	}

	showLoading(true);

	try {
		// Récupérer les informations du sondage
		await fetchSurveyInfo(surveyId, type);

		// Générer le QR Code
		await generateQRCode(surveyId, type);

		// Mettre à jour l'interface
		updateUI(surveyId, type);

		showLoading(false);
	} catch (error) {
		console.error('Erreur:', error);
		showError('Erreur lors du chargement du QR Code');
		showLoading(false);
		isLoaded = false; // Permettre une nouvelle tentative
	}
}

// =============================================================
// récupération des informations du sondage
// =============================================================
async function fetchSurveyInfo(surveyId, type) {
	try {
		const endpoint =
			type === 'binary' ?
				`${CONFIG.api.endpoints.getSurvey}/${surveyId}`
			:	`${CONFIG.api.endpoints.getSurveyMultiple}/${surveyId}`;

		const token = localStorage.getItem('token');

		const response = await fetch(`${endpoint}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		currentSurvey = await response.json();

		// Mettre à jour les informations dans l'interface
		document.getElementById('survey-info').textContent =
			currentSurvey.theme || 'Sondage sans titre';

		if (currentSurvey.createdAt) {
			const createdDate = new Date(currentSurvey.createdAt);
			document.getElementById('survey-date-display').textContent =
				createdDate.toLocaleDateString('fr-FR', {
					day: 'numeric',
					month: 'long',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
				});
		}

		document.getElementById('survey-id-display').textContent = surveyId;

		const typeDisplay =
			type === 'binary' ?
				isFlashSurvey() ? 'Binaire (Flash)'
				:	'Binaire (Oui/Non)'
			:	isFlashSurvey() ? 'Choix multiples (Flash)'
			:	'Choix multiples';
		document.getElementById('survey-type-display').textContent = typeDisplay;
	} catch (error) {
		console.error(
			'Erreur lors de la récupération des informations du sondage:',
			error,
		);
		// Continuer même si les infos du sondage ne sont pas disponibles
	}
}

// =============================================================
// Génération du QR Code
// =============================================================
async function generateQRCode(surveyId, type) {
	try {
		const response = await fetch(
			`${CONFIG.api.endpoints.generateQR}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ surveyId, type }),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Erreur serveur: ${response.status} - ${errorText}`);
		}

		qrData = await response.json();

		if (!qrData.qrPath) {
			throw new Error('Aucun chemin QR reçu du serveur');
		}

		const qrURL = `${qrData.qrPath}`;

		// Ajouter un timestamp pour éviter le cache
		const timestamp = new Date().getTime();
		const qrURLWithCache = `${qrURL}${qrURL.includes('?') ? '&' : '?'}t=${timestamp}`;

		// Mettre à jour l'image du QR Code
		const qrImg = document.getElementById('qrcode-img');

		qrImg.onload = function () {
			console.log('QR Code charge avec succès');
			// Animation d'apparition
			qrImg.style.animation = 'fadeIn 0.5s ease';
		};

		qrImg.onerror = function () {
			console.error("Erreur de chargement de l'image QR");
			showError("Impossible de charger l'image QR");
		};

		qrImg.src = qrURLWithCache;
		qrImg.alt = `QR Code pour le sondage ${surveyId}`;

		// Mettre à jour le lien direct
		const surveyLink = buildSurveyUrl(surveyId, type);
		document.getElementById('survey-link').value = surveyLink;
		document.getElementById('share-link-input').value = surveyLink;
	} catch (error) {
		console.error('Erreur lors de la Génération du QR Code:', error);
		throw error;
	}
}

// =============================================================
// Mise à jour de l'interface
// =============================================================
function updateUI(surveyId, type) {
	// Afficher les boutons
	document.getElementById('download-btn').style.display = 'flex';
	document.getElementById('new-qr-btn').style.display = 'flex';

	// Afficher la section principale
	document.querySelector('.dashboard-container').classList.remove('hidden');

	// Afficher une notification de succès
	showNotification('QR Code généré avec succès !', 'success');
}

// =============================================================
// téléchargement du QR Code
// =============================================================
function downloadQRCode() {
	if (!qrData || !qrData.qrPath) {
		showNotification('QR Code non disponible', 'error');
		return;
	}

	try {
		const params = new URLSearchParams(window.location.search);
		const surveyId = params.get('surveyId');
		const type = params.get('type');

		const qrURL = `${qrData.qrPath}`;
		const a = document.createElement('a');
		a.href = qrURL;
		a.download = `sondage-${surveyId}-${type}-qr.png`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);

		showNotification('QR Code tételecharge avec succès', 'success');

		// Redirection optionnelle après téléchargement
		setTimeout(() => {
			// window.location.href = 'my-surveys.html';
		}, 100);
	} catch (error) {
		console.error('Erreur lors du téléchargement:', error);
		showNotification('Erreur lors du téléchargement', 'error');
	}
}

// =============================================================
// Copie du lien
// =============================================================
function copySurveyLink() {
	const linkInput = document.getElementById('survey-link');
	linkInput.select();

	try {
		navigator.clipboard
			.writeText(linkInput.value)
			.then(() => {
				showNotification('Lien copie dans le presse-papier', 'success');
			})
			.catch((err) => {
				// Fallback pour les anciens navigateurs
				document.execCommand('copy');
				showNotification('Lien copie dans le presse-papier', 'success');
			});
	} catch (error) {
		console.error('Erreur lors de la copie:', error);
		showNotification('Erreur lors de la copie', 'error');
	}
}

function copyShareLink() {
	const linkInput = document.getElementById('share-link-input');
	linkInput.select();

	try {
		navigator.clipboard
			.writeText(linkInput.value)
			.then(() => {
				showNotification('Lien copie dans le presse-papier', 'success');
			})
			.catch((err) => {
				document.execCommand('copy');
				showNotification('Lien copie dans le presse-papier', 'success');
			});
	} catch (error) {
		console.error('Erreur lors de la copie:', error);
		showNotification('Erreur lors de la copie', 'error');
	}
}

function updateShareLink() {
	const params = new URLSearchParams(window.location.search);
	const surveyId = params.get('surveyId');
	const type = params.get('type');
	const surveyLink = buildSurveyUrl(surveyId, type);
	document.getElementById('share-link-input').value = surveyLink;
}

// =============================================================
// Partage sur les plateformes
// =============================================================
function shareOnPlatform(platform) {
	const params = new URLSearchParams(window.location.search);
	const surveyId = params.get('surveyId');
	const type = params.get('type');
	const surveyLink = buildSurveyUrl(surveyId, type);
	if (!surveyLink) {
		showNotification('Lien de partage indisponible', 'error');
		return;
	}
	const surveyTitle = currentSurvey?.theme || 'Mon sondage';
	const surveyQuestion = currentSurvey?.question || 'Participez à mon sondage';

	let shareUrl = '';

	switch (platform) {
		case 'whatsapp':
			shareUrl = `https://wa.me/?text=${encodeURIComponent(
				`${surveyTitle} - ${surveyQuestion}\n${surveyLink}`,
			)}`;
			break;
		case 'facebook':
			shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
				surveyLink,
			)}`;
			break;
		case 'twitter':
			shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
				`${surveyTitle}\n${surveyLink}`,
			)}`;
			break;
		case 'email':
			shareUrl = `mailto:?subject=${encodeURIComponent(
				surveyTitle,
			)}&body=${encodeURIComponent(
				`${surveyQuestion}\n\nParticipez ici : ${surveyLink}`,
			)}`;
			break;
		default:
			return;
	}

	window.open(shareUrl, '_blank');
	document.getElementById('share-modal').classList.add('hidden');
	showNotification(`Partage sur ${platform} lancé`, 'info');
}

// =============================================================
// Utilitaires d'interface
// =============================================================
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

function showError(message) {
	const qrContainer = document.getElementById('qrcode-container');
	qrContainer.innerHTML = `
        <div class="error-state">
            <i class="fas fa-exclamation-triangle"></i>
            <p>${message}</p>
            <button onclick="loadQR(true)" class="btn-primary">
                <i class="fas fa-redo"></i> Réessayer
            </button>
        </div>
    `;
	showNotification(message, 'error');
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
	notification.innerHTML = `
        <i class="fas fa-${
					type === 'error' ? 'exclamation-circle'
					: type === 'warning' ? 'exclamation-triangle'
					: type === 'success' ? 'check-circle'
					: 'info-circle'
				}"></i>
        <span>${message}</span>
    `;

	document.body.appendChild(notification);

	// Supprimer après 5 secondes
	setTimeout(() => {
		notification.style.animation = 'slideOut 0.3s ease';
		setTimeout(() => notification.remove(), 300);
	}, 5000);
}

// Ajouter les animations CSS pour les notifications
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

// Ajouter l'animation fadeIn pour le QR Code
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
    }
    
    .error-state {
        text-align: center;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }
    
    .error-state i {
        font-size: 3rem;
        color: var(--danger-color);
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
		es: 'Español',
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
