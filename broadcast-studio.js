/** @format */

const params = new URLSearchParams(window.location.search);
const surveyId = params.get('Id') || params.get('id') || '';
const surveyType = params.get('type') || '';
const token = window.SiteApi?.getToken?.() || localStorage.getItem('token') || '';

const state = {
	bootstrap: null,
	candidates: [],
	sessions: [],
	previewMode: 'combined',
	activeTab: 'pilotage',
	socket: null,
	candidateRefreshTimer: null,
	bootstrapRefreshTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const notify = (message, type = 'info') => window.SiteUI?.notify?.(message, type);
const escapeHtml = (value) => window.BroadcastRender?.escapeHtml?.(value) || String(value ?? '');
const t = (key, fallback, params) => window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
const applyPageTranslations = (root = document) => window.SiteI18n?.applyTranslations?.(root);

const formatDateTime = (value) => {
	if (!value) return t('broadcast.common.na', 'N/A');
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return t('broadcast.common.na', 'N/A');
	return date.toLocaleString(getIntlLocale());
};

const getModeLabel = (mode) => {
	const normalized = String(mode || 'combined').trim();
	if (normalized === 'results') return t('broadcast.modes.results', 'Résultats');
	if (normalized === 'chat') return t('broadcast.modes.chat', 'Chat');
	return t('broadcast.modes.combined', 'Mixte');
};

const getSourceLabel = (sourceType) =>
	sourceType === 'survey_comment' ?
		t('broadcast.sources.survey_comment', 'Commentaire')
	:	t('broadcast.sources.chat_message', 'Chat');

const getStateLabel = (stateLabel) => {
	const normalized = String(stateLabel || 'eligible').trim();
	if (normalized === 'approved') return t('broadcast.states.approved', 'Approuvé');
	if (normalized === 'featured') return t('broadcast.states.featured', 'Vedette');
	if (normalized === 'removed') return t('broadcast.states.removed', 'Retiré');
	return t('broadcast.states.eligible', 'Éligible');
};

const summarizeUrl = (value) => {
	const raw = String(value || '').trim();
	if (!raw) return '';
	try {
		const parsed = new URL(raw);
		const token = String(parsed.searchParams.get('token') || '').trim();
		const tokenPreview = token ? `${token.slice(0, 12)}…` : '';
		return `${parsed.host}${parsed.pathname}${tokenPreview ? `?token=${tokenPreview}` : ''}`;
	} catch (_error) {
		return raw.length > 92 ? `${raw.slice(0, 92)}…` : raw;
	}
};

const isFlashStudioContext = () => {
	const requested = String(params.get('flash') || '').trim();
	if (requested === '1' || requested === 'true') return true;
	return String(state.bootstrap?.snapshot?.survey?.mode || '').trim() === 'flash';
};

const setButtonBusy = (button, busyLabel) => {
	if (!button) return () => {};
	if (!button.dataset.originalHtml) {
		button.dataset.originalHtml = button.innerHTML;
	}
	button.disabled = true;
	button.classList.add('is-busy');
	button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(
		busyLabel,
	)}</span>`;
	return () => {
		button.disabled = false;
		button.classList.remove('is-busy');
		button.innerHTML = button.dataset.originalHtml || '';
	};
};

const buildReturnUrl = () => {
	const next = new URLSearchParams();
	if (surveyId) next.set('Id', surveyId);
	if (surveyType) next.set('type', surveyType);
	if (isFlashStudioContext()) next.set('flash', '1');
	return `survey-results-admin.html?${next.toString()}`;
};

const setLoading = (visible) => {
	$('#broadcast-loading')?.classList.toggle('hidden', !visible);
	$('#broadcast-shell')?.classList.toggle('hidden', visible);
};

const showEmptyState = ({ title, message, actions = [] }) => {
	setLoading(false);
	$('#broadcast-shell')?.classList.add('hidden');
	const mount = $('#broadcast-empty-state');
	mount?.classList.remove('hidden');
	window.SiteUI?.renderPageState?.({
		mount,
		variant: 'warning',
		icon: 'fa-tower-broadcast',
		title,
		message,
		actions,
	});
};

const requestJson = async (path, options = {}) =>
	window.SiteApi.request(path, {
		auth: true,
		timeoutMs: 20000,
		...options,
	});

const scheduleBootstrapRefresh = (delay = 250) => {
	if (state.bootstrapRefreshTimer) {
		window.clearTimeout(state.bootstrapRefreshTimer);
	}
	state.bootstrapRefreshTimer = window.setTimeout(() => {
		state.bootstrapRefreshTimer = null;
		void loadBootstrap({ silent: true });
	}, delay);
};

const scheduleCandidateRefresh = (delay = 180) => {
	if (state.candidateRefreshTimer) {
		window.clearTimeout(state.candidateRefreshTimer);
	}
	state.candidateRefreshTimer = window.setTimeout(() => {
		state.candidateRefreshTimer = null;
		void loadCandidates({ silent: true });
	}, delay);
};

const currentCandidateQuery = () => {
	const source = $('#candidate-source-filter')?.value || 'all';
	const candidateState = $('#candidate-state-filter')?.value || 'all';
	const sort = $('#candidate-sort-filter')?.value || 'recommended';
	const search = $('#candidate-search')?.value || '';
	return { source, candidateState, sort, search };
};

async function loadBootstrap({ silent = false } = {}) {
	if (!surveyId) return;
	if (!silent) setLoading(true);
	const payload = await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/studio-bootstrap`);
	state.bootstrap = payload;
	state.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
	state.candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	renderStudio();
	setLoading(false);
}

