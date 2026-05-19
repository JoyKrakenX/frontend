/** @format */

(() => {
	if (window.SiteModalSheet) return;

	const getOpenModals = () =>
		Array.from(document.querySelectorAll('.modal:not(.hidden)'));

	const setBodyModalState = () => {
		document.body.classList.toggle('modal-open', getOpenModals().length > 0);
	};

	const getFocusableElements = (modal) =>
		Array.from(
			modal.querySelectorAll(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			),
		).filter((element) => !element.hasAttribute('disabled'));

	const traps = new WeakMap();
	let modalStateObserver = null;

	const getModalContent = (modal) => modal?.querySelector?.('.modal-content') || null;

	const resetModalAnimation = (modal) => {
		const content = getModalContent(modal);
		if (!content) return;
		content.getAnimations?.().forEach((animation) => {
			try {
				animation.cancel();
			} catch (_error) {
				// Ignore animation cleanup failures.
			}
		});
		content.style.removeProperty('animation');
		content.style.removeProperty('transform');
		content.style.removeProperty('opacity');
		content.style.removeProperty('top');
		content.style.removeProperty('bottom');
		delete content.dataset.modalSheetAnimating;
	};

	const prepareModalOpenAnimation = (modal) => {
		const content = getModalContent(modal);
		if (!content) return;
		resetModalAnimation(modal);
		const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
		if (reduceMotion) return;
		const isMobile = window.matchMedia?.('(max-width: 767px)')?.matches;
		content.dataset.modalSheetAnimating = 'true';
		content.style.setProperty('animation', 'none', 'important');
		content.style.opacity = isMobile ? '1' : '0';
		content.style.top = isMobile ? 'auto' : '';
		content.style.bottom = isMobile ? '0px' : '';
		content.style.transform = isMobile
			? 'translate3d(0, calc(100% + 24px), 0)'
			: 'translateY(12px) scale(0.985)';
	};

	const playModalOpenAnimation = (modal) => {
		const content = getModalContent(modal);
		if (!content || typeof content.animate !== 'function') return;
		const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
		if (reduceMotion) return;

		const isMobile = window.matchMedia?.('(max-width: 767px)')?.matches;
		content.dataset.modalSheetAnimating = 'true';
		content.style.setProperty('animation', 'none', 'important');
		content.style.opacity = '1';
		if (isMobile) {
			content.style.top = 'auto';
			content.style.bottom = '0px';
			content.style.transform = 'translate3d(0, calc(100% + 24px), 0)';
		} else {
			content.style.transform = 'translateY(12px) scale(0.985)';
		}

		requestAnimationFrame(() => {
			if (modal.classList.contains('hidden')) {
				resetModalAnimation(modal);
				return;
			}

			const animation = content.animate(
				isMobile ?
					[
						{ opacity: 1, transform: 'translate3d(0, calc(100% + 24px), 0)' },
						{ opacity: 1, transform: 'translate3d(0, 0, 0)' },
					]
				:	[
						{ opacity: 0, transform: 'translateY(12px) scale(0.985)' },
						{ opacity: 1, transform: 'translateY(0) scale(1)' },
					],
				{
					duration: isMobile && modal.id === 'logout-confirm-modal' ? 680 : isMobile ? 640 : 240,
					easing: isMobile ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
					fill: 'both',
				},
			);
			animation.finished
				.catch(() => {})
				.finally(() => {
					if (!modal.classList.contains('hidden')) {
						content.style.removeProperty('animation');
						content.style.removeProperty('transform');
						content.style.removeProperty('opacity');
						content.style.removeProperty('bottom');
						content.style.removeProperty('top');
					}
					delete content.dataset.modalSheetAnimating;
				});
		});
	};

	const observeModalClassChanges = () => {
		if (modalStateObserver || typeof MutationObserver !== 'function' || !document.body) {
			return;
		}

		modalStateObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') {
					continue;
				}
				if (!(mutation.target instanceof Element)) continue;
				if (!mutation.target.classList.contains('modal')) continue;
				setBodyModalState();
				return;
			}
		});

		modalStateObserver.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['class'],
		});
	};

	const trapFocus = (modal) => {
		const focusables = getFocusableElements(modal);
		if (!focusables.length) return () => {};

		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const onKeydown = (event) => {
			if (event.key !== 'Tab') return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
				return;
			}
			if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		modal.addEventListener('keydown', onKeydown);
		return () => modal.removeEventListener('keydown', onKeydown);
	};

	const open = (modalOrId) => {
		const modal =
			typeof modalOrId === 'string'
				? document.getElementById(modalOrId)
				: modalOrId;
		if (!modal || !modal.classList.contains('modal')) return false;

		prepareModalOpenAnimation(modal);
		modal.classList.remove('hidden');
		modal.setAttribute('aria-hidden', 'false');
		modal.dataset.modalOpen = 'true';
		playModalOpenAnimation(modal);

		const cleanup = trapFocus(modal);
		traps.set(modal, cleanup);

		const firstFocusable = getFocusableElements(modal)[0];
		requestAnimationFrame(() => {
			(firstFocusable || modal).focus?.();
		});

		setBodyModalState();
		document.dispatchEvent(
			new CustomEvent('site:modal:open', {
				detail: { id: modal.id || '', modal },
			}),
		);
		return true;
	};

	const close = (modalOrId) => {
		const modal =
			typeof modalOrId === 'string'
				? document.getElementById(modalOrId)
				: modalOrId;
		if (!modal || !modal.classList.contains('modal')) return false;

		modal.classList.add('hidden');
		modal.setAttribute('aria-hidden', 'true');
		modal.dataset.modalOpen = 'false';
		resetModalAnimation(modal);

		const cleanup = traps.get(modal);
		if (typeof cleanup === 'function') cleanup();
		traps.delete(modal);

		setBodyModalState();
		document.dispatchEvent(
			new CustomEvent('site:modal:close', {
				detail: { id: modal.id || '', modal },
			}),
		);
		return true;
	};

	const closeAll = () => {
		getOpenModals().forEach((modal) => close(modal));
	};

	const bindGlobalEvents = () => {
		if (document.body.dataset.modalSheetBound === 'true') return;
		document.body.dataset.modalSheetBound = 'true';

		document.addEventListener(
			'click',
			(event) => {
				const opener = event.target.closest('[data-modal-open]');
				if (opener) {
					event.preventDefault();
					open(opener.getAttribute('data-modal-open'));
					return;
				}

				const closer = event.target.closest('[data-modal-close], .close-modal');
				if (closer) {
					event.preventDefault();
					const modal =
						closer.closest('.modal') || getOpenModals()[getOpenModals().length - 1];
					if (modal) close(modal);
					return;
				}

				const modal = event.target.closest('.modal');
				if (modal && event.target === modal) {
					close(modal);
				}
			},
			true,
		);

		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') return;
			const openModals = getOpenModals();
			if (!openModals.length) return;
			close(openModals[openModals.length - 1]);
		});
	};

	const init = () => {
		bindGlobalEvents();
		observeModalClassChanges();
		setBodyModalState();
	};

	document.addEventListener('DOMContentLoaded', init);

	window.SiteModalSheet = Object.freeze({
		open,
		close,
		closeAll,
		init,
	});
})();
