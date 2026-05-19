/** @format */

const CONFIG = {
	api: {
		state: '/api/survey-flash',
		detailedResults: '/api/survey-flash',
		answer: '/api/survey-flash',
		reaction: '/api/opinion-flash',
	},
};

const params = new URLSearchParams(window.location.search);
const surveyId = params.get('id');
const token = localStorage.getItem('token');

let currentSurvey = null;
let hasParticipated = false;
let canVote = false;
let canViewResults = false;
let socket = null;
let flashRoomJoined = false;
let selectedAnswer = null;
let opinionsData = [];
let privateMessage = '';
let socketDependencyWarned = false;
const getFraudHelper = () => window.FraudChallengeHelper || null;

const $ = (id) => document.getElementById(id);
const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
const prefersReducedMotion = window.matchMedia?.(
	'(prefers-reduced-motion: reduce)',
)?.matches;

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

function buildPinnedBadge(opinion) {
	if (!opinion?.isOwnOpinion) return '';
	return `
		<span class="flash-pin-badge">
			<i class="fas fa-thumbtack" aria-hidden="true"></i>
			${escapeHtml(t('shared.surveys.my_comment_badge', 'Mon commentaire'))}
		</span>
	`;
}

function hasResultsAccess() {
	return Boolean(canViewResults);
}

function getResultsGateMessage() {
	return (
		privateMessage ||
		t(
			'shared.surveys.vote_required_for_live_results',
			'Votez pour accéder aux résultats en temps réel.',
		)
	);
}

function logDependencyIssue(code, context = {}) {
	console.warn(`[${code}]`, {
		page: 'survey-flash-binary',
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
	initialize().catch((error) => {
		console.error('survey-flash-binary init error:', error);
		showNotification('Impossible de charger ce sondage Flash.', 'error');
		redirectToBrowse();
	});
});

document.addEventListener('site:language-changed', () => {
	if (!surveyId || !token) return;
	refreshState();
});

async function initialize() {
	bindEvents();

	if (!surveyId) {
		showNotification('Sondage invalide.', 'error');
		return redirectToBrowse();
	}

	if (!token) {
		showNotification('Veuillez vous connecter pour accéder au sondage.', 'warning');
		return redirectToBrowse();
	}

	await ensureRuntimeDependencies();
	await refreshState();
	initializeSocket();
	hideLoading();
}

function bindEvents() {
	$('back-btn')?.addEventListener('click', () => window.history.back());
	$('results-btn')?.addEventListener('click', async () => {
		await handleResultsShortcut();
	});
	$('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=binary`;
	});
	$('share-btn')?.addEventListener('click', () => {
		openShareModal();
	});
	$('share-modal')
		?.querySelectorAll('.close-modal')
		.forEach((button) => {
			button.addEventListener('click', (event) => {
				event.preventDefault();
				closeShareModal();
			});
		});
	$('share-modal')?.addEventListener('click', (event) => {
		if (event.target === $('share-modal')) {
			closeShareModal();
		}
	});
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') return;
		if ($('share-modal')?.classList.contains('hidden')) return;
		closeShareModal();
	});

	$('answer-yes')?.addEventListener('click', () => setSelectedAnswer(true));
	$('answer-no')?.addEventListener('click', () => setSelectedAnswer(false));
	$('submit-vote')?.addEventListener('click', submitVote);

	document.querySelectorAll('.share-option').forEach((button) => {
		button.addEventListener('click', (event) => {
			void shareOnPlatform(event.currentTarget?.dataset?.platform || '');
		});
	});

	$('opinions-list')?.addEventListener('click', async (event) => {
		const reactionBtn = event.target.closest('[data-reaction]');
		if (!reactionBtn) return;
		event.preventDefault();
		event.stopPropagation();

		const opinionId = reactionBtn.dataset.opinionId;
		const reaction = reactionBtn.dataset.reaction;
		if (!opinionId || !reaction) return;

		await sendReaction(opinionId, reaction);
	});

	window.addEventListener('beforeunload', () => {
		leaveFlashRoom();
	});
}

function joinFlashRoomIfAllowed() {
	if (!hasResultsAccess()) return;
	if (!socket?.connected || flashRoomJoined) return;
	socket.emit('flash:join', { surveyId, type: 'binary' });
	flashRoomJoined = true;
}