async function loadCandidates({ silent = false } = {}) {
	if (!surveyId) return;
	const { source, candidateState, sort, search } = currentCandidateQuery();
	const query = new URLSearchParams({
		source,
		state: candidateState,
		sort,
		search,
		limit: '160',
	});
	try {
		const payload = await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/candidates?${query.toString()}`);
		state.candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
		renderCandidates();
		if (!silent) notify(t('broadcast.studio.notifications.inbox_refreshed', 'Inbox broadcast actualisée.'), 'success');
	} catch (error) {
		if (!silent)
			notify(
				error.message ||
					t(
						'broadcast.studio.notifications.refresh_failed',
						"Impossible d'actualiser les candidats.",
					),
				'error',
			);
	}
}

const buildCandidateActions = (candidate) => {
	const buttons = [];
	if (candidate.broadcastState === 'eligible') {
		buttons.push(`<button type="button" class="btn-primary compact-btn" data-candidate-action="approve" data-source-type="${escapeHtml(candidate.sourceType)}" data-source-id="${escapeHtml(candidate.sourceId)}"><i class="fas fa-check"></i> ${escapeHtml(t('broadcast.studio.actions.approve', 'Approuver'))}</button>`);
		buttons.push(`<button type="button" class="btn-secondary compact-btn" data-candidate-action="feature-from-source" data-source-type="${escapeHtml(candidate.sourceType)}" data-source-id="${escapeHtml(candidate.sourceId)}"><i class="fas fa-star"></i> ${escapeHtml(t('broadcast.studio.actions.feature', 'Mettre en avant'))}</button>`);
		return buttons.join('');
	}
	if (candidate.broadcastState === 'featured') {
		buttons.push(`<button type="button" class="btn-secondary compact-btn" data-candidate-action="unfeature" data-cue-id="${escapeHtml(candidate.cueId || '')}"><i class="fas fa-star-half-stroke"></i> ${escapeHtml(t('broadcast.studio.actions.unfeature', 'Retirer la vedette'))}</button>`);
	}
	if (candidate.broadcastState === 'approved') {
		buttons.push(`<button type="button" class="btn-secondary compact-btn" data-candidate-action="feature" data-cue-id="${escapeHtml(candidate.cueId || '')}"><i class="fas fa-star"></i> ${escapeHtml(t('broadcast.studio.actions.feature', 'Mettre en avant'))}</button>`);
	}
	if (candidate.broadcastState === 'approved' || candidate.broadcastState === 'featured') {
		buttons.push(`<button type="button" class="btn-danger compact-btn" data-candidate-action="unapprove" data-cue-id="${escapeHtml(candidate.cueId || '')}"><i class="fas fa-eye-slash"></i> ${escapeHtml(t('broadcast.studio.actions.remove', 'Retirer'))}</button>`);
	}
	return buttons.join('');
};

const renderCandidates = () => {
	const container = $('#candidate-list');
	if (!container) return;
	if (!state.candidates.length) {
		container.innerHTML = `<div class="empty-state-card">${escapeHtml(
			t('broadcast.studio.messages.empty', 'Aucun message éligible pour ce filtre.'),
		)}</div>`;
		return;
	}
	container.innerHTML = state.candidates
		.map((candidate) => {
			const stateClass = String(candidate.broadcastState || 'eligible').replace(/[^a-z_]/gi, '');
			const sourceClass = candidate.sourceType === 'survey_comment' ? 'comment' : 'chat';
			const sourceLabel = getSourceLabel(candidate.sourceType);
			const createdAt = candidate.createdAt ? formatDateTime(candidate.createdAt) : t('broadcast.common.now', 'Maintenant');
			return `
				<article class="candidate-card">
					<div class="candidate-meta">
						<span class="candidate-source-badge ${sourceClass}">${escapeHtml(sourceLabel)}</span>
						<span class="state-badge ${escapeHtml(stateClass)}">${escapeHtml(getStateLabel(candidate.broadcastState))}</span>
						<span class="state-badge eligible">${escapeHtml(
							t('broadcast.studio.messages.score', 'Score {score}', {
								score: Number(candidate.broadcastScore || 0),
							}),
						)}</span>
						<span class="state-badge eligible">${escapeHtml(
							candidate.pseudoSnapshot || t('broadcast.common.participant', 'Participant'),
						)}</span>
						<span class="state-badge eligible">${escapeHtml(createdAt)}</span>
					</div>
					<p class="candidate-text">${escapeHtml(candidate.textSnapshot || '')}</p>
					<div class="candidate-footer">${buildCandidateActions(candidate)}</div>
				</article>
			`;
		})
		.join('');
};

const renderFeaturedInspector = () => {
	const featured = state.bootstrap?.snapshot?.featuredCue || null;
	const mount = $('#studio-featured-card');
	if (!mount) return;
	if (!featured) {
		mount.className = 'featured-placeholder';
		mount.textContent = t('broadcast.studio.inspector.no_featured', 'Aucun message mis en avant.');
		return;
	}
	mount.className = 'featured-card';
	mount.innerHTML = `
		<div class="featured-author">
			<strong>${escapeHtml(featured.pseudoSnapshot || t('broadcast.common.participant', 'Participant'))}</strong>
			<span class="featured-source">${escapeHtml(getSourceLabel(featured.sourceType))}</span>
		</div>
		<p class="hero-question">${escapeHtml(featured.textSnapshot || '')}</p>
	`;
};

const renderPreview = () => {
	const snapshot = state.bootstrap?.snapshot;
	if (!snapshot) return;
	const canvas = $('#broadcast-preview-canvas');
	if (!canvas) return;
	canvas.innerHTML = window.BroadcastRender.buildOverlayMarkup({
		snapshot,
		mode: state.previewMode,
	});
};

const renderSessions = () => {
	const container = $('#session-list');
	if (!container) return;
	if (!state.sessions.length) {
		container.innerHTML = `<div class="empty-state-card">${escapeHtml(
			t('broadcast.studio.outputs.empty', 'Aucune session active pour ce sondage.'),
		)}</div>`;
		return;
	}
	container.innerHTML = state.sessions
		.map((session) => {
			const urls = session.urls || {};
			const cards = [];
			if (urls.overlay) {
				cards.push(`
					<div class="url-card">
						<strong>${escapeHtml(t('broadcast.outputs.overlay', 'Overlay'))}</strong>
						<code title="${escapeHtml(urls.overlay)}">${escapeHtml(summarizeUrl(urls.overlay))}</code>
						<div class="candidate-footer">
							<button type="button" class="btn-secondary compact-btn" data-copy-url="${escapeHtml(urls.overlay)}"><i class="fas fa-copy"></i> ${escapeHtml(t('broadcast.studio.actions.copy', 'Copier'))}</button>
							<a class="btn-secondary compact-btn" href="${escapeHtml(urls.overlay)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square"></i> ${escapeHtml(t('broadcast.studio.actions.open', 'Ouvrir'))}</a>
						</div>
					</div>
				`);
			}
			if (urls.feed) {
				cards.push(`
					<div class="url-card">
						<strong>${escapeHtml(t('broadcast.outputs.feed', 'Feed JSON'))}</strong>
						<code title="${escapeHtml(urls.feed)}">${escapeHtml(summarizeUrl(urls.feed))}</code>
						<div class="candidate-footer">
							<button type="button" class="btn-secondary compact-btn" data-copy-url="${escapeHtml(urls.feed)}"><i class="fas fa-copy"></i> ${escapeHtml(t('broadcast.studio.actions.copy', 'Copier'))}</button>
							<a class="btn-secondary compact-btn" href="${escapeHtml(urls.feed)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square"></i> ${escapeHtml(t('broadcast.studio.actions.open', 'Ouvrir'))}</a>
						</div>
					</div>
				`);
			}
			return `
				<article class="session-card">
					<div class="session-meta">
						<span class="session-mode-badge ${escapeHtml(session.mode)}">${escapeHtml(getModeLabel(session.mode))}</span>
						<span class="state-badge eligible">${escapeHtml(
							t('broadcast.studio.outputs.expires', 'Expire {date}', {
								date: formatDateTime(session.expiresAt),
							}),
						)}</span>
					</div>
					<h4>${escapeHtml(session.name || t('broadcast.studio.outputs.session_name', 'Session broadcast'))}</h4>
					<div class="url-list">${cards.join('')}</div>
					<div class="session-footer">
						<button type="button" class="btn-danger compact-btn" data-revoke-session="${escapeHtml(session.id)}"><i class="fas fa-ban"></i> ${escapeHtml(t('broadcast.studio.actions.revoke', 'Revoquer'))}</button>
					</div>
				</article>
			`;
		})
		.join('');
};

const renderConfig = () => {
	const config = state.bootstrap?.config || state.bootstrap?.snapshot?.config;
	if (!config) return;
	$('#config-layout').value = config.defaultLayout || 'combined';
	$('#config-position').value = config.position || 'bottom-right';
	$('#config-transparency').value = Number(config.transparency || 0.9);
	$('#config-ticker-speed').value = Number(config.tickerSpeed || 18);
	$('#config-max-text').value = Number(config.maxTextLength || 180);
	$('#config-featured-duration').value = Number(config.featuredDurationSeconds || 16);
	$('#config-ticker-items').value = Number(config.maxTickerItems || 10);
	$('#config-ticker-enabled').checked = Boolean(config.tickerEnabled);
	$('#config-minimal-branding').checked = Boolean(config.minimalBranding);
	$('#config-safe-top').value = Number(config.safeMargins?.top || 48);
	$('#config-safe-right').value = Number(config.safeMargins?.right || 48);
	$('#config-safe-bottom').value = Number(config.safeMargins?.bottom || 48);
	$('#config-safe-left').value = Number(config.safeMargins?.left || 48);

	$('#inspector-layout').textContent = getModeLabel(config.defaultLayout || 'combined');
	$('#inspector-ticker').textContent = config.tickerEnabled ? t('broadcast.common.active', 'Actif') : t('broadcast.common.inactive', 'Inactif');
	$('#inspector-transparency').textContent = `${Math.round(Number(config.transparency || 0.9) * 100)}%`;
	$('#inspector-margins').textContent = `${config.safeMargins?.top || 48} / ${config.safeMargins?.right || 48} / ${config.safeMargins?.bottom || 48} / ${config.safeMargins?.left || 48}`;
};

const renderStudio = () => {
	const snapshot = state.bootstrap?.snapshot;
	if (!snapshot) return;
	$('#studio-survey-theme').textContent = snapshot.survey?.theme || t('broadcast.common.survey', 'Sondage');
	$('#studio-survey-question').textContent = snapshot.survey?.question || '';
	$('#studio-subtitle').textContent = snapshot.survey?.contexte || t('broadcast.studio.subtitle', 'Pilotage antenne pour le sondage en direct');
	$('#studio-kpi-votes').textContent = Number(snapshot.results?.totalOpinions || 0);
	$('#studio-kpi-cues').textContent = Array.isArray(snapshot.cues) ? snapshot.cues.length : 0;
	$('#studio-kpi-sessions').textContent = Array.isArray(state.sessions) ? state.sessions.length : 0;
	$('#studio-live-status').textContent = state.socket?.connected ? t('broadcast.common.connected', 'Connecté') : t('broadcast.common.offline', 'Hors ligne');
	renderFeaturedInspector();
	renderPreview();
	renderCandidates();
	renderSessions();
	renderConfig();
	applyPageTranslations(document);
	$('#broadcast-empty-state')?.classList.add('hidden');
	$('#broadcast-shell')?.classList.remove('hidden');
};

const setActiveTab = (tab) => {
	state.activeTab = tab;
	$$('.studio-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === tab));
	$$('.studio-panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tab));
};

const setPreviewMode = (mode) => {
	state.previewMode = mode;
	$$('.preview-mode-btn').forEach((button) => button.classList.toggle('is-active', button.dataset.previewMode === mode));
	renderPreview();
};

async function handleCandidateAction(button) {
	const action = button.dataset.candidateAction;
	const releaseBusy = setButtonBusy(button, t('broadcast.common.processing', 'Traitement...'));
	try {
		if (action === 'approve' || action === 'feature-from-source') {
			await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/cues`, {
				method: 'POST',
				data: {
					sourceType: button.dataset.sourceType,
					sourceId: button.dataset.sourceId,
					feature: action === 'feature-from-source',
				},
			});
		} else if (action === 'feature' || action === 'unfeature' || action === 'unapprove') {
			await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/cues/${encodeURIComponent(button.dataset.cueId)}`, {
				method: 'PATCH',
				data: { action },
			});
		}
		notify(t('broadcast.studio.notifications.update_saved', 'Mise à jour broadcast enregistrée.'), 'success');
		scheduleBootstrapRefresh(120);
		scheduleCandidateRefresh(120);
	} catch (error) {
		notify(error.message || t('broadcast.studio.notifications.action_failed', 'Action broadcast impossible.'), 'error');
	} finally {
		releaseBusy();
	}
}

async function handleSessionCreate(event) {
	event.preventDefault();
	const submitButton = event.currentTarget?.querySelector('button[type="submit"]');
	const outputs = [];
	if ($('#session-output-overlay')?.checked) outputs.push('overlay');
	if ($('#session-output-feed')?.checked) outputs.push('feed');
	if (!outputs.length) {
		notify(t('broadcast.studio.notifications.select_output', 'Sélectionnez au moins une sortie.'), 'warning');
		return;
	}
	const releaseBusy = setButtonBusy(submitButton, t('broadcast.studio.outputs.generating', 'Génération...'));
	try {
		const payload = await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/sessions`, {
			method: 'POST',
			data: {
				mode: $('#session-mode')?.value || 'combined',
				ttlMinutes: Number($('#session-ttl')?.value || 240),
				outputs,
			},
		});
		state.sessions = [payload.session, ...state.sessions];
		renderSessions();
		notify(t('broadcast.studio.notifications.session_created', 'Session broadcast générée.'), 'success');
	} catch (error) {
		notify(error.message || t('broadcast.studio.notifications.session_failed', 'Génération de session impossible.'), 'error');
	} finally {
		releaseBusy();
	}
}

