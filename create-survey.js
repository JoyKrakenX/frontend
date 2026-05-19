/** @format */
// =============================================================
// Configuration
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			createSurvey: '/api/survey',
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
let currentUser = null;
let isUserMenuOpen = false;
const BROWSE_SURVEYS_URL = 'browse-surveys.html';
const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';
const BINARY_OPTION_PRESETS = Object.freeze([
	{ preset: 'yes_no', yes: 'Oui', no: 'Non', label: 'Oui / Non' },
	{ preset: 'true_false', yes: 'Vrai', no: 'Faux', label: 'Vrai / Faux' },
	{ preset: 'for_against', yes: 'Pour', no: 'Contre', label: 'Pour / Contre' },
	{
		preset: 'agree_disagree',
		yes: 'D’accord',
		no: 'Pas d’accord',
		label: 'D’accord / Pas d’accord',
	},
	{
		preset: 'satisfied_unsatisfied',
		yes: 'Satisfait',
		no: 'Insatisfait',
		label: 'Satisfait / Insatisfait',
	},
	{
		preset: 'accept_refuse',
		yes: 'Accepter',
		no: 'Refuser',
		label: 'Accepter / Refuser',
	},
]);

let selectedBinaryOption = BINARY_OPTION_PRESETS[0];

function queueHeaderScrollState() {
	// Header behavior is managed by shared CSS/JS in production.
}

const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;

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

function extractValidationMessage(payload = {}) {
	const fieldErrors = payload?.errors?.fieldErrors;
	if (!fieldErrors || typeof fieldErrors !== 'object') return '';

	for (const [fieldName, messages] of Object.entries(fieldErrors)) {
		if (Array.isArray(messages) && messages.length) {
			return `${fieldName}: ${String(messages[0] || '').trim()}`;
		}
	}

	return '';
}

function getSelectedBinaryLabels() {
	return {
		yes: selectedBinaryOption.yes,
		no: selectedBinaryOption.no,
		preset: selectedBinaryOption.preset,
	};
}

function syncBinaryOptionUI() {
	const currentLabel = document.getElementById('binary-options-current');
	const modalLabel = document.getElementById('modal-binary-options');
	if (currentLabel) currentLabel.textContent = selectedBinaryOption.label;
	if (modalLabel) modalLabel.textContent = selectedBinaryOption.label;
	document.querySelectorAll('.binary-option-choice').forEach((button) => {
		button.classList.toggle(
			'is-selected',
			button.dataset.preset === selectedBinaryOption.preset,
		);
	});
}

function openBinaryOptionsModal() {
	const modal = document.getElementById('binary-options-modal');
	if (!modal) return;
	syncBinaryOptionUI();
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open(modal);
	} else {
		modal.classList.remove('hidden');
	}
}

function closeBinaryOptionsModal() {
	const modal = document.getElementById('binary-options-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close(modal);
	} else {
		modal.classList.add('hidden');
	}
}

function selectBinaryOptionFromButton(button) {
	if (!button) return;
	const nextOption = {
		preset: String(button.dataset.preset || 'yes_no').trim(),
		yes: String(button.dataset.yes || 'Oui').trim(),
		no: String(button.dataset.no || 'Non').trim(),
	};
	selectedBinaryOption =
		BINARY_OPTION_PRESETS.find((entry) => entry.preset === nextOption.preset) || {
			...nextOption,
			label: `${nextOption.yes} / ${nextOption.no}`,
		};
	syncBinaryOptionUI();
	updatePreview();
	closeBinaryOptionsModal();
}

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	if (!USE_SHARED_USER_MENU()) {
		checkUserLoginState();
	}
	initializeEventListeners();
	initializeApp();
	initializeFooter();
	setupRealTimePreview();
	syncBinaryOptionUI();
	queueHeaderScrollState();
});

