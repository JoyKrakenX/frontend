/** @format */

const CONFIG = {
	api: {
		survey: '/api/survey_2',
		state: '/api/survey_2',
		detailedResults: '/api/survey_2',
		reaction: '/api/opinion_2',
	},
};

const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
const params = new URLSearchParams(window.location.search);
const surveyId = params.get('id');
const token = localStorage.getItem('token');

let currentSurvey = null;
let selectedChoice = null;
let isSubmitting = false;
let hasParticipated = false;
let canVote = false;
let canViewResults = false;
let privateMessage = '';
let opinionsData = [];
let filteredOpinions = [];
let userReactions = new Map();
let optionKeys = [];
let labelsMap = {};
const getFraudHelper = () => window.FraudChallengeHelper || null;
let socket = null;
let classicRoomJoined = false;
let socketDependencyWarned = false;

const LEGACY_OPTION_KEYS = [
	'reponse_1',
	'reponse_2',
	'reponse_3',
	'reponse_4',
	'reponse_5',
	'reponse_6',
];

const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';

function getLiveResultsGateMessage() {
	return (
		privateMessage ||
		t(
			'shared.surveys.vote_required_for_live_results',
			'Votez pour accéder aux résultats en temps réel.',
		)
	);
}

function isOpinionCommentVisible(opinion) {
	return (
		!opinion?.commentModeration?.isDeleted &&
		Boolean(String(opinion?.reason || '').trim())
	);
}

function hasLiveResultsAccess() {
	return Boolean(canViewResults);
}

function isCommentRequired() {
	return currentSurvey?.explain !== false;
}

function logDependencyIssue(code, context = {}) {
	console.warn(`[${code}]`, {
		page: 'survey-choices',
		surveyId,
		...context,
	});
}

async function ensureRuntimeDependencies() {
	if (typeof window.ensureDependencies !== 'function') return;

	try {
		const depsOk = await window.ensureDependencies([
			{
				name: 'socket',
				test: () => typeof window.io === 'function',
				localSrc: '/socket.io/socket.io.js',
				timeoutMs: 2500,
			},
		]);

		if (!depsOk.socket) {
			logDependencyIssue('DEPENDENCY_SOCKET_MISSING');
			socketDependencyWarned = true;
		}
	} catch (error) {
		console.error('dependency check failed:', error);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void bootstrapSurveyChoicesPage();
});

async function bootstrapSurveyChoicesPage() {
	if (!surveyId) {
		showNotification('Sondage invalide.', 'error');
		redirectToBrowse();
		return;
	}

	if (!token) {
		showNotification(
			t('shared.auth.login_required_for_survey', 'Veuillez vous connecter pour participer.'),
			'warning',
		);
		redirectToBrowse();
		return;
	}

	bindEvents();
	await ensureRuntimeDependencies();
	loadSurveyState();
}

document.addEventListener('site:language-changed', () => {
	if (!surveyId || !token) return;
	loadSurveyState();
});

