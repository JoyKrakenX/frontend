/** @format */

(() => {
  const getColor = (type) => {
    switch (type) {
      case 'success':
        return 'linear-gradient(135deg, #10b981, #059669)';
      case 'error':
        return 'linear-gradient(135deg, #ef4444, #dc2626)';
      case 'warning':
        return 'linear-gradient(135deg, #f59e0b, #d97706)';
      default:
        return 'linear-gradient(135deg, #3b82f6, #2563eb)';
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return 'fa-check-circle';
      case 'error':
        return 'fa-exclamation-circle';
      case 'warning':
        return 'fa-exclamation-triangle';
      default:
        return 'fa-info-circle';
    }
  };

  const notify = (message, type = 'info', duration = 4500) => {
    const translated =
      window.SiteI18n?.translateText?.(String(message || '').trim()) || String(message || '').trim();
    const text = String(translated || '').trim();
    if (!text) return;

    const containerId = 'site-toast-container';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.cssText =
        'position:fixed;top:1rem;right:1rem;z-index:100000;display:flex;flex-direction:column;gap:.75rem;max-width:min(28rem,92vw);';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText =
      'display:flex;align-items:center;gap:.65rem;padding:.8rem .95rem;border-radius:.8rem;color:#fff;box-shadow:0 10px 25px rgba(2,6,23,.35);font:500 .92rem/1.35 Inter,Segoe UI,system-ui,sans-serif;opacity:0;transform:translateY(-6px);transition:opacity .2s ease,transform .2s ease;background:' +
      getColor(type);

    const icon = document.createElement('i');
    icon.className = `fas ${getIcon(type)}`;
    icon.setAttribute('aria-hidden', 'true');

    const content = document.createElement('span');
    content.textContent = text;

    toast.appendChild(icon);
    toast.appendChild(content);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    const close = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-4px)';
      setTimeout(() => toast.remove(), 220);
    };

    setTimeout(close, duration);
    toast.addEventListener('click', close);
  };

  const createStateAction = (action = {}) => {
    if (!action) return null;

    const isLink = Boolean(action.href);
    const node = document.createElement(isLink ? 'a' : 'button');
    node.className = action.secondary ? 'btn-secondary' : 'btn-primary';
    if (action.id) node.id = action.id;

    if (isLink) {
      node.href = action.href;
    } else {
      node.type = 'button';
    }

    if (action.icon) {
      const icon = document.createElement('i');
      icon.className = `fas ${action.icon}`;
      icon.setAttribute('aria-hidden', 'true');
      node.appendChild(icon);
    }

    const label = document.createElement('span');
    label.textContent = String(action.label || '').trim();
    node.appendChild(label);

    if (typeof action.onClick === 'function') {
      node.addEventListener('click', (event) => {
        if (isLink) event.preventDefault();
        action.onClick(event);
      });
    }

    return node;
  };

  const renderPageState = ({
    mount,
    variant = 'info',
    icon = 'fa-circle-info',
    title = '',
    message = '',
    actions = [],
    replace = true,
  } = {}) => {
    const target =
      typeof mount === 'string' ? document.querySelector(mount) : mount || document.querySelector('main');
    if (!target) return null;

    const shell = document.createElement('section');
    shell.className = `page-state-shell page-state-shell--${String(variant || 'info').trim()}`;

    const card = document.createElement('div');
    card.className = 'page-state-card';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'page-state-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    const iconNode = document.createElement('i');
    iconNode.className = `fas ${icon}`;
    iconWrap.appendChild(iconNode);

    const heading = document.createElement('h2');
    heading.className = 'page-state-title';
    heading.textContent = String(title || '').trim();

    const body = document.createElement('p');
    body.className = 'page-state-message';
    body.textContent = String(message || '').trim();

    card.appendChild(iconWrap);
    if (heading.textContent) card.appendChild(heading);
    if (body.textContent) card.appendChild(body);

    const validActions = Array.isArray(actions)
      ? actions.map((action) => createStateAction(action)).filter(Boolean)
      : [];
    if (validActions.length) {
      const actionRow = document.createElement('div');
      actionRow.className = 'page-state-actions';
      validActions.forEach((node) => actionRow.appendChild(node));
      card.appendChild(actionRow);
    }

    shell.appendChild(card);
    if (replace) target.replaceChildren(shell);
    else target.appendChild(shell);
    return shell;
  };

  window.SiteUI = Object.freeze({ notify, renderPageState });
})();
