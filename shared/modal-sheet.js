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

		modal.classList.remove('hidden');
		modal.setAttribute('aria-hidden', 'false');
		modal.dataset.modalOpen = 'true';

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
