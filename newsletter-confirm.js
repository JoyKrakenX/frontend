/** @format */

(() => {
  const REDIRECT_TARGET = 'browse-surveys.html';
  const DEFAULT_DELAY_SECONDS = 7;

  const state = {
    countdownTimer: null,
  };

  const els = {
    card: null,
    icon: null,
    title: null,
    message: null,
    hint: null,
  };

  const t = (key, fallback, params) =>
    window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const parseParams = () => {
    const url = new URL(window.location.href);
    return {
      token: String(url.searchParams.get('token') || '').trim(),
      status: String(url.searchParams.get('status') || '').trim(),
      message: String(url.searchParams.get('message') || '').trim(),
    };
  };

  const cleanSensitiveParams = () => {
    try {
      const url = new URL(window.location.href);
      ['token', 'message'].forEach((key) => url.searchParams.delete(key));
      window.history.replaceState({}, '', url.toString());
    } catch (_error) {
      // ignore
    }
  };

  const applyState = ({ tone, iconClass, title, message, hint = '' }) => {
    if (!els.card || !els.icon || !els.title || !els.message || !els.hint) return;
    els.card.dataset.tone = tone;
    els.icon.className = iconClass;
    els.title.textContent = title;
    els.message.textContent = message;
    els.hint.textContent = hint;
  };

  const startCountdown = (seconds = DEFAULT_DELAY_SECONDS) => {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }

    let remaining = Math.max(1, Number(seconds) || DEFAULT_DELAY_SECONDS);
    els.hint.textContent = t(
      'newsletter_status.redirect_hint',
      'Redirection automatique dans {seconds}s...',
      { seconds: remaining },
    );

    state.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
        window.location.href = REDIRECT_TARGET;
        return;
      }

      els.hint.textContent = t(
        'newsletter_status.redirect_hint',
        'Redirection automatique dans {seconds}s...',
        { seconds: remaining },
      );
    }, 1000);
  };

  const mapConfirmStatus = (status, messageOverride = '') => {
    const normalized = String(status || '').toLowerCase();

    if (normalized === 'confirmed') {
      return {
        tone: 'success',
        iconClass: 'fas fa-circle-check',
        title: t('newsletter_confirm.states.success_title', 'Abonnement confirmé'),
        message:
          messageOverride ||
          t(
            'newsletter_confirm.states.success_message',
            'Votre abonnement newsletter est confirmé.',
          ),
        redirect: true,
      };
    }

    if (normalized === 'already_confirmed') {
      return {
        tone: 'info',
        iconClass: 'fas fa-envelope-open-text',
        title: t('newsletter_confirm.states.already_title', 'Abonnement déjà confirmé'),
        message:
          messageOverride ||
          t(
            'newsletter_confirm.states.already_message',
            'Cette adresse est déjà confirmée.',
          ),
        redirect: true,
      };
    }

    if (
      normalized === 'invalid_token' ||
      normalized === 'token_invalid' ||
      normalized === 'invalid_or_expired'
    ) {
      return {
        tone: 'error',
        iconClass: 'fas fa-triangle-exclamation',
        title: t('newsletter_confirm.states.invalid_title', 'Lien invalide'),
        message:
          messageOverride ||
          t(
            'newsletter_confirm.states.invalid_message',
            'Le lien de confirmation est invalide.',
          ),
        redirect: false,
      };
    }

    if (normalized === 'expired_token' || normalized === 'token_expired') {
      return {
        tone: 'warning',
        iconClass: 'fas fa-clock',
        title: t('newsletter_confirm.states.expired_title', 'Lien expiré'),
        message:
          messageOverride ||
          t('newsletter_confirm.states.expired_message', 'Le lien a expiré.'),
        redirect: false,
      };
    }

    return {
      tone: 'error',
      iconClass: 'fas fa-triangle-exclamation',
      title: t('newsletter_confirm.states.error_title', 'Confirmation impossible'),
      message:
        messageOverride ||
        t('newsletter_confirm.states.error_message', 'Une erreur est survenue.'),
      redirect: false,
    };
  };

  const requestConfirmation = async (token) => {
    const response = await window.SiteApi.request(
      `/api/newsletter/confirm?token=${encodeURIComponent(token)}&format=json`,
      { method: 'GET' },
    );
    return response;
  };

  const init = async () => {
    els.card = document.getElementById('status-card');
    els.icon = document.getElementById('status-icon');
    els.title = document.getElementById('status-title');
    els.message = document.getElementById('status-message');
    els.hint = document.getElementById('status-hint');

    if (!els.card || !els.icon || !els.title || !els.message || !els.hint) return;

    const params = parseParams();

    try {
      let status = params.status;
      let message = params.message;

      if (!status && params.token) {
        const response = await requestConfirmation(params.token);
        status = String(response?.status || '');
        message = String(response?.message || '');
      }

      const ui = mapConfirmStatus(status, message);
      applyState(ui);
      if (ui.redirect) startCountdown(DEFAULT_DELAY_SECONDS);
    } catch (error) {
      const ui = mapConfirmStatus('error', error?.message);
      applyState(ui);
    } finally {
      cleanSensitiveParams();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('newsletter-confirm init failed:', error);
    });
  });
})();
