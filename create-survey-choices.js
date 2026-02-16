/** @format */
// =============================================================
// Configuration
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			createSurvey: '/api/survey_2',
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
let optionCount = 2;
const maxOptions = 6;
let isUserMenuOpen = false;

function queueHeaderScrollState() {
	// Header behavior is managed by shared CSS/JS in production.
}

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	checkUserLoginState();
	initializeEventListeners();
	initializeApp();
	setupRealTimePreview();
	initializeFooter();
	queueHeaderScrollState();
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
			// Si pas de pseudo, récupérer depuis l'API
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

	// Bouton aperçu
	document
		.getElementById('preview-btn')
		.addEventListener('click', togglePreview);

	// Bouton connexion
	document.getElementById('login-btn').addEventListener('click', () => {
		window.location.href = '/api/auth/google';
	});

	// Bouton actualiser
	document.getElementById('refresh-btn').addEventListener('click', () => {
		document.getElementById('survey-form').reset();
		const explainYes = document.getElementById('explain-multiple-yes');
		if (explainYes) explainYes.checked = true;
		document.getElementById('preview-section').classList.add('hidden');
		document.getElementById('checkbox-data').checked = false;
		updatePreview();
		showNotification('Formulaire réinitialisé', 'info');
	});

	// Bouton fermer aperçu
	document.getElementById('close-preview')?.addEventListener('click', () => {
		document.getElementById('preview-section').classList.add('hidden');
		document.getElementById('checkbox-data').checked = false;
	});

	// Bouton réinitialiser
	document.getElementById('reset-btn').addEventListener('click', resetForm);

	// Checkbox d'aperçu
	document
		.getElementById('checkbox-data')
		.addEventListener('change', handleCheckboxChange);

	// Formulaire principal
	document
		.getElementById('survey-form')
		.addEventListener('submit', handleSubmit);

	// Clear theme-specific error when the user edits the theme
	document.getElementById('survey-title').addEventListener('input', () => {
		clearThemeError();
	});

	// Modaux
	document.querySelectorAll('.close-modal').forEach((btn) => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.modal').forEach((modal) => {
				modal.classList.add('hidden');
			});
			queueHeaderScrollState();
		});
	});

	// Modal de confirmation
	document.getElementById('modal-cancel').addEventListener('click', () => {
		document.getElementById('confirm-modal').classList.add('hidden');
		queueHeaderScrollState();
	});

	document
		.getElementById('modal-confirm')
		.addEventListener('click', confirmSurveyCreation);

	// Fermer les modaux en cliquant à l'extérieur
	document.querySelectorAll('.modal').forEach((modal) => {
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('hidden');
				queueHeaderScrollState();
			}
		});
	});

	// Gestion du redimensionnement de la fenêtre
	window.addEventListener('resize', handleWindowResize);

	// Keep resize behavior for menu only; no local header hide/show controller.
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
// Initialisation de l'application
// =============================================================
async function initializeApp() {
	const token = localStorage.getItem('token');

	if (!token) {
		showNotification(
			'Veuillez vous connecter pour créer un sondage',
			'warning',
		);
		updateUserHeader(null);
		document.getElementById('loading').classList.add('hidden');
		return;
	}

	try {
		showLoading(true);
		await fetchUserData(token);
		showLoading(false);
	} catch (error) {
		console.error("Erreur lors de l'initialisation:", error);
		showNotification('Erreur de chargement', 'error');
		showLoading(false);
	}
}

// =============================================================
// Récupération des données utilisateur
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
			updateUserHeader(null);
			throw new Error('Session expirée');
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
	const userNameElement = document.getElementById('user-name');
	if (userNameElement) {
		userNameElement.textContent = resolvedPseudo || 'Utilisateur';
	}
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

	const data = {
		theme: document.getElementById('survey-title').value.trim(),
		contexte: document.getElementById('contexte').value.trim(),
		question: document.getElementById('question').value.trim(),
		explain,
	};

	// Récupérer toutes les options
	for (let i = 1; i <= optionCount; i++) {
		const input = document.getElementById(`reponse-${i}`);
		if (input) {
			data[`reponse_${i}`] = input.value.trim();
		}
	}

	return data;
}

function getOptionsArray() {
	const options = [];
	for (let i = 1; i <= optionCount; i++) {
		const input = document.getElementById(`reponse-${i}`);
		if (input && input.value.trim()) {
			options.push(input.value.trim());
		}
	}
	return options;
}

function setupRealTimePreview() {
	// Écouteurs pour les champs de base
	['survey-title', 'contexte', 'question'].forEach((inputId) => {
		const input = document.getElementById(inputId);
		input.addEventListener('input', updatePreview);
	});

	// Écouteurs pour les options existantes
	for (let i = 1; i <= optionCount; i++) {
		const input = document.getElementById(`reponse-${i}`);
		if (input) {
			input.addEventListener('input', updatePreview);
		}
	}
}

