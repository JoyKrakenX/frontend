/** @format */
// =============================================================
// Configuration
// =============================================================
const CONFIG = {
	api: {
		endpoints: {
			survey: '/api/survey',
			answer: '/survey/answer',
		},
	},
	colors: {
		primary: '#6366f1',
		success: '#10b981',
		danger: '#ef4444',
		warning: '#f59e0b',
		yes: '#10b981',
		no: '#ef4444',
	},
};

// =============================================================
// Variables globales
// =============================================================
let currentSurvey = null;
let selectedOpinion = null;
let isSubmitting = false;
let isUserMenuOpen = false;

// =============================================================
// Lecture paramètres URL
// =============================================================
const params = new URLSearchParams(window.location.search);
const surveyId = params.get('id');

if (!surveyId) {
	showNotification('Sondage invalide.', 'error');
	setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
}

// =============================================================
// vérification token
// =============================================================
const token = localStorage.getItem('token');

if (!token) {
	showNotification(
		'Veuillez vous connecter pour participer à ce sondage.',
		'warning',
	);
	setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
}

// =============================================================
// Initialisation
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
	initializeEventListeners();
	initializeUserMenu();
	getSurveyDetails();
	initializeFooter();
});

// =============================================================
// Gestionnaires d'événements
// =============================================================
function initializeEventListeners() {
	// Bouton retour
	document.getElementById('back-btn').addEventListener('click', () => {
		window.history.back();
	});

	// Bouton Résultats
	document.getElementById('results-btn').addEventListener('click', () => {
		if (currentSurvey && currentSurvey.isClosed) {
			window.location.href = `survey-results.html?id=${surveyId}`;
		} else {
			showNotification(
				'Les Résultats seront disponibles une fois le sondage clôturé.',
				'info',
			);
		}
	});

	// Bouton partager
	document.getElementById('share-btn').addEventListener('click', () => {
		document.getElementById('share-modal').classList.remove('hidden');
	});

	// Bouton discussion (redirige vers le chat du sondage)
	document.getElementById('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=binary`;
	});
	// Bouton discussion dans la section sondage clos
	document.getElementById('chat-btn-closed')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=binary`;
	});

	// Bouton voir Résultats (sondage clos)
	document
		.getElementById('view-results-closed')
		?.addEventListener('click', () => {
			window.location.href = `survey-results.html?id=${surveyId}`;
		});

	// Bouton autres sondages
	document.getElementById('browse-other')?.addEventListener('click', () => {
		window.location.href = 'browse-surveys.html';
	});

	// Options de réponse
	document
		.getElementById('yes-button')
		.addEventListener('change', handleOpinionSelection);
	document
		.getElementById('no-button')
		.addEventListener('change', handleOpinionSelection);

	// Annuler choix
	document
		.getElementById('cancel-choice')
		?.addEventListener('click', cancelChoice);

	// Soumission
	document
		.getElementById('submit-opinion')
		?.addEventListener('click', submitFinalAnswer);

	// Suivi du texte
	document
		.getElementById('opinion-text')
		?.addEventListener('input', updateCharCount);

	// Modaux
	document.querySelectorAll('.close-modal').forEach((btn) => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.modal').forEach((modal) => {
				modal.classList.add('hidden');
			});
		});
	});

	// Modal de confirmation
	document.getElementById('modal-cancel')?.addEventListener('click', () => {
		document.getElementById('confirm-modal').classList.add('hidden');
	});

	document
		.getElementById('modal-confirm')
		?.addEventListener('click', confirmChoice);

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

	// Gestion du clic en dehors du menu utilisateur pour le fermer
	document.addEventListener('click', (e) => {
		const userMenu = document.querySelector('.user-menu-container');
		const userMenuDetails = document.querySelector('.user-menu-details');

		if (userMenu && !userMenu.contains(e.target) && isUserMenuOpen) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	});

	// Fermer le menu utilisateur lors du défilement sur mobile
	window.addEventListener('scroll', () => {
		const userMenuDetails = document.querySelector('.user-menu-details');
		if (window.innerWidth <= 768 && userMenuDetails?.hasAttribute('open')) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	});

	// Gestion du redimensionnement de la fenêtre
	window.addEventListener('resize', () => {
		// Fermer le menu utilisateur lors du changement d'orientation ou de taille
		const userMenuDetails = document.querySelector('.user-menu-details');
		if (userMenuDetails?.hasAttribute('open')) {
			userMenuDetails.removeAttribute('open');
			isUserMenuOpen = false;
			updateChevronIcon();
		}
	});
}

// =============================================================
// Gestion du menu utilisateur
// =============================================================
function initializeUserMenu() {
	// Mettre à jour le pseudo au chargement
	updateUserPseudo();

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

	// Optionnel: Vérifier périodiquement les changements de localStorage
	// (utile si l'utilisateur se connecte/déconnecte dans un autre onglet)
	window.addEventListener('storage', function (e) {
		if (e.key === 'userPseudo' || e.key === 'token') {
			updateUserPseudo();
		}
	});
}

// =============================================================
// Fonctions utilitaires pour le menu utilisateur
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


function updateUserPseudo() {
	const userNameElement = document.getElementById('user-name');
	if (!userNameElement) return;

	// 1. Essayer d'obtenir le pseudo du localStorage
	const userPseudo = localStorage.getItem('userPseudo');

	// 2. Si pas de pseudo, Vérifier si un token existe
	const token = localStorage.getItem('token');

	if (userPseudo) {
		// Utiliser le pseudo du localStorage
		userNameElement.textContent = userPseudo;
	} else if (token) {
		// L'utilisateur a un token mais pas de pseudo - utiliser une valeur par défaut
		userNameElement.textContent = 'Utilisateur';
	}
	// Si pas de token ni de pseudo, le texte reste "Utilisateur" (défaut HTML)
}

function handleLogout() {
	try {
		// Nettoyer le stockage local
		localStorage.removeItem('token');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');

		console.log('Déconnexion réussie, redirection vers browse-surveys.html');

		// Rediriger vers la page de parcours des sondages
		window.location.href = 'browse-surveys.html';
	} catch (error) {
		console.warn('Erreur lors de la DECONNEXION:', error);
		// Rediriger même en cas d'erreur
		window.location.href = 'browse-surveys.html';
	}
}

// =============================================================
// récupération des details du sondage
// =============================================================
async function getSurveyDetails() {
	try {
		showLoading(true);

		const response = await fetch(`${CONFIG.api.endpoints.survey}/${surveyId}`, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (response.status === 401) {
			localStorage.removeItem('token');
			showNotification('Session expirée, veuillez vous reconnecter', 'warning');
			setTimeout(() => (window.location.href = 'browse-surveys.html'), 2000);
			return;
		}

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status}`);
		}

		currentSurvey = await response.json();
		displaySurvey(currentSurvey);
		await loadVotesCount();
		showLoading(false);
	} catch (error) {
		console.error('Erreur:', error);
		showNotification(
			error.message || 'Erreur lors du chargement du sondage',
			'error',
		);
		showLoading(false);
	}
}

