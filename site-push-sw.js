/** @format */

const APP_ICON = '/assets/logo.png';

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

const normalizePayload = (payload = {}) => {
	const type = String(payload.type || '').trim();
	const conversationId = String(payload.conversationId || '').trim();
	const surveyId = String(payload.surveyId || '').trim();
	const reason = String(payload.reason || '').trim();

	const fallbackTitleByType = {
		'support.queue':
			reason === 'new_client_message' ?
				'Nouveau message client'
			:	'Nouveau contact support',
		'support.reply': 'Nouvelle reponse du support',
		'survey.new': 'Nouveau sondage en ligne',
		'survey.closed': 'Sondage cloture',
	};

	const fallbackBodyByType = {
		'support.queue':
			reason === 'new_client_message' ?
				'Un client attend une reponse dans la file support.'
			:	'Une nouvelle conversation est entree dans la file support.',
		'support.reply': 'Un agent a repondu a votre message.',
		'survey.new': 'Un nouveau sondage est disponible.',
		'survey.closed': 'Un sondage auquel vous avez participe est cloture.',
	};

	let url = String(payload.url || '').trim();
	if (!url) {
		if (type === 'support.queue') {
			url = `/support-chat-admin.html?conversationId=${encodeURIComponent(conversationId)}`;
		} else if (type === 'support.reply') {
			url = `/support-chat.html?conversationId=${encodeURIComponent(conversationId)}`;
		} else {
			url = '/browse-surveys.html';
		}
	}

	const title =
		String(payload.title || '').trim() ||
		fallbackTitleByType[type] ||
		'Nouvelle notification';
	const body =
		String(payload.body || payload.message || '').trim() ||
		fallbackBodyByType[type] ||
		'Nouveau message.';

	const tagFromPayload = String(payload.tag || '').trim();
	const tag =
		tagFromPayload ||
		(type === 'support.queue' ?
			`support-admin-${conversationId || reason || 'queue'}`
		: type === 'support.reply' ?
			`support-client-${conversationId || reason || 'reply'}`
		: type === 'survey.new' ?
			`survey-new-${surveyId || 'latest'}`
		: type === 'survey.closed' ?
			`survey-closed-${surveyId || 'latest'}`
		:	`site-push-${Date.now()}`);

	return {
		type,
		title,
		body,
		url,
		tag,
		reason,
		conversationId,
		conversationRef: String(payload.conversationRef || '').trim() || null,
		surveyId: surveyId || null,
		surveyType: String(payload.surveyType || '').trim() || null,
		theme: String(payload.theme || '').trim() || null,
		receivedAt: String(payload.receivedAt || '').trim() || new Date().toISOString(),
	};
};

const broadcastToClients = async (notificationPayload) => {
	const clients = await self.clients.matchAll({
		type: 'window',
		includeUncontrolled: true,
	});

	await Promise.all(
		clients.map((client) =>
			client.postMessage({
				type: 'site:push-event',
				payload: notificationPayload,
			}),
		),
	);

	if (notificationPayload.type === 'support.queue') {
		await Promise.all(
			clients.map((client) =>
				client.postMessage({
					type: 'support:queue-pending-hint',
					reason: notificationPayload.reason || 'new_conversation',
					conversationId: notificationPayload.conversationId || null,
					receivedAt: notificationPayload.receivedAt,
				}),
			),
		);
	}
};

const hasVisibleClientForUrl = async (url) => {
	const clients = await self.clients.matchAll({
		type: 'window',
		includeUncontrolled: true,
	});
	if (!clients.length) return false;

	const targetPath = (() => {
		try {
			return new URL(url, self.location.origin).pathname;
		} catch (_error) {
			return '';
		}
	})();

	return clients.some((client) => {
		if (client.visibilityState !== 'visible') return false;
		if (!targetPath) return true;
		try {
			const clientPath = new URL(client.url).pathname;
			return clientPath === targetPath;
		} catch (_error) {
			return false;
		}
	});
};

self.addEventListener('push', (event) => {
	if (!event.data) return;

	event.waitUntil(
		(async () => {
			let rawPayload = {};
			try {
				rawPayload = event.data.json() || {};
			} catch (_error) {
				rawPayload = { body: event.data.text() };
			}

			const payload = normalizePayload(rawPayload);
			await broadcastToClients(payload);

			if (await hasVisibleClientForUrl(payload.url)) return;

			await self.registration.showNotification(payload.title, {
				body: payload.body,
				icon: APP_ICON,
				badge: APP_ICON,
				tag: payload.tag,
				renotify: false,
				data: {
					type: payload.type,
					url: payload.url,
					conversationId: payload.conversationId,
					surveyId: payload.surveyId,
				},
			});
		})(),
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	event.waitUntil(
		(async () => {
			const data = event.notification.data || {};
			const targetUrl = String(data.url || '/browse-surveys.html');
			const conversationId = String(data.conversationId || '').trim() || null;

			const clients = await self.clients.matchAll({
				type: 'window',
				includeUncontrolled: true,
			});

			const targetPath = (() => {
				try {
					return new URL(targetUrl, self.location.origin).pathname;
				} catch (_error) {
					return null;
				}
			})();

			const existingClient = clients.find((client) => {
				try {
					return new URL(client.url).pathname === targetPath;
				} catch (_error) {
					return false;
				}
			});

			if (existingClient) {
				await existingClient.focus();
				if (conversationId) {
					existingClient.postMessage({
						type: 'support:openConversation',
						conversationId,
					});
				}
				return;
			}

			await self.clients.openWindow(targetUrl);
		})(),
	);
});
