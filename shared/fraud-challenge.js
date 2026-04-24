/** @format */

(() => {
	let challengeToken = null;
	let turnstileScriptPromise = null;

	const TURNSTILE_SCRIPT_SRC =
		'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
	const CHALLENGE_STYLE_ID = 'fraud-challenge-style';

	const notify = (fn, message, type = 'info') => {
		if (typeof fn === 'function') {
			fn(message, type);
			return;
		}
		if (window.SiteUI?.notify) {
			window.SiteUI.notify(message, type);
			return;
		}
		if (type === 'error') {
			console.error(message);
			return;
		}
		console.log(message);
	};

	const ensureChallengeStyles = () => {
		if (document.getElementById(CHALLENGE_STYLE_ID)) return;
		const style = document.createElement('style');
		style.id = CHALLENGE_STYLE_ID;
		style.textContent = `
.fraud-challenge-overlay {
	position: fixed;
	inset: 0;
	background: rgba(15, 23, 42, 0.72);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 16px;
	z-index: 12000;
}
.fraud-challenge-modal {
	background: #ffffff;
	border-radius: 14px;
	box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
	width: min(440px, 100%);
	padding: 18px;
}
.fraud-challenge-modal h3 {
	margin: 0 0 8px;
	font-size: 1.1rem;
}
.fraud-challenge-modal p {
	margin: 0 0 14px;
	color: #475569;
}
.fraud-challenge-widget {
	min-height: 74px;
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 10px 0 14px;
}
.fraud-challenge-actions {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
}
.fraud-challenge-btn {
	border: 0;
	border-radius: 10px;
	padding: 10px 14px;
	font-weight: 600;
	cursor: pointer;
}
.fraud-challenge-btn.cancel {
	background: #e2e8f0;
	color: #0f172a;
}
.fraud-challenge-btn.confirm {
	background: #0ea5e9;
	color: #fff;
}
.fraud-challenge-btn.confirm:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}
		`.trim();
		document.head.appendChild(style);
	};

	const ensureTurnstileScript = async () => {
		if (window.turnstile) return true;
		if (turnstileScriptPromise) return turnstileScriptPromise;

		turnstileScriptPromise = new Promise((resolve) => {
			const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
			if (existing) {
				existing.addEventListener('load', () => resolve(Boolean(window.turnstile)), {
					once: true,
				});
				existing.addEventListener('error', () => resolve(false), { once: true });
				return;
			}

			const script = document.createElement('script');
			script.src = TURNSTILE_SCRIPT_SRC;
			script.async = true;
			script.defer = true;
			script.onload = () => resolve(Boolean(window.turnstile));
			script.onerror = () => resolve(false);
			document.head.appendChild(script);
		});

		const loaded = await turnstileScriptPromise;
		if (!loaded) {
			turnstileScriptPromise = null;
		}
		return loaded;
	};

	const requestTurnstileToken = async ({ challenge = null, notify: notifyFn = null } = {}) => {
		const siteKey =
			String(
				challenge?.turnstile?.siteKey || challenge?.siteKey || window.TURNSTILE_SITE_KEY || '',
			).trim() || null;
		if (!siteKey) {
			notify(
				notifyFn,
				'Configuration CAPTCHA absente. Contactez le support si le probleme persiste.',
				'error',
			);
			return null;
		}

		const loaded = await ensureTurnstileScript();
		if (!loaded || !window.turnstile) {
			notify(notifyFn, 'CAPTCHA indisponible temporairement.', 'error');
			return null;
		}

		ensureChallengeStyles();

		return new Promise((resolve) => {
			const overlay = document.createElement('div');
			overlay.className = 'fraud-challenge-overlay';
			overlay.innerHTML = `
				<div class="fraud-challenge-modal" role="dialog" aria-modal="true" aria-label="Vérification CAPTCHA">
					<h3>Vérification supplémentaire</h3>
					<p>Validez le CAPTCHA pour continuer.</p>
					<div class="fraud-challenge-widget" id="fraud-turnstile-widget"></div>
					<div class="fraud-challenge-actions">
						<button type="button" class="fraud-challenge-btn cancel" id="fraud-turnstile-cancel">Annuler</button>
						<button type="button" class="fraud-challenge-btn confirm" id="fraud-turnstile-confirm" disabled>Continuer</button>
					</div>
				</div>
			`;
			document.body.appendChild(overlay);

			let tokenValue = null;
			let widgetId = null;
			const cancelBtn = overlay.querySelector('#fraud-turnstile-cancel');
			const confirmBtn = overlay.querySelector('#fraud-turnstile-confirm');
			const cleanup = (result) => {
				try {
					if (widgetId !== null && window.turnstile?.remove) {
						window.turnstile.remove(widgetId);
					}
				} catch (_error) {}
				overlay.remove();
				resolve(result);
			};

			cancelBtn?.addEventListener('click', () => cleanup(null));
			confirmBtn?.addEventListener('click', () => {
				if (!tokenValue) {
					notify(notifyFn, 'Veuillez valider le CAPTCHA.', 'warning');
					return;
				}
				cleanup(tokenValue);
			});
			overlay.addEventListener('click', (event) => {
				if (event.target === overlay) cleanup(null);
			});

			const widgetContainer = overlay.querySelector('#fraud-turnstile-widget');
			widgetId = window.turnstile.render(widgetContainer, {
				sitekey: siteKey,
				callback: (token) => {
					tokenValue = String(token || '').trim() || null;
					if (confirmBtn) confirmBtn.disabled = !tokenValue;
				},
				'expired-callback': () => {
					tokenValue = null;
					if (confirmBtn) confirmBtn.disabled = true;
				},
				'error-callback': () => {
					tokenValue = null;
					if (confirmBtn) confirmBtn.disabled = true;
				},
			});
		});
	};

	const resolveEmailOtpChallenge = async ({
		request,
		contextType = 'vote',
		surveyType = 'unknown',
		surveyId = null,
		tempToken = null,
		notify: notifyFn = null,
	} = {}) => {
		if (typeof request !== 'function') {
			throw new Error('request function is required for OTP challenge');
		}

		try {
			const startPayload = await request('/api/fraud/challenges/email/start', {
				method: 'POST',
				disableFraudChallengeHeader: true,
				body: JSON.stringify({
					contextType,
					surveyType,
					surveyId,
					tempToken: tempToken || undefined,
				}),
			});

			const challengeId =
				String(startPayload?.challenge?.otp?.challengeId || startPayload?.challengeId || '').trim() ||
				null;
			if (!challengeId) {
				notify(notifyFn, "Impossible de démarrer la vérification email.", 'error');
				return false;
			}

			const code = window.prompt(
				'Un code OTP a été envoyé par email. Saisissez le code de vérification :',
			);
			if (!code || !String(code).trim()) {
				notify(notifyFn, 'Vérification email annulée.', 'warning');
				return false;
			}

			const verifyPayload = await request('/api/fraud/challenges/email/verify', {
				method: 'POST',
				disableFraudChallengeHeader: true,
				body: JSON.stringify({
					challengeId,
					code: String(code).trim(),
					tempToken: tempToken || undefined,
				}),
			});

			const token =
				String(
					verifyPayload?.challenge?.otp?.challengeToken || verifyPayload?.challengeToken || '',
				).trim() || null;
			if (!token) {
				notify(notifyFn, 'Vérification email invalide.', 'error');
				return false;
			}

			challengeToken = token;
			notify(notifyFn, 'Vérification email validée.', 'success');
			return true;
		} catch (error) {
			notify(notifyFn, error?.message || 'Échec de la vérification email.', 'error');
			return false;
		}
	};

	window.FraudChallengeHelper = {
		getChallengeToken: () => challengeToken,
		setChallengeToken: (token) => {
			challengeToken = String(token || '').trim() || null;
		},
		clearChallengeToken: () => {
			challengeToken = null;
		},
		ensureTurnstileScript,
		requestTurnstileToken,
		resolveEmailOtpChallenge,
	};
})();