// =============================================================
// Vérifier l'état de connexion de l'utilisateur
// =============================================================
function checkUserLoginState() {
	if (USE_SHARED_USER_MENU()) return;

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
			setHeaderPseudo(userPseudo);
		} else {
			// Si pas de pseudo, Récupérer depuis l'API
			fetchUserData(token).catch((error) => {
				if (error?.code === 'AUTH_REQUIRED') {
					redirectToBrowseSurveys(
						'Session expirée, veuillez vous reconnecter',
						'warning',
					);
					return;
				}
				console.error('Erreur auth create-survey:', error);
			});
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

	// Bouton Apperçu
	document
		.getElementById('preview-btn')
		?.addEventListener('click', togglePreview);

	document
		.getElementById('binary-options-btn')
		?.addEventListener('click', openBinaryOptionsModal);
	document
		.querySelectorAll('.binary-option-choice')
		.forEach((button) => {
			button.addEventListener('click', () => {
				selectBinaryOptionFromButton(button);
			});
		});
	document
		.getElementById('binary-options-cancel')
		?.addEventListener('click', closeBinaryOptionsModal);
	document
		.querySelectorAll('#binary-options-modal [data-modal-close]')
		.forEach((button) => {
			button.addEventListener('click', closeBinaryOptionsModal);
		});

	// Bouton actualiser
	document.getElementById('refresh-btn')?.addEventListener('click', () => {
		document.getElementById('survey-form').reset();
		selectedBinaryOption = BINARY_OPTION_PRESETS[0];
		syncBinaryOptionUI();
		const explainNo = document.getElementById('explain-no');
		if (explainNo) explainNo.checked = true;
		document.getElementById('preview-section').classList.add('hidden');
		document.getElementById('checkbox-data').checked = false;
		updatePreview();
		showNotification('Formulaire réinitialisé', 'info');
	});

	// Clear theme-specific error when the user edits the theme
	document.getElementById('survey-title').addEventListener('input', () => {
		clearThemeError();
	});

	// Bouton connexion
	const loginBtn = document.getElementById('login-btn');
	if (loginBtn && !USE_SHARED_USER_MENU()) {
		loginBtn.addEventListener('click', () => {
			window.redirectToGoogleAuth?.();
		});
	}

	// Bouton fermer Apperçu
	document.getElementById('close-preview')?.addEventListener('click', () => {
		document.getElementById('preview-section').classList.add('hidden');
		document.getElementById('checkbox-data').checked = false;
	});

	// Bouton Réinitialiser
	document.getElementById('reset-btn')?.addEventListener('click', resetForm);

	// Checkbox d'Apperçu
	document
		.getElementById('checkbox-data')
		.addEventListener('change', handleCheckboxChange);

	// Formulaire principal
	document
		.getElementById('survey-form')
		.addEventListener('submit', handleSubmit);

	// Modal de confirmation
	document.getElementById('modal-cancel').addEventListener('click', () => {
		closeConfirmModal();
	});

	document
		.querySelector('#confirm-modal .close-modal')
		?.addEventListener('click', closeConfirmModal);

	document
		.getElementById('modal-confirm')
		.addEventListener('click', confirmSurveyCreation);

	// Fermer les modaux en cliquant à l'extérieur
	document.getElementById('confirm-modal')?.addEventListener('click', (e) => {
		if (e.target === e.currentTarget) {
			closeConfirmModal();
		}
	});
	document.getElementById('binary-options-modal')?.addEventListener('click', (e) => {
		if (e.target === e.currentTarget) {
			closeBinaryOptionsModal();
		}
	});

	// Gestion du redimensionnement de la fenêtre (legacy menu uniquement)
	if (!USE_SHARED_USER_MENU()) {
		window.addEventListener('resize', handleWindowResize);
	}

	// Keep resize behavior for menu only; no local header hide/show controller.
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
		queueHeaderScrollState();
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
			queueHeaderScrollState();
		});
	}

	// LOGOUT MODAL BUTTONS
	document.getElementById('logout-cancel')?.addEventListener('click', () => {
		document.getElementById('logout-confirm-modal').classList.add('hidden');
		queueHeaderScrollState();
	});

	document.getElementById('logout-ok')?.addEventListener('click', () => {
		handleLogout();
		document.getElementById('logout-confirm-modal').classList.add('hidden');
		queueHeaderScrollState();
	});

	// Gestion du clic en dehors du menu utilisateur pour le fermer
	document.addEventListener('click', (e) => {
		const userMenu = document.querySelector('.user-menu-container');

		if (userMenu && !userMenu.contains(e.target) && isUserMenuOpen) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
			queueHeaderScrollState();
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
			queueHeaderScrollState();
		});
	}

	// Fermer la modal en cliquant à l'extérieur
	const logoutModal = document.getElementById('logout-confirm-modal');
	if (logoutModal) {
		logoutModal.addEventListener('click', (e) => {
			if (e.target === logoutModal) {
				logoutModal.classList.add('hidden');
				queueHeaderScrollState();
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
		clearLocalAuthStorage();

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
			window.location.href = BROWSE_SURVEYS_URL;
		}, 1500);
	} catch (error) {
		console.warn('Erreur lors de la déconnexion :', error);
		// Rediriger même en cas d'erreur
		window.location.href = BROWSE_SURVEYS_URL;
	}
}