function leaveFlashRoom() {
	if (!socket?.connected || !flashRoomJoined) return;
	socket.emit('flash:leave', { surveyId, type: 'binary' });
	flashRoomJoined = false;
}

function initializeSocket() {
	if (typeof window.io !== 'function') {
		showNotification(
			t(
				'survey_flash_binary.live_updates_unavailable',
				'Mises à jour en temps réel indisponibles. Rafraîchissez la page.',
			),
			'warning',
		);
		if (!socketDependencyWarned) {
			logDependencyIssue('DEPENDENCY_SOCKET_MISSING');
			socketDependencyWarned = true;
		}
		return;
	}

	socket = window.io({
		auth: token ? { token } : undefined,
		query: token ? { token } : undefined,
	});

	socket.on('connect', () => {
		flashRoomJoined = false;
		joinFlashRoomIfAllowed();
	});

	socket.on('flash:counts', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'binary') {
			return;
		}
		applyCounts(payload.counts || { yes: 0, no: 0 }, payload.totalOpinions || 0);
		if (payload.isClosed === true) {
			handleSurveyClosed();
		}
	});

	socket.on('flash:new-opinion', (payload) => {
		if (!payload || payload.surveyId !== surveyId) return;
		if (!hasResultsAccess()) return;

		upsertOpinionCard({
			...payload,
			likeCount: payload.likeCount || 0,
			dislikeCount: payload.dislikeCount || 0,
		});
	});

	socket.on('flash:reaction', (payload) => {
		if (!payload?.opinionId) return;
		updateOpinionReaction(
			payload.opinionId,
			payload.likeCount || 0,
			payload.dislikeCount || 0,
		);
	});

	socket.on('flash:comment-deleted', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'binary') return;
		removeOpinionComment(payload.opinionId);
	});

	socket.on('flash:comment-restored', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'binary') return;
		if (!hasResultsAccess()) return;
		upsertOpinionCard({
			...payload,
			likeCount: payload.likeCount || 0,
			dislikeCount: payload.dislikeCount || 0,
		});
	});

	socket.on('flash:closed', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'binary') return;
		handleSurveyClosed();
	});

	socket.on('flash:error', (payload) => {
		if (!payload?.message) return;
		privateMessage = String(payload.message || '').trim();
		canViewResults = false;
		leaveFlashRoom();
		flashRoomJoined = false;
		hideResultsSection();
		showClosedNote(getResultsGateMessage());
	});

	socket.on('organizations:membership:update', (payload) => {
		const eventOrgId = String(payload?.organizationId || '').trim();
		const currentOrgId = String(currentSurvey?.organizationId || '').trim();
		if (eventOrgId && currentOrgId && eventOrgId !== currentOrgId) return;
		void refreshState().catch((error) => {
			console.error('flash binary membership refresh failed:', error);
		});
	});
}

async function refreshState() {
	const state = await apiRequest(`${CONFIG.api.state}/${surveyId}/state`);

	currentSurvey = state.survey;
	hasParticipated = Boolean(state.hasParticipated);
	canVote = Boolean(state.canVote);
	canViewResults = Boolean(state.canViewResults);
	privateMessage = String(state?.message || '').trim();

	renderSurveyHeader();

	if (canVote) {
		showVoteSection();
		hideClosedNote();
		if (hasResultsAccess()) {
			await loadDetailedResults();
			joinFlashRoomIfAllowed();
		} else {
			hideResultsSection();
			leaveFlashRoom();
		}
	} else if (hasResultsAccess()) {
		hideVoteSection();
		await loadDetailedResults();
		joinFlashRoomIfAllowed();
	} else if (state.isClosed) {
		hideVoteSection();
		hideResultsSection();
		leaveFlashRoom();
		showClosedNote(
			getResultsGateMessage() ||
				'Ce sondage est clôturé. Les résultats sont réservés aux votants.',
		);
	} else {
		hideVoteSection();
		hideResultsSection();
		leaveFlashRoom();
		showClosedNote(getResultsGateMessage());
	}
}

