/** @format */

const CONFIG = {
	api: {
		state: '/api/survey-2-flash',
		detailedResults: '/api/survey-2-flash',
		answer: '/api/survey-2-flash',
		reaction: '/api/opinion-2-flash',
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
let segmentedProgress = null;
let socket = null;
let selectedChoice = null;
let optionLabels = {
	reponse_1: 'Option 1',
	reponse_2: 'Option 2',
	reponse_3: 'Option 3',
};
const OPTION_META = {
	reponse_1: { color: '#6366f1', colorLabel: 'Violet' },
	reponse_2: { color: '#10b981', colorLabel: 'Vert' },
	reponse_3: { color: '#f59e0b', colorLabel: 'Orange' },
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
	initialize().catch((error) => {
		console.error('survey-flash-multiple init error:', error);
		showNotification('Impossible de charger ce sondage Flash.', 'error');
		redirectToBrowse();
	});
});

async function initialize() {
	bindEvents();
	initializeProgress();

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

function initializeProgress() {
	const host = $('flash-progress');
	if (!host || typeof window.SiteSegmentedProgress !== 'function') return;
	segmentedProgress = new window.SiteSegmentedProgress(host);
}

function bindEvents() {
	$('back-btn')?.addEventListener('click', () => window.history.back());
	$('chat-btn')?.addEventListener('click', () => {
		window.location.href = `chatroom.html?surveyId=${surveyId}&type=multiple`;
	});

	$('submit-vote')?.addEventListener('click', submitVote);

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
		if (socket?.connected) {
			socket.emit('flash:leave', { surveyId, type: 'multiple' });
		}
	});
}

function initializeSocket() {
	socket = io();

	socket.on('connect', () => {
		socket.emit('flash:join', { surveyId, type: 'multiple' });
	});

	socket.on('flash:counts', (payload) => {
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'multiple') {
			return;
		}
		applyCounts(payload.counts || {}, payload.totalOpinions || 0);
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
		if (!payload || payload.surveyId !== surveyId || payload.type !== 'multiple') {
			return;
		}
		handleSurveyClosed();
	});
}