function clearLocalAuthStorage() {
	localStorage.removeItem('token');
	localStorage.removeItem('jwt_token');
	localStorage.removeItem('userId');
	localStorage.removeItem('userPseudo');
}

function redirectToBrowseSurveys(message, type = 'warning', delayMs = 800) {
	void delayMs;
	if (message) {
		showNotification(message, type);
	}
	updateUserHeader(null);
	showLoading(false);
	const dashboard = document.querySelector('.dashboard-container');
	if (!dashboard) return;
	dashboard.classList.remove('hidden');
	window.SiteUI?.renderPageState?.({
		mount: dashboard,
		variant: type === 'error' ? 'error' : 'warning',
		icon: 'fa-user-lock',
		title: 'Connexion requise',
		message:
			String(message || '').trim() ||
			'Connectez-vous pour créer et publier un nouveau sondage.',
		actions: [
			{
				label: 'Se connecter',
				icon: 'fa-right-to-bracket',
				onClick: () => window.SiteApi?.beginGoogleAuth?.(),
			},
			{
				label: 'Parcourir les sondages',
				icon: 'fa-list',
				href: BROWSE_SURVEYS_URL,
				secondary: true,
			},
		],
	});
}

// =============================================================
// Initialisation de l'application
// =============================================================
async function initializeApp() {
	const token = localStorage.getItem('token');

	if (!token) {
		redirectToBrowseSurveys(
			'Veuillez vous connecter pour créer un sondage',
			'warning',
		);
		return;
	}

	try {
		showLoading(true);
		await fetchUserData(token);
		showLoading(false);
	} catch (error) {
		if (error?.code === 'AUTH_REQUIRED') {
			redirectToBrowseSurveys(
				'Session expirée, veuillez vous reconnecter',
				'warning',
			);
			return;
		}
		console.error("Erreur lors de l'initialisation:", error);
		showNotification('Erreur de chargement', 'error');
		showLoading(false);
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
			clearLocalAuthStorage();
			updateUserHeader(null);
			const authError = new Error('Session expirée');
			authError.code = 'AUTH_REQUIRED';
			throw authError;
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		const data = await response.json();
		currentUser = data;
		updateUserHeader(data);

		const resolvedPseudo = String(
			data.pseudo || localStorage.getItem('userPseudo') || data.username || '',
		).trim();
		setHeaderPseudo(resolvedPseudo || 'Utilisateur');
		if (resolvedPseudo) {
			localStorage.setItem('userPseudo', resolvedPseudo);
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

function updateUserHeader(userData) {
	void userData;
}

// =============================================================
// Gestion du formulaire
// =============================================================
function getSurveyData() {
	const explainValue = document.querySelector(
		'input[name="explain"]:checked',
	)?.value;
	const explain = explainValue !== 'false';

	return {
		theme: document.getElementById('survey-title').value.trim(),
		contexte: document.getElementById('contexte').value.trim(),
		question: document.getElementById('question').value.trim(),
		binaryLabels: getSelectedBinaryLabels(),
		explain,
	};
}

function setupRealTimePreview() {
	const inputs = ['survey-title', 'contexte', 'question'];

	inputs.forEach((inputId) => {
		const input = document.getElementById(inputId);
		if (input) input.addEventListener('input', updatePreview);
	});
}

function updatePreview() {
	const { theme, contexte, question } = getSurveyData();

	// Mettre à jour l'Apperçu dans la zone dédiée
	document.getElementById('preview-theme').textContent = theme || 'Non défini';
	document.getElementById('preview-contexte').textContent =
		contexte || 'Aucun contexte fourni';
	document.getElementById('preview-question').textContent =
		question || 'Non définie';

	// Mettre à jour l'Apperçu dans le modal
	document.getElementById('modal-theme').textContent = theme || 'Non défini';
	document.getElementById('modal-question').textContent =
		question || 'Non définie';
	syncBinaryOptionUI();
}

function handleCheckboxChange() {
	const checkbox = document.getElementById('checkbox-data');
	const previewSection = document.getElementById('preview-section');

	if (checkbox.checked) {
		previewSection.classList.remove('hidden');
		updatePreview();
	} else {
		previewSection.classList.add('hidden');
	}
}

function togglePreview() {
	const checkbox = document.getElementById('checkbox-data');
	const previewSection = document.getElementById('preview-section');

	if (previewSection.classList.contains('hidden')) {
		checkbox.checked = true;
		previewSection.classList.remove('hidden');
		updatePreview();
	} else {
		checkbox.checked = false;
		previewSection.classList.add('hidden');
	}
}

function resetForm() {
	if (confirm('Voulez-vous vraiment réinitialiser le formulaire ?')) {
		document.getElementById('survey-form').reset();
		selectedBinaryOption = BINARY_OPTION_PRESETS[0];
		syncBinaryOptionUI();
		document.getElementById('preview-section').classList.add('hidden');
		document.getElementById('checkbox-data').checked = false;
		updatePreview();
		showNotification('Formulaire réinitialisé', 'info');
	}
}

// =============================================================
// Soumission du formulaire
// =============================================================
async function handleSubmit(e) {
	e.preventDefault();
	// clear any previous theme-specific error
	clearThemeError();

	const token = localStorage.getItem('token');
	if (!token) {
		redirectToBrowseSurveys(
			'Veuillez vous connecter pour créer un sondage',
			'warning',
		);
		return;
	}

	const { theme, contexte, question } = getSurveyData();

	// Validation
	if (!theme || !question) {
		showNotification('Veuillez remplir le thème et la question', 'error');
		return;
	}

	if (theme.length < 3) {
		showNotification('Le thème doit contenir au moins 3 caractères', 'error');
		return;
	}

	if (question.length < 5) {
		showNotification(
			'La question doit contenir au moins 5 caractères',
			'error',
		);
		return;
	}

	// Afficher le modal de confirmation
	document.getElementById('modal-theme').textContent = theme;
	document.getElementById('modal-question').textContent = question;
	openConfirmModal();
}

function openConfirmModal() {
	const modal = document.getElementById('confirm-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open(modal);
	} else {
		modal.classList.remove('hidden');
	}
	queueHeaderScrollState();
}

function closeConfirmModal() {
	const modal = document.getElementById('confirm-modal');
	if (!modal) return;
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close(modal);
	} else {
		modal.classList.add('hidden');
	}
	queueHeaderScrollState();
}

async function confirmSurveyCreation() {
	const token = localStorage.getItem('token');
	const { theme, contexte, question, explain, binaryLabels } = getSurveyData();

	showLoading(true);
	closeConfirmModal();

	try {
		const response = await fetch(
			`${CONFIG.api.endpoints.createSurvey}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					theme,
					contexte,
					question,
					binaryLabels,
					explain,
				}),
			},
		);

		const result = await response.json().catch(() => ({}));

		if (!response.ok) {
			const validationMessage = extractValidationMessage(result);
			const errorMessage =
				validationMessage ||
				result.message ||
				'Erreur lors de la Création du sondage';
			if (String(errorMessage).toLowerCase().startsWith('theme:')) {
				setThemeError(errorMessage);
			}
			throw new Error(errorMessage);
		}

		showNotification('Sondage créé avec succès !', 'success');

		// Rediriger vers la page du QR code
		setTimeout(() => {
			const surveyId = result.surveyId || result._id;
			if (surveyId) {
				window.location.href = `qr-generator.html?surveyId=${surveyId}&type=binary`;
			} else {
				window.location.href = 'my-surveys.html';
			}
		}, 1500);
	} catch (error) {
		console.error('Erreur:', error);
		showNotification(
			error.message || 'Erreur réseau. Veuillez réessayer.',
			'error',
		);
		showLoading(false);
	}
}

// =============================================================
// Utilitaires d'interface
// =============================================================
function setThemeError(message) {
	let el = document.getElementById('theme-error');
	if (!el) {
		el = document.createElement('div');
		el.id = 'theme-error';
		el.className = 'field-error';
		const input = document.getElementById('survey-title');
		if (input && input.parentNode) input.parentNode.appendChild(el);
	}
	el.textContent = message;
}

function clearThemeError() {
	const el = document.getElementById('theme-error');
	if (el) el.remove();
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
