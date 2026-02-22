/** @format */

(() => {
  const t = (key, fallback, params) => window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';

  let growthChart = null;

  const notify = (message, type = 'info') => {
    if (!message) return;
    window.SiteUI?.notify?.(message, type);
  };

  const formatNumber = (value) => new Intl.NumberFormat(getIntlLocale()).format(value || 0);

  const animateCounter = (element, value) => {
    if (!element) return;

    const target = Math.max(0, Number(value) || 0);
    const duration = 950;
    const startTime = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const next = Math.floor(target * progress);
      element.textContent = formatNumber(next);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  };

  const bindNavigation = () => {
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = 'browse-surveys.html';
    });

    document.getElementById('cta-start')?.addEventListener('click', () => {
      window.location.href = 'browse-surveys.html';
    });

    document.getElementById('cta-contact')?.addEventListener('click', () => {
      window.location.href = 'contact.html';
    });

    document.getElementById('broadcaster-contact')?.addEventListener('click', () => {
      window.location.href = 'contact.html?type=broadcaster';
    });

    document.getElementById('cta-demo')?.addEventListener('click', () => {
      window.location.href = 'contact.html?type=demo';
    });

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', (event) => {
        const targetId = anchor.getAttribute('href');
        if (!targetId || targetId === '#') return;

        const target = document.querySelector(targetId);
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
      { threshold: 0.12, rootMargin: '0px 0px -90px 0px' },
    );

    document.querySelectorAll('[data-aos]').forEach((el) => observer.observe(el));
  };

  const setAnimationDelays = () => {
    document.querySelectorAll('.value-card').forEach((card, index) => {
      card.style.animationDelay = `${index * 0.1}s`;
    });

    document.querySelectorAll('.step-card').forEach((card, index) => {
      card.style.animationDelay = `${index * 0.12}s`;
    });

    document.querySelectorAll('.timeline-item').forEach((item, index) => {
      item.style.transitionDelay = `${index * 0.08}s`;
    });
  };

  const buildChart = (metrics) => {
    const canvas = document.getElementById('growthChart');
    if (!canvas || typeof window.Chart === 'undefined') return;

    const labels = Array.isArray(metrics?.series?.labels) ? metrics.series.labels : [];
    const activeUsers = Array.isArray(metrics?.series?.activeUsers)
      ? metrics.series.activeUsers
      : [];
    const surveysCreated = Array.isArray(metrics?.series?.surveysCreated)
      ? metrics.series.surveysCreated
      : [];

    if (growthChart) {
      growthChart.destroy();
      growthChart = null;
    }

    growthChart = new window.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: t('about.metrics.active_users', 'Utilisateurs actifs'),
            data: activeUsers,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.12)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
          },
          {
            label: t('about.metrics.surveys_created', 'Sondages crees'),
            data: surveysCreated,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.12)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#f1f5f9' },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.08)' },
            ticks: { color: '#94a3b8' },
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.08)' },
            ticks: { color: '#94a3b8' },
          },
        },
      },
    });
  };

  const applyMetrics = (metrics) => {
    const summary = metrics?.summary || {};
    const activeUsers = Number(summary.activeUsers || 0);
    const totalSurveys = Number(summary.totalSurveys || 0);
    const totalResponses = Number(summary.totalResponses || 0);

    animateCounter(document.getElementById('active-users'), activeUsers);
    animateCounter(document.getElementById('total-polls'), totalSurveys);
    animateCounter(document.getElementById('total-responses'), totalResponses);

    const sectionStats = document.querySelectorAll('.stats-section .stat-number');
    if (sectionStats[0]) animateCounter(sectionStats[0], activeUsers);
    if (sectionStats[2]) animateCounter(sectionStats[2], totalSurveys);
    if (sectionStats[3]) animateCounter(sectionStats[3], totalResponses);

    buildChart(metrics);
  };

  const loadPlatformMetrics = async () => {
    try {
      const metrics = await window.SiteApi.request('/api/public/platform-metrics', {
        method: 'GET',
      });
      applyMetrics(metrics);
    } catch (error) {
      console.error('about.metrics.load_failed:', error);
      notify(t('about.metrics_load_error', 'Statistiques indisponibles pour le moment.'), 'warning');
      applyMetrics({
        summary: {
          activeUsers: 0,
          totalSurveys: 0,
          totalResponses: 0,
        },
        series: {
          labels: [],
          activeUsers: [],
          surveysCreated: [],
        },
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindNavigation();
    setAnimationDelays();
    initScrollAnimations();
    loadPlatformMetrics();
  });

  document.addEventListener('site:language-changed', () => {
    loadPlatformMetrics();
  });
})();
