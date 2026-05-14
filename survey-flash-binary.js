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
let resultsChart = null;
let socket = null;
let flashRoomJoined = false;
let selectedAnswer = null;
let opinionsData = [];
let privateMessage = '';
let chartDependencyWarned = false;
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
		'survey_flash_binary.chart_unavailable',
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

	const labels = [
		t('survey_flash_binary.answer_yes', 'Oui'),
		t('survey_flash_binary.answer_no', 'Non'),
	];

	resultsChart = new window.Chart(canvas, {
		type: 'doughnut',
		data: {
			labels,
			datasets: [
				{
					data: [0, 0],
					backgroundColor: ['#10b981', '#ef4444'],
					borderColor: ['#064e3b', '#7f1d1d'],
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
			shareOnPlatform(event.currentTarget?.dataset?.platform || '');
		});
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
	$('survey-contexte').textContent = currentSurvey?.contexte || '';
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
	const anchor = document.getElementById('live-result-section');
	const section = $('results-section');
	(anchor || section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyCounts(counts, totalOpinions) {
	const safeYes = Number(counts.yes || 0);
	const safeNo = Number(counts.no || 0);
	const safeTotal = Number(totalOpinions || safeYes + safeNo);

	$('votes-count').innerHTML = `<i class="fas fa-users"></i> ${safeTotal} vote${
		safeTotal > 1 ? 's' : ''
	}`;
	$('results-count').textContent = `${safeTotal} votant${safeTotal > 1 ? 's' : ''}`;

	updateResultsChart(safeYes, safeNo);
	renderResultLines(safeYes, safeNo, safeTotal);
}

function updateResultsChart(yes, no) {
	if (!resultsChart) {
		initializeResultsChart();
	}
	if (!resultsChart) return;

	resultsChart.data.labels = [
		t('survey_flash_binary.answer_yes', 'Oui'),
		t('survey_flash_binary.answer_no', 'Non'),
	];
	resultsChart.data.datasets[0].data = [Number(yes || 0), Number(no || 0)];
	resultsChart.update();
}

function renderResultLines(yes, no, total) {
	const node = $('result-lines');
	if (!node) return;

	const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
	const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
	const yesLabel = t('survey_flash_binary.answer_yes', 'Oui');
	const noLabel = t('survey_flash_binary.answer_no', 'Non');
	const votesLabel = t('survey_flash_binary.votes_label', 'vote(s)');

	node.innerHTML = `
		<div class="flash-result-line yes"><strong>${yesLabel} (vert)</strong><br />${yes} ${votesLabel} - ${yesPct}%</div>
		<div class="flash-result-line no"><strong>${noLabel} (rouge)</strong><br />${no} ${votesLabel} - ${noPct}%</div>
	`;
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

	const answerClass = opinion.answer ? 'yes' : 'no';
	const answerLabel = opinion.answer
		? t('survey_flash_binary.answer_yes', 'Oui')
		: t('survey_flash_binary.answer_no', 'Non');
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

