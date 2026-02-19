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
let selectedChoice = null;
let optionKeys = [];
let optionLabels = {};
let opinionsData = [];

const $ = (id) => document.getElementById(id);
const t = (key, fallback, parameters) =>
	window.SiteI18n?.t?.(key, fallback, parameters) || fallback;
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

async function initialize() {
	bindEvents();
	initializeResultsChart();

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

	await refreshState();
	initializeSocket();
	hideLoading();
}

function initializeResultsChart() {
	const canvas = $('flash-results-chart');
	if (!canvas || typeof window.Chart !== 'function') return;

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

		hydrateOptions(payload);
		renderChoiceButtons();
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

	hydrateOptions(currentSurvey || {});
	renderSurveyHeader();
	renderChoiceButtons();

	if (canVote) {
		showVoteSection();
		hideResultsSection();
		hideClosedNote();
		return;
	}

	if (canViewResults) {
		hideVoteSection();
		await loadDetailedResults();
		return;
	}

	if (state.isClosed) {
		hideVoteSection();
		hideResultsSection();
		showClosedNote(
			state.message ||
				t(
					'survey_flash_multiple.closed_private_results',
					'Ce sondage est cloture. Les resultats sont reserves aux votants.',
				),
		);
		return;
	}

	showVoteSection();
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

async function submitVote() {
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
		await apiRequest(`${CONFIG.api.answer}/${surveyId}/answer`, {
			method: 'POST',
			body: JSON.stringify({
				choice: selectedChoice,
				reason: reason || undefined,
			}),
		});

		showNotification(t('survey_flash_multiple.vote_saved', 'Vote Flash enregistre.'), 'success');
		hasParticipated = true;
		canVote = false;
		canViewResults = true;
		hideVoteSection();
		await loadDetailedResults();
	} catch (error) {
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
	const payload = await apiRequest(
		`${CONFIG.api.detailedResults}/${surveyId}/detailed-results`,
	);

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
	return Boolean(String(opinion?.reason || '').trim());
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
		throw new Error('Session expiree, reconnectez-vous.');
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
