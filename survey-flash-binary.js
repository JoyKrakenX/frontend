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
const currentUserId = localStorage.getItem('userId');

let currentSurvey = null;
let hasParticipated = false;
let canVote = false;
let canViewResults = false;
let chart = null;
let socket = null;
let selectedAnswer = null;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
	initialize().catch((error) => {
		console.error('survey-flash-binary init error:', error);
		showNotification('Impossible de charger ce sondage Flash.', 'error');
		redirectToBrowse();
	});
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

	await refreshState();
	initializeSocket();
	hideLoading();
}

function bindEvents() {
	$('back-btn')?.addEventListener('click', () => window.history.back());
	$('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=binary`;
	});

	$('answer-yes')?.addEventListener('click', () => setSelectedAnswer(true));
	$('answer-no')?.addEventListener('click', () => setSelectedAnswer(false));
	$('submit-vote')?.addEventListener('click', submitVote);

	$('opinions-list')?.addEventListener('click', async (event) => {
		const reactionBtn = event.target.closest('[data-reaction]');
		if (!reactionBtn) return;

		const opinionId = reactionBtn.dataset.opinionId;
		const reaction = reactionBtn.dataset.reaction;
		if (!opinionId || !reaction) return;

		await sendReaction(opinionId, reaction);
	});

	window.addEventListener('beforeunload', () => {
		if (socket?.connected) {
			socket.emit('flash:leave', { surveyId, type: 'binary' });
		}
	});
}

function initializeSocket() {
	socket = io();

	socket.on('connect', () => {
		socket.emit('flash:join', { surveyId, type: 'binary' });
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
		if (!canViewResults) return;

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
			payload.actorUserId === currentUserId ?
				{
					userLiked: payload.actorUserLiked,
					userDisliked: payload.actorUserDisliked,
				}
			:	null,
		);
	});

	socket.on('flash:closed', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'binary') return;
		handleSurveyClosed();
	});
}

async function refreshState() {
	const state = await apiRequest(`${CONFIG.api.state}/${surveyId}/state`);

	currentSurvey = state.survey;
	hasParticipated = Boolean(state.hasParticipated);
	canVote = Boolean(state.canVote);
	canViewResults = Boolean(state.canViewResults);

	renderSurveyHeader();

	if (canVote) {
		showVoteSection();
		hideResultsSection();
		hideClosedNote();
	} else if (canViewResults) {
		hideVoteSection();
		await loadDetailedResults();
	} else if (state.isClosed) {
		hideVoteSection();
		hideResultsSection();
		showClosedNote(
			state.message ||
				'Ce sondage est clôturé. Les résultats sont réservés aux votants.',
		);
	} else {
		showVoteSection();
	}
}

function renderSurveyHeader() {
	$('survey-theme').textContent = currentSurvey?.theme || 'Sondage';
	$('survey-question').textContent =
		currentSurvey?.question || 'Question indisponible';
	$('survey-contexte').textContent = currentSurvey?.contexte || '';

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

async function submitVote() {
	if (selectedAnswer === null) {
		showNotification('Sélectionnez une réponse avant de valider.', 'warning');
		return;
	}

	const submitBtn = $('submit-vote');
	submitBtn.disabled = true;
	submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

	try {
		const reason = String($('reason-input')?.value || '').trim();
		await apiRequest(`${CONFIG.api.answer}/${surveyId}/answer`, {
			method: 'POST',
			body: JSON.stringify({
				answer: selectedAnswer,
				reason: reason || undefined,
			}),
		});

		showNotification('Vote Flash enregistré.', 'success');
		hasParticipated = true;
		canVote = false;
		canViewResults = true;
		hideVoteSection();
		await loadDetailedResults();
	} catch (error) {
		showNotification(error.message || "Impossible d'envoyer votre vote.", 'error');
		submitBtn.disabled = false;
		submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer';
	}
}

async function loadDetailedResults() {
	const payload = await apiRequest(
		`${CONFIG.api.detailedResults}/${surveyId}/detailed-results`,
	);

	const counts = payload.counts || { yes: 0, no: 0 };
	applyCounts(counts, payload.totalOpinions || 0);
	renderOpinions(payload.opinions || []);
	showResultsSection();
	hideClosedNote();
}

function applyCounts(counts, totalOpinions) {
	const safeYes = Number(counts.yes || 0);
	const safeNo = Number(counts.no || 0);
	const safeTotal = Number(totalOpinions || safeYes + safeNo);

	$('votes-count').innerHTML = `<i class="fas fa-users"></i> ${safeTotal} vote${
		safeTotal > 1 ? 's' : ''
	}`;
	$('results-count').textContent = `${safeTotal} votant${safeTotal > 1 ? 's' : ''}`;

	createOrUpdateChart(safeYes, safeNo);
}

function createOrUpdateChart(yes, no) {
	const ctx = $('flash-chart')?.getContext('2d');
	if (!ctx) return;

	if (!chart) {
		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: ['Oui', 'Non'],
				datasets: [
					{
						label: 'Votes',
						data: [yes, no],
						backgroundColor: ['rgba(16, 185, 129, 0.45)', 'rgba(239, 68, 68, 0.45)'],
						borderColor: ['rgb(16, 185, 129)', 'rgb(239, 68, 68)'],
						borderWidth: 1,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				scales: {
					y: { beginAtZero: true },
				},
			},
		});
		return;
	}

	chart.data.datasets[0].data = [yes, no];
	chart.update();
}

function renderOpinions(opinions) {
	const list = $('opinions-list');
	const empty = $('empty-opinions');
	if (!list || !empty) return;

	list.innerHTML = '';

	if (!Array.isArray(opinions) || opinions.length === 0) {
		empty.classList.remove('hidden');
		return;
	}

	empty.classList.add('hidden');
	opinions.forEach((opinion) => {
		list.appendChild(buildOpinionCard(opinion));
	});
}

function buildOpinionCard(opinion) {
	const card = document.createElement('article');
	card.className = 'flash-opinion';
	card.id = `flash-opinion-${opinion._id}`;

	const answerClass = opinion.answer ? 'yes' : 'no';
	const answerLabel = opinion.answer ? 'Oui' : 'Non';
	const content = opinion.reason?.trim();
	const hasContent = Boolean(content);

	card.innerHTML = `
		<div class="flash-opinion-header">
			<strong>${escapeHtml(opinion.userPseudo || 'Anonyme')}</strong>
			<span class="flash-opinion-answer ${answerClass}">${answerLabel}</span>
		</div>
		<div class="flash-opinion-content ${hasContent ? '' : 'empty'}">
			${hasContent ? escapeHtml(content) : 'Aucun commentaire'}
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

	const existing = $(`flash-opinion-${opinion._id}`);
	if (existing) {
		const replacement = buildOpinionCard(opinion);
		existing.replaceWith(replacement);
	} else {
		list.prepend(buildOpinionCard(opinion));
	}

	empty.classList.add('hidden');
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
		showNotification(error.message || 'Réaction impossible.', 'error');
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

function showResultsSection() {
	$('results-section')?.classList.remove('hidden');
}

function hideResultsSection() {
	$('results-section')?.classList.add('hidden');
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
		throw new Error('Session expirée, reconnectez-vous.');
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.message || `Erreur ${response.status}`);
	}

	return payload;
}

function showNotification(message, type = 'info') {
	window.SiteUI?.notify?.(message, type);
}

function redirectToBrowse() {
	setTimeout(() => {
		window.location.href = 'browse-surveys.html';
	}, 800);
}

function escapeHtml(input) {
	return String(input || '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
