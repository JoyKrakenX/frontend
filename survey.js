/** @format */

const CONFIG = {
	api: {
		survey: '/api/survey',
		state: '/api/survey',
		detailedResults: '/api/survey',
		reaction: '/api/opinion',
	},
	colors: {
		yes: '#10b981',
		no: '#ef4444',
	},
};

const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const params = new URLSearchParams(window.location.search);
const surveyId = params.get('id');
const token = localStorage.getItem('token');

let currentSurvey = null;
let selectedOpinion = null;
let isSubmitting = false;
let hasParticipated = false;
let canVote = false;
let canViewResults = false;
let privateMessage = '';
let liveChart = null;
let opinionsData = [];
let filteredOpinions = [];
let userReactions = new Map();
let socket = null;
let classicRoomJoined = false;

const USE_SHARED_USER_MENU = () =>
	document.body?.dataset?.sharedUserMenu === 'true';

function getLiveResultsGateMessage() {
	return (
		privateMessage ||
		t(
			'shared.surveys.vote_required_for_live_results',
			'Votez pour acceder aux resultats en temps reel.',
		)
	);
}

function hasLiveResultsAccess() {
	return Boolean(canViewResults && hasParticipated);
}

document.addEventListener('DOMContentLoaded', () => {
	if (!surveyId) {
		showNotification('Sondage invalide.', 'error');
		return redirectToBrowse();
	}

	if (!token) {
		showNotification(
			t('shared.auth.login_required_for_survey', 'Veuillez vous connecter pour participer.'),
			'warning',
		);
		return redirectToBrowse();
	}

	bindEvents();
	initializeLiveChart();
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

	document.getElementById('browse-other')?.addEventListener('click', () => {
		window.location.href = 'browse-surveys.html';
	});

	document.getElementById('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=binary`;
	});
	document.getElementById('chat-btn-closed')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=binary`;
	});

	document.getElementById('share-btn')?.addEventListener('click', () => {
		document.getElementById('share-modal')?.classList.remove('hidden');
	});

	document.getElementById('yes-button')?.addEventListener('change', handleOpinionSelection);
	document.getElementById('no-button')?.addEventListener('change', handleOpinionSelection);
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
		?.addEventListener('input', filterOpinionsBySearch);

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

			if (hasLiveResultsAccess()) {
				await loadDetailedResults({ animate: false });
				ensureClassicSocket();
			} else if (!canVote) {
				showPrivateNote(getLiveResultsGateMessage());
			}

		showLoading(false);
	} catch (error) {
		console.error('survey state load failed:', error);
		showLoading(false);
		showNotification(error.message || 'Erreur de chargement.', 'error');
	}
}

function renderSurvey(survey) {
	document.getElementById('survey-theme').textContent = survey.theme || '';
	document.getElementById('survey-question').textContent = survey.question || '';
	document.getElementById('survey-contexte').innerHTML = `<p>${
		survey.contexte || t('shared.surveys.no_context', 'Aucun contexte fourni.')
	}</p>`;

	if (survey.createdAt) {
		const createdDate = new Date(survey.createdAt);
		document.getElementById('survey-date').textContent =
			createdDate.toLocaleDateString('fr-FR', {
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
			t('shared.surveys.status_closed', 'Sondage cloture');
		surveyStatus.textContent = t(
			'shared.surveys.status_closed_detail',
			'Sondage cloture - vote ferme',
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
	document.querySelector('.dashboard-container')?.classList.remove('hidden');
}

function applyAccessState() {
	const responseSection = document.getElementById('response-section');
	const closedSection = document.getElementById('closed-survey-section');

	if (canVote) {
		responseSection?.classList.remove('hidden');
		closedSection?.classList.add('hidden');
		hidePrivateNote();
		hideLiveResults();
		return;
	}

	responseSection?.classList.add('hidden');

	if (hasLiveResultsAccess()) {
		closedSection?.classList.add('hidden');
		hidePrivateNote();
		return;
	}

	closedSection?.classList.remove('hidden');
	hideLiveResults();
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

function handleOpinionSelection(event) {
	const choice = event.target.value;
	const isYes = choice === 'true';

	const modalIcon = document.getElementById('modal-choice-icon');
	const modalTitle = document.getElementById('modal-choice-title');
	const modalDesc = document.getElementById('modal-choice-desc');

	if (isYes) {
		modalIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
		modalIcon.style.background = 'linear-gradient(135deg, var(--yes-color), #059669)';
		modalTitle.textContent = t('shared.answers.yes', 'Oui');
		modalDesc.textContent = t('shared.answers.yes_desc', "Vous etes d'accord / favorable");
	} else {
		modalIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
		modalIcon.style.background = 'linear-gradient(135deg, var(--no-color), #dc2626)';
		modalTitle.textContent = t('shared.answers.no', 'Non');
		modalDesc.textContent = t('shared.answers.no_desc', "Vous n'etes pas d'accord / defavorable");
	}

	selectedOpinion = choice;
	document.getElementById('confirm-modal').classList.remove('hidden');
	updateCharCount();
}

function confirmChoice() {
	document.getElementById('confirm-modal').classList.add('hidden');
	document.querySelector('.response-options')?.classList.add('hidden');
	document.getElementById('reason-section')?.classList.remove('hidden');
	setTimeout(() => {
		document.getElementById('opinion-text')?.focus();
	}, 200);
	updateCharCount();
}

function cancelChoice() {
	document.getElementById('yes-button').checked = false;
	document.getElementById('no-button').checked = false;
	selectedOpinion = null;
	document.querySelector('.response-options')?.classList.remove('hidden');
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

	if (!selectedOpinion || length === 0) {
		charCount.style.color = 'var(--text-secondary)';
		submitBtn.disabled = true;
		return;
	}

	charCount.style.color = '#10b981';
	submitBtn.disabled = false;
}

async function submitFinalAnswer() {
	if (isSubmitting) return;

	const reason = String(document.getElementById('opinion-text')?.value || '').trim();
	const submitBtn = document.getElementById('submit-opinion');

	if (!selectedOpinion) {
		showNotification(
			t('shared.surveys.select_answer_first', "Veuillez d'abord selectionner une opinion."),
			'error',
		);
		return;
	}

	if (!reason) {
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
		const answerBoolean = selectedOpinion === 'true';
		const payload = await apiRequest(
			`${CONFIG.api.survey}/${encodeURIComponent(surveyId)}/answer`,
			{
				method: 'POST',
				body: JSON.stringify({
					answer: answerBoolean,
					reason,
				}),
			},
		);

		hasParticipated = Boolean(payload?.hasParticipated ?? true);
		canVote = false;
		canViewResults = Boolean(payload?.canViewResults ?? true);
		privateMessage = '';

		showNotification(
			t('shared.surveys.vote_saved', 'Votre reponse a ete enregistree.'),
			'success',
		);

			applyAccessState();
			await loadDetailedResults({ animate: true });
			if (hasLiveResultsAccess()) {
				ensureClassicSocket();
				scrollToLiveResults();
			}
		} catch (error) {
		showNotification(error.message || 'Erreur reseau.', 'error');
		submitBtn.disabled = false;
		submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Soumettre ma reponse';
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

		if (!hasLiveResultsAccess()) {
			hideLiveResults();
			showPrivateNote(getLiveResultsGateMessage());
			return;
		}

		if (currentSurvey && data?.isClosed !== undefined) {
			currentSurvey.isClosed = Boolean(data.isClosed);
			renderSurvey(currentSurvey);
		}

		applyCountsFromPayload(data);
		opinionsData = sortOpinionsWithPinned(data?.opinions || []);
		filteredOpinions = [...opinionsData];
		renderOpinions(filteredOpinions);
		showLiveResults(animate);
		hidePrivateNote();
	} catch (error) {
		if (error?.statusCode === 403) {
			canViewResults = false;
			privateMessage = String(error.message || '').trim();
			showPrivateNote(getLiveResultsGateMessage());
			hideLiveResults();
			return;
		}
		showNotification(error.message || 'Impossible de charger les resultats.', 'error');
	}
}

function applyCountsFromPayload(payload) {
	const yesCount = Number(payload?.yesCount ?? payload?.counts?.yes ?? 0);
	const noCount = Number(payload?.noCount ?? payload?.counts?.no ?? 0);
	const total = Number(payload?.totalOpinions ?? yesCount + noCount);

	updateVotesCount(total);
	document.getElementById('live-results-count').textContent = `${total} votant${
		total > 1 ? 's' : ''
	}`;
	updateLiveChart(yesCount, noCount);
	renderResultLines(yesCount, noCount, total);
}

function initializeLiveChart() {
	const canvas = document.getElementById('live-results-chart');
	if (!canvas || typeof window.Chart !== 'function') return;

	liveChart = new window.Chart(canvas, {
		type: 'doughnut',
		data: {
			labels: [t('shared.answers.yes', 'Oui'), t('shared.answers.no', 'Non')],
			datasets: [
				{
					data: [0, 0],
					backgroundColor: [CONFIG.colors.yes, CONFIG.colors.no],
					borderColor: ['#064e3b', '#7f1d1d'],
					borderWidth: 2,
					hoverOffset: 8,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			cutout: '55%',
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
							const dataset = context.dataset?.data || [];
							const total = dataset.reduce(
								(sum, item) => sum + Number(item || 0),
								0,
							);
							const percent = total > 0 ? Math.round((value / total) * 100) : 0;
							return `${context.label}: ${value} (${percent}%)`;
						},
					},
				},
			},
		},
	});
}

function updateLiveChart(yes, no) {
	if (!liveChart) initializeLiveChart();
	if (!liveChart) return;

	liveChart.data.datasets[0].data = [Number(yes || 0), Number(no || 0)];
	liveChart.update();
}

function renderResultLines(yes, no, total) {
	const container = document.getElementById('live-result-lines');
	if (!container) return;

	const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
	const noPct = total > 0 ? Math.round((no / total) * 100) : 0;

	container.innerHTML = `
		<div class="live-result-line yes">
			<strong>${t('shared.answers.yes', 'Oui')}</strong>
			<div>${yes} vote(s) - ${yesPct}%</div>
		</div>
		<div class="live-result-line no">
			<strong>${t('shared.answers.no', 'Non')}</strong>
			<div>${no} vote(s) - ${noPct}%</div>
		</div>
	`;
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

function filterOpinionsBySearch() {
	const query = String(
		document.getElementById('live-search-opinions')?.value || '',
	).toLowerCase();

	if (!query) {
		filteredOpinions = [...opinionsData];
		renderOpinions(filteredOpinions);
		return;
	}

	filteredOpinions = opinionsData.filter((opinion) => {
		const pseudo = String(opinion?.userPseudo || '').toLowerCase();
		const reason = String(opinion?.reason || '').toLowerCase();
		return pseudo.includes(query) || reason.includes(query);
	});
	renderOpinions(filteredOpinions);
}

function renderOpinions(opinions = []) {
	const list = document.getElementById('live-opinions-list');
	const emptyNode = document.getElementById('live-no-opinions');
	if (!list || !emptyNode) return;

	list.innerHTML = '';
	const visible = sortOpinionsWithPinned(opinions || []).filter((entry) =>
		String(entry?.reason || '').trim(),
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
	const answerLabel = opinion.answer ? t('shared.answers.yes', 'Oui') : t('shared.answers.no', 'Non');
	const answerClass = opinion.answer ? 'yes' : 'no';
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
			<span class="live-opinion-answer ${answerClass}">${answerLabel}</span>
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
	const reason = String(opinion.reason || '').trim();
	if (!reason) return;

	const index = opinionsData.findIndex(
		(entry) => String(entry?._id) === String(opinion._id),
	);
	if (index >= 0) {
		opinionsData[index] = { ...opinionsData[index], ...opinion };
	} else {
		opinionsData.push(opinion);
	}
	filteredOpinions = [...opinionsData];
	filterOpinionsBySearch();
}

function ensureClassicSocket() {
	if (!hasLiveResultsAccess() || typeof window.io !== 'function') return;

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
				hideLiveResults();
				showPrivateNote(privateMessage);
			});
		}

	joinClassicRoom();
}

function isCurrentClassicPayload(payload) {
	return (
		payload &&
		String(payload.surveyId || '') === String(surveyId) &&
		String(payload.type || '') === 'binary'
	);
}

function joinClassicRoom() {
	if (!socket || !socket.connected || classicRoomJoined) return;
	socket.emit('classic:join', { surveyId, type: 'binary' });
	classicRoomJoined = true;
}

function leaveClassicRoom() {
	if (!socket || !socket.connected || !classicRoomJoined) return;
	socket.emit('classic:leave', { surveyId, type: 'binary' });
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

async function apiRequest(url, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			...(options.headers || {}),
		},
	});

	if (response.status === 401) {
		localStorage.removeItem('token');
		showNotification('Session expiree. Reconnectez-vous.', 'warning');
		redirectToBrowse();
		const unauthorized = new Error('Session expiree.');
		unauthorized.statusCode = 401;
		throw unauthorized;
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = new Error(payload.message || `Erreur ${response.status}`);
		error.statusCode = response.status;
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
