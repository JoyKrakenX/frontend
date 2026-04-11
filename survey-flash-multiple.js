/** @format */

const CONFIG = {
	api: {
		state: '/api/survey-2-flash',
		detailedResults: '/api/survey-2-flash',
		answer: '/api/survey-2-flash',
		reaction: '/api/opinion-2-flash',
	},
};

const OPTION_PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const LEGACY_OPTION_KEYS = [
	'reponse_1',
	'reponse_2',
	'reponse_3',
	'reponse_4',
	'reponse_5',
	'reponse_6',
];

const params = new URLSearchParams(window.location.search);
const surveyId = params.get('id');
const token = localStorage.getItem('token');

let currentSurvey = null;
let hasParticipated = false;
let canVote = false;
let canViewResults = false;
let resultsChart = null;
let socket = null;
let flashRoomJoined = false;
let selectedChoice = null;
let optionKeys = [];
let optionLabels = {};
let opinionsData = [];
let privateMessage = '';
let pendingResultsScroll = false;
let chartDependencyWarned = false;
let socketDependencyWarned = false;
const getFraudHelper = () => window.FraudChallengeHelper || null;

const $ = (id) => document.getElementById(id);
const t = (key, fallback, parameters) =>
	window.SiteI18n?.t?.(key, fallback, parameters) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
const prefersReducedMotion = window.matchMedia?.(
	'(prefers-reduced-motion: reduce)',
)?.matches;
const SCROLL_OFFSET_PX = 96;
const SCROLL_TOLERANCE_PX = 24;
const SCROLL_RETRY_DELAYS_MS = [0, 120, 380];
const debugScroll = params.get('debugScroll') === '1';

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
			'Votez pour acceder aux resultats en temps reel.',
		)
	);
}

function logDependencyIssue(code, context = {}) {
	console.warn(`[${code}]`, {
		page: 'survey-flash-multiple',
		surveyId,
		...context,
	});
}

async function ensureRuntimeDependencies() {
	if (typeof window.ensureDependencies !== 'function') return;
	try {
		const depsOk = await window.ensureDependencies([
			{
				name: 'chart',
				test: () => typeof window.Chart === 'function',
				localSrc: 'vendor/chartjs/chart.min.js',
				timeoutMs: 2500,
			},
			{
				name: 'socket',
				test: () => typeof window.io === 'function',
				localSrc: '/socket.io/socket.io.js',
				timeoutMs: 2500,
			},
		]);

		if (!depsOk.chart) {
			renderChartDependencyFallback();
			logDependencyIssue('DEPENDENCY_CHART_MISSING');
			chartDependencyWarned = true;
		}
		if (!depsOk.socket) {
			logDependencyIssue('DEPENDENCY_SOCKET_MISSING');
			socketDependencyWarned = true;
		}
	} catch (error) {
		console.error('dependency check failed:', error);
	}
}

function renderChartDependencyFallback() {
	const wrap = document.querySelector('.flash-chart-wrap');
	const canvas = $('flash-results-chart');
	if (!wrap) return;

	let fallback = wrap.querySelector('.flash-chart-fallback');
	if (!fallback) {
		fallback = document.createElement('p');
		fallback.className = 'flash-chart-fallback';
		fallback.setAttribute('role', 'status');
		wrap.appendChild(fallback);
	}
	fallback.textContent = t(
		'survey_flash_multiple.chart_unavailable',
		'Graphique indisponible pour le moment.',
	);

	if (canvas) {
		canvas.classList.add('hidden');
		canvas.setAttribute('aria-hidden', 'true');
	}
}

function clearChartDependencyFallback() {
	const wrap = document.querySelector('.flash-chart-wrap');
	const canvas = $('flash-results-chart');
	if (!wrap) return;
	wrap.querySelector('.flash-chart-fallback')?.remove();
	if (canvas) {
		canvas.classList.remove('hidden');
		canvas.removeAttribute('aria-hidden');
	}
}

function parseOptionKeyIndex(optionKey) {
	const match = String(optionKey || '').match(/^reponse_(\d+)$/);
	if (!match) return -1;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed - 1 : -1;
}

function sortOptionKeys(keys = []) {
	return [...keys].sort(
		(left, right) => parseOptionKeyIndex(left) - parseOptionKeyIndex(right),
	);
}

