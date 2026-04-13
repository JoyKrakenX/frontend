/** @format */

const overlayMode = document.body?.dataset?.overlayMode || 'combined';
const overlayParams = new URLSearchParams(window.location.search);
const overlayToken = overlayParams.get('token') || '';
const feedPathByMode = {
	results: '/api/broadcast/feed/results',
	chat: '/api/broadcast/feed/chat',
	combined: '/api/broadcast/feed/combined',
};

const overlayState = {
	snapshot: null,
	socket: null,
	pollTimer: null,
};

const describeBroadcastFailure = (payload = {}) => {
	const code = String(payload?.code || '').trim();
	if (code === 'broadcast_session_revoked') {
		const revokedAt = payload?.meta?.revokedAt ? new Date(payload.meta.revokedAt) : null;
		return {
			title: 'Session revoquee',
			message:
				revokedAt && !Number.isNaN(revokedAt.getTime()) ?
					`Cette session broadcast a ete revoquee le ${revokedAt.toLocaleString()}.`
				:	'Cette session broadcast a ete revoquee par la regie.',
		};
	}
	if (code === 'broadcast_session_expired') {
		const expiresAt = payload?.meta?.expiresAt ? new Date(payload.meta.expiresAt) : null;
		return {
			title: 'Session expiree',
			message:
				expiresAt && !Number.isNaN(expiresAt.getTime()) ?
					`Cette session broadcast a expire le ${expiresAt.toLocaleString()}.`
				:	'Cette session broadcast a expire.',
		};
	}
	if (code === 'broadcast_session_not_found') {
		return {
			title: 'Session introuvable',
			message: 'La session broadcast demandee est introuvable.',
		};
	}
	return {
		title: 'Flux indisponible',
		message: String(payload?.message || 'Le flux broadcast n est pas disponible.'),
	};
};

const renderOverlayState = (title, message) => {
	const root = document.getElementById('overlay-root');
	if (!root) return;
	root.innerHTML = `
		<div class="overlay-state">
			<div class="overlay-state-card">
				<h1>${window.BroadcastRender.escapeHtml(title)}</h1>
				<p>${window.BroadcastRender.escapeHtml(message)}</p>
			</div>
		</div>
	`;
};

const applyOverlayConfig = (config = {}) => {
	document.body.style.setProperty('--overlay-top', `${Number(config.safeMargins?.top || 48)}px`);
	document.body.style.setProperty('--overlay-right', `${Number(config.safeMargins?.right || 48)}px`);
	document.body.style.setProperty('--overlay-bottom', `${Number(config.safeMargins?.bottom || 48)}px`);
	document.body.style.setProperty('--overlay-left', `${Number(config.safeMargins?.left || 48)}px`);
	document.body.style.setProperty('--overlay-opacity', `${Math.max(0.2, Math.min(1, Number(config.transparency || 0.9)))}`);
};

const normalizeSnapshotFromPayload = (payload = {}) => {
	const survey = payload.survey || {};
	return {
		survey,
		results: payload.results || overlayState.snapshot?.results || null,
		cues: Array.isArray(payload.cues) ? payload.cues : overlayState.snapshot?.cues || [],
		featuredCue: payload.featuredCue ?? overlayState.snapshot?.featuredCue ?? null,
		config: payload.config || overlayState.snapshot?.config || {},
		updatedAt: payload.updatedAt || new Date().toISOString(),
	};
};

const renderOverlay = () => {
	if (!overlayState.snapshot) return;
	applyOverlayConfig(overlayState.snapshot.config);
	const root = document.getElementById('overlay-root');
	if (!root) return;
	root.innerHTML = window.BroadcastRender.buildOverlayMarkup({
		snapshot: overlayState.snapshot,
		mode: overlayMode,
	});
};