async function refreshState() {
	const state = await apiRequest(`${CONFIG.api.state}/${surveyId}/state`);

	currentSurvey = state.survey;
	hasParticipated = Boolean(state.hasParticipated);
	canVote = Boolean(state.canVote);
	canViewResults = Boolean(state.canViewResults);
	optionLabels = {
		reponse_1: currentSurvey?.reponse_1 || 'Option 1',
		reponse_2: currentSurvey?.reponse_2 || 'Option 2',
		reponse_3: currentSurvey?.reponse_3 || 'Option 3',
	};

	renderSurveyHeader();
	renderChoiceButtons();

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
				`Cloture: ${formatDate(currentSurvey.endedAt)}`
			:	'Cloture: En cours';
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

function renderChoiceButtons() {
	const container = $('options-list');
	if (!container) return;

	container.innerHTML = `
		<button class="flash-option-btn" type="button" data-choice="reponse_1">${escapeHtml(optionLabels.reponse_1)}</button>
		<button class="flash-option-btn" type="button" data-choice="reponse_2">${escapeHtml(optionLabels.reponse_2)}</button>
		<button class="flash-option-btn" type="button" data-choice="reponse_3">${escapeHtml(optionLabels.reponse_3)}</button>
	`;
}

async function submitVote() {
	if (!selectedChoice) {
		showNotification('Sélectionnez une option avant de valider.', 'warning');
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
				choice: selectedChoice,
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

	optionLabels = payload.labels || optionLabels;

	const counts = payload.counts || {
		reponse_1: 0,
		reponse_2: 0,
		reponse_3: 0,
	};

	applyCounts(counts, payload.totalOpinions || 0);
	renderOpinions(payload.opinions || []);
	showResultsSection();
	hideClosedNote();
}

function applyCounts(counts, totalOpinions) {
	const safeCounts = {
		reponse_1: Number(counts.reponse_1 || 0),
		reponse_2: Number(counts.reponse_2 || 0),
		reponse_3: Number(counts.reponse_3 || 0),
	};
	const safeTotal = Number(
		totalOpinions ||
			safeCounts.reponse_1 + safeCounts.reponse_2 + safeCounts.reponse_3,
	);

	$('votes-count').innerHTML = `<i class="fas fa-users"></i> ${safeTotal} vote${
		safeTotal > 1 ? 's' : ''
	}`;
	$('results-count').textContent = `${safeTotal} votant${safeTotal > 1 ? 's' : ''}`;

	const series = buildResultSeries(safeCounts);
	renderProgressLegend(series);
	renderResultLines(series, safeTotal);
	updateSegmentedProgress(series, safeTotal);
}

function buildResultSeries(counts) {
	return [
		{
			key: 'reponse_1',
			label: optionLabels.reponse_1,
			value: Number(counts.reponse_1 || 0),
			color: OPTION_META.reponse_1.color,
			colorLabel: OPTION_META.reponse_1.colorLabel,
		},
		{
			key: 'reponse_2',
			label: optionLabels.reponse_2,
			value: Number(counts.reponse_2 || 0),
			color: OPTION_META.reponse_2.color,
			colorLabel: OPTION_META.reponse_2.colorLabel,
		},
		{
			key: 'reponse_3',
			label: optionLabels.reponse_3,
			value: Number(counts.reponse_3 || 0),
			color: OPTION_META.reponse_3.color,
			colorLabel: OPTION_META.reponse_3.colorLabel,
		},
	];
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
					<span>${escapeHtml(item.label)} = ${escapeHtml(item.colorLabel)}</span>
				</span>
			`;
		})
		.join('');
}

function renderResultLines(series, total) {
	const node = $('result-lines');
	if (!node) return;

	node.innerHTML = series
		.map((item) => {
			const percentage = total > 0 ? Math.round((item.value / total) * 100) : 0;
			const borderColor = hexToRgba(item.color, 0.48);
			const bgStart = hexToRgba(item.color, 0.16);
			const bgEnd = hexToRgba(item.color, 0.04);

			return `
				<div class="flash-result-line" style="border-color:${borderColor}; background: linear-gradient(180deg, ${bgStart} 0%, ${bgEnd} 100%);">
					<strong>${escapeHtml(item.label)}</strong><br />${item.value} vote(s) - ${percentage}%
				</div>
			`;
		})
		.join('');
}

function updateSegmentedProgress(series, total) {
	if (!segmentedProgress) return;
	segmentedProgress.setData(
		series.map((item) => ({
			label: item.label,
			value: item.value,
			color: item.color,
		})),
		total,
	);
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

function renderOpinions(opinions) {
	const list = $('opinions-list');
	const empty = $('empty-opinions');
	if (!list || !empty) return;

	list.innerHTML = '';
	const visibleOpinions =
		Array.isArray(opinions) ? opinions.filter(hasOpinionComment) : [];

	if (visibleOpinions.length === 0) {
		empty.classList.remove('hidden');
		return;
	}

	empty.classList.add('hidden');
	visibleOpinions.forEach((opinion) => {
		list.appendChild(buildOpinionCard(opinion));
	});
}

function hasOpinionComment(opinion) {
	return Boolean(String(opinion?.reason || '').trim());
}

function buildOpinionCard(opinion) {
	const card = document.createElement('article');
	card.className = 'flash-opinion';
	card.id = `flash-opinion-${opinion._id}`;

	const answerLabel = optionLabels[opinion.answer] || opinion.answer;
	const answerKey = String(opinion.answer || '').toLowerCase();
	const content = opinion.reason?.trim();
	const safePseudo = escapeHtml(opinion.userPseudo || 'Anonyme');
	const avatarLetter = safePseudo.charAt(0).toUpperCase() || 'A';

	card.innerHTML = `
		<div class="flash-opinion-header">
			<div class="flash-author">
				<span class="flash-avatar">${avatarLetter}</span>
				<strong class="flash-user">${safePseudo}</strong>
			</div>
			<span class="flash-opinion-answer flash-opinion-answer--${escapeHtml(answerKey)}">${escapeHtml(answerLabel)}</span>
		</div>
		<div class="flash-opinion-content">
			${escapeHtml(content)}
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
	if (!hasOpinionComment(opinion)) return;

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
		submitBtn.disabled = !selectedChoice;
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

function formatDate(value) {
	if (!value) return '--';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return '--';
	return parsed.toLocaleString('fr-FR', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}
