/** @format */

(() => {
  const t = (key, fallback, params) => window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const maxAttachmentBytes = 5 * 1024 * 1024;
  const allowedAttachmentTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);

  const notify = (message, type = 'info') => {
    if (!message) return;
    window.SiteUI?.notify?.(message, type);
  };

  const getField = (id) => document.getElementById(id);

  const setFieldError = (fieldId, message = '') => {
    const field = getField(fieldId);
    const error = getField(`${fieldId}Error`);

    if (field) field.classList.toggle('error', Boolean(message));
    if (error) error.textContent = message;
  };

  const clearAllErrors = () => {
    ['fullName', 'email', 'subject', 'message', 'attachment'].forEach((id) => {
      setFieldError(id, '');
    });
  };

  const isValidEmail = (value) => emailRegex.test(String(value || '').trim());

  const validateAttachment = () => {
    const attachmentInput = getField('attachment');
    if (!attachmentInput || !attachmentInput.files || !attachmentInput.files.length) {
      setFieldError('attachment', '');
      return true;
    }

    const file = attachmentInput.files[0];
    if (file.size > maxAttachmentBytes) {
      setFieldError(
        'attachment',
        t('contact.attachment_too_large', 'Fichier trop volumineux (5MB max).'),
      );
      return false;
    }

    if (!allowedAttachmentTypes.has(file.type)) {
      setFieldError(
        'attachment',
        t('contact.attachment_invalid_type', 'Type de fichier non autorise.'),
      );
      return false;
    }

    setFieldError('attachment', '');
    return true;
  };

  const validateForm = () => {
    const fullName = String(getField('fullName')?.value || '').trim();
    const email = String(getField('email')?.value || '').trim();
    const subject = String(getField('subject')?.value || '').trim();
    const message = String(getField('message')?.value || '').trim();

    let valid = true;

    if (!fullName || fullName.length < 2) {
      setFieldError('fullName', t('contact.invalid_name', 'Nom invalide.'));
      valid = false;
    } else {
      setFieldError('fullName', '');
    }

    if (!isValidEmail(email)) {
      setFieldError('email', t('contact.invalid_email', 'Adresse email invalide.'));
      valid = false;
    } else {
      setFieldError('email', '');
    }

    if (!subject) {
      setFieldError('subject', t('contact.invalid_subject', 'Sujet obligatoire.'));
      valid = false;
    } else {
      setFieldError('subject', '');
    }

    if (!message || message.length < 10) {
      setFieldError(
        'message',
        t('contact.invalid_message', 'Le message doit contenir au moins 10 caracteres.'),
      );
      valid = false;
    } else {
      setFieldError('message', '');
    }

    if (!validateAttachment()) {
      valid = false;
    }

    return valid;
  };

  const mapCategory = (subjectValue) => {
    const normalized = String(subjectValue || '').toLowerCase();
    if (normalized.includes('technical')) return 'technical';
    if (normalized.includes('billing')) return 'billing';
    if (normalized.includes('feature')) return 'feature';
    if (normalized.includes('account')) return 'general';
    if (normalized.includes('partnership')) return 'general';
    return 'general';
  };

  const buildSubject = () => {
    const subjectSelect = getField('subject');
    if (!subjectSelect) return 'Contact request';

    const selected = subjectSelect.options[subjectSelect.selectedIndex];
    const label = String(selected?.textContent || selected?.value || 'general').trim();
    return `Contact - ${label}`;
  };

  const showConfirmationModal = (ticketRef) => {
    const modal = getField('confirmationModal');
    const trackingNumber = getField('trackingNumber');
    const closeModalBtn = getField('closeModalBtn');
    const confirmCloseBtn = getField('confirmCloseBtn');
    if (!modal) return;

    if (trackingNumber) trackingNumber.textContent = ticketRef || 'SUP-REF-N/A';

    const close = () => {
      modal.classList.add('hidden');
      document.body.classList.remove('modal-open');
    };

    closeModalBtn?.addEventListener('click', close, { once: true });
    confirmCloseBtn?.addEventListener('click', close, { once: true });

    modal.addEventListener(
      'click',
      (event) => {
        if (event.target === modal) close();
      },
      { once: true },
    );

    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  };

  const bindContactForm = () => {
    const contactForm = getField('contactForm');
    const submitBtn = getField('submitBtn');
    const resetBtn = getField('resetBtn');
    if (!contactForm) return;

    ['fullName', 'email', 'subject', 'message'].forEach((fieldId) => {
      getField(fieldId)?.addEventListener('input', () => setFieldError(fieldId, ''));
      getField(fieldId)?.addEventListener('blur', () => {
        validateForm();
      });
    });

    getField('attachment')?.addEventListener('change', () => {
      validateAttachment();
    });

    resetBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      contactForm.reset();
      clearAllErrors();
      notify(t('contact.form_reset', 'Formulaire reinitialise.'), 'info');
    });

    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!validateForm()) return;

      const originalHtml = submitBtn?.innerHTML || '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
      }

      try {
        const response = await window.SiteSupportTickets.submitTicket({
          form: contactForm,
          nameField: '#fullName',
          emailField: '#email',
          subjectField: '#subject',
          messageField: '#message',
          attachmentField: '#attachment',
          category: mapCategory(getField('subject')?.value),
          subject: buildSubject(),
          channelPage: 'contact',
          locale: window.SiteI18n?.getLanguage?.() || 'fr',
        });

        contactForm.reset();
        clearAllErrors();

        const ticketRef = response?.ticket?.ticketRef || '';
        showConfirmationModal(ticketRef);
      } catch (error) {
        notify(
          error?.message ||
            t('contact.submit_error', "Impossible d'envoyer votre message pour le moment."),
          'error',
        );
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalHtml;
        }
      }
    });
  };

  const initFAQ = () => {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach((item) => {
      const question = item.querySelector('.faq-question');
      const answer = item.querySelector('.faq-answer');
      if (!question || !answer) return;

      question.addEventListener('click', () => {
        const isActive = item.classList.contains('active');

        faqItems.forEach((otherItem) => {
          if (otherItem === item) return;
          otherItem.classList.remove('active');
          otherItem.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
          const otherAnswer = otherItem.querySelector('.faq-answer');
          if (otherAnswer) otherAnswer.style.maxHeight = null;
        });

        if (isActive) {
          item.classList.remove('active');
          question.setAttribute('aria-expanded', 'false');
          answer.style.maxHeight = null;
          return;
        }

        item.classList.add('active');
        question.setAttribute('aria-expanded', 'true');
        answer.style.maxHeight = `${answer.scrollHeight}px`;
      });
    });
  };

  const initAlternativeButtons = () => {
    getField('liveChatBtn')?.addEventListener('click', () => {
      window.location.href = 'support-chat.html';
    });

    getField('callBtn')?.addEventListener('click', () => {
      if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        window.location.href = 'tel:+2290141688672';
        return;
      }

      notify(
        t(
          'contact.call_number_info',
          'Numero: +229 01 41 68 86 72 (Lundi-Vendredi, 09:00-18:00).',
        ),
        'info',
      );
    });
  };

  const prefillUserData = async () => {
    try {
      const token = window.SiteApi?.getToken?.();
      if (token) {
        const me = await window.SiteApi.request('/api/auth/me', {
          method: 'GET',
          auth: true,
        });

        if (getField('email') && me?.email) getField('email').value = me.email;
        if (getField('fullName') && (me?.pseudo || me?.name)) {
          getField('fullName').value = me.pseudo || me.name;
        }
        return;
      }
    } catch (_error) {
      // Fallback below.
    }

    try {
      const localUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (getField('email') && localUser?.email) getField('email').value = localUser.email;
      if (getField('fullName') && (localUser?.name || localUser?.pseudo)) {
        getField('fullName').value = localUser.name || localUser.pseudo;
      }
    } catch (_error) {
      // Ignore malformed local payload.
    }
  };

  const bindBackButton = () => {
    getField('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = 'browse-surveys.html';
    });
  };

  document.addEventListener('DOMContentLoaded', async () => {
    bindBackButton();
    initFAQ();
    bindContactForm();
    initAlternativeButtons();
    await prefillUserData();
  });
})();