function resolveOptionKeys(source = {}) {
	if (Array.isArray(source.optionKeys) && source.optionKeys.length) {
		return sortOptionKeys(source.optionKeys);
	}

	const labelKeys = Object.keys(source.labels || {});
	if (labelKeys.length) {
		return sortOptionKeys(labelKeys);
	}

	if (Array.isArray(source.options) && source.options.length) {
		return source.options.map((_, index) => `reponse_${index + 1}`);
	}

	const legacyKeys = LEGACY_OPTION_KEYS.filter((key) =>
		String(source[key] || '').trim(),
	);
	if (legacyKeys.length) {
		return sortOptionKeys(legacyKeys);
	}

	return ['reponse_1', 'reponse_2', 'reponse_3'];
}

function getOptionLabel(source = {}, key, index) {
	const label =
		source.labels?.[key] ||
		source.options?.[index] ||
		source[key] ||
		t('survey_flash_multiple.option_fallback', `Option ${index + 1}`, {
			index: index + 1,
		});
	return String(label || '').trim() || `Option ${index + 1}`;
}

function getOptionColorByIndex(index) {
	return OPTION_PALETTE[index % OPTION_PALETTE.length];
}

function getOptionColor(optionKey) {
	const index = optionKeys.indexOf(optionKey);
	if (index >= 0) return getOptionColorByIndex(index);
	const parsed = parseOptionKeyIndex(optionKey);
	return getOptionColorByIndex(parsed >= 0 ? parsed : 0);
}

function hydrateOptions(source = {}) {
	const resolvedOptionKeys = resolveOptionKeys(source);
	const resolvedLabels = {};

	resolvedOptionKeys.forEach((key, index) => {
		resolvedLabels[key] = getOptionLabel(source, key, index);
	});

	optionKeys = resolvedOptionKeys;
	optionLabels = resolvedLabels;

	if (!optionKeys.includes(selectedChoice)) {
		selectedChoice = null;
	}
}

function buildSeriesFromCounts(counts = {}) {
	return optionKeys.map((key, index) => ({
		key,
		label: optionLabels[key] || `Option ${index + 1}`,
		value: Number(counts[key] || 0),
		color: getOptionColorByIndex(index),
	}));
}