function renderSurveyHeader() {
	$('survey-theme').textContent = currentSurvey?.theme || 'Sondage';
	$('survey-question').textContent =
		currentSurvey?.question || 'Question indisponible';
	const labels = getBinaryLabels();
	const yesButton = $('answer-yes');
	const noButton = $('answer-no');
	if (yesButton) yesButton.innerHTML = `<i class="fas fa-thumbs-up"></i> ${escapeHtml(labels.yes)}`;
	if (noButton) noButton.innerHTML = `<i class="fas fa-thumbs-down"></i> ${escapeHtml(labels.no)}`;
	renderSurveyContext(currentSurvey?.contexte);
	updateQuestionCardVisibility();
	const createdAtLabel = $('created-date');
	const endedAtLabel = $('ended-date');
	if (createdAtLabel) {
		createdAtLabel.textContent = `Creation: ${formatDate(
			currentSurvey?.createdAt,
		)}`;
	}
	if (endedAtLabel) {
		endedAtLabel.textContent =
			currentSurvey?.endedAt ?
				`Clôture : ${formatDate(currentSurvey.endedAt)}`
			:	'Clôture : En cours';
	}

	const statusBadge = $('status-badge');
	if (!statusBadge) return;

	if (currentSurvey?.isClosed) {
		statusBadge.innerHTML = '<i class="fas fa-lock"></i> Sondage clôturé';
		statusBadge.className = 'status-badge closed';
	} else {
		statusBadge.innerHTML = '<i class="fas fa-unlock"></i> Sondage ouvert';
		statusBadge.className = 'status-badge open';
	}
}

function renderSurveyContext(rawContext) {
	const contextNode = $('survey-contexte');
	if (!contextNode) return;

	const context = String(rawContext || '').trim();
	if (context) {
		contextNode.textContent = context;
		contextNode.classList.remove('is-empty');
		return;
	}

	contextNode.textContent = t(
		'shared.surveys.no_context_provided',
		'Aucun contexte fourni',
	);
	contextNode.classList.add('is-empty');
}

function updateQuestionCardVisibility() {
	const questionCard = $('question-card') || document.querySelector('.flash-question-card');
	if (questionCard) {
		questionCard.classList.toggle('is-hidden-after-vote', hasResultsAccess());
	}
	updateShareResultsVisibility();
}

function updateShareResultsVisibility() {
	const row = $('share-results-row');
	if (!row) return;
	row.classList.toggle('hidden', !hasParticipated);
}

function setSelectedAnswer(answer) {
	selectedAnswer = answer;
	$('answer-yes')?.classList.toggle('selected', answer === true);
	$('answer-no')?.classList.toggle('selected', answer === false);
	$('submit-vote').disabled = false;
}

async function submitVote(attempt = 0, turnstileTokenOverride = null) {
	if (selectedAnswer === null) {
		showNotification('Sélectionnez une réponse avant de valider.', 'warning');
		return;
	}

	const submitBtn = $('submit-vote');
	submitBtn.disabled = true;
	submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

	try {
		const reason = String($('reason-input')?.value || '').trim();
		const bodyPayload = {
			answer: selectedAnswer,
			reason: reason || undefined,
			locale: window.SiteI18n?.getLanguage?.() || 'fr',
		};
		const scanId = window.CommunitySurveyAnalytics ? window.CommunitySurveyAnalytics.getScanId?.(surveyId, 'binary') : '';
		if (scanId) bodyPayload.scanId = scanId;
		const deviceIntegrity =
			await window.CommunityDeviceIntegrity?.getDeviceIntegrityPayload?.({
				surveyId,
				surveyType: 'binary_flash',
			});
		if (deviceIntegrity) {
			bodyPayload.deviceIntegrity = deviceIntegrity;
		}
		if (turnstileTokenOverride) {
			bodyPayload.turnstileToken = turnstileTokenOverride;
		}
		const payload = await apiRequest(`${CONFIG.api.answer}/${surveyId}/answer`, {
			method: 'POST',
			body: JSON.stringify(bodyPayload),
		});
		const voteStatus = String(payload?.voteStatus || 'accepted').trim().toLowerCase();
		const commentModerationState = String(
			payload?.commentModeration?.state || 'visible',
		)
			.trim()
			.toLowerCase();

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
				'Vote Flash reçu mais placé en quarantaine. Il n’est pas encore inclus dans les résultats propres.',
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
			showNotification('Vote Flash enregistre.', 'success');
		}
		hasParticipated = Boolean(payload?.hasParticipated ?? true);
		canVote = Boolean(payload?.canVote ?? false);
		canViewResults = Boolean(payload?.canViewResults ?? true);
		privateMessage = '';
		hideVoteSection();
		await loadDetailedResults();
		joinFlashRoomIfAllowed();
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
			submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
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
					submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
					return submitVote(attempt + 1, turnstileToken);
				}
			}

			if (challengeCode === 'EMAIL_OTP_REQUIRED') {
				const resolved = await fraudHelper?.resolveEmailOtpChallenge?.({
					request: apiRequest,
					contextType: 'vote',
					surveyType: 'binary_flash',
					surveyId,
					notify: showNotification,
				});
				if (resolved && attempt < 2) {
					submitBtn.disabled = false;
					submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
					return submitVote(attempt + 1, null);
				}
			}

			showNotification(error.message || 'Verification supplementaire requise.', 'warning');
			submitBtn.disabled = false;
			submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
			return;
		}

		showNotification(error.message || "Impossible d'envoyer votre vote.", 'error');
		submitBtn.disabled = false;
		submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
	}
}