// =============================================================
// Affichage du sondage
// =============================================================
function displaySurvey(survey) {
	// Mettre à jour les informations générales
	document.getElementById('survey-theme').textContent = survey.theme;
	document.getElementById('survey-question').textContent = survey.question;
	document.getElementById('survey-contexte').innerHTML = `<p>${
		survey.contexte || 'Aucun contexte fourni.'
	}</p>`;

	// Mettre à jour la date
	if (survey.createdAt) {
		const createdDate = new Date(survey.createdAt);
		document.getElementById('survey-date').textContent =
			createdDate.toLocaleDateString('fr-FR', {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
			});
	}

	// Mettre à jour le statut
	const statusBadge = document.getElementById('status-badge');
	const surveyStatus = document.getElementById('survey-status');

	if (survey.isClosed) {
		statusBadge.className = 'status-badge closed';
		statusBadge.innerHTML = '<i class="fas fa-circle"></i> Sondage clôturé';
		surveyStatus.textContent = 'Sondage clôturé - Vote fermé';

		// Afficher la section sondage clos
		document.getElementById('closed-survey-section').classList.remove('hidden');
		document.getElementById('response-section').classList.add('hidden');

		// désactiver le bouton Résultats
		document.getElementById('results-btn').disabled = false;
	} else {
		statusBadge.className = 'status-badge open';
		statusBadge.innerHTML = '<i class="fas fa-circle"></i> Sondage ouvert';
		surveyStatus.textContent = 'Sondage ouvert - Vote en cours';

		// Afficher la section réponse
		document.getElementById('response-section').classList.remove('hidden');
		document.getElementById('closed-survey-section').classList.add('hidden');

		// désactiver ou activer le bouton Résultats selon le statut
		document.getElementById('results-btn').disabled = false;
	}

	// Initial fallback count from survey payload.
	updateVotesCount(Number(survey.totalVotes || survey.totalOpinions || 0));

	// Afficher le dashboard
	document.querySelector('.dashboard-container').classList.remove('hidden');
}