function updatePreview() {
	const { theme, contexte, question } = getSurveyData();
	const options = getOptionsArray();

	// Mettre à jour l'aperçu dans la zone dédiée
	document.getElementById('preview-theme').textContent = theme || 'Non défini';
	document.getElementById('preview-contexte').textContent =
		contexte || 'Aucun contexte fourni';
	document.getElementById('preview-question').textContent =
		question || 'Non définie';

	// Mettre à jour les options dans l'aperçu
	const previewOptions = document.getElementById('preview-options');
	if (previewOptions) {
		previewOptions.innerHTML = options
			.map(
				(option) =>
					`<div class="preview-option-item">${option || 'Option vide'}</div>`,
			)
			.join('');
	}

	// Mettre à jour l'aperçu dans le modal
	document.getElementById('modal-theme').textContent = theme || 'Non défini';
	document.getElementById('modal-question').textContent =
		question || 'Non définie';
	document.getElementById('modal-options-count').textContent = `${
		options.length
	} option${options.length > 1 ? 's' : ''}`;
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

		// Réinitialiser les options à 2 seulement
		while (optionCount > 2) {
			const optionToRemove = document.getElementById(`option-${optionCount}`);
			if (optionToRemove) {
				optionToRemove.remove();
				optionCount--;
			}
		}

		updateOptionsCounter();
		updateRemoveButtonState();
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
		showNotification(
			'Veuillez vous connecter pour créer un sondage',
			'warning',
		);
		window.location.href = 'browse-surveys.html';
		return;
	}

	const { theme, contexte, question } = getSurveyData();
	const options = getOptionsArray();

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

	if (options.length < 2) {
		showNotification('Au moins 2 options sont requises', 'error');
		return;
	}

	for (let i = 0; i < options.length; i++) {
		if (!options[i] || options[i].length < 1) {
			showNotification(`L'option ${i + 1} est vide`, 'error');
			return;
		}
	}

	// Afficher le modal de confirmation
	document.getElementById('modal-theme').textContent = theme;
	document.getElementById('modal-question').textContent = question;
	document.getElementById('modal-options-count').textContent = `${
		options.length
	} option${options.length > 1 ? 's' : ''}`;
	document.getElementById('confirm-modal').classList.remove('hidden');
	queueHeaderScrollState();
}

async function confirmSurveyCreation() {
	const token = localStorage.getItem('token');
	const { theme, contexte, question, explain } = getSurveyData();
	const options = getOptionsArray();

	// Construire l'objet de données pour l'API
	const surveyData = {
		theme,
		contexte: contexte || '',
		question,
		explain,
	};

	// Ajouter chaque option
	options.forEach((option, index) => {
		surveyData[`reponse_${index + 1}`] = option;
	});

	showLoading(true);
	document.getElementById('confirm-modal').classList.add('hidden');
	queueHeaderScrollState();

	try {
		const response = await fetch(
			`${CONFIG.api.endpoints.createSurvey}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(surveyData),
			},
		);

		let result = null;
		const cloned = response.clone();
		try {
			result = await response.json();
		} catch (e) {
			// Try to get raw text for debugging
			try {
				const text = await cloned.text();
				result = { __raw: text };
			} catch (e2) {
				result = null;
			}
		}

		if (!response.ok) {
			console.error(
				'create-survey-choices: server error',
				response.status,
				response.statusText,
				result,
			);

			// Raw textual response handling
			if (result && result.__raw) {
				const text = String(result.__raw || '').trim();
				console.error('create-survey-choices: server returned raw body:', text);
				if (/th[eè]me/i.test(text)) {
					setThemeError('Un sondage avec ce thème existe déjà.');
					showNotification('Un sondage avec ce thème existe déjà.', 'error');
					showLoading(false);
					return;
				}

				// Show raw text as notification if non-empty
				if (text) {
					showNotification(text, 'error');
					showLoading(false);
					return;
				}
			}

			// Inline theme conflict (structured JSON)
			if (result && result.message && /th[eè]me/i.test(result.message)) {
				const msg = result.message || 'Un sondage avec ce thème existe déjà.';
				setThemeError(msg);
				showNotification(msg, 'error');
				showLoading(false);
				return;
			}

			// Mongoose-style validation errors
			if (result && result.errors && typeof result.errors === 'object') {
				const firstErr = Object.values(result.errors)[0];
				const msg = (firstErr && firstErr.message) || JSON.stringify(result);
				showNotification(msg, 'error');
				showLoading(false);
				return;
			}

			// Generic message if available
			if (result && result.message) {
				showNotification(result.message, 'error');
			} else {
				showNotification(
					`${response.status} ${response.statusText || 'Erreur'}`,
					'error',
				);
			}
			showLoading(false);
			return;
		}

		// Hide loading and show success notification
		showLoading(false);
		showNotification('Sondage à choix multiples créé avec succès !', 'success');

		// Rediriger vers la page du QR code
		setTimeout(() => {
			const surveyId = (result && (result.surveyId || result._id)) || null;
			if (surveyId) {
				window.location.href = `qr-generator.html?surveyId=${surveyId}&type=multiple`;
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
	const input = document.getElementById('survey-title');
	if (!el) {
		el = document.createElement('div');
		el.id = 'theme-error';
		el.className = 'field-error';
		el.setAttribute('aria-live', 'polite');
		if (input && input.parentNode) input.parentNode.appendChild(el);
	}
	el.textContent = message;
	// focus and make sure user can see the error
	if (input) {
		try {
			input.focus({ preventScroll: true });
			input.scrollIntoView({ behavior: 'smooth', block: 'center' });
		} catch (e) {
			// ignore if environment doesn't support options
			input.focus();
		}
	}
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
	notification.setAttribute('role', 'alert');
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
        animation: slideIn 0.3s ease;
    `;

	// Append the notification to the document so it's visible
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
