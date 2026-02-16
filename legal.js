/** @format */

(() => {
  const t = (key, fallback, params) => window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const notify = (message, type = 'info') => {
    if (!message) return;
    window.SiteUI?.notify?.(message, type);
  };

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

  const animatePercentValue = (element, target) => {
    if (!element) return;
    const end = Math.max(0, Math.min(100, Number(target) || 0));
    const duration = 900;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const value = Math.round(end * progress);
      element.textContent = `${value}%`;
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  };

  const initHeroStats = () => {
    animatePercentValue(document.getElementById('legal-compliance'), 100);
    animatePercentValue(document.getElementById('transparency'), 100);
    animatePercentValue(document.getElementById('user-protection'), 100);
  };

  const initNavigation = () => {
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = 'browse-surveys.html';
    });

    document.getElementById('my-survey-button')?.addEventListener('click', () => {
      window.location.href = 'my-surveys.html';
    });

    document.getElementById('create-survey-btn')?.addEventListener('click', () => {
      window.location.href = 'create-survey.html';
    });

    document.getElementById('read-cgu')?.addEventListener('click', () => {
      window.location.href = 'cgu.html';
    });

    document.getElementById('read-privacy')?.addEventListener('click', () => {
      window.location.href = 'privacy.html';
    });

    document.getElementById('contact-us')?.addEventListener('click', () => {
      window.location.href = 'contact.html';
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

  const initScrollAnimations = () => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('aos-animate');
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -90px 0px',
      },
    );

    document.querySelectorAll('[data-aos]').forEach((el) => observer.observe(el));
  };

  const bindLegalContactForm = () => {
    const form = document.getElementById('legal-contact-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const reasonEl = document.getElementById('legal-contact-reason');
      const nameEl = document.getElementById('legal-contact-name');
      const emailEl = document.getElementById('legal-contact-email');
      const messageEl = document.getElementById('legal-contact-message');
      const submitBtn = form.querySelector('button[type="submit"]');

      const reason = String(reasonEl?.value || '').trim();
      const name = String(nameEl?.value || '').trim();
      const email = String(emailEl?.value || '').trim();
      const message = String(messageEl?.value || '').trim();

      if (!reason || !name || !email || !message) {
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
        const response = await window.SiteSupportTickets.submitTicket({
          form,
          nameField: '#legal-contact-name',
          emailField: '#legal-contact-email',
          messageField: '#legal-contact-message',
          category: 'legal',
          subject: `Legal - ${reason}`,
          channelPage: 'legal',
          locale: window.SiteI18n?.getLanguage?.() || 'fr',
        });

        form.reset();
        const ticketRef = response?.ticket?.ticketRef || 'N/A';
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

  const bindLegalUpdatesSubscribe = () => {
    const button = document.getElementById('subscribe-legal-updates');
    const input = document.getElementById('legal-update-email');
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
            sourcePage: 'legal',
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

  const setEffectiveDate = () => {
    const target = document.getElementById('effective-date');
    if (target) target.textContent = '12 Fevrier 2026';
  };

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initHeroStats();
    initScrollAnimations();
    bindLegalContactForm();
    bindLegalUpdatesSubscribe();
    setEffectiveDate();
  });
})();
