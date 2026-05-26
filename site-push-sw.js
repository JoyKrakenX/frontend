/** @format */

const CACHE_VERSION = 'community-pwa-v20260526-admin-analytics-1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_ICON = '/assets/pwa-maskable-192x192.png';
const OFFLINE_FALLBACK_URL = '/browse-surveys.html';
const PRECACHE_URLS = [
	'/browse-surveys.html',
	'/site.webmanifest',
	'/favicon.ico',
	'/assets/favicon-192x192.png',
	'/assets/favicon-512x512.png',
	'/assets/pwa-maskable-192x192.png',
	'/assets/pwa-maskable-512x512.png',
	'/assets/apple-touch-icon.png',
	'/assets/community-notification-soft.wav',
	'/shared/pwa.js',
	'/shared/api-client.js',
	'/shared/i18n.js',
	'/shared/site-ui.js',
	'/shared/user-menu.js',
	'/shared/support-admin-menu.js',
	'/shared/chat-preview-renderer.js',
	'/shared/results-share-snapshot.js',
	'/shared/survey-analytics-tracker.js',
	'/shared/site-shell.css',
	'/shared/ux-foundation.css',
	'/survey-flash-overlay-results.css',
	'/survey-results-admin.html',
	'/survey-results-admin.css',
	'/survey-results-admin.js',
	'/chatroom.html',
	'/chatroom.css',
	'/chatroom-focus.css',
	'/chatroom.js',
];

const isSameOrigin = (url) => url.origin === self.location.origin;

const shouldBypassCache = (url) =>
	url.pathname.startsWith('/api/') ||
	url.pathname.startsWith('/socket.io/') ||
	url.pathname.startsWith('/uploads/');

const isStaticAsset = (url) =>
	/\.(?:css|js|json|webmanifest|png|jpg|jpeg|gif|svg|ico|webp|avif|wav|mp3|ogg|woff2?)$/i.test(
		url.pathname,
	);

const trimOldCaches = async () => {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith('community-pwa-') && !key.startsWith(CACHE_VERSION))
			.map((key) => caches.delete(key)),
	);
};

const cacheFirstWithRefresh = async (request) => {
	const cache = await caches.open(RUNTIME_CACHE);
	const cached = await cache.match(request);

	const refresh = fetch(request)
		.then((response) => {
			if (response && response.ok) {
				cache.put(request, response.clone()).catch(() => {});
			}
			return response;
		})
		.catch(() => null);

	return cached || (await refresh) || fetch(request);
};

const networkFirstNavigation = async (request) => {
	try {
		const response = await fetch(request);
		if (response && response.ok) {
			const cache = await caches.open(APP_SHELL_CACHE);
			cache.put(request, response.clone()).catch(() => {});
		}
		return response;
	} catch (_error) {
		const cache = await caches.open(APP_SHELL_CACHE);
		return (
			(await cache.match(request)) ||
			(await cache.match(OFFLINE_FALLBACK_URL)) ||
			Response.error()
		);
	}
};

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(APP_SHELL_CACHE);
			await cache.addAll(PRECACHE_URLS);
			await self.skipWaiting();
		})(),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			await trimOldCaches();
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (!isSameOrigin(url) || shouldBypassCache(url)) return;

	if (request.mode === 'navigate') {
		event.respondWith(networkFirstNavigation(request));
		return;
	}

	if (isStaticAsset(url)) {
		event.respondWith(cacheFirstWithRefresh(request));
	}
});

const normalizePayload = (payload = {}) => {
	const type = String(payload.type || '').trim();
	const conversationId = String(payload.conversationId || '').trim();
	const surveyId = String(payload.surveyId || '').trim();
	const messageId = String(payload.messageId || '').trim();
	const reason = String(payload.reason || '').trim();

	const fallbackTitleByType = {
		'support.queue':
			reason === 'new_client_message' ?
				'Nouveau message client'
			:	'Nouveau contact support',
		'support.reply': 'Nouvelle réponse du support',
		'survey.new': 'Nouveau sondage en ligne',
		'survey.closed': 'Sondage clôturé',
		'chat.reply': 'Réponse dans le chat',
	};

	const fallbackBodyByType = {
		'support.queue':
			reason === 'new_client_message' ?
				'Un client attend une réponse dans la file support.'
			:	'Une nouvelle conversation est entrée dans la file support.',
		'support.reply': 'Un agent a répondu à votre message.',
		'survey.new': 'Un nouveau sondage est disponible.',
		'survey.closed': 'Un sondage auquel vous avez participé est clôturé.',
		'chat.reply': 'Quelqu’un a répondu à votre message.',
	};

	let url = String(payload.url || '').trim();
	if (!url) {
		if (type === 'support.queue') {
			url = `/support-chat-admin.html?conversationId=${encodeURIComponent(conversationId)}`;
		} else if (type === 'support.reply') {
			url = `/support-chat.html?conversationId=${encodeURIComponent(conversationId)}`;
		} else if (type === 'chat.reply' && surveyId) {
			const surveyType =
				String(payload.surveyType || '').trim() === 'multiple' ?
					'multiple'
				:	'binary';
			const params = new URLSearchParams({ surveyId, type: surveyType });
			if (messageId) params.set('messageId', messageId);
			url = `/chatroom.html?${params.toString()}`;
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
		: type === 'chat.reply' ?
			`chat-reply-${surveyId || 'survey'}-${messageId || 'message'}`
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
		messageId: messageId || null,
		fromUser: String(payload.fromUser || '').trim() || null,
		targetUserId: String(payload.targetUserId || '').trim() || null,
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
					surveyType: payload.surveyType,
					messageId: payload.messageId,
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
			const messageId = String(data.messageId || '').trim() || null;
			const surveyId = String(data.surveyId || '').trim() || null;

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
				if (messageId) {
					existingClient.postMessage({
						type: 'chat:openMessage',
						messageId,
						surveyId,
						url: targetUrl,
					});
				}
				return;
			}

			await self.clients.openWindow(targetUrl);
		})(),
	);
});