async function loadDetailedResults() {
	if (!hasResultsAccess()) {
		hideResultsSection();
		leaveFlashRoom();
		showClosedNote(getResultsGateMessage());
		return;
	}

	try {
		const payload = await apiRequest(
			`${CONFIG.api.detailedResults}/${surveyId}/detailed-results`,
		);

		hasParticipated = Boolean(payload?.hasParticipated ?? hasParticipated);
		canVote = Boolean(payload?.canVote ?? canVote);
		canViewResults = Boolean(payload?.canViewResults ?? canViewResults);
		privateMessage = String(payload?.message || privateMessage || '').trim();
		updateQuestionCardVisibility();

		if (!hasResultsAccess()) {
			hideResultsSection();
			leaveFlashRoom();
			showClosedNote(getResultsGateMessage());
			return;
		}

		const counts = payload.counts || { yes: 0, no: 0 };
		applyCounts(counts, payload.totalOpinions || 0);
		opinionsData = sortOpinionsWithPinned(
			(Array.isArray(payload.opinions) ? payload.opinions : []).filter(
				hasOpinionComment,
			),
		);
		renderOpinions(opinionsData);
		showResultsSection({ animate: true });
		hideClosedNote();
		joinFlashRoomIfAllowed();
	} catch (error) {
		if (error?.statusCode === 403) {
			canViewResults = false;
			privateMessage = String(error.message || privateMessage || '').trim();
			leaveFlashRoom();
			hideResultsSection();
			showClosedNote(getResultsGateMessage());
			return;
		}
		throw error;
	}
}

async function handleResultsShortcut() {
	if (!hasResultsAccess()) {
		showNotification(getResultsGateMessage(), 'info');
		return;
	}

	if ($('results-section')?.classList.contains('hidden')) {
		try {
			await loadDetailedResults();
		} catch (error) {
			showNotification(error.message || 'Impossible de charger les resultats.', 'error');
			return;
		}
	}

	scrollToResultsSection();
}

