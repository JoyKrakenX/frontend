/** @format */

(() => {
  if (window.SiteSupportTickets) return;

  const t = (key, fallback, params) =>
    window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const hasToken = () => Boolean(window.SiteApi?.getToken?.());

  const requireAuth = () => {
    if (hasToken()) return true;
    window.SiteUI?.notify?.(
      t(
        'support.auth_required',
        'Connexion requise pour envoyer une demande support. Redirection...',
      ),
      'warning',
    );
    window.redirectToGoogleAuth?.();
    return false;
  };

  const mapCategory = (value, fallback = 'general') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;

    const table = {
      technical: 'technical',
      account: 'general',
      feature: 'feature',
      billing: 'billing',
      partnership: 'general',
      other: 'other',
      problem: 'accessibility',
      suggestion: 'accessibility',
      feedback: 'accessibility',
      'legal-question': 'legal',
      'data-rights': 'privacy',
      'intellectual-property': 'legal',
      access: 'privacy',
      correction: 'privacy',
      deletion: 'privacy',
      complaint: 'privacy',
      question: 'privacy',
      legal: 'legal',
      privacy: 'privacy',
      accessibility: 'accessibility',
      general: 'general',
    };

    return table[normalized] || fallback;
  };

  const toText = (value, max = 2000) => String(value || '').trim().slice(0, max);

  const isValidEmail = (value) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim().toLowerCase());

  const inferSubjectFromSelect = (select) => {
    if (!select) return '';
    const selected = select.options?.[select.selectedIndex];
    if (!selected) return '';
    return toText(selected.textContent || selected.label || selected.value || '', 180);
  };

  const readValueFromField = (form, fieldRef) => {
    if (!fieldRef || !form) return '';
    if (typeof fieldRef === 'string') {
      const node = form.querySelector(fieldRef);
      return node?.value ?? '';
    }
    return fieldRef?.value ?? '';
  };

  const resolveFieldNode = (form, fieldRef) => {
    if (!fieldRef || !form) return null;
    if (typeof fieldRef === 'string') return form.querySelector(fieldRef);
    return fieldRef || null;
  };

  const submitTicket = async (config) => {
    if (!requireAuth()) return null;

    const {
      form,
      channelPage = 'contact',
      categoryValue = '',
      category = '',
      subjectValue = '',
      subject = '',
      messageValue = '',
      message = '',
      nameValue = '',
      name = '',
      emailValue = '',
      email = '',
      nameField = '',
      emailField = '',
      subjectField = '',
      messageField = '',
      locale = window.SiteI18n?.getLanguage?.() || 'fr',
      attachmentInput = null,
      attachmentField = '',
      submitButton = null,
      submittingLabel = '',
      successMessage = '',
    } = config || {};

    if (!form) {
      throw new Error('support form missing');
    }

    const authenticated = hasToken();

    const resolvedName = toText(
      nameValue || name || readValueFromField(form, nameField),
      120,
    );
    const resolvedEmail = toText(
      emailValue || email || readValueFromField(form, emailField),
      180,
    ).toLowerCase();
    const resolvedMessage = toText(
      messageValue || message || readValueFromField(form, messageField),
      6000,
    );

    const resolvedCategory = mapCategory(
      categoryValue || category,
      channelPage === 'accessibility' ? 'accessibility' : 'general',
    );

    const resolvedSubject =
      toText(subjectValue || subject || readValueFromField(form, subjectField), 180) ||
      resolvedCategory;

    if (!authenticated && (!resolvedName || resolvedName.length < 2)) {
      throw new Error(t('support.invalid_name', 'Nom invalide.'));
    }

    if (!authenticated && !isValidEmail(resolvedEmail)) {
      throw new Error(t('support.invalid_email', 'Adresse email invalide.'));
    }

    if (!resolvedMessage || resolvedMessage.length < 10) {
      throw new Error(
        t('support.invalid_message', 'Le message doit contenir au moins 10 caracteres.'),
      );
    }

    const body = new FormData();
    body.append('channelPage', channelPage);
    body.append('category', resolvedCategory);
    body.append('subject', resolvedSubject);
    if (resolvedName) body.append('name', resolvedName);
    if (resolvedEmail) body.append('email', resolvedEmail);
    body.append('message', resolvedMessage);
    body.append('locale', locale);

    const resolvedAttachmentInput = attachmentInput || resolveFieldNode(form, attachmentField);
    const attachmentFile = resolvedAttachmentInput?.files?.[0] || null;
    if (attachmentFile) {
      body.append('attachment', attachmentFile);
    }

    const previousLabel = submitButton?.innerHTML || '';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.innerHTML =
        submittingLabel ||
        '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Envoi...';
    }

    try {
      const response = await window.SiteApi.request('/api/support/tickets', {
        method: 'POST',
        auth: true,
        body,
        headers: {},
      });

      const ticketRef = String(response?.ticket?.ticketRef || '').trim();
      window.SiteUI?.notify?.(
        successMessage ||
          t(
            'support.ticket_created',
            `Demande envoyee. Reference: ${ticketRef || '-'}`,
            { ticketRef: ticketRef || '-' },
          ),
        'success',
      );

      try {
        form.reset();
      } catch (_error) {
        // ignore
      }

      return response;
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = previousLabel;
      }
    }
  };

  const bindForm = (form, configBuilder) => {
    if (!form || form.dataset.supportTicketBound === 'true') return;
    form.dataset.supportTicketBound = 'true';

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const config = configBuilder?.(form) || {};
        await submitTicket({ form, ...config });
      } catch (error) {
        const message =
          error?.payload?.message ||
          error?.message ||
          t('support.submit_error', "Impossible d'envoyer la demande support.");
        window.SiteUI?.notify?.(message, 'error');
      }
    });
  };

  window.SiteSupportTickets = Object.freeze({
    submitTicket,
    bindForm,
    mapCategory,
    inferSubjectFromSelect,
  });
})();

