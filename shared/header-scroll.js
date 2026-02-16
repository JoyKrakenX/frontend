/** @format */

(() => {
	const TOP_REVEAL_Y = 8;
	const HIDE_START_Y = 6;
	const HIDE_DISTANCE = 4;
	const SHOW_DISTANCE = 3;
	const DELTA_EPSILON = 0.5;
	const SCROLL_SOURCE_SELECTOR = '[data-header-scroll-source="true"]';

	let ticking = false;
	let refreshQueued = false;
	let lastScrollY = 0;
	let pendingScrollY = 0;
	let downAccum = 0;
	let upAccum = 0;
	let headerHeightQueued = false;
	let headerElement = null;
	let activeScrollSource = null;

	const getWindowScrollTop = () =>
		window.scrollY ||
		document.scrollingElement?.scrollTop ||
		document.documentElement.scrollTop ||
		document.body.scrollTop ||
		0;

	const getScrollTopForSource = (source) => {
		if (!source || source === window) return getWindowScrollTop();
		return Math.max(0, Number(source.scrollTop) || 0);
	};

	const hasBlockingOverlayOpen = () =>
		!!document.querySelector('.modal:not(.hidden)') ||
		!!document.querySelector('#logout-confirm-modal:not(.hidden)') ||
		!!document.querySelector('.user-menu-details[open]') ||
		!!document.querySelector('.side-panel.active') ||
		!!document.querySelector('#emoji-picker:not(.hidden)');

	const isEnabled = () => document.body?.dataset?.headerAutohide === 'true';

	const setHeaderHidden = (hidden) => {
		if (!document.body) return;
		document.body.classList.toggle('header-hidden', !!hidden);
	};

	const setHeaderScrolled = (scrolled) => {
		if (!document.body) return;
		document.body.classList.toggle('header-scrolled', !!scrolled);
	};

	const updateHeaderHeight = () => {
		if (!document.body || !headerElement) return;
		const headerHeight = Math.max(
			0,
			Math.round(
				headerElement.getBoundingClientRect().height ||
					headerElement.offsetHeight ||
					0,
			),
		);
		document.body.style.setProperty('--site-header-height', `${headerHeight}px`);
	};

	const queueHeaderHeightUpdate = () => {
		if (headerHeightQueued) return;
		headerHeightQueued = true;
		window.requestAnimationFrame(() => {
			headerHeightQueued = false;
			updateHeaderHeight();
		});
	};

	const resetDirectionAccumulators = () => {
		downAccum = 0;
		upAccum = 0;
	};

	const setActiveSource = (source) => {
		const normalized = source || window;
		if (activeScrollSource === normalized) return;
		activeScrollSource = normalized;
		lastScrollY = getScrollTopForSource(normalized);
		pendingScrollY = lastScrollY;
		resetDirectionAccumulators();
	};

	const applyHeaderState = (currentY, { forceReveal = false } = {}) => {
		if (!isEnabled()) {
			setHeaderHidden(false);
			setHeaderScrolled(currentY > TOP_REVEAL_Y);
			lastScrollY = currentY;
			resetDirectionAccumulators();
			queueHeaderHeightUpdate();
			return;
		}

		const shouldReveal =
			forceReveal || hasBlockingOverlayOpen() || currentY <= TOP_REVEAL_Y;
		if (shouldReveal) {
			setHeaderHidden(false);
			resetDirectionAccumulators();
		} else {
			const delta = currentY - lastScrollY;
			if (delta > DELTA_EPSILON) {
				downAccum += delta;
				upAccum = 0;
			} else if (delta < -DELTA_EPSILON) {
				upAccum += -delta;
				downAccum = 0;
			}

			if (currentY > HIDE_START_Y && downAccum >= HIDE_DISTANCE) {
				setHeaderHidden(true);
				downAccum = 0;
			} else if (upAccum >= SHOW_DISTANCE) {
				setHeaderHidden(false);
				upAccum = 0;
			}
		}

		setHeaderScrolled(currentY > TOP_REVEAL_Y);
		lastScrollY = currentY;
		queueHeaderHeightUpdate();
	};

	const onWindowScroll = () => {
		setActiveSource(window);
		pendingScrollY = getScrollTopForSource(window);
		if (ticking) return;
		ticking = true;
		window.requestAnimationFrame(() => {
			applyHeaderState(pendingScrollY);
			ticking = false;
		});
	};

	const onSourceScroll = (source) => {
		setActiveSource(source);
		pendingScrollY = getScrollTopForSource(source);
		if (ticking) return;
		ticking = true;
		window.requestAnimationFrame(() => {
			applyHeaderState(pendingScrollY);
			ticking = false;
		});
	};

	const onMarkedContainerScroll = (event) => {
		const target = event?.target;
		if (!(target instanceof Element)) return;
		if (!target.matches(SCROLL_SOURCE_SELECTOR)) return;
		onSourceScroll(target);
	};

	const reveal = () => {
		const source = activeScrollSource || window;
		const currentY = getScrollTopForSource(source);
		setHeaderHidden(false);
		setHeaderScrolled(currentY > TOP_REVEAL_Y);
		lastScrollY = currentY;
		pendingScrollY = currentY;
		resetDirectionAccumulators();
		queueHeaderHeightUpdate();
	};

	const refresh = () => {
		const source = activeScrollSource || window;
		const currentY = getScrollTopForSource(source);
		applyHeaderState(currentY, {
			forceReveal: hasBlockingOverlayOpen() || currentY <= TOP_REVEAL_Y,
		});
		pendingScrollY = currentY;
		queueHeaderHeightUpdate();
	};

	const queueRefresh = () => {
		if (refreshQueued) return;
		refreshQueued = true;
		window.requestAnimationFrame(() => {
			refreshQueued = false;
			refresh();
		});
	};

	window.SiteHeaderScroll = Object.freeze({ refresh, reveal });

	const init = () => {
		if (!document.body) return;
		headerElement = document.querySelector('header');
		if (!headerElement) return;

		setActiveSource(window);
		lastScrollY = getWindowScrollTop();
		pendingScrollY = lastScrollY;

		window.addEventListener('scroll', onWindowScroll, { passive: true });
		document.addEventListener('scroll', onMarkedContainerScroll, {
			passive: true,
			capture: true,
		});
		window.addEventListener('resize', queueRefresh, { passive: true });
		document.addEventListener('visibilitychange', queueRefresh);
		document.addEventListener('toggle', queueRefresh, true);

		const observer = new MutationObserver(() => {
			queueRefresh();
		});
		observer.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['class', 'open', 'aria-hidden'],
		});

		if ('ResizeObserver' in window) {
			const resizeObserver = new ResizeObserver(() => {
				queueHeaderHeightUpdate();
				refresh();
			});
			resizeObserver.observe(headerElement);
		}

		queueHeaderHeightUpdate();
		refresh();
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
