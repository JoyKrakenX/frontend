/** @format */

(() => {
	if (window.SitePushCenter) return;

	const SW_URL = '/site-push-sw.js';
	const COMMUNITY_SOUND_URL = '/assets/community-notification-soft.wav';
	const SOUND_PREF_KEY = 'community:notification-sound-enabled';
	const BANNER_STACK_ID = 'site-push-banner-stack';
	const ENABLE_BUTTON_CLASS = 'push-enable-item';
	const ENABLE_BUTTON_SELECTOR = `.${ENABLE_BUTTON_CLASS}`;
	const DEDUP_WINDOW_MS = 4000;

	const CHANNELS = Object.freeze({
		SUPPORT_QUEUE: 'support_queue',
		SUPPORT_REPLY: 'support_reply',
		SURVEY_NEW: 'survey_new',
		SURVEY_CLOSED: 'survey_closed',
		CHAT_REPLY: 'chat_reply',
	});

	const DEFAULT_USER_CHANNELS = Object.freeze([
		CHANNELS.SURVEY_NEW,
		CHANNELS.SURVEY_CLOSED,
		CHANNELS.CHAT_REPLY,
	]);

	const state = {
		initialized: false,
		registration: null,
		registrationPromise: null,
		subscriptionPromise: null,
		renderQueued: false,
		bannerDedup: new Map(),
		soundElement: null,
		soundPrimed: false,
	};

	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const supportsPush = () =>
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window;

	const isConnected = () => Boolean(window.SiteApi?.getToken?.());

	const getLocale = () => window.SiteI18n?.getLanguage?.() || 'fr';

	const getPermission = () =>
		!supportsPush() ? 'unsupported' : Notification.permission;

	const isSoundEnabled = () => {
		try {
			return localStorage.getItem(SOUND_PREF_KEY) !== 'false';
		} catch (_error) {
			return true;
		}
	};

	const ensureSoundElement = () => {
		if (state.soundElement) return state.soundElement;
		const audio = new Audio(COMMUNITY_SOUND_URL);
		audio.preload = 'auto';
		audio.volume = 0.38;
		state.soundElement = audio;
		return audio;
	};

	const primeCommunitySound = () => {
		if (state.soundPrimed || !isSoundEnabled()) return;
		try {
			const audio = ensureSoundElement();
			const previousVolume = audio.volume;
			audio.volume = 0;
			const promise = audio.play();
			if (promise?.then) {
				promise
					.then(() => {
						audio.pause();
						audio.currentTime = 0;
						audio.volume = previousVolume;
						state.soundPrimed = true;
					})
					.catch(() => {
						audio.volume = previousVolume;
					});
			}
		} catch (_error) {
			/* Browser autoplay policies may block sound until a gesture. */
		}
	};

	const playCommunitySound = () => {
		if (!isSoundEnabled() || document.visibilityState !== 'visible') return;
		try {
			const baseAudio = ensureSoundElement();
			const audio = baseAudio.cloneNode(true);
			audio.volume = baseAudio.volume;
			audio.play().catch(() => {});
		} catch (_error) {
			/* Sound is optional; notification delivery must never fail because of audio. */
		}
	};

	const normalizeChannels = (channels) =>
		Array.from(
			new Set(
				(Array.isArray(channels) ? channels : [channels])
					.map((item) => String(item || '').trim())
					.filter(Boolean),
			),
		);

	const getDeviceLabel = () => {
		const ua = navigator.userAgent || '';
		if (/android|iphone|ipad|mobile/i.test(ua)) return 'Mobile';
		if (/tablet/i.test(ua)) return 'Tablette';
		return 'Desktop';
	};

	const urlBase64ToUint8Array = (base64String) => {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let index = 0; index < rawData.length; index += 1) {
			outputArray[index] = rawData.charCodeAt(index);
		}
		return outputArray;
	};

	const cleanupBannerDedup = () => {
		const now = Date.now();
		for (const [key, timestamp] of state.bannerDedup.entries()) {
			if (now - timestamp > DEDUP_WINDOW_MS) {
				state.bannerDedup.delete(key);
			}
		}
	};

	const ensureBannerStack = () => {
		let stack = document.getElementById(BANNER_STACK_ID);
		if (stack) return stack;

		stack = document.createElement('div');
		stack.id = BANNER_STACK_ID;
		stack.className = 'site-push-banner-stack';
		stack.setAttribute('aria-live', 'polite');
		stack.setAttribute('aria-atomic', 'false');
		document.body.appendChild(stack);
		return stack;
	};

	const showInAppBanner = (payload = {}) => {
		const title = String(payload.title || '').trim();
		const body = String(payload.body || '').trim();
		const url = String(payload.url || '').trim();
		const dedupKey = String(payload.tag || `${payload.type || 'push'}:${title}:${body}`);
		if (!title && !body) return;

		cleanupBannerDedup();
		const previous = state.bannerDedup.get(dedupKey);
		if (previous && Date.now() - previous < DEDUP_WINDOW_MS) return;
		state.bannerDedup.set(dedupKey, Date.now());
		playCommunitySound();

		const stack = ensureBannerStack();
		const banner = document.createElement('div');
		banner.className = 'site-push-banner';
		banner.setAttribute('role', 'status');
		banner.tabIndex = 0;

		const icon = document.createElement('i');
		icon.className = 'fas fa-bell';
		icon.setAttribute('aria-hidden', 'true');

		const content = document.createElement('div');
		content.className = 'site-push-banner-content';
		content.innerHTML = `
      <strong>${title || 'Notification'}</strong>
      ${body ? `<p>${body}</p>` : ''}
    `;

		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'site-push-banner-close';
		close.setAttribute('aria-label', t('shared.modals.close', 'Fermer'));
		close.textContent = '×';

		const removeBanner = () => {
			banner.classList.add('is-leaving');
			window.setTimeout(() => banner.remove(), 180);
		};

		close.addEventListener('click', (event) => {
			event.stopPropagation();
			removeBanner();
		});

		if (url) {
			banner.classList.add('is-clickable');
			banner.addEventListener('click', () => {
				window.location.href = url;
			});
			banner.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				window.location.href = url;
			});
		}

		banner.appendChild(icon);
		banner.appendChild(content);
		banner.appendChild(close);
		stack.appendChild(banner);

		window.requestAnimationFrame(() => {
			banner.classList.add('is-visible');
		});

		window.setTimeout(removeBanner, 6500);
	};

	const ensureRegistration = async () => {
		if (!supportsPush()) return null;
		if (state.registration) return state.registration;
		if (state.registrationPromise) return state.registrationPromise;

		state.registrationPromise = (async () => {
			await navigator.serviceWorker.register(SW_URL, { scope: '/' });
			state.registration = await navigator.serviceWorker.ready;
			return state.registration;
		})();

		try {
			return await state.registrationPromise;
		} finally {
			state.registrationPromise = null;
		}
	};

	const getPublicKey = async () => {
		if (!window.SiteApi?.request) return null;
		try {
			const response = await window.SiteApi.request('/api/push/public-key', {
				method: 'GET',
				auth: true,
			});
			return String(response?.publicKey || '').trim() || null;
		} catch (_error) {
			try {
				const fallbackResponse = await window.SiteApi.request(
					'/api/support/chat/push/public-key',
					{
						method: 'GET',
						auth: true,
					},
				);
				return String(fallbackResponse?.publicKey || '').trim() || null;
			} catch (_fallbackError) {
				return null;
			}
		}
	};

	const getOrCreateSubscription = async (registration, publicKey) => {
		const existing = await registration.pushManager.getSubscription();
		if (existing) return existing;

		if (state.subscriptionPromise) {
			return state.subscriptionPromise;
		}

		state.subscriptionPromise = (async () => {
			const current = await registration.pushManager.getSubscription();
			if (current) return current;

			return registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey),
			});
		})();

		try {
			return await state.subscriptionPromise;
		} finally {
			state.subscriptionPromise = null;
		}
	};

	const ensureChannels = async (channels = []) => {
		const normalizedChannels = normalizeChannels(channels);
		const permission = getPermission();

		if (!isConnected()) {
			return { ok: false, subscribed: false, permission, reason: 'unauthenticated' };
		}

		if (!supportsPush()) {
			return { ok: false, subscribed: false, permission: 'unsupported' };
		}

		if (permission !== 'granted') {
			queueRender();
			return { ok: false, subscribed: false, permission };
		}

		const registration = await ensureRegistration();
		if (!registration) {
			return { ok: false, subscribed: false, permission: 'unsupported' };
		}

		const publicKey = await getPublicKey();
		if (!publicKey) {
			return { ok: false, subscribed: false, permission, reason: 'missing_public_key' };
		}

		const subscription = await getOrCreateSubscription(registration, publicKey);
		if (!subscription) {
			return { ok: false, subscribed: false, permission, reason: 'subscription_failed' };
		}

		const response = await window.SiteApi.request('/api/push/subscribe', {
			method: 'POST',
			auth: true,
			data: {
				subscription: subscription.toJSON(),
				channels: normalizedChannels,
				platform: navigator.platform || '',
				deviceLabel: getDeviceLabel(),
				locale: getLocale(),
			},
		});

		queueRender();
		return {
			ok: true,
			subscribed: true,
			permission,
			channels:
				Array.isArray(response?.subscription?.channels) ?
					response.subscription.channels
				:	normalizedChannels,
		};
	};

	const unsubscribeChannels = async (channels = []) => {
		if (!isConnected() || !supportsPush()) {
			return { ok: false, deleted: 0 };
		}

		const normalizedChannels = normalizeChannels(channels);
		const registration = await ensureRegistration();
		if (!registration) return { ok: false, deleted: 0 };

		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) return { ok: true, deleted: 0 };

		const response = await window.SiteApi.request('/api/push/unsubscribe', {
			method: 'POST',
			auth: true,
			data: {
				endpoint: subscription.endpoint,
				channels: normalizedChannels,
			},
		});

		return {
			ok: true,
			deleted: Number(response?.deleted || 0),
			remainingChannels: Array.isArray(response?.remainingChannels) ?
					response.remainingChannels
				:	[],
		};
	};

	const requestPermission = async () => {
		if (!supportsPush()) {
			window.SiteUI?.notify?.(
				t('push.unsupported', 'Notifications push non supportées sur cet appareil.'),
				'warning',
			);
			queueRender();
			return { ok: false, permission: 'unsupported' };
		}

		let permission = Notification.permission;
		if (permission !== 'granted') {
			try {
				permission = await Notification.requestPermission();
			} catch (_error) {
				permission = 'denied';
			}
		}

		if (permission === 'granted') {
			const result = await ensureChannels(DEFAULT_USER_CHANNELS);
			queueRender();
			return { ok: Boolean(result?.ok), permission };
		}

		if (permission === 'denied') {
			window.SiteUI?.notify?.(
				t('push.permission_denied', 'Notifications navigateur refusées.'),
				'warning',
			);
		}

		queueRender();
		return { ok: false, permission };
	};

	const removeEnableButtons = () => {
		document.querySelectorAll(ENABLE_BUTTON_SELECTOR).forEach((item) => item.remove());
	};

	const upsertEnableButton = (dropdown) => {
		if (!dropdown) return;

		if (!isConnected() || !supportsPush()) {
			dropdown.querySelector(ENABLE_BUTTON_SELECTOR)?.remove();
			return;
		}

		if (getPermission() === 'granted') {
			dropdown.querySelector(ENABLE_BUTTON_SELECTOR)?.remove();
			return;
		}

		let button = dropdown.querySelector(ENABLE_BUTTON_SELECTOR);
		if (!button) {
			button = document.createElement('button');
			button.type = 'button';
			button.className = `dropdown-item ${ENABLE_BUTTON_CLASS}`;
			button.innerHTML = `
        <i class="fas fa-bell"></i>
        <span></span>
      `;
			button.addEventListener('click', () => {
				primeCommunitySound();
				requestPermission().catch((error) => {
					console.error('push permission request failed:', error);
				});
			});

			const divider = dropdown.querySelector('.dropdown-divider');
			if (divider) {
				divider.insertAdjacentElement('afterend', button);
			} else {
				dropdown.prepend(button);
			}
		}

		const label = button.querySelector('span');
		if (label) {
			label.textContent = t('push.enable_cta', 'Activer les notifications');
		}
	};

	const render = () => {
		if (!isConnected()) {
			removeEnableButtons();
			return;
		}
		document
			.querySelectorAll('#user-menu .user-dropdown')
			.forEach(upsertEnableButton);
	};

	const queueRender = () => {
		if (state.renderQueued) return;
		state.renderQueued = true;
		window.requestAnimationFrame(() => {
			state.renderQueued = false;
			render();
		});
	};

	const bindEvents = () => {
		document.addEventListener('site:language-changed', () => {
			queueRender();
		});

		window.addEventListener('focus', () => {
			queueRender();
		});

		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) queueRender();
		});

		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.addEventListener('message', (event) => {
				if (event?.data?.type !== 'site:push-event') return;
				showInAppBanner(event.data.payload || {});
			});
		}

		['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
			document.addEventListener(eventName, primeCommunitySound, {
				once: true,
				passive: true,
			});
		});

		const observer = new MutationObserver(() => {
			queueRender();
		});
		observer.observe(document.body, { childList: true, subtree: true });
	};

	const init = async () => {
		if (state.initialized) return;
		state.initialized = true;
		bindEvents();
		queueRender();

		if (!isConnected() || !supportsPush()) return;

		await ensureRegistration().catch(() => {});

		if (getPermission() === 'granted') {
			ensureChannels(DEFAULT_USER_CHANNELS).catch(() => {});
		}
	};

	window.SitePushCenter = Object.freeze({
		init,
		requestPermission,
		ensureChannels,
		unsubscribeChannels,
		primeCommunitySound,
		channels: CHANNELS,
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => {
			init().catch((error) => console.error('push-center init failed:', error));
		});
	} else {
		init().catch((error) => console.error('push-center init failed:', error));
	}
})();