const fetchOverlayPayload = async () => {
	if (!overlayToken) {
		renderOverlayState('Token manquant', 'Aucune session broadcast signee n a ete fournie.');
		return;
	}
	const endpoint = overlayState.snapshot ? `${feedPathByMode[overlayMode]}?token=${encodeURIComponent(overlayToken)}` : `/api/broadcast/bootstrap?token=${encodeURIComponent(overlayToken)}`;
	const response = await fetch(endpoint, { credentials: 'same-origin' });
	if (!response.ok) {
		let payload = null;
		try {
			payload = await response.json();
		} catch (_error) {
			payload = { message: await response.text() };
		}
		const error = new Error(String(payload?.message || `HTTP ${response.status}`));
		error.payload = payload;
		error.status = response.status;
		throw error;
	}
	const payload = await response.json();
	overlayState.snapshot = normalizeSnapshotFromPayload(payload);
	renderOverlay();
};

const scheduleFeedPolling = () => {
	if (overlayState.pollTimer) {
		window.clearInterval(overlayState.pollTimer);
	}
	overlayState.pollTimer = window.setInterval(() => {
		void fetchOverlayPayload().catch((error) => {
			const failure = describeBroadcastFailure(error?.payload);
			renderOverlayState(failure.title, failure.message);
		});
	}, 15000);
};

const setupSocket = () => {
	if (typeof window.io !== 'function' || !overlayToken) return;
	overlayState.socket = window.io({ auth: { broadcastToken: overlayToken } });
	overlayState.socket.on('connect', () => {
		overlayState.socket.emit('broadcast:joinOverlay', { token: overlayToken }, (ack = {}) => {
			if (!ack.ok) {
				renderOverlayState('Session refusee', ack.message || 'La session broadcast a ete refusee.');
			}
		});
	});
	overlayState.socket.on('broadcast:results', (results) => {
		if (!overlayState.snapshot) return;
		overlayState.snapshot.results = results;
		overlayState.snapshot.updatedAt = new Date().toISOString();
		renderOverlay();
	});
	overlayState.socket.on('broadcast:cue:upsert', ({ cue } = {}) => {
		if (!overlayState.snapshot || !cue) return;
		const cues = Array.isArray(overlayState.snapshot.cues) ? [...overlayState.snapshot.cues] : [];
		const existingIndex = cues.findIndex((entry) => entry.id === cue.id);
		if (existingIndex >= 0) cues.splice(existingIndex, 1, cue);
		else cues.unshift(cue);
		overlayState.snapshot.cues = cues;
		overlayState.snapshot.featuredCue = cues.find((entry) => entry.featured) || overlayState.snapshot.featuredCue;
		renderOverlay();
	});
	overlayState.socket.on('broadcast:cue:remove', ({ cueId } = {}) => {
		if (!overlayState.snapshot || !cueId) return;
		overlayState.snapshot.cues = (overlayState.snapshot.cues || []).filter((entry) => entry.id !== cueId);
		if (overlayState.snapshot.featuredCue?.id === cueId) {
			overlayState.snapshot.featuredCue = overlayState.snapshot.cues.find((entry) => entry.featured) || null;
		}
		renderOverlay();
	});
	overlayState.socket.on('broadcast:status', (payload = {}) => {
		if (payload.reason === 'candidate:new' || payload.reason === 'candidate:restored') {
			return;
		}
		void fetchOverlayPayload().catch(() => {});
	});
	overlayState.socket.on('broadcast:session:revoked', () => {
		renderOverlayState('Session revoquee', 'La session broadcast a ete revoquee par la regie.');
		if (overlayState.socket) overlayState.socket.disconnect();
	});
};

document.addEventListener('DOMContentLoaded', async () => {
	if (!window.BroadcastRender?.buildOverlayMarkup) {
		renderOverlayState('Chargement', 'Preparation du rendu broadcast...');
		return;
	}
	try {
		await fetchOverlayPayload();
		setupSocket();
		scheduleFeedPolling();
	} catch (error) {
		const failure = describeBroadcastFailure(error?.payload);
		renderOverlayState(failure.title, failure.message);
	}
});