async function handleSessionRevoke(sessionId) {
	try {
		await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/sessions/${encodeURIComponent(sessionId)}/revoke`, {
			method: 'PATCH',
			data: {},
		});
		state.sessions = state.sessions.filter((session) => session.id !== sessionId);
		renderSessions();
		notify(t('broadcast.studio.notifications.session_revoked', 'Session broadcast révoquée.'), 'success');
	} catch (error) {
		notify(error.message || t('broadcast.studio.notifications.revoke_failed', 'Revocation impossible.'), 'error');
	}
}

async function handleConfigSave(event) {
	event.preventDefault();
	const submitButton = event.currentTarget?.querySelector('button[type="submit"]');
	const releaseBusy = setButtonBusy(submitButton, t('broadcast.studio.settings.saving', 'Enregistrement...'));
	try {
		await requestJson(`/api/broadcast/surveys/${encodeURIComponent(surveyId)}/config`, {
			method: 'PATCH',
			data: {
				defaultLayout: $('#config-layout')?.value,
				position: $('#config-position')?.value,
				transparency: Number($('#config-transparency')?.value || 0.9),
				tickerSpeed: Number($('#config-ticker-speed')?.value || 18),
				maxTextLength: Number($('#config-max-text')?.value || 180),
				featuredDurationSeconds: Number($('#config-featured-duration')?.value || 16),
				maxTickerItems: Number($('#config-ticker-items')?.value || 10),
				tickerEnabled: Boolean($('#config-ticker-enabled')?.checked),
				minimalBranding: Boolean($('#config-minimal-branding')?.checked),
				safeMargins: {
					top: Number($('#config-safe-top')?.value || 48),
					right: Number($('#config-safe-right')?.value || 48),
					bottom: Number($('#config-safe-bottom')?.value || 48),
					left: Number($('#config-safe-left')?.value || 48),
				},
			},
		});
		notify(t('broadcast.studio.notifications.config_saved', 'Réglages broadcast enregistrés.'), 'success');
		scheduleBootstrapRefresh(120);
	} catch (error) {
		notify(error.message || t('broadcast.studio.notifications.config_failed', 'Enregistrement impossible.'), 'error');
	} finally {
		releaseBusy();
	}
}

const copyText = async (value) => {
	try {
		await navigator.clipboard.writeText(value);
		notify(t('broadcast.studio.notifications.url_copied', 'URL copiée.'), 'success');
	} catch (_error) {
		notify(t('broadcast.studio.notifications.copy_failed', 'Copie impossible depuis ce navigateur.'), 'warning');
	}
};

const setupSocket = () => {
	if (typeof window.io !== 'function' || !token || !surveyId) return;
	state.socket = window.io({ auth: { token } });
	state.socket.on('connect', () => {
		$('#studio-live-status').textContent = t('broadcast.common.connected', 'Connecté');
		state.socket.emit('broadcast:joinStudio', { surveyId }, (ack = {}) => {
			if (!ack.ok) {
				notify(
					ack.message ||
						t(
							'broadcast.studio.notifications.connection_refused',
							'Connexion studio refusée.',
						),
					'warning',
				);
			}
		});
	});
	state.socket.on('disconnect', () => {
		$('#studio-live-status').textContent = t('broadcast.common.offline', 'Hors ligne');
	});
	state.socket.on('broadcast:results', (results) => {
		if (!state.bootstrap?.snapshot) return;
		state.bootstrap.snapshot.results = results;
		state.bootstrap.snapshot.updatedAt = new Date().toISOString();
		renderStudio();
	});
	state.socket.on('broadcast:cue:upsert', () => {
		scheduleBootstrapRefresh(140);
		scheduleCandidateRefresh(140);
	});
	state.socket.on('broadcast:cue:remove', () => {
		scheduleBootstrapRefresh(140);
		scheduleCandidateRefresh(140);
	});
	state.socket.on('broadcast:status', (payload = {}) => {
		if (payload.reason === 'candidate:new' || payload.reason === 'candidate:restored') {
			scheduleCandidateRefresh(200);
			return;
		}
		scheduleBootstrapRefresh(180);
	});
};

function initializeEventListeners() {
	$('#back-btn')?.addEventListener('click', () => {
		window.location.href = buildReturnUrl();
	});
	$$('.studio-tab').forEach((button) => {
		button.addEventListener('click', () => setActiveTab(button.dataset.tab));
	});
	$$('.preview-mode-btn').forEach((button) => {
		button.addEventListener('click', () => setPreviewMode(button.dataset.previewMode));
	});
	$('#messages-refresh-btn')?.addEventListener('click', () => {
		void loadCandidates({ silent: false });
	});
	['#candidate-source-filter', '#candidate-state-filter', '#candidate-sort-filter'].forEach((selector) => {
		$(selector)?.addEventListener('change', () => {
			void loadCandidates({ silent: true });
		});
	});
	$('#candidate-search')?.addEventListener('input', () => scheduleCandidateRefresh(260));
	$('#candidate-list')?.addEventListener('click', (event) => {
		const button = event.target.closest('[data-candidate-action]');
		if (!button) return;
		void handleCandidateAction(button);
	});
	$('#broadcast-session-form')?.addEventListener('submit', handleSessionCreate);
	$('#session-list')?.addEventListener('click', (event) => {
		const copyButton = event.target.closest('[data-copy-url]');
		if (copyButton) {
			void copyText(copyButton.dataset.copyUrl || '');
			return;
		}
		const revokeButton = event.target.closest('[data-revoke-session]');
		if (revokeButton) {
			void handleSessionRevoke(revokeButton.dataset.revokeSession);
		}
	});
	$('#broadcast-config-form')?.addEventListener('submit', handleConfigSave);
}

async function initialize() {
	initializeEventListeners();
	setActiveTab('pilotage');
	setPreviewMode('combined');
	if (!surveyId) {
		showEmptyState({
			title: t('broadcast.studio.empty.missing_context_title', 'Contexte du sondage manquant'),
			message: t(
				'broadcast.studio.empty.missing_context_message',
				"Le studio broadcast a besoin d'un identifiant de sondage dans l'URL.",
			),
			actions: [{ label: t('broadcast.studio.empty.back_to_surveys', 'Retour aux sondages'), href: 'my-surveys.html' }],
		});
		return;
	}
	if (!token) {
		showEmptyState({
			title: t('broadcast.studio.empty.login_title', 'Connexion requise'),
			message: t(
				'broadcast.studio.empty.login_message',
				'Connectez-vous avec un compte owner/admin pour accéder au studio broadcast.',
			),
			actions: [{ label: t('broadcast.studio.empty.login_action', 'Se connecter'), onClick: () => window.SiteApi?.beginGoogleAuth?.() }],
		});
		return;
	}
	try {
		await loadBootstrap();
		setupSocket();
	} catch (error) {
		showEmptyState({
			title: t('broadcast.studio.empty.unavailable_title', 'Studio indisponible'),
			message: error.message || t('broadcast.studio.empty.unavailable_message', 'Impossible de charger le studio broadcast.'),
			actions: [{ label: t('broadcast.studio.back', 'Retour'), href: buildReturnUrl(), secondary: true }],
		});
	}
}

document.addEventListener('DOMContentLoaded', () => {
	if (window.BroadcastRender?.buildOverlayMarkup) {
		void initialize();
		return;
	}
	const script = document.createElement('script');
	script.src = 'broadcast-render.js';
	script.onload = () => void initialize();
	document.head.appendChild(script);
});
