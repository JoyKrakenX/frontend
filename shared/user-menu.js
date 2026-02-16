/** @format */

(() => {
  if (window.SiteUserMenu) return;

  const GOOGLE_LOGIN_PATH = '/api/auth/google';

  const t = (key, fallback, params) =>
    window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const ensureLogoutModal = () => {
    let modal = document.getElementById('logout-confirm-modal');
    if (modal) return modal;

    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div id="logout-confirm-modal" class="modal hidden" aria-hidden="true" role="dialog" aria-labelledby="logout-confirm-title">
        <div class="modal-content">
          <div class="modal-header">
            <h3 id="logout-confirm-title" data-i18n="shared.auth.logout_confirm_title">Confirmer la déconnexion</h3>
            <button class="close-modal" type="button" aria-label="Fermer" data-i18n-aria="shared.modals.close">&times;</button>
          </div>
          <div class="modal-body">
            <p data-i18n="shared.auth.logout_confirm_body">Êtes-vous sûr de vouloir vous déconnecter ?</p>
          </div>
          <div class="modal-footer">
            <button id="logout-cancel" class="btn-secondary" type="button" data-i18n="shared.auth.logout_cancel">Annuler</button>
            <button id="logout-ok" class="btn-danger" type="button" data-i18n="shared.auth.logout_confirm">Se déconnecter</button>
          </div>
        </div>
      </div>`,
    );

    modal = document.getElementById('logout-confirm-modal');
    window.SiteI18n?.applyTranslations?.(modal);
    return modal;
  };

  const showLogoutModal = () => {
    const modal = ensureLogoutModal();
    modal?.classList.remove('hidden');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  };

  const hideLogoutModal = () => {
    const modal = document.getElementById('logout-confirm-modal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  };

  const clearSession = () => {
    window.SiteApi?.clearToken?.();
    localStorage.removeItem('user');
    localStorage.removeItem('userPseudo');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userRole');
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
    if (!host.querySelector('#login-btn')) {
      host.insertAdjacentHTML(
        'beforeend',
        `<button id="login-btn" class="btn-primary" type="button" data-i18n-aria="shared.auth.login">
          <i class="fas fa-sign-in-alt"></i>
          <span data-i18n="shared.auth.login">Se connecter</span>
        </button>`,
      );
    }
    return host.querySelector('#login-btn');
  };

  const ensureUserMenu = (host) => {
    if (!host.querySelector('#user-menu')) {
      host.insertAdjacentHTML(
        'beforeend',
        `<div id="user-menu" class="user-menu-container hidden">
          <details class="user-menu-details">
            <summary class="user-menu-summary" data-i18n-aria="shared.auth.user_menu">
              <i class="fas fa-user-circle user-icon"></i>
              <i class="fas fa-chevron-down chevron-icon"></i>
            </summary>
            <div class="user-dropdown">
              <div class="dropdown-header">
                <div class="user-info">
                  <i class="fas fa-user-circle user-avatar"></i>
                  <div class="user-details">
                    <div class="user-name-full">
                      <div id="user-name" class="user-name"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item logout-item" id="logout-btn" type="button" data-i18n-aria="shared.auth.logout">
                <i class="fas fa-sign-out-alt"></i>
                <span data-i18n="shared.auth.logout">Déconnexion</span>
              </button>
            </div>
          </details>
        </div>`,
      );
    }
    return host.querySelector('#user-menu');
  };

  const setConnectedState = (connected, pseudo = '') => {
    const loginBtn = document.getElementById('login-btn');
    const userMenu = document.getElementById('user-menu');
    const userName = document.getElementById('user-name');
    const normalizedPseudo = String(pseudo || '').trim();

    if (userName) userName.textContent = connected ? normalizedPseudo : '';
    if (loginBtn) loginBtn.classList.toggle('hidden', connected);
    if (userMenu) userMenu.classList.toggle('hidden', !connected);
  };

  const bindGlobalEvents = () => {
    if (document.body.dataset.userMenuBound === 'true') return;
    document.body.dataset.userMenuBound = 'true';

    document.addEventListener('click', (event) => {
      const details = document.querySelector('#user-menu .user-menu-details');
      if (!details?.open) return;
      if (!details.contains(event.target)) {
        details.open = false;
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideLogoutModal();
    });

    document.addEventListener('click', (event) => {
      const modal = document.getElementById('logout-confirm-modal');
      if (modal && event.target === modal) hideLogoutModal();
    });
  };

  const bindLocalEvents = () => {
    document.getElementById('login-btn')?.addEventListener('click', () => {
      window.location.href = GOOGLE_LOGIN_PATH;
    });

    document.getElementById('logout-btn')?.addEventListener('click', showLogoutModal);
    document.getElementById('logout-cancel')?.addEventListener('click', hideLogoutModal);
    document.querySelector('#logout-confirm-modal .close-modal')?.addEventListener('click', hideLogoutModal);

    document.getElementById('logout-ok')?.addEventListener('click', () => {
      clearSession();
      hideLogoutModal();
      window.location.href = 'browse-surveys.html';
    });
  };

  const loadCurrentUser = async () => {
    const token = window.SiteApi?.getToken?.();
    if (!token) {
      setConnectedState(false);
      return;
    }

    try {
      const me = await window.SiteApi.request('/api/auth/me', { method: 'GET', auth: true });
      const pseudo = String(me?.pseudo || me?.name || localStorage.getItem('userPseudo') || '').trim();
      setConnectedState(true, pseudo);

      if (pseudo) localStorage.setItem('userPseudo', pseudo);
      if (me?.email) localStorage.setItem('userEmail', me.email);
      if (me?.role) localStorage.setItem('userRole', me.role);
    } catch (_error) {
      clearSession();
      setConnectedState(false);
    }
  };

  const init = async () => {
    if (document.body?.dataset?.sharedUserMenu !== 'true') return;

    const pageActions = ensurePageActions();
    if (!pageActions) return;

    ensureLoginButton(pageActions);
    ensureUserMenu(pageActions);
    ensureLogoutModal();

    window.SiteI18n?.applyTranslations?.(pageActions);
    window.SiteI18n?.applyTranslations?.(document.getElementById('logout-confirm-modal'));

    bindGlobalEvents();
    bindLocalEvents();
    await loadCurrentUser();
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => console.error('user-menu init failed:', error));
  });

  document.addEventListener('site:language-changed', () => {
    window.SiteI18n?.applyTranslations?.(document.getElementById('page-actions') || document);
    const modal = document.getElementById('logout-confirm-modal');
    if (modal) window.SiteI18n?.applyTranslations?.(modal);
  });

  window.SiteUserMenu = Object.freeze({ init });
})();
