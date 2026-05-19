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
	let userNameRepairFrame = 0;

	const USER_MENU_ICON_PATHS = Object.freeze({
		closed: [
			'M 84,24 C 84,24 61.333333,24.001 50,24.001 38.666667,24.001 16,24 16,24',
			'M 84,50 H 50 16',
			'M 84,76 C 84,76 61.333333,76.001 50,76.001 38.666667,76.001 16,76 16,76',
		],
		open: [
			'M 76,24 C 76,24 50.055365,50 50,50 49.94463,50 24,24 24,24',
			'M 50.001,50 H 50 49.99',
			'M 76,76 C 76,76 50.055365,50 50,50 49.944635,50 24,76 24,76',
		],
		openFrames: [
			[
				'M 84,24 C 84,24 61.333333,24.001 50,24.001 38.666667,24.001 16,24 16,24',
				'M 82,24 C 82,24 66.957389,30.5 50,30.5 33.042611,30.5 18,24 18,24',
				'M 80,24 C 80,24 61.663104,37 50,37 38.336896,37 20,24 20,24',
				'M 78,24 C 78,24 55.685686,43.5 50,43.5 44.314314,43.5 22,24 22,24',
				'M 76,24 C 76,24 50.055365,50 50,50 49.94463,50 24,24 24,24',
			],
			[
				'M 84,50 H 50 16',
				'M 75.5,50 H 50 24.5',
				'M 67,50 H 50 33',
				'M 58.5,50 H 50 41.5',
				'M 50.001,50 H 50 49.99',
			],
			[
				'M 84,76 C 84,76 61.333333,76.001 50,76.001 38.666667,76.001 16,76 16,76',
				'M 82,76 C 82,76 66.957389,69.5 50,69.5 33.042611,69.5 18,76 18,76',
				'M 80,76 C 80,76 61.663104,63 50,63 38.336896,63 20,76 20,76',
				'M 78,76 C 78,76 55.685686,56.5 50,56.5 44.314314,56.5 22,76 22,76',
				'M 76,76 C 76,76 50.055365,50 50,50 49.944635,50 24,76 24,76',
			],
		],
	});

	const notify = (message, type = 'info') => {
		if (window.SiteUI?.notify) {
			window.SiteUI.notify(message, type);
			return;
		}
		console[type === 'error' ? 'error' : 'log'](message);
	};

	const announce = (message) => {
		if (!message) return;
		let region = document.getElementById('site-user-menu-live-region');
		if (!region) {
			region = document.createElement('div');
			region.id = 'site-user-menu-live-region';
			region.className = 'sr-only';
			region.setAttribute('aria-live', 'polite');
			region.setAttribute('aria-atomic', 'true');
			document.body.appendChild(region);
		}
		region.textContent = message;
	};

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
		if (title) {
			title.setAttribute('data-i18n', 'shared.auth.logout_confirm_title');
			title.textContent = t(
				'shared.auth.logout_confirm_title',
				'Confirmer la déconnexion',
			);
		}

		const bodyText = modal.querySelector('.modal-body p');
		if (bodyText) {
			bodyText.setAttribute('data-i18n', 'shared.auth.logout_confirm_body');
			bodyText.textContent = t(
				'shared.auth.logout_confirm_body',
				'Êtes-vous sûr de vouloir vous déconnecter ?',
			);
		}

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
			cancelButton.textContent = t('shared.auth.logout_cancel', 'Annuler');
		}

		const okButton = modal.querySelector('#logout-ok');
		if (okButton) {
			okButton.setAttribute('type', 'button');
			okButton.setAttribute('data-i18n', 'shared.auth.logout_confirm');
			okButton.textContent = t(
				'shared.auth.logout_confirm',
				'Se déconnecter',
			);
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
						<h3 id="logout-confirm-title" data-i18n="shared.auth.logout_confirm_title">Confirmer la déconnexion</h3>
						<button class="close-modal" type="button" data-modal-close aria-label="${t('shared.modals.close', 'Fermer la fenetre')}">×</button>
					</div>
					<div class="modal-body">
						<p data-i18n="shared.auth.logout_confirm_body">Êtes-vous sûr de vouloir vous déconnecter ?</p>
					</div>
					<div class="modal-footer">
						<button id="logout-cancel" class="btn-secondary" type="button" data-modal-close data-i18n="shared.auth.logout_cancel">Annuler</button>
						<button id="logout-ok" class="btn-danger" type="button" data-i18n="shared.auth.logout_confirm">Se déconnecter</button>
					</div>
				</div>
			</div>`,
		);

		modal = document.getElementById('logout-confirm-modal');
		normalizeExistingLogoutModal(modal);
		window.SiteI18n?.applyTranslations?.(modal);
		return modal;
	};

	const normalizeExistingEditPseudoModal = (modal) => {
		if (!modal) return null;
		modal.classList.add('modal');
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-hidden', modal.classList.contains('hidden') ? 'true' : 'false');
		modal.setAttribute('aria-labelledby', 'edit-pseudo-title');
		modal.setAttribute('data-modal-size', modal.getAttribute('data-modal-size') || 'sm');

		const title = modal.querySelector('#edit-pseudo-title');
		if (title) title.setAttribute('data-i18n', 'shared.auth.edit_pseudo_title');

		const input = modal.querySelector('#new-pseudo-input');
		if (input) {
			input.setAttribute('maxlength', '32');
			input.setAttribute('data-i18n-placeholder', 'shared.auth.new_pseudo_placeholder');
			input.setAttribute('aria-describedby', 'pseudo-error');
		}

		const error = modal.querySelector('#pseudo-error');
		if (error) {
			error.setAttribute('role', 'alert');
			error.setAttribute('aria-live', 'polite');
		}

		const closeButton = modal.querySelector('.close-modal');
		if (closeButton) {
			closeButton.setAttribute('type', 'button');
			closeButton.setAttribute('data-modal-close', '');
			closeButton.setAttribute('aria-label', t('shared.modals.close', 'Fermer la fenêtre'));
		}

		const cancelButton = modal.querySelector('#cancel-edit-pseudo');
		if (cancelButton) {
			cancelButton.setAttribute('type', 'button');
			cancelButton.setAttribute('data-modal-close', '');
			cancelButton.setAttribute('data-i18n', 'shared.actions.cancel');
		}

		const confirmButton = modal.querySelector('#confirm-edit-pseudo');
		if (confirmButton) {
			confirmButton.setAttribute('type', 'button');
			confirmButton.setAttribute('data-i18n', 'shared.actions.save');
		}
		return modal;
	};

	const ensureEditPseudoModal = () => {
		let modal = document.getElementById('edit-pseudo-modal');
		if (modal) {
			normalizeExistingEditPseudoModal(modal);
			window.SiteI18n?.applyTranslations?.(modal);
			return modal;
		}

		document.body.insertAdjacentHTML(
			'beforeend',
			`
			<div id="edit-pseudo-modal" class="modal hidden" aria-hidden="true" role="dialog" aria-labelledby="edit-pseudo-title" data-modal-size="sm">
				<div class="modal-content">
					<div class="modal-header">
						<h3 id="edit-pseudo-title" data-i18n="shared.auth.edit_pseudo_title"><i class="fa fa-pencil"></i> Modifier le pseudo</h3>
						<button class="close-modal" type="button" data-modal-close aria-label="${t('shared.modals.close', 'Fermer la fenêtre')}">×</button>
					</div>
					<div class="modal-body">
						<input id="new-pseudo-input" type="text" class="form-control pseudo-input" placeholder="${t('shared.auth.new_pseudo_placeholder', 'Nouveau pseudo')}" maxlength="32" aria-describedby="pseudo-error" data-i18n-placeholder="shared.auth.new_pseudo_placeholder" />
						<div id="pseudo-error" class="pseudo-error" role="alert" aria-live="polite"></div>
					</div>
					<div class="modal-footer">
						<button id="cancel-edit-pseudo" class="btn-secondary" type="button" data-modal-close data-i18n="shared.actions.cancel">Annuler</button>
						<button id="confirm-edit-pseudo" class="btn-primary" type="button" data-i18n="shared.actions.save">Enregistrer</button>
					</div>
				</div>
			</div>`,
		);

		modal = document.getElementById('edit-pseudo-modal');
		normalizeExistingEditPseudoModal(modal);
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

	const getFooterNavigationSections = () => {
		const footerLists = Array.from(document.querySelectorAll('.site-footer .footer-links'));
		const navigationLists = footerLists.filter((list) =>
			list.querySelector(
				'a[href="browse-surveys.html"], a[href="my-surveys.html"], a[href="create-survey.html"], a[href="create-survey-choices.html"], a[href="billing.html"]',
			),
		);
		return Array.from(
			new Set(navigationLists.map((list) => list.closest('.footer-section')).filter(Boolean)),
		);
	};

	const syncFooterNavigationVisibility = (authenticated = false) => {
		const sections = getFooterNavigationSections();
		if (!sections.length) return;
		const shouldShow = Boolean(authenticated);
		sections.forEach((section) => {
			section.hidden = !shouldShow;
			section.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
			section.dataset.authNavigation = 'true';
		});
	};

	const clampDropdownToViewport = (details) => {
		const dropdown = details?.querySelector('.user-dropdown');
		if (!dropdown) return;
		const viewportWidth = Math.max(
			document.documentElement?.clientWidth || 0,
			window.innerWidth || 0,
		);
		const panelWidth = Math.max(232, Math.min(340, viewportWidth - 16));
		const menuRoot = details.closest('.user-menu-container');
		const forceDropdownStyle = (property, value) => {
			dropdown.style.setProperty(property, value, 'important');
		};

		details.style.setProperty('--user-menu-panel-width', `${panelWidth}px`);
		menuRoot?.style.setProperty('--user-menu-panel-width', `${panelWidth}px`);
		forceDropdownStyle('left', '0');
		forceDropdownStyle('right', 'auto');
		forceDropdownStyle('bottom', 'auto');
		forceDropdownStyle('width', '100%');
		forceDropdownStyle('max-width', '100%');
		forceDropdownStyle('min-width', '0');
		forceDropdownStyle('transform', 'none');
	};

	const getEditPseudoButtonMarkup = () => `
		<button id="edit-pseudo-btn" class="edit-pseudo-btn" type="button" title="${t(
			'shared.auth.edit_pseudo_title',
			'Modifier le pseudo',
		)}" aria-label="${t('shared.auth.edit_pseudo_title', 'Modifier le pseudo')}">
			<i class="fa fa-pencil" aria-hidden="true"></i>
		</button>`;

	const getUserMenuSummaryMarkup = () => `
		<span class="user-menu-summary-icon user-menu-summary-user-icon" aria-hidden="true">
			<i class="fas fa-user-circle"></i>
		</span>
		<span class="user-menu-summary-icon user-menu-summary-arrow" aria-hidden="true">
			<i class="fas fa-angle-down"></i>
		</span>`;

	const syncUserMenuIcon = (details, options = {}) => {
		if (!details) return;
		const isOpen = Boolean(details.open);
		const summary = details.querySelector('.user-menu-summary');
		if (summary) {
			summary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
			summary.classList.toggle('is-open', isOpen);
		}
		const arrow = details.querySelector('.user-menu-summary-arrow');
		arrow?.classList.toggle('is-open', isOpen);
		const icon = null;
		if (!icon) return;
		icon.classList.toggle('is-open', isOpen);
		icon.querySelectorAll('path').forEach((path, index) => {
			const target = isOpen
				? USER_MENU_ICON_PATHS.open[index]
				: USER_MENU_ICON_PATHS.closed[index];
			if (!options.animate) {
				path.setAttribute('d', target);
				return;
			}
			const frames = USER_MENU_ICON_PATHS.openFrames[index] || [];
			const animate = path.querySelector('animate');
			if (!animate || !frames.length) {
				path.setAttribute('d', target);
				return;
			}
			const values = isOpen ? frames : [...frames].reverse();
			animate.setAttribute('values', values.join('; '));
			try {
				animate.beginElement();
			} catch (_error) {
				path.setAttribute('d', target);
			}
		});
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

		if (!summary.querySelector('.user-menu-summary-user-icon')) {
			summary.innerHTML = getUserMenuSummaryMarkup();
		}
		summary.setAttribute('aria-label', t('shared.auth.user', 'Utilisateur'));
		syncUserMenuIcon(details, { animate: false });

		let dropdown = details.querySelector('.user-dropdown');
		if (!dropdown) {
			dropdown = document.createElement('div');
			dropdown.className = 'user-dropdown';
			details.appendChild(dropdown);
		}

		dropdown.className = 'user-dropdown';
		dropdown.innerHTML = `
			<div class="dropdown-header">
				<div class="user-info">
					<i class="fas fa-user-circle user-avatar" aria-hidden="true"></i>
					<div class="user-details">
						<div class="user-name-full">
							<div id="user-name" class="user-name">
								<span id="pseudo-text"></span>
								${getEditPseudoButtonMarkup()}
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="dropdown-divider"></div>
			<div class="user-menu-nav">
				<a id="user-menu-home" class="dropdown-item" href="${BROWSE_PATH}">
					<i class="fas fa-house" aria-hidden="true"></i><span data-i18n="shared.nav.home">Accueil</span>
				</a>
				<a id="user-menu-my-surveys" class="dropdown-item" href="${MY_SURVEYS_PATH}">
					<i class="fas fa-chart-line" aria-hidden="true"></i><span data-i18n="shared.nav.my_surveys">Mes sondages</span>
				</a>
				<a id="user-menu-billing" class="dropdown-item" href="${BILLING_PATH}">
					<i class="fas fa-wallet" aria-hidden="true"></i><span data-i18n="shared.nav.billing">Facturation</span>
				</a>
				<a id="support-admin-link" class="dropdown-item support-admin-item" href="${SUPPORT_ADMIN_PATH}">
					<i class="fas fa-headset" aria-hidden="true"></i><span data-i18n="shared.auth.support_admin">Support Admin</span>
				</a>
				<button id="user-menu-create-survey" class="dropdown-item" type="button" data-action="open-create-survey-modal">
					<i class="fas fa-plus-circle" aria-hidden="true"></i><span data-i18n="shared.nav.create_survey">Créer un sondage</span>
				</button>
			</div>
			<div class="dropdown-divider dropdown-divider--actions"></div>
			<button id="logout-btn" class="dropdown-item logout-item" type="button">
				<i class="fas fa-sign-out-alt" aria-hidden="true"></i><span data-i18n="shared.auth.logout">Déconnexion</span>
			</button>`;

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

	const ensureUserNameStructure = () => {
		const userName = document.getElementById('user-name');
		if (!userName) return null;

		let pseudoText = userName.querySelector('#pseudo-text');
		let editButton = userName.querySelector('#edit-pseudo-btn');
		if (!pseudoText || !editButton) {
			const legacyPseudo = String(userName.textContent || '').trim();
			userName.innerHTML = `<span id="pseudo-text"></span>${getEditPseudoButtonMarkup()}`;
			pseudoText = userName.querySelector('#pseudo-text');
			editButton = userName.querySelector('#edit-pseudo-btn');
			if (pseudoText && legacyPseudo) pseudoText.textContent = legacyPseudo;
		}

		if (editButton) {
			editButton.setAttribute('type', 'button');
			editButton.setAttribute('aria-label', t('shared.auth.edit_pseudo_title', 'Modifier le pseudo'));
			editButton.setAttribute('title', t('shared.auth.edit_pseudo_title', 'Modifier le pseudo'));
		}

		return { userName, pseudoText, editButton };
	};

	const scheduleUserNameRepair = () => {
		if (userNameRepairFrame) return;
		userNameRepairFrame = window.requestAnimationFrame(() => {
			userNameRepairFrame = 0;
			renderUserName(
				localStorage.getItem('userPseudo') ||
					document.getElementById('pseudo-text')?.textContent?.trim() ||
					document.getElementById('user-name')?.textContent?.trim() ||
					'',
			);
		});
	};

	const bindUserNameIntegrityObserver = () => {
		const userName = document.getElementById('user-name');
		if (!userName || userName.dataset.sharedMenuObserver === 'true') return;
		userName.dataset.sharedMenuObserver = 'true';

		const observer = new MutationObserver(() => {
			if (
				!userName.querySelector('#pseudo-text') ||
				!userName.querySelector('#edit-pseudo-btn')
			) {
				scheduleUserNameRepair();
			}
		});
		observer.observe(userName, { childList: true, subtree: true });
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

	const renderUserName = (pseudo = '') => {
		const structure = ensureUserNameStructure();
		if (!structure) return;
		const { pseudoText, editButton } = structure;
		bindUserNameIntegrityObserver();
		if (pseudoText) pseudoText.textContent = String(pseudo || '').trim();
		if (editButton) {
			editButton.classList.toggle('hidden', !String(pseudo || '').trim());
			editButton.setAttribute('aria-label', t('shared.auth.edit_pseudo_title', 'Modifier le pseudo'));
			editButton.setAttribute('title', t('shared.auth.edit_pseudo_title', 'Modifier le pseudo'));
		}
	};

	const setPseudo = (pseudo = '') => {
		const normalizedPseudo = String(pseudo || '').trim();
		if (normalizedPseudo) localStorage.setItem('userPseudo', normalizedPseudo);
		renderUserName(normalizedPseudo);
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
		const mySurveysEntry = document.getElementById('user-menu-my-surveys');
		const billingEntry = document.getElementById('user-menu-billing');
		const supportAdminEntry = document.getElementById('support-admin-link');
		const userRole =
			String(localStorage.getItem('userRole') || '')
				.trim()
				.toLowerCase();
		const isSupportOrAdmin = userRole === 'admin' || userRole === 'support';
		if (mySurveysEntry) {
			mySurveysEntry.classList.remove('hidden');
		}
		if (billingEntry) {
			billingEntry.classList.remove('hidden');
		}
		if (supportAdminEntry) {
			supportAdminEntry.classList.toggle('hidden', !isSupportOrAdmin);
		}
	};

	const setConnectedState = (connected, pseudo = '') => {
		const loginBtn = document.getElementById('login-btn');
		const userMenu = document.getElementById('user-menu');
		const normalizedPseudo = String(pseudo || '').trim();
		const displayPseudo =
			connected ?
				normalizedPseudo ||
				String(localStorage.getItem('userPseudo') || '').trim() ||
				t('shared.auth.user', 'Utilisateur')
			:	'';
		if (document.body) {
			document.body.dataset.authenticated = connected ? 'true' : 'false';
		}

		renderUserName(displayPseudo);
		if (loginBtn) {
			const forceHidden = connected || shouldHideHeaderLoginButton();
			loginBtn.classList.toggle('hidden', forceHidden);
		}
		if (userMenu) userMenu.classList.toggle('hidden', !connected);
		syncFooterNavigationVisibility(connected);
		window.requestAnimationFrame(() => syncFooterNavigationVisibility(connected));
		window.setTimeout(() => syncFooterNavigationVisibility(connected), 250);
		setAuthPending(false);
		emitAuthResolved(connected, displayPseudo);

		updateContextualEntries();
	};

	const showEditPseudoModal = () => {
		const modal = ensureEditPseudoModal();
		if (!modal) return;
		closeUserMenu();

		const errorDiv = document.getElementById('pseudo-error');
		if (errorDiv) errorDiv.textContent = '';

		const pseudoInput = document.getElementById('new-pseudo-input');
		const currentPseudo =
			document.getElementById('pseudo-text')?.textContent?.trim() ||
			localStorage.getItem('userPseudo') ||
			'';
		if (pseudoInput) {
			pseudoInput.value = currentPseudo;
		}

		if (window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(modal);
		} else {
			modal.classList.remove('hidden');
			modal.setAttribute('aria-hidden', 'false');
			document.body?.classList.add('modal-open');
		}

		window.setTimeout(() => {
			pseudoInput?.focus();
			pseudoInput?.select();
		}, 40);
		announce(t('shared.auth.edit_pseudo_opened', 'Fenêtre de modification de pseudo ouverte'));
	};

	const hideEditPseudoModal = () => {
		const modal = document.getElementById('edit-pseudo-modal');
		if (!modal) return;
		if (window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(modal);
		} else {
			modal.classList.add('hidden');
			modal.setAttribute('aria-hidden', 'true');
			document.body?.classList.remove('modal-open');
		}
		const input = document.getElementById('new-pseudo-input');
		const error = document.getElementById('pseudo-error');
		if (input) input.value = '';
		if (error) error.textContent = '';
	};

	const submitEditPseudo = async () => {
		const input = document.getElementById('new-pseudo-input');
		const errorDiv = document.getElementById('pseudo-error');
		if (!input || !errorDiv) return;

		const pseudo = String(input.value || '').trim();
		errorDiv.textContent = '';

		if (pseudo.length < 3 || pseudo.length > 32) {
			errorDiv.textContent = t(
				'shared.auth.pseudo_length_error',
				'Le pseudo doit comporter entre 3 et 32 caractères.',
			);
			return;
		}

		const currentPseudo = document.getElementById('pseudo-text')?.textContent?.trim() || '';
		if (currentPseudo === pseudo) {
			errorDiv.textContent = t('shared.auth.pseudo_same_error', 'Vous utilisez déjà ce pseudo.');
			return;
		}

		const confirmButton = document.getElementById('confirm-edit-pseudo');
		confirmButton?.setAttribute('disabled', 'disabled');
		try {
			const data = await window.SiteApi.request('/api/auth/pseudo', {
				method: 'PUT',
				auth: true,
				data: { pseudo },
			});

			const updatedPseudo = String(data?.pseudo || pseudo).trim();
			if (updatedPseudo) {
				localStorage.setItem('userPseudo', updatedPseudo);
				renderUserName(updatedPseudo);
			}
			if (data?.token) window.SiteApi?.setToken?.(data.token);
			if (data?.user?._id || data?.user?.id) {
				localStorage.setItem('userId', data.user._id || data.user.id);
			}
			if (data?.user?.email) localStorage.setItem('userEmail', data.user.email);

			hideEditPseudoModal();
			notify(t('shared.auth.pseudo_updated', 'Pseudo mis à jour avec succès.'), 'success');
			document.dispatchEvent(
				new CustomEvent('site:user:pseudo-updated', {
					detail: { pseudo: updatedPseudo },
				}),
			);
			announce(
				t('shared.auth.pseudo_updated_announcement', 'Pseudo mis à jour : {pseudo}', {
					pseudo: updatedPseudo,
				}),
			);
		} catch (error) {
			errorDiv.textContent =
				error?.message ||
				t('shared.auth.pseudo_update_error', 'Erreur lors de la modification du pseudo.');
		} finally {
			confirmButton?.removeAttribute('disabled');
		}
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
				if (!details) return;
				syncUserMenuIcon(details, { animate: true });
				if (!details.open) return;
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

				const editPseudoBtn = event.target.closest('#edit-pseudo-btn');
				if (editPseudoBtn) {
					event.preventDefault();
					event.stopPropagation();
					showEditPseudoModal();
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

				const editCancelBtn = event.target.closest('#cancel-edit-pseudo');
				const editCloseBtn = event.target.closest('#edit-pseudo-modal [data-modal-close]');
				if (editCancelBtn || editCloseBtn) {
					event.preventDefault();
					hideEditPseudoModal();
					return;
				}

				const editConfirmBtn = event.target.closest('#confirm-edit-pseudo');
				if (editConfirmBtn) {
					event.preventDefault();
					submitEditPseudo();
				}
			},
			true,
		);

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				hideLogoutModal();
				hideEditPseudoModal();
			}

			if (
				event.key === 'Enter' &&
				event.target?.id === 'new-pseudo-input' &&
				!event.isComposing
			) {
				event.preventDefault();
				submitEditPseudo();
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
		bindUserNameIntegrityObserver();
		ensureFooterBillingLink();
		syncFooterNavigationVisibility(false);
		window.requestAnimationFrame(() => syncFooterNavigationVisibility(false));
		const loginBtn = document.getElementById('login-btn');
		const userMenu = document.getElementById('user-menu');
		if (loginBtn) loginBtn.classList.add('hidden');
		if (userMenu) userMenu.classList.add('hidden');
		ensureLogoutModal();
		ensureEditPseudoModal();
		window.SiteI18n?.applyTranslations?.(pageActions);
		window.SiteI18n?.applyTranslations?.(document.getElementById('logout-confirm-modal'));
		window.SiteI18n?.applyTranslations?.(document.getElementById('edit-pseudo-modal'));

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
		const editModal = document.getElementById('edit-pseudo-modal');
		if (editModal) window.SiteI18n?.applyTranslations?.(editModal);
		renderUserName(localStorage.getItem('userPseudo') || '');
	});

	window.SiteUserMenu = Object.freeze({
		init,
		setPseudo,
		refresh: () => renderUserName(localStorage.getItem('userPseudo') || ''),
	});
})();