function bindEvents() {
	document.getElementById('back-btn')?.addEventListener('click', () => {
		window.history.back();
	});

	document.getElementById('results-btn')?.addEventListener('click', async () => {
		await handleResultsShortcut();
	});
	document
		.getElementById('view-results-closed')
		?.addEventListener('click', async () => {
			await handleResultsShortcut();
		});

	document.getElementById('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=multiple`;
	});
	document.getElementById('chat-btn-closed')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=multiple`;
	});

	document.getElementById('share-btn')?.addEventListener('click', () => {
		document.getElementById('share-modal')?.classList.remove('hidden');
	});

	document.getElementById('browse-other')?.addEventListener('click', () => {
		window.location.href = 'browse-surveys.html';
	});

	document.getElementById('cancel-choice')?.addEventListener('click', cancelChoice);
	document
		.getElementById('submit-opinion')
		?.addEventListener('click', submitFinalAnswer);
	document.getElementById('opinion-text')?.addEventListener('input', updateCharCount);

	document.getElementById('modal-cancel')?.addEventListener('click', () => {
		document.getElementById('confirm-modal')?.classList.add('hidden');
	});
	document.getElementById('modal-confirm')?.addEventListener('click', confirmChoice);

	document.querySelectorAll('.close-modal').forEach((btn) => {
		btn.addEventListener('click', () => {
			if (USE_SHARED_USER_MENU() && btn.closest('#logout-confirm-modal')) return;
			document.querySelectorAll('.modal').forEach((modal) => {
				modal.classList.add('hidden');
			});
		});
	});

	document.querySelectorAll('.modal').forEach((modal) => {
		modal.addEventListener('click', (event) => {
			if (event.target !== modal) return;
			if (USE_SHARED_USER_MENU() && modal.id === 'logout-confirm-modal') return;
			modal.classList.add('hidden');
		});
	});

	document.querySelectorAll('.share-option').forEach((btn) => {
		btn.addEventListener('click', (event) => {
			shareOnPlatform(event.currentTarget.dataset.platform);
		});
	});

	document
		.getElementById('live-search-opinions')
		?.addEventListener('input', filterOpinions);
	document
		.getElementById('live-filter-answer')
		?.addEventListener('change', filterOpinions);

	document
		.getElementById('live-opinions-list')
		?.addEventListener('click', async (event) => {
			const reactionBtn = event.target.closest('[data-reaction]');
			if (!reactionBtn) return;

			const opinionId = reactionBtn.dataset.opinionId;
			const reaction = reactionBtn.dataset.reaction;
			if (!opinionId || !reaction) return;
			await handleReaction(opinionId, reaction);
		});

	window.addEventListener('beforeunload', () => {
		leaveClassicRoom();
	});
}

async function loadSurveyState() {
	try {
		showLoading(true);
		const payload = await apiRequest(
			`${CONFIG.api.state}/${encodeURIComponent(surveyId)}/state`,
		);

		currentSurvey = payload?.survey || null;
		hasParticipated = Boolean(payload?.hasParticipated);
		canVote = Boolean(payload?.canVote);
		canViewResults = Boolean(payload?.canViewResults);
		privateMessage = String(payload?.message || '').trim();

		if (!currentSurvey) {
			throw new Error('Sondage introuvable.');
		}

		renderSurvey(currentSurvey);
		applyAccessState();
		ensureClassicSocket();

		if (hasLiveResultsAccess()) {
			await loadDetailedResults({ animate: false });
		} else if (!canVote) {
			showPrivateNote(getLiveResultsGateMessage());
		}

		showLoading(false);
	} catch (error) {
		console.error('survey choices state load failed:', error);
		showLoading(false);
		showNotification(error.message || 'Erreur de chargement.', 'error');
	}
}

function renderSurvey(survey) {
	document.getElementById('survey-theme').textContent = survey.theme || '';
	document.getElementById('survey-question').textContent = survey.question || '';
	renderSurveyContext(survey.contexte);
	updateQuestionCardVisibility();

	if (survey.createdAt) {
		const createdDate = new Date(survey.createdAt);
		document.getElementById('survey-date').textContent =
			createdDate.toLocaleDateString(getIntlLocale(), {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
			});
	}

	const statusBadge = document.getElementById('status-badge');
	const surveyStatus = document.getElementById('survey-status');
	if (survey.isClosed) {
		statusBadge.className = 'status-badge closed';
		statusBadge.innerHTML =
			'<i class="fas fa-circle"></i> ' +
			t('shared.surveys.status_closed', 'Sondage clôturé');
		surveyStatus.textContent = t(
			'shared.surveys.status_closed_detail',
			'Sondage clôturé - vote ferme',
		);
	} else {
		statusBadge.className = 'status-badge open';
		statusBadge.innerHTML =
			'<i class="fas fa-circle"></i> ' +
			t('shared.surveys.status_open', 'Sondage ouvert');
		surveyStatus.textContent = t(
			'shared.surveys.status_open_detail',
			'Sondage ouvert - vote en cours',
		);
	}

	updateVotesCount(Number(survey.totalVotes || survey.totalOpinions || 0));
	prepareSurveyOptions(survey);
	document.querySelector('.dashboard-container')?.classList.remove('hidden');
}

function renderSurveyContext(rawContext) {
	const contextNode = document.getElementById('survey-contexte');
	if (!contextNode) return;

	const context = String(rawContext || '').trim();
	if (context) {
		contextNode.innerHTML = `<p>${escapeHtml(context)}</p>`;
		contextNode.classList.remove('is-empty');
		return;
	}

	contextNode.innerHTML = `<p>${escapeHtml(
		t('shared.surveys.no_context_provided', 'Aucun contexte fourni'),
	)}</p>`;
	contextNode.classList.add('is-empty');
}

function updateQuestionCardVisibility() {
	const questionCard =
		document.getElementById('question-card') ||
		document.querySelector('.question-card');
	const shouldHide = Boolean(hasParticipated);
	if (questionCard) {
		questionCard.classList.toggle('is-hidden-after-vote', shouldHide);
		questionCard.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
	}
	updateShareResultsVisibility();
}

function updateShareResultsVisibility() {
	const row = document.getElementById('share-results-row');
	if (!row) return;
	row.classList.toggle('hidden', !hasParticipated);
}

function prepareSurveyOptions(survey) {
	const optionsArray = Array.isArray(survey?.options) ? survey.options : [];
	const incomingKeys = Array.isArray(survey?.optionKeys) ? [...survey.optionKeys] : [];
	const fallbackKeys = LEGACY_OPTION_KEYS.filter((key) =>
		String(survey?.[key] || '').trim(),
	);

	optionKeys =
		incomingKeys.length ?
			sortOptionKeys(incomingKeys)
		: optionsArray.length ?
			optionsArray.map((_, index) => `reponse_${index + 1}`)
		: 	sortOptionKeys(fallbackKeys);

	labelsMap = {};
	optionKeys.forEach((key, index) => {
		const label =
			survey?.labels?.[key] ||
			optionsArray[index] ||
			survey?.[key] ||
			`Option ${index + 1}`;
		labelsMap[key] = String(label);
	});

	generateResponseOptions();
	updateLiveFilterOptions();
}

function sortOptionKeys(keys = []) {
	return [...keys].sort((left, right) => parseOptionKeyIndex(left) - parseOptionKeyIndex(right));
}

function parseOptionKeyIndex(key) {
	const match = String(key || '').match(/^reponse_(\d+)$/);
	if (!match) return 0;
	return Number(match[1] || 0);
}

function generateResponseOptions() {
	const container = document.getElementById('response-options');
	if (!container) return;
	container.innerHTML = '';

	optionKeys.forEach((key, index) => {
		const optionId = `option-${index + 1}`;
		const card = document.createElement('div');
		card.className = 'option-card-multiple';
		card.innerHTML = `
			<input type="radio" id="${optionId}" name="choice" value="${key}" class="option-radio" />
			<label for="${optionId}" class="option-label-multiple">
				<div class="option-content-multiple">
					<h4>${String.fromCharCode(65 + index)}. ${escapeHtml(
						labelsMap[key] || `Option ${index + 1}`,
					)}</h4>
					<p>${escapeHtml(labelsMap[key] || '')}</p>
				</div>
				<div class="option-selector-multiple"><div class="selector-circle-multiple"></div></div>
			</label>
		`;
		card
			.querySelector('input')
			?.addEventListener('change', handleChoiceSelection);
		container.appendChild(card);
	});
}

function applyAccessState() {
	const responseSection = document.getElementById('response-section');
	const closedSection = document.getElementById('closed-survey-section');
	updateQuestionCardVisibility();

	if (canVote) {
		responseSection?.classList.remove('hidden');
		closedSection?.classList.add('hidden');
		hidePrivateNote();
		if (hasLiveResultsAccess()) {
			joinClassicRoom();
		} else {
			hideLiveResults();
			leaveClassicRoom();
		}
		return;
	}

	responseSection?.classList.add('hidden');
	if (hasLiveResultsAccess()) {
		closedSection?.classList.add('hidden');
		hidePrivateNote();
		joinClassicRoom();
		return;
	}

	closedSection?.classList.remove('hidden');
	hideLiveResults();
	leaveClassicRoom();
	showPrivateNote(getLiveResultsGateMessage());
}

async function handleResultsShortcut() {
	if (!hasLiveResultsAccess()) {
		showNotification(getLiveResultsGateMessage(), 'info');
		return;
	}

	if (!document.getElementById('live-results-section')?.classList.contains('hidden')) {
		scrollToLiveResults();
		return;
	}

	await loadDetailedResults({ animate: true });
	if (hasLiveResultsAccess()) {
		scrollToLiveResults();
	}
}

function handleChoiceSelection(event) {
	const choice = event.target.value;
	const choiceLabel = labelsMap[choice] || choice;

	const modalIcon = document.getElementById('modal-choice-icon');
	const modalTitle = document.getElementById('modal-choice-title');
	const modalDesc = document.getElementById('modal-choice-desc');

	modalIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
	modalIcon.style.background =
		'linear-gradient(135deg, rgba(99, 102, 241, 0.85), rgba(14, 165, 233, 0.85))';
	modalTitle.textContent = choiceLabel;
	modalDesc.textContent = t('shared.surveys.multiple_choice_confirmation', 'Confirmez cette option');

	selectedChoice = choice;
	document.getElementById('confirm-modal').classList.remove('hidden');
	updateCharCount();
}

function confirmChoice() {
	document.getElementById('confirm-modal').classList.add('hidden');
	document.querySelector('.response-options-multiple')?.classList.add('hidden');
	document.getElementById('reason-section')?.classList.remove('hidden');
	setTimeout(() => {
		document.getElementById('opinion-text')?.focus();
	}, 200);
	updateCharCount();
}

function cancelChoice() {
	document.querySelectorAll('input[name="choice"]').forEach((input) => {
		input.checked = false;
	});
	selectedChoice = null;
	document.querySelector('.response-options-multiple')?.classList.remove('hidden');
	document.getElementById('reason-section')?.classList.add('hidden');
	document.getElementById('opinion-text').value = '';
	updateCharCount();
}

function updateCharCount() {
	const textarea = document.getElementById('opinion-text');
	const charCount = document.getElementById('char-count');
	const submitBtn = document.getElementById('submit-opinion');
	if (!textarea || !charCount || !submitBtn) return;

	const length = textarea.value.length;
	charCount.textContent = `${length}/500 caracteres`;

	if (length > 500) {
		charCount.style.color = '#ef4444';
		submitBtn.disabled = true;
		return;
	}

	if (!selectedChoice || (isCommentRequired() && length === 0)) {
		charCount.style.color = 'var(--text-secondary)';
		submitBtn.disabled = true;
		return;
	}

	charCount.style.color = '#10b981';
	submitBtn.disabled = false;
}

async function submitFinalAnswer(attempt = 0, turnstileTokenOverride = null) {
	if (isSubmitting) return;

	const reason = String(document.getElementById('opinion-text')?.value || '').trim();
	const submitBtn = document.getElementById('submit-opinion');

	if (!selectedChoice) {
		showNotification(
			t('shared.surveys.select_choice_first', "Veuillez d'abord sélectionner une option."),
			'error',
		);
		return;
	}

	if (isCommentRequired() && !reason) {
		showNotification(
			t('shared.surveys.reason_required', 'La justification est obligatoire.'),
			'warning',
		);
		return;
	}

	if (reason.length > 500) {
		showNotification(
			t(
				'shared.surveys.reason_too_long',
				'Votre justification ne doit pas depasser 500 caracteres.',
			),
			'error',
		);
		return;
	}

	isSubmitting = true;
	submitBtn.disabled = true;
	submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

	try {
		const bodyPayload = {
			choice: selectedChoice,
			reason,
			locale: window.SiteI18n?.getLanguage?.() || 'fr',
		};
		const deviceIntegrity =
			await window.CommunityDeviceIntegrity?.getDeviceIntegrityPayload?.({
				surveyId,
				surveyType: 'multiple',
			});
		if (deviceIntegrity) {
			bodyPayload.deviceIntegrity = deviceIntegrity;
		}
		if (turnstileTokenOverride) {
			bodyPayload.turnstileToken = turnstileTokenOverride;
		}
		const payload = await apiRequest(
			`${CONFIG.api.survey}/${encodeURIComponent(surveyId)}/answer`,
			{
				method: 'POST',
				body: JSON.stringify(bodyPayload),
			},
		);
		const voteStatus = String(payload?.voteStatus || 'accepted').trim().toLowerCase();
		const commentModerationState = String(
			payload?.commentModeration?.state || 'visible',
		)
			.trim()
			.toLowerCase();

		hasParticipated = Boolean(payload?.hasParticipated ?? true);
		canVote = Boolean(payload?.canVote ?? false);
		canViewResults = Boolean(payload?.canViewResults ?? true);
		privateMessage = '';

		if (voteStatus === 'quarantined' && commentModerationState === 'auto_hidden') {
			showNotification(
				t(
					'shared.surveys.vote_quarantined_and_comment_hidden',
					'Votre vote a ete enregistre et place en quarantaine. Votre commentaire a aussi ete masque automatiquement pour moderation.',
				),
				'warning',
			);
		} else if (voteStatus === 'quarantined') {
			showNotification(
				'Vote reçu et placé en quarantaine. Il est enregistré, mais n’apparaîtra pas dans les résultats propres avant revue.',
				'warning',
			);
		} else if (commentModerationState === 'auto_hidden') {
			showNotification(
				t(
					'shared.surveys.comment_auto_hidden',
					'Votre vote a ete enregistre, mais votre commentaire a ete masque automatiquement car il peut contenir un contenu a risque.',
				),
				'warning',
			);
		} else {
			showNotification(
				t('shared.surveys.vote_saved', 'Votre réponse a été enregistrée avec succès !'),
				'success',
			);
		}

		applyAccessState();
		await loadDetailedResults({ animate: true });
		if (hasLiveResultsAccess()) {
			ensureClassicSocket();
			scrollToLiveResults();
		}
	} catch (error) {
		const errorCode = String(error?.payload?.code || '').trim();
		if (
			['DEVICE_VOTE_ALREADY_USED', 'DEVICE_MACHINE_ALREADY_USED', 'DEVICE_VPN_BLOCKED', 'DEVICE_INTEGRITY_REQUIRED'].includes(errorCode)
		) {
			const key =
				errorCode === 'DEVICE_VOTE_ALREADY_USED' ? 'shared.surveys.device_vote_already_used'
				: errorCode === 'DEVICE_MACHINE_ALREADY_USED' ? 'shared.surveys.device_machine_already_used'
				: errorCode === 'DEVICE_VPN_BLOCKED' ? 'shared.surveys.device_vpn_blocked'
				: 'shared.surveys.device_integrity_required';
			showNotification(t(key, error.message || 'Vote non enregistré.'), 'warning');
			submitBtn.disabled = false;
			submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Soumettre ma réponse';
			isSubmitting = false;
			return;
		}
		if (error?.statusCode === 428) {
			const fraudHelper = getFraudHelper();
			const challengeCode = String(error?.payload?.code || '').trim();
			const challengePayload = error?.payload?.challenge || null;

			if (challengeCode === 'TURNSTILE_REQUIRED') {
				const turnstileToken = await fraudHelper?.requestTurnstileToken?.({
					challenge: challengePayload,
					notify: showNotification,
				});
				if (turnstileToken && attempt < 2) {
					submitBtn.disabled = false;
					submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Soumettre ma réponse';
					isSubmitting = false;
					return submitFinalAnswer(attempt + 1, turnstileToken);
				}
			}

			if (challengeCode === 'EMAIL_OTP_REQUIRED') {
				const resolved = await fraudHelper?.resolveEmailOtpChallenge?.({
					request: apiRequest,
					contextType: 'vote',
					surveyType: 'multiple',
					surveyId,
					notify: showNotification,
				});
				if (resolved && attempt < 2) {
					submitBtn.disabled = false;
					submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Soumettre ma réponse';
					isSubmitting = false;
					return submitFinalAnswer(attempt + 1, null);
				}
			}

			showNotification(error.message || 'Verification supplementaire requise.', 'warning');
			submitBtn.disabled = false;
			submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Soumettre ma réponse';
			isSubmitting = false;
			return;
		}
		showNotification(error.message || 'Erreur reseau.', 'error');
		submitBtn.disabled = false;
		submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Soumettre ma réponse';
		isSubmitting = false;
	}
}

async function loadDetailedResults({ animate = false } = {}) {
	if (!hasLiveResultsAccess()) {
		hideLiveResults();
		showPrivateNote(getLiveResultsGateMessage());
		return;
	}

	try {
		const data = await apiRequest(
			`${CONFIG.api.detailedResults}/${encodeURIComponent(surveyId)}/detailed-results`,
		);

		hasParticipated = Boolean(data?.hasParticipated ?? hasParticipated);
		canVote = Boolean(data?.canVote ?? canVote);
		canViewResults = Boolean(data?.canViewResults ?? canViewResults);
		privateMessage = String(data?.message || privateMessage || '').trim();
		updateQuestionCardVisibility();

		if (!hasLiveResultsAccess()) {
			hideLiveResults();
			showPrivateNote(getLiveResultsGateMessage());
			return;
		}

		optionKeys = Array.isArray(data?.optionKeys) ? [...data.optionKeys] : optionKeys;
		labelsMap = { ...(data?.labels || labelsMap) };
		updateLiveFilterOptions();

		if (currentSurvey && data?.isClosed !== undefined) {
			currentSurvey.isClosed = Boolean(data.isClosed);
			renderSurvey(currentSurvey);
		}

		applyCountsFromPayload(data);
		opinionsData = sortOpinionsWithPinned(
			(Array.isArray(data?.opinions) ? data.opinions : []).filter(
				isOpinionCommentVisible,
			),
		);
		filteredOpinions = [...opinionsData];
		renderOpinions(filteredOpinions);
		showLiveResults(animate);
		hidePrivateNote();
	} catch (error) {
		if (error?.statusCode === 403) {
			canViewResults = false;
			privateMessage = String(error.message || '').trim();
			leaveClassicRoom();
			applyAccessState();
			showPrivateNote(getLiveResultsGateMessage());
			hideLiveResults();
			return;
		}
		showNotification(error.message || 'Impossible de charger les resultats.', 'error');
	}
}

function applyCountsFromPayload(payload) {
	const counts = payload?.counts || {};
	const total = Number(payload?.totalOpinions || 0);
	updateVotesCount(total);

	const items = optionKeys.map((key, index) => ({
		key,
		label: labelsMap[key] || `Option ${index + 1}`,
		value: Number(counts?.[key] || 0),
	}));
	renderOverlayResultCard(items, total);
}

function renderOverlayResultCard(items, total) {
	const host = document.getElementById('live-overlay-result-card');
	if (!host) return;

	let card = host.querySelector('.overlay-card.results');
	if (!card) {
		host.innerHTML = `
			<div class="overlay-card results">
				<span class="overlay-eyebrow"><i class="fas fa-tower-broadcast"></i> ${escapeHtml(
					t('survey_choices.overlay_type', 'Sondage multiple'),
				)}</span>
				<h2 class="overlay-title"></h2>
				<p class="overlay-subtitle" data-overlay-question></p>
				<div class="overlay-result-bars"></div>
				<p class="overlay-subtitle" data-overlay-summary></p>
			</div>
		`;
		card = host.querySelector('.overlay-card.results');
	}

	const safeTotal = Number(total || 0);
	card.querySelector('.overlay-title').textContent = currentSurvey?.theme || 'Sondage';
	card.querySelector('[data-overlay-question]').textContent =
		currentSurvey?.question || t('shared.surveys.question_unavailable', 'Question indisponible');
	card.querySelector('[data-overlay-summary]').textContent =
		`${formatVoteCount(safeTotal)} · ${getSurveyStateLabel()}`;
	renderOverlayBars(card.querySelector('.overlay-result-bars'), items, safeTotal);
}

function renderOverlayBars(container, items, total) {
	if (!container) return;
	const nextKeys = new Set(items.map((item) => String(item.key)));
	container.querySelectorAll('[data-result-key]').forEach((row) => {
		if (!nextKeys.has(row.getAttribute('data-result-key'))) row.remove();
	});

	items.forEach((item) => {
		const key = String(item.key);
		const value = Number(item.value || 0);
		const pct = total > 0 ? Math.round((value / total) * 100) : 0;
		let row = container.querySelector(`[data-result-key="${cssEscape(key)}"]`);
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
		row.querySelector('.overlay-result-label').textContent = item.label;
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

function formatVoteCount(total) {
	return `${total} vote${total > 1 ? 's' : ''}`;
}

function getSurveyStateLabel() {
	return currentSurvey?.isClosed ?
			t('shared.surveys.status_closed', 'Sondage clôturé')
		:	t('shared.surveys.status_open', 'Sondage ouvert');
}

function cssEscape(value) {
	if (window.CSS?.escape) return window.CSS.escape(value);
	return String(value).replace(/["\\]/g, '\\$&');
}

function updateLiveFilterOptions() {
	const select = document.getElementById('live-filter-answer');
	if (!select) return;
	const previous = String(select.value || 'all');
	select.innerHTML =
		'<option value="all">Toutes les reponses</option>' +
		optionKeys
			.map((key, index) => {
				const label = labelsMap[key] || `Option ${index + 1}`;
				return `<option value="${key}">${escapeHtml(label)}</option>`;
			})
			.join('');

	select.value = optionKeys.includes(previous) ? previous : 'all';
}

function filterOpinions() {
	const query = String(
		document.getElementById('live-search-opinions')?.value || '',
	).toLowerCase();
	const answerFilter = String(
		document.getElementById('live-filter-answer')?.value || 'all',
	);

	filteredOpinions = opinionsData.filter((opinion) => {
		if (answerFilter !== 'all' && String(opinion.answer) !== answerFilter) {
			return false;
		}
		if (!query) return true;
		const pseudo = String(opinion?.userPseudo || '').toLowerCase();
		const reason = String(opinion?.reason || '').toLowerCase();
		return pseudo.includes(query) || reason.includes(query);
	});

	renderOpinions(filteredOpinions);
}

function sortOpinionsWithPinned(opinions = []) {
	return [...opinions].sort((left, right) => {
		const leftPinned = left?.isOwnOpinion ? 1 : 0;
		const rightPinned = right?.isOwnOpinion ? 1 : 0;
		if (leftPinned !== rightPinned) return rightPinned - leftPinned;
		const leftTime = new Date(left?.createdAt || 0).getTime();
		const rightTime = new Date(right?.createdAt || 0).getTime();
		return rightTime - leftTime;
	});
}

function buildChatroomUrl({ embed = false } = {}) {
	const chatParams = new URLSearchParams({
		surveyId: String(surveyId || ''),
		type: 'multiple',
	});
	if (embed) chatParams.set('embed', '1');
	return `chatroom.html?${chatParams.toString()}`;
}

function openChatroomFromCommentsOverlay() {
	if (!surveyId) return;
	window.location.href = buildChatroomUrl();
}

function renderChatPreviewOverlay() {
	const list = document.getElementById('live-opinions-list');
	const emptyNode = document.getElementById('live-no-opinions');
	const card = document.getElementById('live-comments-card');
	if (!list || !surveyId) return;

	card?.classList.add('is-chat-preview');
	list.classList.add('is-chat-preview');
	emptyNode?.classList.add('hidden');

	if (!list.querySelector('.flash-chat-preview-frame')) {
		list.innerHTML = `
			<iframe
				class="flash-chat-preview-frame"
				title="${escapeHtml(t('shared.surveys.live_chat_preview_title', 'Aperçu du chat en direct'))}"
				src="${escapeHtml(buildChatroomUrl({ embed: true }))}"
				loading="lazy"
				tabindex="-1"
				aria-hidden="true"
			></iframe>
		`;
	}

	if (card && card.dataset.chatPreviewBound !== 'true') {
		card.dataset.chatPreviewBound = 'true';
		card.setAttribute('role', 'button');
		card.setAttribute('tabindex', '0');
		card.addEventListener('click', openChatroomFromCommentsOverlay);
		card.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openChatroomFromCommentsOverlay();
		});
	}
}

function renderOpinions(opinions = []) {
	const list = document.getElementById('live-opinions-list');
	const emptyNode = document.getElementById('live-no-opinions');
	if (!list || !emptyNode) return;

	renderChatPreviewOverlay();
	return;

	list.innerHTML = '';
	const visible = sortOpinionsWithPinned(opinions || []).filter(
		isOpinionCommentVisible,
	);

	if (!visible.length) {
		emptyNode.classList.remove('hidden');
		return;
	}
	emptyNode.classList.add('hidden');

	visible.forEach((opinion) => {
		list.appendChild(buildOpinionCard(opinion));
	});
}

function buildOpinionCard(opinion) {
	const node = document.createElement('article');
	node.className = `live-opinion-card ${opinion?.isOwnOpinion ? 'is-own-opinion' : ''}`;
	node.id = `live-opinion-${opinion._id}`;

	const safePseudo = escapeHtml(opinion.userPseudo || 'Anonyme');
	const avatar = safePseudo.charAt(0).toUpperCase() || 'A';
	const answerLabel = escapeHtml(labelsMap[opinion.answer] || opinion.answer || '');
	const reason = escapeHtml(String(opinion.reason || '').trim());
	const reactionState = userReactions.get(String(opinion._id));
	const likeActive = reactionState === 'like' || (!reactionState && opinion.userLiked);
	const dislikeActive =
		reactionState === 'dislike' || (!reactionState && opinion.userDisliked);

	node.innerHTML = `
		<div class="live-opinion-header">
			<div class="live-opinion-author">
				<span class="live-opinion-avatar">${avatar}</span>
				<strong>${safePseudo}</strong>
				${
					opinion?.isOwnOpinion ?
						`<span class="live-pin-badge"><i class="fas fa-thumbtack"></i>${escapeHtml(
							t('shared.surveys.my_comment_badge', 'Mon commentaire'),
						)}</span>`
					: 	''
				}
			</div>
			<span class="live-opinion-answer">${answerLabel}</span>
		</div>
		<div class="live-opinion-content">"${reason || 'Aucun commentaire'}"</div>
		<div class="live-reactions">
			<button class="live-reaction-btn ${likeActive ? 'active' : ''}" data-reaction="like" data-opinion-id="${opinion._id}" type="button">
				<i class="fas fa-thumbs-up"></i>
				<span class="like-count">${Number(opinion.likeCount || 0)}</span>
			</button>
			<button class="live-reaction-btn ${dislikeActive ? 'active' : ''}" data-reaction="dislike" data-opinion-id="${opinion._id}" type="button">
				<i class="fas fa-thumbs-down"></i>
				<span class="dislike-count">${Number(opinion.dislikeCount || 0)}</span>
			</button>
		</div>
	`;

	return node;
}

async function handleReaction(opinionId, reaction) {
	try {
		const payload = await apiRequest(
			`${CONFIG.api.reaction}/${encodeURIComponent(opinionId)}/${encodeURIComponent(
				reaction,
			)}`,
			{ method: 'POST' },
		);
		userReactions.set(opinionId, reaction);
		updateOpinionReaction(opinionId, payload.likeCount, payload.dislikeCount, {
			userLiked: Boolean(payload.userLiked),
			userDisliked: Boolean(payload.userDisliked),
		});
	} catch (error) {
		if (
			error?.statusCode === 410 ||
			error?.payload?.code === 'SURVEY_COMMENT_UNAVAILABLE'
		) {
			removeOpinionComment(opinionId);
		}
		showNotification(error.message || 'Reaction impossible.', 'error');
	}
}

function updateOpinionReaction(opinionId, likeCount, dislikeCount, userState = null) {
	const card = document.getElementById(`live-opinion-${opinionId}`);
	if (!card) return;

	const likeNode = card.querySelector('.like-count');
	const dislikeNode = card.querySelector('.dislike-count');
	if (likeNode) likeNode.textContent = Number(likeCount || 0);
	if (dislikeNode) dislikeNode.textContent = Number(dislikeCount || 0);

	if (userState) {
		const likeBtn = card.querySelector('[data-reaction="like"]');
		const dislikeBtn = card.querySelector('[data-reaction="dislike"]');
		likeBtn?.classList.toggle('active', Boolean(userState.userLiked));
		dislikeBtn?.classList.toggle('active', Boolean(userState.userDisliked));
	}

	const index = opinionsData.findIndex(
		(opinion) => String(opinion?._id) === String(opinionId),
	);
	if (index >= 0) {
		opinionsData[index] = {
			...opinionsData[index],
			likeCount: Number(likeCount || 0),
			dislikeCount: Number(dislikeCount || 0),
			...(userState || {}),
		};
	}
}

function upsertOpinion(opinion) {
	if (!opinion?._id) return;
	if (!isOpinionCommentVisible(opinion)) {
		removeOpinionComment(opinion._id);
		return;
	}

	const index = opinionsData.findIndex(
		(entry) => String(entry?._id) === String(opinion._id),
	);
	if (index >= 0) {
		opinionsData[index] = { ...opinionsData[index], ...opinion };
	} else {
		opinionsData.push(opinion);
	}
	filterOpinions();
}

function removeOpinionComment(opinionId) {
	const normalizedId = String(opinionId || '').trim();
	if (!normalizedId) return;

	const nextOpinions = opinionsData.filter(
		(opinion) => String(opinion?._id || '') !== normalizedId,
	);
	if (nextOpinions.length === opinionsData.length) return;
	opinionsData = nextOpinions;
	filteredOpinions = filteredOpinions.filter(
		(opinion) => String(opinion?._id || '') !== normalizedId,
	);
	filterOpinions();
}

function ensureClassicSocket() {
	if (typeof window.io !== 'function') {
		showPrivateNote(
			t(
				'shared.surveys.live_updates_unavailable',
				'Mises à jour en temps réel indisponibles. Rafraîchissez la page.',
			),
		);
		if (!socketDependencyWarned) {
			logDependencyIssue('DEPENDENCY_SOCKET_MISSING');
			socketDependencyWarned = true;
		}
		return;
	}

	if (!socket) {
		socket = window.io({
			auth: { token },
		});

		socket.on('connect', () => {
			joinClassicRoom();
		});

		socket.on('classic:counts', (payload) => {
			if (!isCurrentClassicPayload(payload)) return;
			applyCountsFromPayload(payload);
		});

		socket.on('classic:new-opinion', (payload) => {
			if (!isCurrentClassicPayload(payload)) return;
			upsertOpinion(payload);
		});

		socket.on('classic:reaction', (payload) => {
			if (!isCurrentClassicPayload(payload)) return;
			updateOpinionReaction(payload.opinionId, payload.likeCount, payload.dislikeCount);
		});

		socket.on('classic:comment-deleted', (payload) => {
			if (!isCurrentClassicPayload(payload)) return;
			removeOpinionComment(payload.opinionId);
		});

		socket.on('classic:comment-restored', (payload) => {
			if (!isCurrentClassicPayload(payload)) return;
			upsertOpinion(payload);
		});

		socket.on('classic:closed', (payload) => {
			if (!isCurrentClassicPayload(payload)) return;
			if (currentSurvey) {
				currentSurvey.isClosed = true;
				renderSurvey(currentSurvey);
			}
			canVote = false;
			applyAccessState();
		});

		socket.on('classic:error', (payload) => {
			if (!payload?.message) return;
			privateMessage = String(payload.message);
			canViewResults = false;
			leaveClassicRoom();
			hideLiveResults();
			showPrivateNote(privateMessage);
		});

		socket.on('organizations:membership:update', (payload) => {
			const eventOrgId = String(payload?.organizationId || '').trim();
			const currentOrgId = String(currentSurvey?.organizationId || '').trim();
			if (eventOrgId && currentOrgId && eventOrgId !== currentOrgId) return;
			void loadSurveyState();
		});
	}

	if (hasLiveResultsAccess()) {
		joinClassicRoom();
	} else {
		leaveClassicRoom();
	}
}

function isCurrentClassicPayload(payload) {
	return (
		payload &&
		String(payload.surveyId || '') === String(surveyId) &&
		String(payload.type || '') === 'multiple'
	);
}

function joinClassicRoom() {
	if (!hasLiveResultsAccess()) return;
	if (!socket || !socket.connected || classicRoomJoined) return;
	socket.emit('classic:join', { surveyId, type: 'multiple' });
	classicRoomJoined = true;
}

function leaveClassicRoom() {
	if (!socket || !socket.connected || !classicRoomJoined) return;
	socket.emit('classic:leave', { surveyId, type: 'multiple' });
	classicRoomJoined = false;
}

function showLiveResults(animate) {
	const section = document.getElementById('live-results-section');
	if (!section) return;
	if (!hasLiveResultsAccess()) {
		hideLiveResults();
		return;
	}
	section.classList.remove('hidden');
	if (!animate) return;
	section.classList.remove('results-reveal');
	void section.offsetWidth;
	section.classList.add('results-reveal');
}

function hideLiveResults() {
	const section = document.getElementById('live-results-section');
	if (!section) return;
	section.classList.add('hidden');
	section.classList.remove('results-reveal');
}

function scrollToLiveResults() {
	document
		.getElementById('live-results-section')
		?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showPrivateNote(message) {
	const node = document.getElementById('live-private-note');
	if (!node) return;
	node.textContent = message;
	node.classList.remove('hidden');
}

function hidePrivateNote() {
	document.getElementById('live-private-note')?.classList.add('hidden');
}

function updateVotesCount(count) {
	document.getElementById('votes-count').innerHTML =
		`<i class="fas fa-users"></i> ${count} vote${count > 1 ? 's' : ''}`;
}

function showLoading(show) {
	const loading = document.getElementById('loading');
	const dashboard = document.querySelector('.dashboard-container');
	if (show) {
		loading?.classList.remove('hidden');
		dashboard?.classList.add('hidden');
		return;
	}
	loading?.classList.add('hidden');
	dashboard?.classList.remove('hidden');
}

function showNotification(message, type = 'info') {
	if (window.SiteUI?.notify) {
		window.SiteUI.notify(message, type);
		return;
	}
	const existing = document.querySelector('.notification');
	if (existing) existing.remove();
	const node = document.createElement('div');
	node.className = `notification ${type}`;
	node.innerHTML = `<span>${escapeHtml(message)}</span>`;
	document.body.appendChild(node);
	setTimeout(() => node.remove(), 3200);
}

function shareOnPlatform(platform) {
	const surveyLink = window.location.href;
	const surveyTitle = currentSurvey?.theme || 'Sondage';
	const snapshotText = buildResultsSnapshotText();
	let shareUrl = '';

	switch (platform) {
		case 'whatsapp':
			shareUrl = `https://wa.me/?text=${encodeURIComponent(
				`${snapshotText}\n${surveyLink}`,
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
				`${snapshotText}\n${surveyLink}`,
			)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'copy':
			navigator.clipboard
				.writeText(`${snapshotText}\n${surveyLink}`)
				.then(() =>
					showNotification(
						t('shared.surveys.link_copied', 'Lien copie dans le presse-papiers.'),
						'success',
					),
				)
				.catch(() => showNotification('Copie impossible.', 'warning'));
			break;
		default:
			break;
	}

	document.getElementById('share-modal')?.classList.add('hidden');
}

