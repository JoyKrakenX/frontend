/** @format */

(() => {
	if (window.CommunityPWA) return;

	const SW_URL = '/site-push-sw.js';
	const SW_SCOPE = '/';
	const INSTALL_BUTTON_CLASS = 'pwa-install-item';
	const INSTALL_BUTTON_SELECTOR = `.${INSTALL_BUTTON_CLASS}`;
	let deferredInstallPrompt = null;
	let renderQueued = false;
	let installObserver = null;

	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const canUseServiceWorker = () =>
		typeof window !== 'undefined' &&
		window.isSecureContext &&
		'serviceWorker' in navigator;

	const isStandalone = () =>
		window.matchMedia?.('(display-mode: standalone)')?.matches ||
		window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches ||
		window.navigator?.standalone === true;

	const register = async () => {
		if (!canUseServiceWorker()) {
			return { ok: false, reason: 'unsupported' };
		}

		try {
			const registration = await navigator.serviceWorker.register(SW_URL, {
				scope: SW_SCOPE,
			});
			// Installed PWAs can keep an older worker longer than a normal tab.
			// Explicitly checking for updates makes UI fixes visible faster after deploy.
			registration.update?.().catch(() => {});
			return { ok: true, registration };
		} catch (error) {
			console.warn('Community PWA service worker registration failed:', error);
			return { ok: false, reason: 'registration_failed', error };
		}
	};

	const getInstallLabel = () =>
		t('shared.nav.install_app', 'Installer Community');

	const updateInstallButtonLabels = () => {
		document.querySelectorAll(INSTALL_BUTTON_SELECTOR).forEach((button) => {
			const label = button.querySelector('span');
			if (label) label.textContent = getInstallLabel();
			button.setAttribute('aria-label', getInstallLabel());
		});
	};

	const shouldShowInstallButton = () =>
		Boolean(deferredInstallPrompt) && !isStandalone();

	const removeInstallButtons = () => {
		document.querySelectorAll(INSTALL_BUTTON_SELECTOR).forEach((button) => {
			button.remove();
		});
	};

	const createInstallButton = () => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `dropdown-item ${INSTALL_BUTTON_CLASS}`;
		button.setAttribute('data-i18n-aria', 'shared.nav.install_app');
		button.innerHTML = `
			<i class="fas fa-download"></i>
			<span data-i18n="shared.nav.install_app">${getInstallLabel()}</span>
		`;
		button.addEventListener('click', () => {
			install().catch((error) => {
				console.warn('Community PWA install failed:', error);
			});
		});
		return button;
	};

	const upsertInstallButton = (dropdown) => {
		if (!dropdown) return;
		if (!shouldShowInstallButton()) {
			dropdown.querySelector(INSTALL_BUTTON_SELECTOR)?.remove();
			return;
		}

		let button = dropdown.querySelector(INSTALL_BUTTON_SELECTOR);
		if (!button) {
			button = createInstallButton();
			const actionsDivider = dropdown.querySelector('.dropdown-divider--actions');
			const nav = dropdown.querySelector('.user-menu-nav');
			if (actionsDivider) {
				actionsDivider.insertAdjacentElement('beforebegin', button);
			} else if (nav) {
				nav.insertAdjacentElement('afterend', button);
			} else {
				dropdown.appendChild(button);
			}
		}
		updateInstallButtonLabels();
		window.SiteI18n?.applyTranslations?.(button);
	};

	const renderInstallEntry = () => {
		if (!shouldShowInstallButton()) {
			removeInstallButtons();
			return;
		}

		document
			.querySelectorAll('#user-menu .user-dropdown')
			.forEach(upsertInstallButton);
	};

	const queueRender = () => {
		if (renderQueued) return;
		renderQueued = true;
		window.requestAnimationFrame(() => {
			renderQueued = false;
			renderInstallEntry();
		});
	};

	const install = async () => {
		if (!deferredInstallPrompt || isStandalone()) {
			return { ok: false, reason: isStandalone() ? 'already_installed' : 'not_available' };
		}

		const promptEvent = deferredInstallPrompt;
		deferredInstallPrompt = null;
		removeInstallButtons();

		await promptEvent.prompt();
		const choice = await promptEvent.userChoice;
		return {
			ok: choice?.outcome === 'accepted',
			outcome: choice?.outcome || 'unknown',
		};
	};

	const bindInstallEvents = () => {
		window.addEventListener('beforeinstallprompt', (event) => {
			// Keep the browser's generic shortcut flow out of Community's UI when possible,
			// and expose our own PWA-only "Installer Community" action.
			event.preventDefault();
			deferredInstallPrompt = event;
			queueRender();
		});

		window.addEventListener('appinstalled', () => {
			deferredInstallPrompt = null;
			removeInstallButtons();
		});

		document.addEventListener('site:language-changed', updateInstallButtonLabels);

		installObserver = new MutationObserver(queueRender);
		if (document.body) {
			installObserver.observe(document.body, { childList: true, subtree: true });
		}
	};

	const init = () => {
		bindInstallEvents();
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => {
				register().catch(() => {});
				queueRender();
			});
			return;
		}

		register().catch(() => {});
		queueRender();
	};

	window.CommunityPWA = Object.freeze({ register, init, install, isStandalone });
	init();
})();