document.addEventListener('DOMContentLoaded', () => {
	initialize().catch((error) => {
		console.error('survey-flash-multiple init error:', error);
		showNotification(
			t('survey_flash_multiple.load_error', 'Impossible de charger ce sondage Flash.'),
			'error',
		);
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
		showNotification(
			t('survey_flash_multiple.invalid_survey', 'Sondage invalide.'),
			'error',
		);
		return redirectToBrowse();
	}

	if (!token) {
		showNotification(
			t('survey_flash_multiple.login_required', 'Veuillez vous connecter pour acceder au sondage.'),
			'warning',
		);
		return redirectToBrowse();
	}

	await ensureRuntimeDependencies();
	initializeResultsChart();
	await refreshState();
	initializeSocket();
	hideLoading();
}

function initializeResultsChart() {
	const canvas = $('flash-results-chart');
	if (!canvas) return;
	if (typeof window.Chart !== 'function') {
		renderChartDependencyFallback();
		if (!chartDependencyWarned) {
			logDependencyIssue('DEPENDENCY_CHART_MISSING');
			chartDependencyWarned = true;
		}
		return;
	}
	clearChartDependencyFallback();

	resultsChart = new window.Chart(canvas, {
		type: 'doughnut',
		data: {
			labels: [],
			datasets: [
				{
					data: [],
					backgroundColor: [],
					borderColor: [],
					borderAlign: 'center',
					borderWidth: 2,
					borderRadius: 0,
					offset: 0,
					hoverOffset: 10,
					weight: 1,
					spacing: 0,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			cutout: '50%',
			radius: '100%',
			rotation: 0,
			circumference: 360,
			elements: {
				arc: {
					borderAlign: 'center',
					borderWidth: 2,
					borderRadius: 0,
					spacing: 0,
				},
			},
			animation: {
				animateRotate: true,
				animateScale: false,
			},
			plugins: {
				legend: {
					position: 'bottom',
					labels: {
						color: '#e2e8f0',
					},
				},
				tooltip: {
					callbacks: {
						label: (context) => {
							const value = Number(context.raw || 0);
							const data = context.dataset?.data || [];
							const total = data.reduce(
								(sum, item) => sum + Number(item || 0),
								0,
							);
							const pct = total > 0 ? Math.round((value / total) * 100) : 0;
							const label = context.label || '';
							return `${label}: ${value} (${pct}%)`;
						},
					},
				},
			},
		},
	});
}

function bindEvents() {
	$('back-btn')?.addEventListener('click', () => window.history.back());
	$('results-btn')?.addEventListener('click', async () => {
		pendingResultsScroll = true;
		await handleResultsShortcut();
	});
	$('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=multiple`;
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

	$('submit-vote')?.addEventListener('click', submitVote);

	document.querySelectorAll('.share-option').forEach((button) => {
		button.addEventListener('click', (event) => {
			shareOnPlatform(event.currentTarget?.dataset?.platform || '');
		});
	});

	$('options-list')?.addEventListener('click', (event) => {
		const optionBtn = event.target.closest('[data-choice]');
		if (!optionBtn) return;
		selectedChoice = optionBtn.dataset.choice;
		document
			.querySelectorAll('.flash-option-btn')
			.forEach((btn) =>
				btn.classList.toggle('selected', btn.dataset.choice === selectedChoice),
			);
		$('submit-vote').disabled = !selectedChoice;
	});

	$('opinions-list')?.addEventListener('click', async (event) => {
		const reactionBtn = event.target.closest('[data-reaction]');
		if (!reactionBtn) return;

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
	socket.emit('flash:join', { surveyId, type: 'multiple' });
	flashRoomJoined = true;
}

function leaveFlashRoom() {
	if (!socket?.connected || !flashRoomJoined) return;
	socket.emit('flash:leave', { surveyId, type: 'multiple' });
	flashRoomJoined = false;
}

function initializeSocket() {
	if (typeof window.io !== 'function') {
		showNotification(
			t(
				'survey_flash_multiple.live_updates_unavailable',
				'Mises a jour en temps reel indisponibles. Rafraichissez la page.',
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
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'multiple') {
			return;
		}

		hydrateOptions(payload);
		renderChoiceButtons();
		applyCounts(payload.counts || {}, payload.totalOpinions || 0);

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
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'multiple') return;
		removeOpinionComment(payload.opinionId);
	});

	socket.on('flash:comment-restored', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'multiple') return;
		if (!hasResultsAccess()) return;
		upsertOpinionCard({
			...payload,
			likeCount: payload.likeCount || 0,
			dislikeCount: payload.dislikeCount || 0,
		});
	});

	socket.on('flash:closed', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'multiple') {
			return;
		}
		handleSurveyClosed();
	});

	socket.on('flash:error', (payload) => {
		if (!payload?.message) return;
		privateMessage = String(payload.message || '').trim();
		canViewResults = false;
		leaveFlashRoom();
		hideResultsSection();
		showClosedNote(getResultsGateMessage());
	});

	socket.on('organizations:membership:update', (payload) => {
		const eventOrgId = String(payload?.organizationId || '').trim();
		const currentOrgId = String(currentSurvey?.organizationId || '').trim();
		if (eventOrgId && currentOrgId && eventOrgId !== currentOrgId) return;
		void refreshState().catch((error) => {
			console.error('flash multiple membership refresh failed:', error);
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

	hydrateOptions(currentSurvey || {});
	renderSurveyHeader();
	renderChoiceButtons();

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
		return;
	}

	if (hasResultsAccess()) {
		hideVoteSection();
		await loadDetailedResults();
		joinFlashRoomIfAllowed();
		return;
	}

	if (state.isClosed) {
		hideVoteSection();
		hideResultsSection();
		leaveFlashRoom();
		showClosedNote(
			getResultsGateMessage() ||
				t(
					'survey_flash_multiple.closed_private_results',
					'Ce sondage est cloture. Les resultats sont reserves aux votants.',
				),
		);
		return;
	}

	hideVoteSection();
	hideResultsSection();
	leaveFlashRoom();
	showClosedNote(getResultsGateMessage());
}

function renderSurveyHeader() {
	$('survey-theme').textContent = currentSurvey?.theme || 'Sondage';
	$('survey-question').textContent =
		currentSurvey?.question || 'Question indisponible';
	$('survey-contexte').textContent = currentSurvey?.contexte || '';
	const createdAtLabel = $('created-date');
	const endedAtLabel = $('ended-date');
	if (createdAtLabel) {
		createdAtLabel.textContent = `Creation: ${formatDate(currentSurvey?.createdAt)}`;
	}
	if (endedAtLabel) {
		endedAtLabel.textContent =
			currentSurvey?.endedAt ?
				`Cloture: ${formatDate(currentSurvey.endedAt)}`
			: 'Cloture: En cours';
	}

	const statusBadge = $('status-badge');
	if (!statusBadge) return;

	if (currentSurvey?.isClosed) {
		statusBadge.innerHTML = '<i class="fas fa-lock"></i> Sondage cloture';
		statusBadge.className = 'status-badge closed';
	} else {
		statusBadge.innerHTML = '<i class="fas fa-unlock"></i> Sondage ouvert';
		statusBadge.className = 'status-badge open';
	}
}

function renderChoiceButtons() {
	const container = $('options-list');
	if (!container) return;

	container.innerHTML = optionKeys
		.map((key, index) => {
			const color = getOptionColorByIndex(index);
			const label = optionLabels[key] || `Option ${index + 1}`;
			return `
				<button
					class="flash-option-btn ${selectedChoice === key ? 'selected' : ''}"
					type="button"
					data-choice="${key}"
					style="--option-color: ${color};"
				>
					<span class="flash-option-key">${String.fromCharCode(65 + index)}</span>
					<span class="flash-option-label">${escapeHtml(label)}</span>
				</button>
			`;
		})
		.join('');

	const submitBtn = $('submit-vote');
	if (submitBtn) {
		submitBtn.disabled = !selectedChoice || !canVote;
	}
}

async function submitVote(attempt = 0, turnstileTokenOverride = null) {
	if (!selectedChoice || !optionKeys.includes(selectedChoice)) {
		showNotification(
			t('survey_flash_multiple.select_option_first', 'Selectionnez une option avant de valider.'),
			'warning',
		);
		return;
	}

	const submitBtn = $('submit-vote');
	submitBtn.disabled = true;
	submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

	try {
		const reason = String($('reason-input')?.value || '').trim();
		const bodyPayload = {
			choice: selectedChoice,
			reason: reason || undefined,
			locale: window.SiteI18n?.getLanguage?.() || 'fr',
		};
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
				'Vote Flash recu mais place en quarantaine. Il n est pas encore inclus dans les resultats clean.',
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
				t('survey_flash_multiple.vote_saved', 'Vote Flash enregistre.'),
				'success',
			);
		}
		hasParticipated = Boolean(payload?.hasParticipated ?? true);
		canVote = Boolean(payload?.canVote ?? false);
		canViewResults = Boolean(payload?.canViewResults ?? true);
		privateMessage = '';
		hideVoteSection();
		await loadDetailedResults();
		joinFlashRoomIfAllowed();
	} catch (error) {
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
					surveyType: 'multiple_flash',
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

		showNotification(
			error.message ||
				t('survey_flash_multiple.vote_send_error', "Impossible d'envoyer votre vote."),
			'error',
		);
		submitBtn.disabled = false;
		submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
	}
}

async function loadDetailedResults() {
	if (!hasResultsAccess()) {
		hideResultsSection();
		leaveFlashRoom();
		showClosedNote(getResultsGateMessage());
		pendingResultsScroll = false;
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

		if (!hasResultsAccess()) {
			hideResultsSection();
			leaveFlashRoom();
			showClosedNote(getResultsGateMessage());
			pendingResultsScroll = false;
			return;
		}

		hydrateOptions(payload);
		renderChoiceButtons();
		applyCounts(payload.counts || {}, payload.totalOpinions || 0);
		opinionsData = sortOpinionsWithPinned(
			(Array.isArray(payload.opinions) ? payload.opinions : []).filter(
				hasOpinionComment,
			),
		);
		renderOpinions(opinionsData);
		showResultsSection({ animate: true });
		hideClosedNote();
		joinFlashRoomIfAllowed();

		if (pendingResultsScroll) {
			await scrollToResultsSectionWhenReady();
			pendingResultsScroll = false;
		}
	} catch (error) {
		if (error?.statusCode === 403) {
			canViewResults = false;
			privateMessage = String(error.message || privateMessage || '').trim();
			leaveFlashRoom();
			hideResultsSection();
			showClosedNote(getResultsGateMessage());
			pendingResultsScroll = false;
			return;
		}
		throw error;
	}
}

async function handleResultsShortcut() {
	if (!hasResultsAccess()) {
		try {
			await refreshState();
		} catch (error) {
			showNotification(error.message || 'Impossible de verifier les droits resultats.', 'error');
			pendingResultsScroll = false;
			return;
		}
		if (!hasResultsAccess()) {
			showClosedNote(getResultsGateMessage());
			showNotification(getResultsGateMessage(), 'info');
			scrollToNode($('closed-note'));
			pendingResultsScroll = false;
			return;
		}
	}

	if ($('results-section')?.classList.contains('hidden')) {
		try {
			await loadDetailedResults();
		} catch (error) {
			showNotification(error.message || 'Impossible de charger les resultats.', 'error');
			return;
		}
	}

	await scrollToResultsSectionWhenReady();
	pendingResultsScroll = false;
}

const nextAnimationFrame = () =>
	new Promise((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});

async function scrollToResultsSectionWhenReady(maxFrames = 16) {
	for (let frame = 0; frame < maxFrames; frame += 1) {
		const section = $('results-section');
		if (
			section &&
			!section.classList.contains('hidden') &&
			section.getBoundingClientRect().height > 0
		) {
			break;
		}
		await nextAnimationFrame();
	}
	scrollToResultsSection();
}

function scrollToResultsSection() {
	const anchor = document.getElementById('live-result-section');
	const section = $('results-section');
	const target =
		section && !section.classList.contains('hidden') ? section : (anchor || section);
	if (!target) return;
	scrollToNode(target);
}

function scrollToNode(targetNode) {
	if (!(targetNode instanceof HTMLElement)) return;
	unlockStaleModalLockIfSafe();
	forceScrollToTarget(targetNode, {
		offset: SCROLL_OFFSET_PX,
		retries: SCROLL_RETRY_DELAYS_MS,
		tolerance: SCROLL_TOLERANCE_PX,
	});
}

function unlockStaleModalLockIfSafe() {
	const modalVisibleCount = countVisibleModals();
	if (modalVisibleCount > 0) return;
	document.body?.classList.remove('modal-open');
	if (document.body) {
		document.body.style.overflow = '';
		document.body.style.overflowY = '';
	}
	if (document.documentElement) {
		document.documentElement.style.overflow = '';
		document.documentElement.style.overflowY = '';
	}
	scrollDebugLog('unlock-modal-open', {
		'body.modal-open': Boolean(document.body?.classList.contains('modal-open')),
		modalVisibleCount,
		bodyOverflow: document.body?.style?.overflow || '',
		htmlOverflow: document.documentElement?.style?.overflow || '',
	});
}

function forceScrollToTarget(
	targetNode,
	{
		offset = SCROLL_OFFSET_PX,
		retries = SCROLL_RETRY_DELAYS_MS,
		tolerance = SCROLL_TOLERANCE_PX,
	} = {},
) {
	if (!(targetNode instanceof HTMLElement)) return;
	const safeOffset = Math.max(0, Number(offset) || 0);
	const safeTolerance = Math.max(0, Number(tolerance) || 0);
	const safeRetries =
		Array.isArray(retries) && retries.length ?
			retries.map((delayMs) => Math.max(0, Number(delayMs) || 0))
		:	[0];

	safeRetries.forEach((delayMs, index) => {
		window.setTimeout(() => {
			unlockStaleModalLockIfSafe();
			attemptScrollToTarget(targetNode, {
				offset: safeOffset,
				tolerance: safeTolerance,
				attemptIndex: index + 1,
				attemptTotal: safeRetries.length,
				highlight: index === 0,
				isLastAttempt: index === safeRetries.length - 1,
			});
		}, delayMs);
	});
}

function attemptScrollToTarget(
	targetNode,
	{
		offset = SCROLL_OFFSET_PX,
		tolerance = SCROLL_TOLERANCE_PX,
		attemptIndex = 1,
		attemptTotal = 1,
		highlight = false,
		isLastAttempt = false,
	} = {},
) {
	if (!(targetNode instanceof HTMLElement)) return;
	const root =
		document.scrollingElement || document.documentElement || document.body;
	const targets = collectScrollTargets(targetNode);
	const snapshotsBefore = captureTargetScrollStates(targets);

	scrollDebugLog('before', {
		attempt: attemptIndex,
		attemptTotal,
		targets: describeScrollTargets(targets),
		states: snapshotsBefore,
		...buildScrollDebugSnapshot(targetNode, root, offset, targets),
	});

	targets.forEach((target) => {
		scrollTargetToOffset(targetNode, target, offset);
	});

	const snapshotsAfter = captureTargetScrollStates(targets);
	const movementDetected = hasAnyTargetMoved(snapshotsBefore, snapshotsAfter);

	const afterRect = targetNode.getBoundingClientRect();
	const measuredDelta = Math.abs(afterRect.top - offset);
	const withinTolerance = measuredDelta <= tolerance;

	scrollDebugLog('after', {
		attempt: attemptIndex,
		attemptTotal,
		measuredDelta: Math.round(measuredDelta),
		withinTolerance,
		movementDetected,
		targets: describeScrollTargets(targets),
		states: snapshotsAfter,
		...buildScrollDebugSnapshot(targetNode, root, offset, targets),
	});

	if (isLastAttempt && !withinTolerance && !movementDetected) {
		applyUltimateScrollFallback(targetNode);
	}

	if (highlight) {
		animateTargetFocus(targetNode);
	}
}

function buildScrollDebugSnapshot(
	targetNode,
	root,
	offset = SCROLL_OFFSET_PX,
	targets = [],
) {
	const rect = targetNode instanceof HTMLElement ? targetNode.getBoundingClientRect() : null;
	const targetTop = Number(rect?.top);
	const delta = Number.isFinite(targetTop) ? Math.abs(targetTop - offset) : null;
	return {
		scrollY: Number(window.scrollY || window.pageYOffset || 0),
		'root.scrollTop': Number(root?.scrollTop || 0),
		'targetRect.top': Number.isFinite(targetTop) ? Math.round(targetTop) : null,
		delta: Number.isFinite(delta) ? Math.round(delta) : null,
		'body.modal-open': Boolean(document.body?.classList.contains('modal-open')),
		modalVisibleCount: countVisibleModals(),
		targetCount: targets.length,
	};
}

function collectScrollTargets(targetNode) {
	if (!(targetNode instanceof HTMLElement)) return [];

	const ordered = [];
	const seen = new Set();
	const pushTarget = (target) => {
		if (!target) return;
		if (seen.has(target)) return;
		seen.add(target);
		ordered.push(target);
	};

	getScrollableAncestors(targetNode).forEach((ancestor) => pushTarget(ancestor));

	const knownContainers = document.querySelectorAll(
		'main, #flash-app, .dashboard-container, [data-scroll-container], .page-content, .content-wrapper',
	);
	knownContainers.forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (!isScrollableElement(node)) return;
		if (!node.contains(targetNode)) return;
		pushTarget(node);
	});

	const root = document.scrollingElement || document.documentElement || document.body;
	pushTarget(root);
	pushTarget(document.documentElement);
	pushTarget(document.body);

	return ordered;
}

function getScrollableAncestors(node) {
	const ancestors = [];
	let current = node?.parentElement || null;
	while (current && current !== document.body) {
		if (isScrollableElement(current)) ancestors.push(current);
		current = current.parentElement;
	}
	return ancestors;
}

function isScrollableElement(element) {
	if (!(element instanceof HTMLElement)) return false;
	const style = window.getComputedStyle(element);
	const overflowY = String(style.overflowY || '').toLowerCase();
	const canScrollY =
		overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
	return canScrollY && element.scrollHeight > element.clientHeight + 1;
}

function scrollTargetToOffset(targetNode, target, offset = SCROLL_OFFSET_PX) {
	if (!(targetNode instanceof HTMLElement) || !target) return;
	const safeOffset = Math.max(0, Number(offset) || 0);
	const behavior = prefersReducedMotion ? 'auto' : 'smooth';

	const isRootTarget =
		target === window ||
		target === document.scrollingElement ||
		target === document.documentElement ||
		target === document.body;

	if (isRootTarget) {
		const currentTop =
			window.pageYOffset ||
			document.scrollingElement?.scrollTop ||
			document.documentElement.scrollTop ||
			document.body.scrollTop ||
			0;
		const rect = targetNode.getBoundingClientRect();
		const rawTop = currentTop + rect.top - safeOffset;
		const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
		const maxTop = Math.max(
			0,
			((document.scrollingElement || document.documentElement || document.body)?.scrollHeight || 0) -
				viewportHeight,
		);
		const clampedTop = Math.max(0, Math.min(maxTop, Math.round(rawTop)));
		window.scrollTo({ top: clampedTop, behavior });
		const root = document.scrollingElement || document.documentElement || document.body;
		if (root) root.scrollTop = clampedTop;
		return;
	}

	if (!(target instanceof HTMLElement)) return;
	const targetRect = targetNode.getBoundingClientRect();
	const containerRect = target.getBoundingClientRect();
	const rawTop = target.scrollTop + (targetRect.top - containerRect.top) - safeOffset;
	const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
	const clampedTop = Math.max(0, Math.min(maxTop, Math.round(rawTop)));
	if (typeof target.scrollTo === 'function') {
		target.scrollTo({ top: clampedTop, behavior });
	} else {
		target.scrollTop = clampedTop;
	}
	target.scrollTop = clampedTop;
}

function captureTargetScrollStates(targets = []) {
	return targets.map((target) => ({
		key: getScrollTargetKey(target),
		top: getScrollTopForTarget(target),
	}));
}

function hasAnyTargetMoved(beforeStates = [], afterStates = []) {
	const beforeByKey = new Map();
	beforeStates.forEach((state) => beforeByKey.set(state.key, Number(state.top || 0)));
	return afterStates.some((state) => {
		const beforeTop = Number(beforeByKey.get(state.key) || 0);
		const afterTop = Number(state.top || 0);
		return Math.abs(afterTop - beforeTop) > 1;
	});
}

function getScrollTopForTarget(target) {
	const isRootTarget =
		target === window ||
		target === document.scrollingElement ||
		target === document.documentElement ||
		target === document.body;
	if (isRootTarget) {
		return Number(
			window.pageYOffset ||
				document.scrollingElement?.scrollTop ||
				document.documentElement.scrollTop ||
				document.body.scrollTop ||
				0,
		);
	}
	return Number(target?.scrollTop || 0);
}

function getScrollTargetKey(target) {
	const isRootTarget =
		target === window ||
		target === document.scrollingElement ||
		target === document.documentElement ||
		target === document.body;
	if (isRootTarget) return 'root';
	if (!(target instanceof HTMLElement)) return 'unknown';
	const id = target.id ? `#${target.id}` : '';
	const className = String(target.className || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 3)
		.map((name) => `.${name}`)
		.join('');
	return `${target.tagName.toLowerCase()}${id}${className}`;
}

function describeScrollTargets(targets = []) {
	return targets.map((target) => getScrollTargetKey(target));
}

function applyUltimateScrollFallback(targetNode) {
	if (!(targetNode instanceof HTMLElement)) return;
	targetNode.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
	const root = document.scrollingElement || document.documentElement || document.body;
	const currentTop = getScrollTopForTarget(root);
	const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
	const maxTop = Math.max(0, (root?.scrollHeight || 0) - viewportHeight);
	const clampedTop = Math.max(
		0,
		Math.min(maxTop, Math.round(currentTop - SCROLL_OFFSET_PX)),
	);
	window.scrollTo({ top: clampedTop, behavior: 'auto' });
	if (root) root.scrollTop = clampedTop;
	scrollDebugLog('ultimate-fallback', {
		targetTop: clampedTop,
		...buildScrollDebugSnapshot(targetNode, root, SCROLL_OFFSET_PX),
	});
}

function countVisibleModals() {
	return document.querySelectorAll('.modal:not(.hidden)').length;
}

function scrollDebugLog(stage, payload) {
	if (!debugScroll) return;
	console.log(`[survey-flash-multiple][scroll:${stage}]`, payload);
}

function animateTargetFocus(targetNode) {
	if (!(targetNode instanceof HTMLElement)) return;
	targetNode.classList.remove('scroll-targeted');
	void targetNode.offsetWidth;
	targetNode.classList.add('scroll-targeted');
	window.setTimeout(() => {
		targetNode.classList.remove('scroll-targeted');
	}, 680);
}

function applyCounts(counts, totalOpinions) {
	const mappedCounts = {};
	optionKeys.forEach((key) => {
		mappedCounts[key] = Number(counts?.[key] || 0);
	});

	const safeTotal =
		Number(totalOpinions || 0) ||
		optionKeys.reduce((sum, key) => sum + Number(mappedCounts[key] || 0), 0);

	$('votes-count').innerHTML = `<i class="fas fa-users"></i> ${safeTotal} vote${
		safeTotal > 1 ? 's' : ''
	}`;
	$('results-count').textContent = `${safeTotal} votant${safeTotal > 1 ? 's' : ''}`;

	const series = buildSeriesFromCounts(mappedCounts);
	renderProgressLegend(series);
	renderResultLines(series, safeTotal);
	updateResultsChart(series);
}

function renderProgressLegend(series) {
	const node = $('progress-legend');
	if (!node) return;

	node.innerHTML = series
		.map((item) => {
			const strongBorder = hexToRgba(item.color, 0.44);
			const softBg = hexToRgba(item.color, 0.14);
			return `
				<span class="legend-item" style="border-color:${strongBorder}; background:${softBg};">
					<span class="legend-dot" style="background:${item.color};" aria-hidden="true"></span>
					<span>${escapeHtml(item.label)}</span>
				</span>
			`;
		})
		.join('');
}

function renderResultLines(series, total) {
	const node = $('result-lines');
	if (!node) return;
	const votesLabel = t('survey_flash_multiple.votes_label', 'vote(s)');

	node.innerHTML = series
		.map((item) => {
			const percentage = total > 0 ? Math.round((item.value / total) * 100) : 0;
			const borderColor = hexToRgba(item.color, 0.48);
			const bgStart = hexToRgba(item.color, 0.16);
			const bgEnd = hexToRgba(item.color, 0.04);

			return `
				<div class="flash-result-line" style="border-color:${borderColor}; background: linear-gradient(180deg, ${bgStart} 0%, ${bgEnd} 100%);">
					<strong>${escapeHtml(item.label)}</strong><br />${item.value} ${votesLabel} - ${percentage}%
				</div>
			`;
		})
		.join('');
}

function updateResultsChart(series) {
	if (!resultsChart) {
		initializeResultsChart();
	}
	if (!resultsChart) return;

	resultsChart.data.labels = series.map((item) => item.label);
	resultsChart.data.datasets[0].data = series.map((item) => Number(item.value || 0));
	resultsChart.data.datasets[0].backgroundColor = series.map((item) => item.color);
	resultsChart.data.datasets[0].borderColor = series.map((item) =>
		hexToRgba(item.color, 0.92),
	);
	resultsChart.update();
}

function hexToRgba(color, alpha = 1) {
	const normalized = String(color || '').trim();
	if (!normalized.startsWith('#')) return normalized;

	let hex = normalized.slice(1);
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((char) => char + char)
			.join('');
	}

	if (hex.length !== 6) return normalized;

	const intValue = Number.parseInt(hex, 16);
	if (!Number.isFinite(intValue)) return normalized;

	const red = (intValue >> 16) & 255;
	const green = (intValue >> 8) & 255;
	const blue = intValue & 255;
	const safeAlpha = Math.max(0, Math.min(1, Number(alpha)));

	return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`;
}

function renderOpinions(opinions = opinionsData, animatedIds = new Set()) {
	const list = $('opinions-list');
	const empty = $('empty-opinions');
	if (!list || !empty) return;

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

	const answerKey = String(opinion.answer || '').trim();
	const answerLabel = optionLabels[answerKey] || answerKey;
	const answerColor = getOptionColor(answerKey);
	const content = opinion.reason?.trim();
	const safePseudo = escapeHtml(opinion.userPseudo || 'Anonyme');
	const avatarLetter = safePseudo.charAt(0).toUpperCase() || 'A';
	const chipBg = hexToRgba(answerColor, 0.2);
	const chipBorder = hexToRgba(answerColor, 0.4);

	card.innerHTML = `
		<div class="flash-opinion-header">
			<div class="flash-author">
				<span class="flash-avatar">${avatarLetter}</span>
				<strong class="flash-user">${safePseudo}</strong>
				${buildPinnedBadge(opinion)}
			</div>
			<span class="flash-opinion-answer" style="background:${chipBg}; color:${answerColor}; border-color:${chipBorder};">${escapeHtml(answerLabel)}</span>
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
	if (!hasResultsAccess()) {
		hideResultsSection();
		leaveFlashRoom();
		showClosedNote(getResultsGateMessage());
	}
	showNotification(
		t('survey_flash_multiple.closed_notice', 'Ce sondage Flash est desormais cloture.'),
		'info',
	);
}

function showVoteSection() {
	$('vote-section')?.classList.remove('hidden');
	const submitBtn = $('submit-vote');
	if (submitBtn) {
		submitBtn.disabled = !selectedChoice;
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
		throw new Error('Session expiree, reconnectez-vous.');
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

function shareOnPlatform(platform) {
	const surveyLink = window.location.href;
	const surveyTitle = currentSurvey?.theme || 'Sondage Flash';
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
			: 'Connectez-vous pour acceder a ce sondage Flash et voter en direct.',
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