function buildResultsSnapshotText() {
	const card = document.querySelector('#live-overlay-result-card .overlay-card.results');
	const title = card?.querySelector('.overlay-title')?.textContent?.trim() || currentSurvey?.theme || 'Sondage';
	const question = card?.querySelector('[data-overlay-question]')?.textContent?.trim() || currentSurvey?.question || '';
	const rows = [...(card?.querySelectorAll('.overlay-result-bar') || [])]
		.map((row) => {
			const label = row.querySelector('.overlay-result-label')?.textContent?.trim();
			const value = row.querySelector('.overlay-result-value')?.textContent?.trim();
			return label && value ? `${label}: ${value}` : '';
		})
		.filter(Boolean);
	const summary = card?.querySelector('[data-overlay-summary]')?.textContent?.trim() || '';
	return [title, question, ...rows, summary].filter(Boolean).join('\n');
}

async function apiRequest(url, options = {}) {
	const fraudHelper = getFraudHelper();
	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`,
		...(options.headers || {}),
	};
	if (!options.disableFraudChallengeHeader) {
		const challengeToken = String(fraudHelper?.getChallengeToken?.() || '').trim();
		if (challengeToken && !headers['x-fraud-challenge-token']) {
			headers['x-fraud-challenge-token'] = challengeToken;
		}
	}

	const response = await fetch(url, {
		...options,
		headers,
	});

	if (response.status === 401) {
		localStorage.removeItem('token');
		showNotification('Session expirée. Reconnectez-vous.', 'warning');
		redirectToBrowse();
		const unauthorized = new Error('Session expirée.');
		unauthorized.statusCode = 401;
		throw unauthorized;
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = new Error(payload.message || `Erreur ${response.status}`);
		error.statusCode = response.status;
		error.payload = payload;
		throw error;
	}

	return payload;
}

function redirectToBrowse() {
	setTimeout(() => {
		window.location.href = 'browse-surveys.html';
	}, 800);
}

function escapeHtml(value) {
	return String(value || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