// =============================================================
// Gestion de la sélection d'opinion
// =============================================================

async function loadVotesCount() {
	try {
		const response = await fetch(
			`${CONFIG.api.endpoints.survey}/${surveyId}/detailed-results`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		);

		if (!response.ok) return;
		const payload = await response.json();
		const totalOpinions = Number(payload?.totalOpinions || 0);
		updateVotesCount(totalOpinions);
	} catch (_error) {
		// Keep fallback count from survey payload.
	}
}

function handleOpinionSelection(event) {
	const choice = event.target.value;
	const isYes = choice === 'true';

	// Mettre à jour l'aperçu dans le modal
	const modalIcon = document.getElementById('modal-choice-icon');
	const modalTitle = document.getElementById('modal-choice-title');
	const modalDesc = document.getElementById('modal-choice-desc');

	if (isYes) {
		modalIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
		modalIcon.style.background =
			'linear-gradient(135deg, var(--yes-color), #059669)';
		modalTitle.textContent = 'Oui';
		modalDesc.textContent = "Vous êtes d'accord / favorable";
	} else {
		modalIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
		modalIcon.style.background =
			'linear-gradient(135deg, var(--no-color), #dc2626)';
		modalTitle.textContent = 'Non';
		modalDesc.textContent = "Vous n'êtes pas d'accord / défavorable";
	}

	// Stocker le choix temporaire
	selectedOpinion = choice;

	// Afficher le modal de confirmation
	document.getElementById('confirm-modal').classList.remove('hidden');
}

// =============================================================
// Confirmation du choix
// =============================================================
function confirmChoice() {
	document.getElementById('confirm-modal').classList.add('hidden');

	// Masquer les options
	document.querySelector('.response-options').classList.add('hidden');

	// Afficher la section raison
	document.getElementById('reason-section').classList.remove('hidden');

	// Focus sur le textarea
	setTimeout(() => {
		document.getElementById('opinion-text').focus();
	}, 300);

	showNotification(
		'Choix enregistré, vous pouvez maintenant expliquer votre décision',
		'success',
	);
}

// =============================================================
// Annulation du choix
// =============================================================
function cancelChoice() {
	// Réinitialiser les sélections
	document.getElementById('yes-button').checked = false;
	document.getElementById('no-button').checked = false;
	selectedOpinion = null;

	// Réafficher les options
	document.querySelector('.response-options').classList.remove('hidden');

	// Masquer la section raison
	document.getElementById('reason-section').classList.add('hidden');

	// Réinitialiser le textarea
	document.getElementById('opinion-text').value = '';
	updateCharCount();

	showNotification('Vous pouvez modifier votre choix', 'info');
}

