/** @format */

(() => {
	if (window.SiteUserMenu) return;

	const BROWSE_PATH = 'browse-surveys.html';
	const MY_SURVEYS_PATH = 'my-surveys.html';
	const BILLING_PATH = 'billing.html';
	const SUPPORT_ADMIN_PATH = 'support-chat-admin.html';

	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const getCurrentPage = () => String(document.body?.dataset?.page || '').trim();
	const shouldHideHeaderLoginButton = () => getCurrentPage() === 'browse-surveys';
	const shouldHideHeaderBillingButton = () => getCurrentPage() === 'billing';
	let lastAuthState = null;

	const setAuthPending = (isPending) => {
		if (!document.body) return;
		document.body.dataset.authState = isPending ? 'pending' : 'resolved';
		if (isPending) {
			delete document.body.dataset.authenticated;
		}
	};

	const emitAuthResolved = (authenticated, pseudo = '') => {
		const normalized = Boolean(authenticated);
		const payload = {
			authenticated: normalized,
			pseudo: String(pseudo || '').trim(),
		};

		const key = `${payload.authenticated}:${payload.pseudo}`;
		if (lastAuthState === key) return;
		lastAuthState = key;

		document.dispatchEvent(
			new CustomEvent('site:auth:resolved', {
				detail: payload,
			}),
		);
	};

	const normalizeExistingLogoutModal = (modal) => {
		if (!modal) return null;

		modal.setAttribute('role', 'dialog');
		modal.setAttribute(
			'aria-hidden',
			modal.classList.contains('hidden') ? 'true' : 'false',
		);
		modal.setAttribute(
			'data-modal-size',
			modal.getAttribute('data-modal-size') || 'sm',
		);

		const title = modal.querySelector('#logout-confirm-title');
		if (title) title.setAttribute('data-i18n', 'shared.auth.logout_confirm_title');

		const bodyText = modal.querySelector('.modal-body p');
		if (bodyText) bodyText.setAttribute('data-i18n', 'shared.auth.logout_confirm_body');

		const closeButton = modal.querySelector('.close-modal');
		if (closeButton) {
			closeButton.setAttribute('type', 'button');
			closeButton.setAttribute('data-modal-close', '');
			if (!closeButton.hasAttribute('aria-label')) {
				closeButton.setAttribute(
					'aria-label',
					t('shared.modals.close', 'Fermer la fenetre'),
				);
			}
		}

		const cancelButton = modal.querySelector('#logout-cancel');
		if (cancelButton) {
			cancelButton.setAttribute('type', 'button');
			cancelButton.setAttribute('data-modal-close', '');
			cancelButton.setAttribute('data-i18n', 'shared.auth.logout_cancel');
		}

		const okButton = modal.querySelector('#logout-ok');
		if (okButton) {
			okButton.setAttribute('type', 'button');
			okButton.setAttribute('data-i18n', 'shared.auth.logout_confirm');
		}

		return modal;
	};

	const ensureLogoutModal = () => {
		let modal = document.getElementById('logout-confirm-modal');
		if (modal) {
			normalizeExistingLogoutModal(modal);
			window.SiteI18n?.applyTranslations?.(modal);
			return modal;
		}

		document.body.insertAdjacentHTML(
			'beforeend',
			`
			<div id="logout-confirm-modal" class="modal hidden" aria-hidden="true" role="dialog" aria-labelledby="logout-confirm-title" data-modal-size="sm">
				<div class="modal-content">
					<div class="modal-header">
						<h3 id="logout-confirm-title" data-i18n="shared.auth.logout_confirm_title">Confirmer la deconnexion</h3>
						<button class="close-modal" type="button" data-modal-close aria-label="${t('shared.modals.close', 'Fermer la fenetre')}">×</button>
					</div>
					<div class="modal-body">
						<p data-i18n="shared.auth.logout_confirm_body">Etes-vous sûr de vouloir vous deconnecter ?</p>
					</div>
					<div class="modal-footer">
						<button id="logout-cancel" class="btn-secondary" type="button" data-modal-close data-i18n="shared.auth.logout_cancel">Annuler</button>
						<button id="logout-ok" class="btn-danger" type="button" data-i18n="shared.auth.logout_confirm">Se deconnecter</button>
					</div>
				</div>
			</div>`,
		);

		modal = document.getElementById('logout-confirm-modal');
		normalizeExistingLogoutModal(modal);
		window.SiteI18n?.applyTranslations?.(modal);
		return modal;
	};

	const ensurePageActions = () => {
		let pageActions = document.getElementById('page-actions');
		if (pageActions) return pageActions;

		const headerRoot =
			document.getElementById('header-content') ||
			document.querySelector('.header-container') ||
			document.querySelector('header');
		if (!headerRoot) return null;

		pageActions = document.createElement('div');
		pageActions.id = 'page-actions';
		pageActions.className = 'page-actions-shell';
		headerRoot.appendChild(pageActions);
		return pageActions;
	};

	const ensureLoginButton = (host) => {
		if (shouldHideHeaderLoginButton()) {
			host.querySelector('#login-btn')?.remove();
			return null;
		}

		if (!host.querySelector('#login-btn')) {
			host.insertAdjacentHTML(
				'beforeend',
				`<button id="login-btn" class="btn-primary hidden" type="button" data-i18n-aria="shared.auth.login">
					<i class="fas fa-sign-in-alt"></i>
					<span data-i18n="shared.auth.login">Se connecter</span>
				</button>`,
			);
		}
		return host.querySelector('#login-btn');
	};

	const ensureFooterBillingLink = () => {
		if (shouldHideHeaderBillingButton()) return;
		const footerLists = Array.from(document.querySelectorAll('.footer-links'));
		const navigationList = footerLists.find((list) =>
			list.querySelector('a[href="browse-surveys.html"], a[href="my-surveys.html"]'),
		);
		if (!navigationList || navigationList.querySelector(`a[href="${BILLING_PATH}"]`)) return;

		const item = document.createElement('li');
		item.innerHTML = `<a href="${BILLING_PATH}" class="footer-link">
			<i class="fas fa-wallet"></i>
			<span data-i18n="shared.nav.billing">Facturation</span>
		</a>`;
		navigationList.appendChild(item);
		window.SiteI18n?.applyTranslations?.(item);
	};

	const clampDropdownToViewport = (details) => {
		const dropdown = details?.querySelector('.user-dropdown');
		if (!dropdown) return;

		const forceStyle = (property, value) => {
			dropdown.style.setProperty(property, value, 'important');
		};

		forceStyle('left', '50%');
		forceStyle('right', 'auto');
		forceStyle('bottom', 'auto');
		forceStyle('width', 'max-content');
		forceStyle('max-width', 'min(92vw, 360px)');
		forceStyle('min-width', '260px');
		forceStyle('transform', 'translateX(-50%)');

		const rect = dropdown.getBoundingClientRect();
		const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
		const edgePadding = 8;
		if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right) || !rect.width) {
			forceStyle('transform', 'translateX(-50%)');
			return;
		}
		if (rect.width >= viewportWidth - edgePadding * 2) {
			forceStyle('transform', 'translateX(-50%)');
			return;
		}

		let shiftX = 0;

		if (rect.left < edgePadding) {
			shiftX = edgePadding - rect.left;
		} else if (rect.right > viewportWidth - edgePadding) {
			shiftX = viewportWidth - edgePadding - rect.right;
		}
		const maxShift = Math.max(0, viewportWidth / 2 - rect.width / 2 - edgePadding);
		if (!Number.isFinite(shiftX)) {
			shiftX = 0;
		}
		shiftX = Math.max(-maxShift, Math.min(maxShift, shiftX));

		forceStyle('transform', `translateX(-50%) translateX(${Math.round(shiftX)}px)`);
	};

	const ensureMenuActions = (menuRoot) => {
		let details = menuRoot.querySelector('.user-menu-details');
		if (!details) {
			details = document.createElement('details');
			details.className = 'user-menu-details';
			menuRoot.appendChild(details);
		}

		let summary = details.querySelector('.user-menu-summary');
		if (!summary) {
			summary = document.createElement('summary');
			summary.className = 'user-menu-summary';
			details.appendChild(summary);
		}

		if (!summary.querySelector('.user-icon')) {
			summary.innerHTML = `
				<i class="fas fa-user-circle user-icon"></i>
				<i class="fas fa-chevron-down chevron-icon"></i>`;
		}
		summary.setAttribute('aria-label', t('shared.auth.user', 'Utilisateur'));

		let dropdown = details.querySelector('.user-dropdown');
		if (!dropdown) {
			dropdown = document.createElement('div');
			dropdown.className = 'user-dropdown';
			details.appendChild(dropdown);
		}

		if (!dropdown.querySelector('.dropdown-header')) {
			dropdown.insertAdjacentHTML(
				'afterbegin',
				`<div class="dropdown-header">
					<div class="user-info">
						<i class="fas fa-user-circle user-avatar"></i>
						<div class="user-details">
							<div class="user-name-full">
								<div id="user-name" class="user-name"></div>
							</div>
						</div>
					</div>
				</div>
				<div class="dropdown-divider"></div>`,
			);
		}

		let nav = dropdown.querySelector('.user-menu-nav');
		if (!nav) {
			nav = document.createElement('div');
			nav.className = 'user-menu-nav';
			const firstDivider = dropdown.querySelector('.dropdown-divider');
			if (firstDivider) {
				firstDivider.insertAdjacentElement('afterend', nav);
			} else {
				dropdown.appendChild(nav);
			}
		}

		const ensureNavItem = (id, iconClass, i18nKey, fallback, href = '#', asButton = false) => {
			let item = nav.querySelector(`#${id}`);
			if (!item) {
				item = document.createElement(asButton ? 'button' : 'a');
				item.id = id;
				item.className = 'dropdown-item';
				if (asButton) {
					item.type = 'button';
				} else {
					item.href = href;
				}
				item.innerHTML = `<i class="${iconClass}"></i><span data-i18n="${i18nKey}">${fallback}</span>`;
				nav.appendChild(item);
			}
			return item;
		};

		ensureNavItem('user-menu-home', 'fas fa-house', 'shared.nav.home', 'Accueil', BROWSE_PATH);
		ensureNavItem(
			'user-menu-my-surveys',
			'fas fa-chart-bar',
			'shared.nav.my_surveys',
			'Mes sondages',
			MY_SURVEYS_PATH,
		);
		ensureNavItem(
			'user-menu-billing',
			'fas fa-wallet',
			'shared.nav.billing',
			'Facturation',
			BILLING_PATH,
		);
		const supportAdminItem = ensureNavItem(
			'support-admin-link',
			'fas fa-headset',
			'shared.auth.support_admin',
			'Support Admin',
			SUPPORT_ADMIN_PATH,
		);
		supportAdminItem.classList.add('support-admin-item');

		const createItem = ensureNavItem(
			'user-menu-create-survey',
			'fas fa-plus-circle',
			'shared.nav.create_survey',
			'Creer un sondage',
			'#',
			true,
		);
		createItem.setAttribute('data-action', 'open-create-survey-modal');

		if (!dropdown.querySelector('.dropdown-divider--actions')) {
			const divider = document.createElement('div');
			divider.className = 'dropdown-divider dropdown-divider--actions';
			nav.insertAdjacentElement('afterend', divider);
		}

		let logoutItem = dropdown.querySelector('#logout-btn');
		if (!logoutItem) {
			logoutItem = document.createElement('button');
			logoutItem.id = 'logout-btn';
			logoutItem.type = 'button';
			logoutItem.className = 'dropdown-item logout-item';
			logoutItem.innerHTML =
				'<i class="fas fa-sign-out-alt"></i><span data-i18n="shared.auth.logout">Deconnexion</span>';
			dropdown.appendChild(logoutItem);
		}

		return menuRoot;
	};

	const ensureUserMenu = (host) => {
		let menu = host.querySelector('#user-menu');
		if (!menu) {
			menu = document.createElement('div');
			menu.id = 'user-menu';
			menu.className = 'user-menu-container hidden';
			host.appendChild(menu);
		}
		menu.classList.add('user-menu-container');
		return ensureMenuActions(menu);
	};

	const clearSession = () => {
		window.SiteApi?.clearToken?.();
		localStorage.removeItem('token');
		localStorage.removeItem('jwt_token');
		localStorage.removeItem('user');
		localStorage.removeItem('userId');
		localStorage.removeItem('userPseudo');
		localStorage.removeItem('userEmail');
		localStorage.removeItem('userRole');
	};

	const closeUserMenu = () => {
		document.querySelectorAll('#user-menu .user-menu-details[open]').forEach((details) => {
			details.open = false;
		});
	};

	const showLogoutModal = () => {
		const modal = ensureLogoutModal();
		if (window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(modal);
		} else {
			modal.classList.remove('hidden');
		}
	};

	const hideLogoutModal = () => {
		const modal = document.getElementById('logout-confirm-modal');
		if (!modal) return;
		if (window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(modal);
		} else {
			modal.classList.add('hidden');
		}
	};

	const updateContextualEntries = () => {
		const page = getCurrentPage();
		const mySurveysEntry = document.getElementById('user-menu-my-surveys');
		const billingEntry = document.getElementById('user-menu-billing');
		const supportAdminEntry = document.getElementById('support-admin-link');
		const userRole =
			String(localStorage.getItem('userRole') || '')
				.trim()
				.toLowerCase();
		const isSupportOrAdmin = userRole === 'admin' || userRole === 'support';
		if (mySurveysEntry) {
			mySurveysEntry.classList.toggle('hidden', page === 'my-surveys');
		}
		if (billingEntry) {
			billingEntry.classList.toggle('hidden', page === 'billing');
		}
		if (supportAdminEntry) {
			supportAdminEntry.classList.toggle(
				'hidden',
				!isSupportOrAdmin || page === 'support-chat-admin',
			);
		}
	};

	const setConnectedState = (connected, pseudo = '') => {
		const loginBtn = document.getElementById('login-btn');
		const userMenu = document.getElementById('user-menu');
		const userName = document.getElementById('user-name');
		const normalizedPseudo = String(pseudo || '').trim();
		if (document.body) {
			document.body.dataset.authenticated = connected ? 'true' : 'false';
		}

		if (userName) userName.textContent = connected ? normalizedPseudo : '';
		if (loginBtn) {
			const forceHidden = connected || shouldHideHeaderLoginButton();
			loginBtn.classList.toggle('hidden', forceHidden);
		}
		if (userMenu) userMenu.classList.toggle('hidden', !connected);
		setAuthPending(false);
		emitAuthResolved(connected, normalizedPseudo);

		updateContextualEntries();
	};

	const loadCurrentUser = async () => {
		const token = window.SiteApi?.getToken?.();
		if (!token) {
			setConnectedState(false);
			return;
		}

		try {
			const me = await window.SiteApi.request('/api/auth/me', {
				method: 'GET',
				auth: true,
			});
			const pseudo = String(
				me?.pseudo || me?.name || localStorage.getItem('userPseudo') || '',
			).trim();
			const role = String(
				me?.role || localStorage.getItem('userRole') || '',
			).trim();
			if (role) localStorage.setItem('userRole', role);
			setConnectedState(true, pseudo);

			if (pseudo) localStorage.setItem('userPseudo', pseudo);
			if (me?._id) localStorage.setItem('userId', me._id);
			if (me?.email) localStorage.setItem('userEmail', me.email);
		} catch (_error) {
			clearSession();
			setConnectedState(false);
		}
	};

	const bindEvents = () => {
		if (document.body.dataset.sharedUserMenuBound === 'true') return;
		document.body.dataset.sharedUserMenuBound = 'true';

		document.addEventListener('click', (event) => {
			const details = document.querySelector('#user-menu .user-menu-details');
			if (details?.open && !details.contains(event.target)) {
				details.open = false;
			}
		});

		document.addEventListener(
			'toggle',
			(event) => {
				const details = event.target?.closest?.('#user-menu .user-menu-details');
				if (!details || !details.open) return;
				requestAnimationFrame(() => {
					clampDropdownToViewport(details);
					setTimeout(() => clampDropdownToViewport(details), 80);
				});
			},
			true,
		);

		const repositionOpenDropdown = () => {
			const details = document.querySelector('#user-menu .user-menu-details[open]');
			if (!details) return;
			clampDropdownToViewport(details);
		};

		window.addEventListener('resize', repositionOpenDropdown, { passive: true });
		window.addEventListener('orientationchange', () => {
			window.setTimeout(repositionOpenDropdown, 120);
		});

		document.addEventListener(
			'click',
			(event) => {
				const loginBtn = event.target.closest('#login-btn');
				if (loginBtn) {
					event.preventDefault();
					window.SiteApi?.beginGoogleAuth?.();
					return;
				}

				const logoutBtn = event.target.closest('#logout-btn');
				if (logoutBtn) {
					event.preventDefault();
					closeUserMenu();
					showLogoutModal();
					return;
				}

				const createBtn = event.target.closest('#user-menu-create-survey, [data-action="open-create-survey-modal"]');
				if (createBtn) {
					event.preventDefault();
					closeUserMenu();
					document.dispatchEvent(new CustomEvent('open:create-survey-modal'));
				}
			},
			true,
		);

		document.addEventListener(
			'click',
			(event) => {
				const cancelBtn = event.target.closest('#logout-cancel');
				const closeBtn = event.target.closest('#logout-confirm-modal [data-modal-close]');
				if (cancelBtn || closeBtn) {
					event.preventDefault();
					hideLogoutModal();
					return;
				}

				const okBtn = event.target.closest('#logout-ok');
				if (okBtn) {
					event.preventDefault();
					clearSession();
					hideLogoutModal();
					window.location.href = BROWSE_PATH;
				}
			},
			true,
		);

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				hideLogoutModal();
			}
		});
	};

	const init = async () => {
		if (document.body?.dataset?.sharedUserMenu !== 'true') return;
		setAuthPending(true);

		const pageActions = ensurePageActions();
		if (!pageActions) return;

		ensureLoginButton(pageActions);
		ensureUserMenu(pageActions);
		ensureFooterBillingLink();
		const loginBtn = document.getElementById('login-btn');
		const userMenu = document.getElementById('user-menu');
		if (loginBtn) loginBtn.classList.add('hidden');
		if (userMenu) userMenu.classList.add('hidden');
		ensureLogoutModal();
		window.SiteI18n?.applyTranslations?.(pageActions);
		window.SiteI18n?.applyTranslations?.(document.getElementById('logout-confirm-modal'));

		bindEvents();
		await loadCurrentUser();
	};

	document.addEventListener('DOMContentLoaded', () => {
		init().catch((error) => {
			console.error('user-menu init failed:', error);
		});
	});

	document.addEventListener('site:language-changed', () => {
		const pageActions = document.getElementById('page-actions');
		if (pageActions) window.SiteI18n?.applyTranslations?.(pageActions);
		const modal = document.getElementById('logout-confirm-modal');
		if (modal) window.SiteI18n?.applyTranslations?.(modal);
	});

	window.SiteUserMenu = Object.freeze({ init });
})();


