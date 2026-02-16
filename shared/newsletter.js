/** @format */

(() => {
	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const isValidEmail = (value) =>
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

	const toPositiveSeconds = (value, fallback = 1) => {
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, fallback);
		return Math.max(1, Math.ceil(parsed));
	};

	const toPositiveDurationSeconds = (value) => {
		const parsed = Number(String(value ?? '').replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed <= 0) return null;
		return Math.max(1, Math.ceil(parsed));
	};

	const toPositiveDurationMilliseconds = (value) => {
		const parsed = Number(String(value ?? '').replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed <= 0) return null;
		return Math.max(1, Math.ceil(parsed));
	};

	const parseDurationSecondsFromText = (value) => {
		const text = String(value || '').trim().toLowerCase();
		if (!text) return null;

		const msMatch = text.match(
			/(\d+(?:[.,]\d+)?)\s*(?:ms|msec|millisecondes?|milliseconds?)/i,
		);
		if (msMatch) {
			const milliseconds = Number(msMatch[1].replace(',', '.'));
			if (Number.isFinite(milliseconds) && milliseconds > 0) {
				return Math.max(1, Math.ceil(milliseconds / 1000));
			}
		}

		const secondsMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec(?:onde)?s?)/i);
		if (secondsMatch) {
			const seconds = Number(secondsMatch[1].replace(',', '.'));
			if (Number.isFinite(seconds) && seconds > 0) {
				return Math.max(1, Math.ceil(seconds));
			}
		}

		return null;
	};

	const resolveRetryDelaySeconds = (
		payload = {},
		fallbackMessage = '',
		defaultSeconds = 1,
	) => {
		const secondCandidates = [
			payload?.cooldownSeconds,
			payload?.retryAfterSeconds,
			payload?.remainingSeconds,
			payload?.seconds,
		];
		for (const candidate of secondCandidates) {
			const parsed = toPositiveDurationSeconds(candidate);
			if (parsed) return parsed;
		}

		const millisecondCandidates = [
			payload?.cooldownMs,
			payload?.retryAfterMs,
			payload?.remainingMs,
		];
		for (const candidate of millisecondCandidates) {
			const parsed = toPositiveDurationMilliseconds(candidate);
			if (parsed) return Math.max(1, Math.ceil(parsed / 1000));
		}

		const textCandidates = [payload?.message, fallbackMessage];
		for (const candidate of textCandidates) {
			const parsed = parseDurationSecondsFromText(candidate);
			if (parsed) return parsed;
		}

		return toPositiveSeconds(defaultSeconds, defaultSeconds);
	};

	const formatDuration = (seconds) => {
		const totalSeconds = toPositiveSeconds(seconds, 1);
		const minutes = Math.floor(totalSeconds / 60);
		const remainingSeconds = totalSeconds % 60;

		if (minutes <= 0) return `${totalSeconds}s`;
		if (remainingSeconds <= 0) return `${minutes} min`;
		return `${minutes} min ${remainingSeconds}s`;
	};

	const mapStatus = (status, fallbackMessage = '', payload = {}) => {
		const normalized = String(status || '').trim().toLowerCase();

		if (normalized === 'pending') {
			return {
				type: 'success',
				message: t(
					'newsletter.confirmation_sent',
					'Email recu. Verifiez votre boite pour confirmer votre abonnement.',
				),
			};
		}

		if (normalized === 'pending_resent') {
			return {
				type: 'success',
				message: t(
					'newsletter.pending_resent',
					'Un nouvel email de confirmation a ete envoye.',
				),
			};
		}

		if (normalized === 'pending_cooldown') {
			const seconds = resolveRetryDelaySeconds(payload, fallbackMessage, 1);
			const duration = formatDuration(seconds);
			return {
				type: 'warning',
				message: t(
					'newsletter.pending_cooldown_human',
					'Une confirmation est deja en attente. Reessayez dans {duration}.',
					{ duration, seconds: duration },
				),
			};
		}

		if (normalized === 'pending_retry_later') {
			const seconds = resolveRetryDelaySeconds(payload, fallbackMessage, 60);
			const duration = formatDuration(seconds);
			return {
				type: 'warning',
				message: t(
					'newsletter.pending_retry_later_human',
					'Trop de relances pour cette adresse. Reessayez dans {duration}.',
					{ duration, seconds: duration },
				),
			};
		}

		if (normalized === 'already_subscribed') {
			return {
				type: 'info',
				message: t(
					'newsletter.already_subscribed',
					'Cette adresse email est deja inscrite a la newsletter.',
				),
			};
		}

		if (normalized === 'pending_exists') {
			return {
				type: 'warning',
				message: t(
					'newsletter.pending_exists',
					'Une confirmation est deja en attente. Verifiez votre boite email.',
				),
			};
		}

		if (normalized === 'service_unavailable') {
			return {
				type: 'error',
				message: t(
					'newsletter.delivery_issue',
					"Impossible d'envoyer l'email de confirmation pour le moment. Reessayez plus tard.",
				),
			};
		}

		const normalizedFallbackMessage = String(fallbackMessage || '').trim();
		const fallbackDurationSeconds =
			parseDurationSecondsFromText(normalizedFallbackMessage);
		if (
			normalizedFallbackMessage &&
			fallbackDurationSeconds &&
			/(reessayez|reessayer|retry|attendez|attendre)/i.test(
				normalizedFallbackMessage,
			)
		) {
			const duration = formatDuration(fallbackDurationSeconds);
			return {
				type: 'warning',
				message: normalizedFallbackMessage.replace(
					/(\d+(?:[.,]\d+)?)\s*(?:ms|msec|millisecondes?|milliseconds?|s|sec(?:onde)?s?)/i,
					duration,
				),
			};
		}

		return {
			type: 'info',
			message:
				normalizedFallbackMessage ||
				t(
					'newsletter.pending_confirmation',
					'Inscription recue. Verifiez votre email.',
				),
		};
	};

	const bindNewsletterForm = (form) => {
		if (!form || form.dataset.newsletterBound === 'true') return;
		form.dataset.newsletterBound = 'true';

		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			event.stopImmediatePropagation();

			const input = form.querySelector('input[type="email"], .newsletter-input');
			const submitBtn = form.querySelector(
				'button[type="submit"], .newsletter-btn',
			);
			const email = String(input?.value || '')
				.trim()
				.toLowerCase();

			if (!isValidEmail(email)) {
				window.SiteUI?.notify?.(
					t('newsletter.invalid_email', 'Adresse email invalide.'),
					'error',
				);
				return;
			}

			if (submitBtn) {
				submitBtn.disabled = true;
				submitBtn.dataset.originalHtml = submitBtn.innerHTML;
				submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i>`;
			}

			try {
				const sourcePage =
					form.dataset.sourcePage ||
					document.body?.dataset?.page ||
					window.location.pathname.split('/').pop() ||
					'unknown';

				const response = await window.SiteApi.request(
					'/api/newsletter/subscribe',
					{
						method: 'POST',
						data: {
							email,
							consent: true,
							locale: window.SiteI18n?.getLanguage?.() || 'fr',
							sourcePage,
						},
					},
				);

				const mapped = mapStatus(response?.status, response?.message, response);
				window.SiteUI?.notify?.(mapped.message, mapped.type);
				if (input) input.value = '';
			} catch (error) {
				const payload = error?.payload || {};
				const status = String(payload?.status || '').toLowerCase();
				const mapped = mapStatus(status, error?.message || '', payload);
				window.SiteUI?.notify?.(
					mapped.message,
					mapped.type === 'success' ? 'error' : mapped.type,
				);
			} finally {
				if (submitBtn) {
					submitBtn.disabled = false;
					submitBtn.innerHTML =
						submitBtn.dataset.originalHtml || submitBtn.innerHTML;
				}
			}
		});
	};

	const scrollTargetToTop = (target) => {
		if (!target) return;
		if (typeof target.scrollTo === 'function') {
			target.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}
		target.scrollTop = 0;
	};

	const collectScrollableAncestors = (node) => {
		const ancestors = [];
		let current = node?.parentElement || null;

		while (current && current !== document.body) {
			const style = window.getComputedStyle(current);
			const overflowY = String(style.overflowY || '').toLowerCase();
			const isScrollable =
				(overflowY === 'auto' ||
					overflowY === 'scroll' ||
					overflowY === 'overlay') &&
				current.scrollHeight > current.clientHeight;

			if (isScrollable) ancestors.push(current);
			current = current.parentElement;
		}

		return ancestors;
	};

	const scrollPageToTop = (originLink) => {
		const targets = new Set([
			document.scrollingElement,
			document.documentElement,
			document.body,
		]);

		collectScrollableAncestors(originLink).forEach((ancestor) => {
			targets.add(ancestor);
		});

		document
			.querySelectorAll(
				'main, [data-scroll-container], .page-content, .content-wrapper',
			)
			.forEach((node) => {
				if (node.scrollHeight > node.clientHeight) targets.add(node);
			});

		targets.forEach((target) => {
			scrollTargetToTop(target);
		});

		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	const bindFooterSocialScrollTop = () => {
		if (!document.getElementById('top')) {
			document.documentElement.id = 'top';
		}

		const footerRoots = document.querySelectorAll(
			'.site-footer, footer.site-footer, footer',
		);
		const socialLinks = new Set();

		footerRoots.forEach((root) => {
			root.querySelectorAll('.social-link').forEach((link) => {
				socialLinks.add(link);
			});
		});

		socialLinks.forEach((link) => {
			link.setAttribute('href', '#top');
			if (link.dataset.scrollTopBound === 'true') return;
			link.dataset.scrollTopBound = 'true';

			link.addEventListener('click', (event) => {
				event.preventDefault();
				scrollPageToTop(link);
				if (window.location.hash !== '#top') {
					window.history.replaceState(
						{},
						document.title,
						`${window.location.pathname}${window.location.search}#top`,
					);
				}
			});
		});
	};

	const init = () => {
		document.querySelectorAll('.newsletter-form').forEach(bindNewsletterForm);
		bindFooterSocialScrollTop();
	};

	document.addEventListener('DOMContentLoaded', init);
	document.addEventListener('site:language-changed', bindFooterSocialScrollTop);
	window.SiteNewsletter = Object.freeze({ init });
})();