function scrollToResultsSection() {
	const section = $('results-section');
	section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyCounts(counts, totalOpinions) {
	const safeYes = Number(counts.yes || 0);
	const safeNo = Number(counts.no || 0);
	const safeTotal = Number(totalOpinions || safeYes + safeNo);
	const labels = getBinaryLabels();

	$('votes-count').innerHTML = `<i class="fas fa-users"></i> ${safeTotal} vote${
		safeTotal > 1 ? 's' : ''
	}`;
	const resultsCount = $('results-count');
	if (resultsCount) {
		resultsCount.textContent = `${safeTotal} votant${safeTotal > 1 ? 's' : ''}`;
	}

	renderOverlayResultCard(
		[
			{
				key: 'yes',
				label: labels.yes,
				value: safeYes,
			},
			{
				key: 'no',
				label: labels.no,
				value: safeNo,
			},
		],
		safeTotal,
	);
}

function getBinaryLabels(survey = currentSurvey) {
	const labels = survey?.binaryLabels || {};
	return {
		yes: String(labels.yes || '').trim() || t('survey_flash_binary.answer_yes', 'Oui'),
		no: String(labels.no || '').trim() || t('survey_flash_binary.answer_no', 'Non'),
	};
}

function renderOverlayResultCard(items, total) {
	const host = $('flash-overlay-result-card');
	if (!host) return;

	let card = host.querySelector('.overlay-card.results');
	if (!card) {
		host.innerHTML = `
			<div class="overlay-card results">
				<span class="overlay-eyebrow"><i class="fas fa-tower-broadcast"></i> ${escapeHtml(
					t('survey_flash_binary.overlay_type', 'Binary Flash'),
				)}</span>
				<h2 class="overlay-title"></h2>
				<p class="overlay-subtitle" data-overlay-question></p>
				<div class="overlay-result-bars"></div>
				<p class="overlay-subtitle" data-overlay-summary></p>
			</div>
		`;
		card = host.querySelector('.overlay-card.results');
	}

	const title = card.querySelector('.overlay-title');
	const question = card.querySelector('[data-overlay-question]');
	const summary = card.querySelector('[data-overlay-summary]');
	const bars = card.querySelector('.overlay-result-bars');
	const safeTotal = Number(total || 0);

	if (title) title.textContent = currentSurvey?.theme || 'Sondage';
	if (question) {
		question.textContent =
			currentSurvey?.question || t('shared.surveys.question_unavailable', 'Question indisponible');
	}
	if (summary) {
		summary.textContent = `${formatVoteCount(safeTotal)} · ${getSurveyStateLabel()}`;
	}
	if (!bars) return;

	const nextKeys = new Set(items.map((item) => String(item.key)));
	bars.querySelectorAll('[data-result-key]').forEach((row) => {
		if (!nextKeys.has(row.getAttribute('data-result-key'))) {
			row.remove();
		}
	});

	items.forEach((item) => {
		const key = String(item.key);
		const value = Number(item.value || 0);
		const pct = safeTotal > 0 ? Math.round((value / safeTotal) * 100) : 0;
		let row = bars.querySelector(`[data-result-key="${cssEscape(key)}"]`);
		const wasCreated = !row;

		if (!row) {
			row = document.createElement('div');
			row.className = 'overlay-result-bar';
			row.setAttribute('data-result-key', key);
			row.innerHTML = `
				<span class="overlay-result-label"></span>
				<div class="overlay-result-track">
					<div class="overlay-result-fill"></div>
				</div>
				<span class="overlay-result-value"></span>
			`;
			bars.appendChild(row);
		}

		row.querySelector('.overlay-result-label').textContent = item.label;
		row.querySelector('.overlay-result-value').textContent = `${value} · ${pct}%`;
		const fill = row.querySelector('.overlay-result-fill');
		if (fill) {
			if (wasCreated) {
				fill.style.width = '0%';
				window.requestAnimationFrame(() => {
					fill.style.width = `${pct}%`;
				});
			} else {
				fill.style.width = `${pct}%`;
			}
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

function buildChatroomUrl({ embed = false } = {}) {
	const chatParams = new URLSearchParams({
		surveyId: String(surveyId || ''),
		type: 'binary',
	});
	if (embed) chatParams.set('embed', '1');
	return `chatroom.html?${chatParams.toString()}`;
}

function openChatRoomFromPreview() {
	if (!surveyId) return;
	window.location.href = buildChatroomUrl();
}

let chatPreviewPointerStart = null;
let chatPreviewSuppressClick = false;

function isChatPreviewInteractiveTarget(target) {
	return Boolean(
		target?.closest?.('button, a, input, textarea, select, [data-reaction]'),
	);
}

function bindChatPreviewScrollGuard(card, list) {
	if (!card || !list || card.dataset.chatPreviewScrollGuardBound === 'true') return;
	card.dataset.chatPreviewScrollGuardBound = 'true';

	card.addEventListener(
		'pointerdown',
		(event) => {
			chatPreviewPointerStart = {
				x: event.clientX,
				y: event.clientY,
				scrollTop: list.scrollTop,
			};
			chatPreviewSuppressClick = false;
		},
		{ passive: true },
	);
	card.addEventListener(
		'pointermove',
		(event) => {
			if (!chatPreviewPointerStart) return;
			const moved =
				Math.abs(event.clientX - chatPreviewPointerStart.x) > 8 ||
				Math.abs(event.clientY - chatPreviewPointerStart.y) > 8 ||
				Math.abs(list.scrollTop - chatPreviewPointerStart.scrollTop) > 2;
			if (moved) chatPreviewSuppressClick = true;
		},
		{ passive: true },
	);
	card.addEventListener('pointerup', () => {
		chatPreviewPointerStart = null;
	});
	card.addEventListener('pointercancel', () => {
		chatPreviewPointerStart = null;
		chatPreviewSuppressClick = false;
	});
	list.addEventListener(
		'scroll',
		() => {
			if (chatPreviewPointerStart) chatPreviewSuppressClick = true;
		},
		{ passive: true },
	);
}

function bindChatPreviewNavigation() {
	const list = $('opinions-list');
	const empty = $('empty-opinions');
	const card = $('flash-comments-card');
	if (!list || !surveyId) return;

	card?.classList.add('is-chat-preview');
	list.classList.add('is-chat-preview');
	empty?.classList.add('hidden');

	if (card && card.dataset.chatPreviewBound !== 'true') {
		card.dataset.chatPreviewBound = 'true';
		card.setAttribute('role', 'button');
		card.setAttribute('tabindex', '0');
		bindChatPreviewScrollGuard(card, list);
		card.addEventListener('click', (event) => {
			if (isChatPreviewInteractiveTarget(event.target) || chatPreviewSuppressClick) {
				chatPreviewSuppressClick = false;
				return;
			}
			openChatRoomFromPreview();
		});
		card.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openChatRoomFromPreview();
		});
	}
}

function renderOpinions(opinions = opinionsData, animatedIds = new Set()) {
	const list = $('opinions-list');
	const empty = $('empty-opinions');
	if (!list || !empty) return;

	bindChatPreviewNavigation();

	if (window.ChatPreviewRenderer?.render) {
		window.ChatPreviewRenderer.render({
			list,
			empty,
			surveyId,
			type: 'binary',
			theme: currentSurvey?.theme || '',
		});
		return;
	}

	list.innerHTML = '';
	const visibleOpinions = sortOpinionsWithPinned(
		Array.isArray(opinions) ? opinions.filter(hasOpinionComment) : [],
	);

	if (visibleOpinions.length === 0) {
		empty.classList.remove('hidden');
		return;
	}

	empty.classList.add('hidden');
	visibleOpinions.forEach((opinion) => {
		list.appendChild(buildOpinionCard(opinion, animatedIds.has(String(opinion._id))));
	});
}

function hasOpinionComment(opinion) {
	return (
		!opinion?.commentModeration?.isDeleted &&
		Boolean(String(opinion?.reason || '').trim())
	);
}

function formatQuotedComment(content) {
	const safeContent = escapeHtml(String(content || '').trim());
	if (!safeContent) {
		return '<em class="comment-empty">Aucun commentaire</em>';
	}
	return `<span class="comment-quote-text">"${safeContent}"</span>`;
}

function buildOpinionCard(opinion, animateEntry = false) {
	const card = document.createElement('article');
	card.className = `flash-opinion${opinion?.isOwnOpinion ? ' is-own-opinion' : ''}${
		animateEntry ? ' opinion-enter' : ''
	}`;
	card.id = `flash-opinion-${opinion._id}`;

	const answerClass = opinion.answer ? 'yes' : 'no';
	const labels = getBinaryLabels();
	const answerLabel = opinion.answer ? labels.yes : labels.no;
	const content = opinion.reason?.trim();
	const safePseudo = escapeHtml(opinion.userPseudo || 'Anonyme');
	const avatarLetter = safePseudo.charAt(0).toUpperCase() || 'A';

	card.innerHTML = `
		<div class="flash-opinion-header">
			<div class="flash-author">
				<span class="flash-avatar">${avatarLetter}</span>
				<strong class="flash-user">${safePseudo}</strong>
				${buildPinnedBadge(opinion)}
			</div>
			<span class="flash-opinion-answer ${answerClass}">${answerLabel}</span>
		</div>
		<div class="flash-opinion-content">
			${formatQuotedComment(content)}
		</div>
		<div class="flash-reactions">
			<button class="flash-reaction-btn ${opinion.userLiked ? 'active' : ''}" type="button" data-reaction="like" data-opinion-id="${opinion._id}">
				<i class="fas fa-thumbs-up"></i>
				<span class="like-count">${Number(opinion.likeCount || 0)}</span>
			</button>
			<button class="flash-reaction-btn ${opinion.userDisliked ? 'active' : ''}" type="button" data-reaction="dislike" data-opinion-id="${opinion._id}">
				<i class="fas fa-thumbs-down"></i>
				<span class="dislike-count">${Number(opinion.dislikeCount || 0)}</span>
			</button>
		</div>
	`;

	return card;
}

function upsertOpinionCard(opinion) {
	const list = $('opinions-list');
	const empty = $('empty-opinions');
	if (!list || !empty) return;
	if (!hasOpinionComment(opinion)) {
		removeOpinionComment(opinion?._id);
		return;
	}

	const opinionId = String(opinion._id || '');
	if (!opinionId) return;
	const existingIndex = opinionsData.findIndex(
		(entry) => String(entry?._id || '') === opinionId,
	);
	const alreadyExists = existingIndex >= 0;

	if (alreadyExists) {
		opinionsData[existingIndex] = { ...opinionsData[existingIndex], ...opinion };
	} else {
		opinionsData.push(opinion);
	}

	opinionsData = sortOpinionsWithPinned(opinionsData.filter(hasOpinionComment));
	renderOpinions(opinionsData, alreadyExists ? new Set() : new Set([opinionId]));
}

function removeOpinionComment(opinionId) {
	const normalizedId = String(opinionId || '').trim();
	if (!normalizedId) return;
	const nextOpinions = opinionsData.filter(
		(opinion) => String(opinion?._id || '') !== normalizedId,
	);
	if (nextOpinions.length === opinionsData.length) return;
	opinionsData = nextOpinions;
	renderOpinions(opinionsData);
}

async function sendReaction(opinionId, reaction) {
	try {
		const payload = await apiRequest(
			`${CONFIG.api.reaction}/${opinionId}/${reaction}`,
			{
				method: 'POST',
			},
		);

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

function updateOpinionReaction(
	opinionId,
	likeCount,
	dislikeCount,
	userState = null,
) {
	const card = $(`flash-opinion-${opinionId}`);
	if (!card) return;

	const likeNode = card.querySelector('.like-count');
	const dislikeNode = card.querySelector('.dislike-count');
	if (likeNode) likeNode.textContent = Number(likeCount || 0);
	if (dislikeNode) dislikeNode.textContent = Number(dislikeCount || 0);
	const opinionIndex = opinionsData.findIndex(
		(opinion) => String(opinion?._id || '') === String(opinionId),
	);
	if (opinionIndex >= 0) {
		opinionsData[opinionIndex] = {
			...opinionsData[opinionIndex],
			likeCount: Number(likeCount || 0),
			dislikeCount: Number(dislikeCount || 0),
			...(userState || {}),
		};
	}

	if (userState) {
		const likeBtn = card.querySelector('[data-reaction="like"]');
		const dislikeBtn = card.querySelector('[data-reaction="dislike"]');
		likeBtn?.classList.toggle('active', Boolean(userState.userLiked));
		dislikeBtn?.classList.toggle('active', Boolean(userState.userDisliked));
	}
}

function handleSurveyClosed() {
	if (!currentSurvey) return;
	currentSurvey.isClosed = true;
	if (!currentSurvey.endedAt) currentSurvey.endedAt = new Date().toISOString();
	canVote = false;
	hideVoteSection();
	renderSurveyHeader();
	showNotification('Ce sondage Flash est désormais clôturé.', 'info');
}

function showVoteSection() {
	$('vote-section')?.classList.remove('hidden');
	const submitBtn = $('submit-vote');
	if (submitBtn) {
		submitBtn.disabled = selectedAnswer === null;
		submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
	}
}

function hideVoteSection() {
	$('vote-section')?.classList.add('hidden');
}

function showResultsSection({ animate = false } = {}) {
	const section = $('results-section');
	if (!section) return;

	section.classList.remove('hidden');
	if (!animate || prefersReducedMotion) {
		section.classList.remove('results-reveal');
		return;
	}

	section.classList.remove('results-reveal');
	void section.offsetWidth;
	section.classList.add('results-reveal');
}

function hideResultsSection() {
	const section = $('results-section');
	if (!section) return;
	section.classList.add('hidden');
	section.classList.remove('results-reveal');
}

function showClosedNote(message) {
	const node = $('closed-note');
	if (!node) return;
	node.textContent = message;
	node.classList.remove('hidden');
}

function hideClosedNote() {
	$('closed-note')?.classList.add('hidden');
}

function hideLoading() {
	$('loading')?.classList.add('hidden');
	$('flash-app')?.classList.remove('hidden');
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
		throw new Error('Session expirée, reconnectez-vous.');
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

function showNotification(message, type = 'info') {
	window.SiteUI?.notify?.(message, type);
}

function openShareModal() {
	if (window.SiteModalSheet?.open) {
		window.SiteModalSheet.open('share-modal');
		return;
	}
	$('share-modal')?.classList.remove('hidden');
	$('share-modal')?.setAttribute('aria-hidden', 'false');
	document.body.classList.add('modal-open');
}

function closeShareModal() {
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close('share-modal');
		return;
	}
	$('share-modal')?.classList.add('hidden');
	$('share-modal')?.setAttribute('aria-hidden', 'true');
	document.body.classList.remove('modal-open');
}

async function shareOnPlatform(platform) {
	const surveyLink = window.location.href;
	const surveyTitle = currentSurvey?.theme || 'Sondage Flash';
	const snapshotText = buildResultsSnapshotText();
	if (window.CommunityResultsShare?.shareOverlaySnapshot) {
		try {
			await window.CommunityResultsShare.shareOverlaySnapshot({
				platform,
				cardSelector: '#flash-overlay-result-card .overlay-card.results',
				shareUrl: surveyLink,
				title: surveyTitle,
				text: snapshotText,
				filenamePrefix: surveyTitle,
				notify: showNotification,
			});
			closeShareModal();
			return;
		} catch (error) {
			console.warn('results snapshot sharing failed, using link fallback:', error);
			showNotification('Capture indisponible. Partage du lien uniquement.', 'warning');
		}
	}
	let shareUrl = '';

	switch (platform) {
		case 'whatsapp':
			shareUrl = `https://wa.me/?text=${encodeURIComponent(`${surveyTitle}\n${surveyLink}`)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'facebook':
			shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(surveyLink)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'twitter':
			shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(`${surveyTitle}\n${surveyLink}`)}`;
			window.open(shareUrl, '_blank');
			break;
		case 'copy':
			navigator.clipboard
				.writeText(surveyLink)
				.then(() => {
					showNotification(
						t('shared.surveys.link_copied', 'Lien copie dans le presse-papiers.'),
						'success',
					);
				})
				.catch(() => {
					showNotification('Copie impossible.', 'warning');
				});
			break;
		default:
			break;
	}

	closeShareModal();
}

function buildResultsSnapshotText() {
	const card = document.querySelector('#flash-overlay-result-card .overlay-card.results');
	const title =
		card?.querySelector('.overlay-title')?.textContent?.trim() ||
		currentSurvey?.theme ||
		'Sondage Flash';
	const question =
		card?.querySelector('[data-overlay-question]')?.textContent?.trim() ||
		currentSurvey?.question ||
		'';
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

function redirectToBrowse() {
	hideLoading?.();
	document.getElementById('loading')?.classList.add('hidden');
	document.querySelector('.dashboard-container')?.classList.add('hidden');
	const hasToken = Boolean(window.SiteApi?.getToken?.() || localStorage.getItem('token'));
	const isInvalidSurvey = !surveyId;
	window.SiteUI?.renderPageState?.({
		mount: document.querySelector('main'),
		variant: isInvalidSurvey ? 'error' : 'warning',
		icon: isInvalidSurvey ? 'fa-link-slash' : 'fa-user-lock',
		title: isInvalidSurvey ? 'Sondage indisponible' : 'Connexion requise',
		message: isInvalidSurvey
			? "Le lien du sondage Flash est incomplet ou invalide. Ouvrez un sondage depuis Community pour voter."
			: 'Connectez-vous pour accéder à ce sondage Flash et voter en direct.',
		actions: hasToken
			? [
				{
					label: 'Parcourir les sondages',
					icon: 'fa-list',
					href: 'browse-surveys.html',
				},
			]
			: [
				{
					label: 'Se connecter',
					icon: 'fa-right-to-bracket',
					onClick: () => window.SiteApi?.beginGoogleAuth?.(),
				},
				{
					label: 'Parcourir les sondages',
					icon: 'fa-list',
					href: 'browse-surveys.html',
					secondary: true,
				},
			],
	});
}

function escapeHtml(input) {
	return String(input || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function formatDate(value) {
	if (!value) return '--';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return '--';
	return parsed.toLocaleString(getIntlLocale(), {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}

