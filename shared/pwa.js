/** @format */

(() => {
	if (window.CommunityPWA) return;

	const SW_URL = '/site-push-sw.js';
	const SW_SCOPE = '/';

	const canUseServiceWorker = () =>
		typeof window !== 'undefined' &&
		window.isSecureContext &&
		'serviceWorker' in navigator;

	const register = async () => {
		if (!canUseServiceWorker()) {
			return { ok: false, reason: 'unsupported' };
		}

		try {
			const registration = await navigator.serviceWorker.register(SW_URL, {
				scope: SW_SCOPE,
			});
			return { ok: true, registration };
		} catch (error) {
			console.warn('Community PWA service worker registration failed:', error);
			return { ok: false, reason: 'registration_failed', error };
		}
	};

	const init = () => {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => {
				register().catch(() => {});
			});
			return;
		}

		register().catch(() => {});
	};

	window.CommunityPWA = Object.freeze({ register, init });
	init();
})();
