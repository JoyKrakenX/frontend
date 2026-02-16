/** @format */

(() => {
  const t = (key, fallback, params) => window.SiteI18n?.t?.(key, fallback, params) || fallback;

  const notify = (message, type = 'info') => {
    if (!message) return;
    window.SiteUI?.notify?.(message, type);
  };

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

  const bindBackButton = () => {
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = 'browse-surveys.html';
    });
  };

  const initSmoothAnchors = () => {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', (event) => {
        const targetId = anchor.getAttribute('href');
        if (!targetId || targetId === '#') return;

        const target = document.querySelector(targetId);
        if (!target) return;

        event.preventDefault();
        window.scrollTo({
          top: Math.max(0, target.offsetTop - 96),
          behavior: 'smooth',
        });
      });
    });
  };

  const initTocHighlight = () => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          document.querySelectorAll('.toc-link').forEach((link) => {
            link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`);
          });
        });
      },
      {
        root: null,
        rootMargin: '-100px 0px -50% 0px',
        threshold: 0.1,
      },
    );

    document.querySelectorAll('.content-article').forEach((article) => observer.observe(article));
  };

  const initAnimations = () => {
    const progressFill = document.querySelector('.progress-fill');
    if (progressFill) {
      setTimeout(() => {
        progressFill.style.transition = 'width 1.5s ease-in-out';
      }, 500);
    }

    document.querySelectorAll('.content-article').forEach((article, index) => {
      article.style.animationDelay = `${index * 0.1}s`;
    });
  };

  const bindAccessibilityForm = () => {
    const form = document.querySelector('.accessibility-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const nameEl = document.getElementById('name');
      const emailEl = document.getElementById('email');
      const typeEl = document.getElementById('type');
      const messageEl = document.getElementById('message');
      const submitBtn = form.querySelector('.btn-submit');

      const name = String(nameEl?.value || '').trim();
      const email = String(emailEl?.value || '').trim();
      const message = String(messageEl?.value || '').trim();
      const reason = String(typeEl?.value || 'accessibility').trim();

      if (!name || !email || !message) {
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
          nameField: '#name',
          emailField: '#email',
          messageField: '#message',
          category: 'accessibility',
          subject: `Accessibility - ${reason}`,
          channelPage: 'accessibility',
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
        notify(
          error?.message || t('forms.submit_error', "Impossible d'envoyer votre demande."),
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

  document.addEventListener('DOMContentLoaded', () => {
    bindBackButton();
    initSmoothAnchors();
    initTocHighlight();
    initAnimations();
    bindAccessibilityForm();
  });
})();