// =============================================================
// Mise à jour du compteur de caractères
// =============================================================
function updateCharCount() {
	const textarea = document.getElementById('opinion-text');
	const charCount = document.getElementById('char-count');
	const submitBtn = document.getElementById('submit-opinion');

	const length = textarea.value.length;
	charCount.textContent = `${length}/500 caractères`;

	// Mettre en évidence si trop long
	if (length > 500) {
		charCount.style.color = CONFIG.colors.danger;
		submitBtn.disabled = true;
	} else if (length > 0) {
		charCount.style.color = CONFIG.colors.success;
		submitBtn.disabled = false;
	} else {
		charCount.style.color = 'var(--text-secondary)';
		submitBtn.disabled = true;
	}
}

// =============================================================
// Soumission finale
// =============================================================
async function submitFinalAnswer() {
	if (isSubmitting) return;

	const reason = document.getElementById('opinion-text').value.trim();
	const submitBtn = document.getElementById('submit-opinion');

	if (!selectedOpinion) {
		showNotification("Veuillez d'abord sélectionner une opinion", 'error');
		return;
	}

	if (reason.length > 500) {
		showNotification(
			'Votre explication ne doit pas dépasser 500 caractères',
			'error',
		);
		return;
	}

	isSubmitting = true;
	submitBtn.disabled = true;
	submitBtn.innerHTML =
		'<i class="fas fa-spinner fa-spin"></i> Envoi en cours...';

	try {
		const answerBoolean = selectedOpinion === 'true';

		const response = await fetch(
			`${CONFIG.api.endpoints.survey}/${surveyId}/answer`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					answer: answerBoolean,
					reason: reason || undefined,
				}),
			},
		);

		const result = await response.json();

		if (!response.ok) {
			if (response.status === 403) {
				throw new Error(
					result.message || 'Vous avez déjà répondu à ce sondage',
				);
			}
			throw new Error(result.message || 'Erreur lors de la soumission');
		}

		showNotification(
			'Votre réponse a CTA enregistrée avec succès !',
			'success',
		);

		// Redirection après succès
		setTimeout(() => {
			window.location.href = 'browse-surveys.html';
		}, 2000);
	} catch (error) {
		console.error('Erreur soumission:', error);
		showNotification(
			error.message || 'Erreur réseau. Veuillez Réessayer.',
			'error',
		);

		// Réactiver le bouton
		submitBtn.disabled = false;
		submitBtn.innerHTML =
			'<i class="fas fa-paper-plane"></i> Soumettre ma réponse';
		isSubmitting = false;
	}
}

// =============================================================
// Partage sur les plateformes
// =============================================================
function shareOnPlatform(platform) {
	const surveyLink = window.location.href;
	const surveyTitle = currentSurvey?.theme || 'Sondage intéressant';

	let shareUrl = '';

	switch (platform) {
		case 'whatsapp':
			shareUrl = `https://wa.me/?text=${encodeURIComponent(
				`${surveyTitle}\n${surveyLink}`,
			)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'facebook':
			shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
				surveyLink,
			)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'twitter':
			shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(
				`${surveyTitle}\n${surveyLink}`,
			)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'copy':
			navigator.clipboard
				.writeText(surveyLink)
				.then(() => {
					showNotification('Lien copie dans le presse-papier', 'success');
				})
				.catch(() => {
					// Fallback pour anciens navigateurs
					const input = document.createElement('input');
					input.value = surveyLink;
					document.body.appendChild(input);
					input.select();
					document.execCommand('copy');
					document.body.removeChild(input);
					showNotification('Lien copie dans le presse-papier', 'success');
				});
			break;
	}

	document.getElementById('share-modal').classList.add('hidden');
}

// =============================================================
// Mise à jour du compteur de votes
// =============================================================
function updateVotesCount(count) {
	document.getElementById('votes-count').innerHTML =
		`<i class="fas fa-users"></i> ${count} vote${count !== 1 ? 's' : ''}`;
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
const style = document.createElement('style');
style.textContent = `
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

