/** @format */

(() => {
  const t = (key, fallback, params) => window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const notify = (message, type = 'info') => {
    if (!message) return;
    window.SiteUI?.notify?.(message, type);
  };

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

  const openModal = (tab = 'export') => {
    const modal = document.getElementById('data-management-modal');
    if (!modal) return;

    if (window.SiteModalSheet?.open) {
      window.SiteModalSheet.open(modal);
    } else {
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }
    activateTab(tab);

    const confirmCheckbox = document.getElementById('confirm-understand');
    const confirmDeletionBtn = document.getElementById('confirm-deletion');
    if (confirmCheckbox) confirmCheckbox.checked = false;
    if (confirmDeletionBtn) confirmDeletionBtn.disabled = true;
  };

  const closeModal = () => {
    const modal = document.getElementById('data-management-modal');
    if (!modal) return;

    if (window.SiteModalSheet?.close) {
      window.SiteModalSheet.close(modal);
    } else {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }
  };

  const activateTab = (tab) => {
    document.querySelectorAll('.data-management-tabs .tab').forEach((node) => {
      node.classList.toggle('active', node.dataset.tab === tab);
    });

    document.querySelectorAll('.tab-content').forEach((content) => {
      content.classList.toggle('active', content.id === `${tab}-tab`);
    });
  };

  const buildDeletionScope = () => {
    const deleteAll = document.getElementById('delete-all-data');
    if (deleteAll?.checked) return ['all'];

    const scopes = [];
    if (document.getElementById('delete-account-data')?.checked) scopes.push('account_data');
    if (document.getElementById('delete-polls-data')?.checked) scopes.push('poll_responses');
    if (document.getElementById('delete-chat-data')?.checked) scopes.push('chat_messages');
    return scopes;
  };

  const createPrivacyTicket = async ({ subject, message }) => {
    return window.SiteSupportTickets.submitTicket({
      name: '',
      email: '',
      message,
      category: 'privacy',
      subject,
      channelPage: 'privacy',
      locale: window.SiteI18n?.getLanguage?.() || 'fr',
    });
  };

  const handleExportRequest = async () => {
    const button = document.getElementById('start-export');
    if (!button) return;

    const checked = document.querySelector('input[name="export-format"]:checked');
    const format = checked?.id?.replace('export-', '') || 'json';

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

    try {
      const payload = await createPrivacyTicket({
        subject: `RGPD export request (${format.toUpperCase()})`,
        message: `Demande RGPD d export des donnees. Format demande: ${format.toUpperCase()}.`,
      });

      const ticketRef = payload?.ticket?.ticketRef || 'N/A';
      notify(
        t('privacy.export_ticket_created', 'Demande enregistree. Reference: {ticketRef}', {
          ticketRef,
        }),
        'success',
      );
      closeModal();
    } catch (error) {
      notify(
        error?.message ||
          t('privacy.export_ticket_error', "Impossible de creer la demande d export."),
        'error',
      );
    } finally {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  };

  const handleDeletionRequest = async () => {
    const confirmCheckbox = document.getElementById('confirm-understand');
    const button = document.getElementById('confirm-deletion');
    if (!button) return;

    if (!confirmCheckbox?.checked) {
      notify(
        t(
          'privacy.deletion_confirm_required',
          'Confirmez que vous comprenez les consequences avant de continuer.',
        ),
        'error',
      );
      return;
    }

    if (
      !window.confirm(
        t(
          'privacy.deletion_confirm_dialog',
          'Voulez-vous vraiment soumettre cette demande RGPD de suppression ?',
        ),
      )
    ) {
      return;
    }

    const scopes = buildDeletionScope();
    const scopeLabel = scopes.length ? scopes.join(', ') : 'none_selected';

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';

    try {
      const payload = await createPrivacyTicket({
        subject: 'RGPD deletion request',
        message:
          `Demande RGPD de suppression des donnees. Perimetre: ${scopeLabel}.` +
          ' Action demandee via formulaire privacy.',
      });

      const ticketRef = payload?.ticket?.ticketRef || 'N/A';
      notify(
        t('privacy.deletion_ticket_created', 'Demande enregistree. Reference: {ticketRef}', {
          ticketRef,
        }),
        'success',
      );
      closeModal();
    } catch (error) {
      notify(
        error?.message ||
          t('privacy.deletion_ticket_error', 'Impossible de creer la demande de suppression.'),
        'error',
      );
    } finally {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  };

  const bindDataManagement = () => {
    document.getElementById('manage-privacy')?.addEventListener('click', () => openModal('settings'));
    document.getElementById('export-data')?.addEventListener('click', () => openModal('export'));

    document.getElementById('access-data')?.addEventListener('click', () => openModal('export'));
    document.getElementById('delete-account')?.addEventListener('click', () => openModal('delete'));

    document.getElementById('close-data-modal')?.addEventListener('click', closeModal);

    document.getElementById('data-management-modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });

    document.querySelectorAll('.data-management-tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    });

    document.getElementById('start-export')?.addEventListener('click', () => {
      handleExportRequest();
    });

    document.getElementById('confirm-understand')?.addEventListener('change', (event) => {
      const button = document.getElementById('confirm-deletion');
      if (button) button.disabled = !event.target.checked;
    });

    document.getElementById('confirm-deletion')?.addEventListener('click', () => {
      handleDeletionRequest();
    });

    const deleteAll = document.getElementById('delete-all-data');
    const options = document.querySelectorAll('.deletion-option input:not(#delete-all-data)');

    deleteAll?.addEventListener('change', () => {
      options.forEach((option) => {
        option.checked = deleteAll.checked;
        option.disabled = deleteAll.checked;
      });
    });

    options.forEach((option) => {
      option.addEventListener('change', () => {
        if (!option.checked && deleteAll?.checked) {
          deleteAll.checked = false;
          options.forEach((opt) => {
            opt.disabled = false;
          });
        }
      });
    });
  };

  const bindDpoForm = () => {
    const form = document.getElementById('dpo-contact-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const reason = String(document.getElementById('contact-reason')?.value || '').trim();
      const email = String(document.getElementById('contact-email')?.value || '').trim();
      const message = String(document.getElementById('contact-message')?.value || '').trim();
      const submitBtn = form.querySelector('button[type="submit"]');

      if (!reason || !email || !message) {
        notify(t('forms.required', 'Veuillez remplir les champs obligatoires.'), 'error');
        return;
      }

      if (!isValidEmail(email)) {
        notify(t('forms.invalid_email', 'Adresse email invalide.'), 'error');
        return;
      }

      const originalHtml = submitBtn?.innerHTML || '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
      }

      try {
        const payload = await window.SiteSupportTickets.submitTicket({
          form,
          emailField: '#contact-email',
          messageField: '#contact-message',
          category: 'privacy',
          subject: `Privacy DPO - ${reason}`,
          channelPage: 'privacy',
          locale: window.SiteI18n?.getLanguage?.() || 'fr',
        });

        form.reset();
        const ticketRef = payload?.ticket?.ticketRef || 'N/A';
        notify(
          t('support.ticket_created', 'Demande envoyee. Reference: {ticketRef}', {
            ticketRef,
          }),
          'success',
        );
      } catch (error) {
        notify(error?.message || t('forms.submit_error', "Impossible d'envoyer votre demande."), 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHtml;
        }
      }
    });
  };

  const mapNewsletterStatus = (payload) => {
    const status = String(payload?.status || '').toLowerCase();
    if (status === 'pending') return { type: 'success', message: payload?.message };
    if (status === 'already_subscribed') return { type: 'info', message: payload?.message };
    if (status === 'pending_exists') return { type: 'warning', message: payload?.message };
    return { type: 'info', message: payload?.message };
  };

  const bindPrivacyUpdatesSubscribe = () => {
    const button = document.getElementById('subscribe-updates');
    const input = document.getElementById('update-email');
    if (!button || !input) return;

    button.addEventListener('click', async () => {
      const email = String(input.value || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        notify(t('forms.invalid_email', 'Adresse email invalide.'), 'error');
        return;
      }

      const originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Inscription...';

      try {
        const payload = await window.SiteApi.request('/api/newsletter/subscribe', {
          method: 'POST',
          data: {
            email,
            consent: true,
            locale: window.SiteI18n?.getLanguage?.() || 'fr',
            sourcePage: 'privacy',
          },
        });

        const mapped = mapNewsletterStatus(payload);
        notify(mapped.message || t('newsletter.pending_confirmation', 'Inscription enregistree.'), mapped.type);
        input.value = '';
      } catch (error) {
        notify(error?.message || t('newsletter.submit_error', "Impossible d'enregistrer votre inscription."), 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    });
  };

  const bindNavigation = () => {
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = 'browse-surveys.html';
    });

    document.getElementById('read-cgu')?.addEventListener('click', () => {
      window.location.href = 'cgu.html';
    });

    document.getElementById('edit-profile')?.addEventListener('click', () => {
      window.location.href = 'complete-profile.html';
    });

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', (event) => {
        const href = anchor.getAttribute('href');
        if (!href || href === '#') return;

        const target = document.querySelector(href);
        if (!target) return;

        event.preventDefault();
        window.scrollTo({
          top: Math.max(0, target.offsetTop - 84),
          behavior: 'smooth',
        });
      });
    });
  };

  const initHeroStats = () => {
    ['data-protected', 'gdpr-compliant', 'privacy-control'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = '100%';
    });
  };

  const initSettingsStorage = () => {
    const saveButton = document.getElementById('save-settings');
    const ids = ['public-profile', 'analytics-optin', 'email-notifications'];

    const normalizeIncoming = (settings) => ({
      'public-profile': Boolean(settings?.publicProfile ?? true),
      'analytics-optin': Boolean(settings?.analyticsOptIn ?? true),
      'email-notifications': Boolean(settings?.emailNotifications ?? true),
    });

    const applySettingsToUI = (settings) => {
      const normalized = normalizeIncoming(settings);
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.checked = Boolean(normalized[id]);
        }
      });
    };

    const loadSettingsFromApi = async () => {
      try {
        const payload = await window.SiteApi.request('/api/privacy/settings', {
          method: 'GET',
          auth: true,
        });
        applySettingsToUI(payload);
      } catch (error) {
        const status = Number(error?.status || error?.payload?.status || 0);
        if (status === 401) {
          return;
        }
        notify(
          error?.message ||
            t(
              'privacy.settings_load_error',
              'Impossible de charger vos parametres de confidentialite.',
            ),
          'warning',
        );
      }
    };

    const saveSettingsToApi = async () => {
      const payload = {
        publicProfile: Boolean(document.getElementById('public-profile')?.checked),
        analyticsOptIn: Boolean(document.getElementById('analytics-optin')?.checked),
        emailNotifications: Boolean(document.getElementById('email-notifications')?.checked),
      };

      const original = saveButton?.innerHTML || '';
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
      }

      try {
        const saved = await window.SiteApi.request('/api/privacy/settings', {
          method: 'PUT',
          auth: true,
          data: payload,
        });
        applySettingsToUI(saved);
        notify(t('privacy.settings_saved', 'Parametres de confidentialite enregistres.'), 'success');
        closeModal();
      } catch (error) {
        notify(
          error?.message ||
            t(
              'privacy.settings_save_error',
              'Impossible d enregistrer vos parametres de confidentialite.',
            ),
          'error',
        );
      } finally {
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.innerHTML = original;
        }
      }
    };

    loadSettingsFromApi();
    saveButton?.addEventListener('click', saveSettingsToApi);
  };

  const setLastUpdate = () => {
    const node = document.getElementById('last-update');
    if (node) node.textContent = '12 Fevrier 2026';
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindNavigation();
    initHeroStats();
    bindDataManagement();
    bindDpoForm();
    bindPrivacyUpdatesSubscribe();
    initSettingsStorage();
    setLastUpdate();
  });
})();
