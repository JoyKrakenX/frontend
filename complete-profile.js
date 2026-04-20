/** @format */

(() => {
	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const state = {
		step: 0,
		values: {
			pseudo: '',
			birthdate: '',
			gender: '',
		},
		errors: {},
		flatpickr: null,
	};
	const FLATPICKR_SCRIPT_SRC = 'vendor/flatpickr/flatpickr.min.js';
	const FLATPICKR_LOCALE_FR_SRC = 'vendor/flatpickr/l10n/fr.js';
	let flatpickrLoadPromise = null;
	const getFraudHelper = () => window.FraudChallengeHelper || null;

	const root = document.getElementById('app');
	const infoBox = document.getElementById('informations-box');
	const urlParams = new URLSearchParams(window.location.search);
	const tempToken = urlParams.get('token');
	const totalSteps = 4;

	const introTyperState = {
		runId: 0,
		timers: [],
		isRunning: false,
	};

	const cancelIntroTypewriter = () => {
		introTyperState.runId += 1;
		introTyperState.isRunning = false;
		introTyperState.timers.forEach((timerId) => clearTimeout(timerId));
		introTyperState.timers = [];
	};

	const startIntroTypewriter = (
		text,
		callback,
		{ baseSpeed = 45, startDelay = 380, punctuationPause = 180 } = {},
	) => {
		const punctuation = new Set(['.', ',', '!', '?', ';', ':']);
		const runId = introTyperState.runId;
		let index = 0;
		introTyperState.isRunning = true;

		const schedule = (delay, fn) => {
			const timerId = setTimeout(() => {
				introTyperState.timers = introTyperState.timers.filter(
					(activeId) => activeId !== timerId,
				);
				fn();
			}, delay);
			introTyperState.timers.push(timerId);
		};

		const next = () => {
			if (runId !== introTyperState.runId) return;
			if (index >= text.length) {
				introTyperState.isRunning = false;
				return;
			}
			const char = text.charAt(index);
			callback(char);
			index += 1;
			const extra = punctuation.has(char) ? punctuationPause : 0;
			schedule(baseSpeed + extra, next);
		};

		schedule(Math.max(0, startDelay), next);
	};

	const escapeHtml = (value) =>
		String(value || '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');

	const clampStep = (value) => Math.max(0, Math.min(totalSteps - 1, value));

	const loadScriptOnce = (src) =>
		new Promise((resolve, reject) => {
			if (!src) {
				reject(new Error('Script source manquante.'));
				return;
			}

			const existing = document.querySelector(`script[data-dyn-src="${src}"]`);
			if (existing) {
				if (existing.dataset.loaded === 'true') {
					resolve();
					return;
				}
				existing.addEventListener('load', () => resolve(), { once: true });
				existing.addEventListener(
					'error',
					() => reject(new Error(`Echec de chargement: ${src}`)),
					{ once: true },
				);
				return;
			}

			const script = document.createElement('script');
			script.src = src;
			script.async = true;
			script.dataset.dynSrc = src;
			script.addEventListener('load', () => {
				script.dataset.loaded = 'true';
				resolve();
			});
			script.addEventListener(
				'error',
				() => reject(new Error(`Echec de chargement: ${src}`)),
			);
			document.head.appendChild(script);
		});

	const ensureFlatpickrReady = async () => {
		if (typeof window.flatpickr === 'function') return true;

		if (!flatpickrLoadPromise) {
			flatpickrLoadPromise = loadScriptOnce(FLATPICKR_SCRIPT_SRC)
				.then(() => loadScriptOnce(FLATPICKR_LOCALE_FR_SRC))
				.then(() => typeof window.flatpickr === 'function')
				.catch(() => false);
		}

		return flatpickrLoadPromise;
	};

	const yearOptions = () => {
		const currentYear = new Date().getFullYear();
		const maxBirthYear = currentYear - 13;
		const years = [];
		for (let y = maxBirthYear; y >= 1900; y -= 1) {
			years.push(`<option value="${y}">${y}</option>`);
		}
		return years.join('');
	};

	const renderIntro = () => {
		if (!infoBox) return;
		cancelIntroTypewriter();
		infoBox.textContent = '';
		startIntroTypewriter(
			t(
				'complete_profile.intro',
				'Veuillez compléter votre profil pour répondre au sondage et participer au chat.',
			),
			(char) => {
				infoBox.textContent += char;
			},
		);
	};

	const validateCurrentStep = () => {
		state.errors = {};
		const { pseudo, birthdate, gender } = state.values;

		if (state.step === 0) {
			if (!pseudo || pseudo.trim().length < 2) {
				state.errors.pseudo = t(
					'complete_profile.error_pseudo',
					'Le pseudo doit contenir au moins 2 caractères.',
				);
			}
		}

		if (state.step === 1) {
			if (!birthdate) {
				state.errors.birthdate = t(
					'complete_profile.error_birthdate',
					'Veuillez sélectionner votre date de naissance.',
				);
			}
		}

		if (state.step === 2) {
			if (!gender) {
				state.errors.gender = t(
					'complete_profile.error_gender',
					'Veuillez sélectionner votre genre.',
				);
			}
		}

		return Object.keys(state.errors).length === 0;
	};

	const renderStepContent = () => {
		const { pseudo, birthdate, gender } = state.values;

		if (state.step === 0) {
			return `
				<div class="form-group">
					<label class="form-label" for="pseudo-input">${t(
						'complete_profile.pseudo',
						'Pseudo',
					)}</label>
					<input id="pseudo-input" class="form-control" type="text" value="${escapeHtml(
						pseudo,
					)}" minlength="2" maxlength="40" autocomplete="nickname" placeholder="${escapeHtml(
						t('complete_profile.pseudo_placeholder', 'Ex: Alex'),
					)}" />
					${
						state.errors.pseudo ?
							`<div class="error-text">${escapeHtml(state.errors.pseudo)}</div>`
						:	''
					}
				</div>
			`;
		}

		if (state.step === 1) {
			const selectedYear = birthdate ? new Date(birthdate).getFullYear() : '';
			return `
				<div class="form-group">
					<label class="form-label" for="birthdate-input">${t(
						'complete_profile.birthdate',
						'Date de naissance',
					)}</label>
					<input id="birthdate-input" class="form-control" type="text" readonly placeholder="${escapeHtml(
						t('complete_profile.birthdate_placeholder', 'Sélectionner une date'),
					)}" value="${escapeHtml(birthdate)}" />
					<div class="year-row">
						<label class="form-label sr-only" for="birth-year-select">${t(
							'complete_profile.birth_year',
							'Année de naissance',
						)}</label>
						<select id="birth-year-select" class="form-select">
							<option value="">${t('complete_profile.birth_year', 'Année de naissance')}</option>
							${yearOptions()}
						</select>
					</div>
					${
						state.errors.birthdate ?
							`<div class="error-text">${escapeHtml(state.errors.birthdate)}</div>`
						:	''
					}
					<input type="hidden" id="selected-year-hidden" value="${escapeHtml(selectedYear)}" />
				</div>
			`;
		}

		if (state.step === 2) {
			return `
				<div class="form-group">
					<label class="form-label" for="gender-select">${t(
						'complete_profile.gender',
						'Genre',
					)}</label>
					<select id="gender-select" class="form-select">
						<option value="">${t('complete_profile.gender_placeholder', '-- Sélectionnez --')}</option>
						<option value="homme" ${gender === 'homme' ? 'selected' : ''}>${t(
							'complete_profile.gender_male',
							'Homme',
						)}</option>
						<option value="femme" ${gender === 'femme' ? 'selected' : ''}>${t(
							'complete_profile.gender_female',
							'Femme',
						)}</option>
						<option value="autre" ${gender === 'autre' ? 'selected' : ''}>${t(
							'complete_profile.gender_other',
							'Autre',
						)}</option>
					</select>
					${
						state.errors.gender ?
							`<div class="error-text">${escapeHtml(state.errors.gender)}</div>`
						:	''
					}
				</div>
			`;
		}

		return `
			<div class="final-summary">
				<div class="check"><i class="fas fa-check"></i></div>
				<h3>${t('complete_profile.review_title', 'Vérifiez vos informations')}</h3>
				<p>${t(
					'complete_profile.review_subtitle',
					'Une fois validé, vous serez redirigé vers les sondages.',
				)}</p>
				<div class="summary-grid">
					<div><strong>${t('complete_profile.pseudo', 'Pseudo')}:</strong> ${escapeHtml(
						pseudo || '-',
					)}</div>
					<div><strong>${t('complete_profile.birthdate', 'Date de naissance')}:</strong> ${escapeHtml(
						birthdate || '-',
					)}</div>
					<div><strong>${t('complete_profile.gender', 'Genre')}:</strong> ${escapeHtml(
						gender || '-',
					)}</div>
				</div>
			</div>
		`;
	};

	const renderLegalNotice = () => `
		<p
			class="signup-legal-note"
			data-i18n-html="complete_profile.legal_notice_html"
		>${t(
			'complete_profile.legal_notice_html',
			'En poursuivant, vous acceptez les <a href="cgu.html" class="signup-legal-link">conditions d\\'utilisation</a> de Community et reconnaissez avoir lu notre <a href="privacy.html" class="signup-legal-link">politique de confidentialit&eacute;</a>.',
		)}</p>
	`;

	const render = () => {
		if (!root) return;

		const progressPercent = Math.round(((state.step + 1) / totalSteps) * 100);
		root.innerHTML = `
			<section class="profile-card card">
				<div class="step-head">
					<small>${t('complete_profile.step_of', 'Étape {step} sur {total}', {
						step: state.step + 1,
						total: totalSteps,
					})}</small>
					<div class="progress">
						<div class="progress-bar" style="width:${progressPercent}%"></div>
					</div>
				</div>
				<form id="complete-profile-form" novalidate>
					${renderStepContent()}
					<div class="form-actions">
						<button type="button" id="prev-step" class="btn-secondary ${
							state.step === 0 ? 'hidden' : ''
						}">
							<i class="fas fa-arrow-left"></i> ${t('complete_profile.back', 'Retour')}
						</button>
						<button type="submit" id="next-step" class="btn-primary">
							${
								state.step === totalSteps - 1 ?
									`${t('complete_profile.submit', 'Valider')} <i class="fas fa-check"></i>`
								:	`${t('complete_profile.next', 'Suivant')} <i class="fas fa-arrow-right"></i>`
							}
						</button>
					</div>
				</form>
				${renderLegalNotice()}
			</section>
		`;

		bindFormEvents();
		if (state.step === 1) setupDatePicker();
		else destroyDatePicker();
	};

	const setStep = (step) => {
		state.step = clampStep(step);
		render();
	};

	const parseIsoDate = (value) => {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
		if (!match) return null;
		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const parsed = new Date(year, month - 1, day);
		if (
			parsed.getFullYear() !== year ||
			parsed.getMonth() !== month - 1 ||
			parsed.getDate() !== day
		) {
			return null;
		}
		return parsed;
	};

	const toIsoDate = (date) => {
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
		const year = String(date.getFullYear()).padStart(4, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	const getCurrentBirthDate = () => {
		const selectedDate = state.flatpickr?.selectedDates?.[0];
		if (selectedDate instanceof Date && !Number.isNaN(selectedDate.getTime())) {
			return selectedDate;
		}
		return parseIsoDate(state.values.birthdate);
	};

	const setupDatePicker = () => {
		const input = document.getElementById('birthdate-input');
		if (!input) return;

		destroyDatePicker();
		bindYearControls();

		const flatpickrLib = window.flatpickr;
		if (typeof flatpickrLib !== 'function') {
			ensureFlatpickrReady().then((isReady) => {
				if (!isReady) {
					window.SiteUI?.notify?.(
						t(
							'complete_profile.calendar_load_error',
							'Le calendrier personnalise est indisponible. Rechargez la page.',
						),
						'error',
					);
					return;
				}
				if (state.step === 1 && !state.flatpickr) {
					setupDatePicker();
				}
			});
			return;
		}

		input.setAttribute('readonly', 'readonly');
		state.flatpickr = flatpickrLib(input, {
			locale: window.flatpickr?.l10ns?.fr || 'fr',
			dateFormat: 'Y-m-d',
			altInput: true,
			altFormat: 'd/m/Y',
			clickOpens: true,
			disableMobile: true,
			maxDate: 'today',
			minDate: '1900-01-01',
			monthSelectorType: 'dropdown',
			onReady: (_selectedDates, _dateStr, instance) => {
				const forceOpen = () => instance.open();
				instance.input.addEventListener('click', forceOpen);
				instance.input.addEventListener('focus', forceOpen);
				if (instance.altInput) {
					instance.altInput.addEventListener('click', forceOpen);
					instance.altInput.addEventListener('focus', forceOpen);
				}
			},
			onChange: (_dates, dateStr) => {
				state.values.birthdate = dateStr || '';
				state.errors.birthdate = '';
				syncYearSelect();
			},
		});

		if (state.values.birthdate) {
			state.flatpickr.setDate(state.values.birthdate, false, 'Y-m-d');
		}

		syncYearSelect();
	};

	const syncYearSelect = () => {
		const yearSelect = document.getElementById('birth-year-select');
		if (!yearSelect) return;
		const selectedDate = getCurrentBirthDate();
		if (selectedDate) {
			yearSelect.value = String(selectedDate.getFullYear());
			return;
		}
		yearSelect.value = '';
	};

	const applyYear = (yearValue) => {
		if (!yearValue) return;
		const year = Number(yearValue);
		if (!Number.isFinite(year)) return;
		const current = getCurrentBirthDate() || new Date();
		const month = current.getMonth();
		const day = current.getDate();
		const maxDay = new Date(year, month + 1, 0).getDate();
		const nextDate = new Date(year, month, Math.min(day, maxDay));
		if (Number.isNaN(nextDate.getTime())) return;
		if (state.flatpickr) {
			state.flatpickr.setDate(nextDate, true, 'Y-m-d');
			return;
		}
		state.values.birthdate = toIsoDate(nextDate);
		state.errors.birthdate = '';
		const input = document.getElementById('birthdate-input');
		if (input) input.value = state.values.birthdate;
		syncYearSelect();
	};


	const bindYearControls = () => {
		document.getElementById('birth-year-select')?.addEventListener('change', (event) => {
			applyYear(event.target.value);
		});
	};

	const destroyDatePicker = () => {
		if (!state.flatpickr) return;
		state.flatpickr.destroy();
		state.flatpickr = null;
	};

	const bindFormEvents = () => {
		const form = document.getElementById('complete-profile-form');
		if (!form) return;

		document.getElementById('prev-step')?.addEventListener('click', () => {
			setStep(state.step - 1);
		});

		document.getElementById('pseudo-input')?.addEventListener('input', (event) => {
			state.values.pseudo = event.target.value;
			state.errors.pseudo = '';
		});

		document.getElementById('gender-select')?.addEventListener('change', (event) => {
			state.values.gender = event.target.value;
			state.errors.gender = '';
		});

		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (state.step < totalSteps - 1) {
				if (!validateCurrentStep()) {
					render();
					return;
				}
				setStep(state.step + 1);
				return;
			}
			await submitProfile();
		});
	};

	const profileApiRequest = async (url, options = {}) => {
		const fraudHelper = getFraudHelper();
		const headers = {
			'Content-Type': 'application/json',
			...(options.headers || {}),
		};
		if (!options.disableFraudChallengeHeader) {
			const challengeToken = String(fraudHelper?.getChallengeToken?.() || '').trim();
			if (challengeToken) {
				headers['x-fraud-challenge-token'] = challengeToken;
			}
		}

		const response = await fetch(url, {
			...options,
			headers,
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error(payload?.message || `Erreur ${response.status}`);
			error.statusCode = response.status;
			error.payload = payload;
			throw error;
		}
		return payload;
	};

	const submitProfile = async (attempt = 0, turnstileTokenOverride = null) => {
		const submitBtn = document.getElementById('next-step');
		const previousHtml = submitBtn?.innerHTML || '';
		if (submitBtn) {
			submitBtn.disabled = true;
			submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t(
				'complete_profile.submitting',
				'Validation...',
			)}`;
		}

		try {
			const bodyPayload = {
				tempToken,
				pseudo: state.values.pseudo.trim(),
				birthdate: state.values.birthdate,
				gender: state.values.gender,
			};
			if (turnstileTokenOverride) {
				bodyPayload.turnstileToken = turnstileTokenOverride;
			}

			const payload = await profileApiRequest('/api/auth/complete-profile', {
				method: 'POST',
				body: JSON.stringify(bodyPayload),
			});

			if (payload?.token) {
				window.SiteApi?.setToken?.(payload.token);
				localStorage.setItem('token', payload.token);
			}

			window.SiteUI?.notify?.(
				t('complete_profile.submit_success', 'Profil complete avec succes.'),
				'success',
			);
			setTimeout(() => {
				window.location.href = 'browse-surveys.html';
			}, 2200);
		} catch (error) {
			if (error?.statusCode === 428) {
				const fraudHelper = getFraudHelper();
				const challengeCode = String(error?.payload?.code || '').trim();
				const challengePayload = error?.payload?.challenge || null;

				if (challengeCode === 'TURNSTILE_REQUIRED') {
					const turnstileToken = await fraudHelper?.requestTurnstileToken?.({
						challenge: challengePayload,
						notify: (message, type) => window.SiteUI?.notify?.(message, type),
					});
					if (turnstileToken && attempt < 2) {
						return submitProfile(attempt + 1, turnstileToken);
					}
				}

				if (challengeCode === 'EMAIL_OTP_REQUIRED') {
					const resolved = await fraudHelper?.resolveEmailOtpChallenge?.({
						request: profileApiRequest,
						contextType: 'profile',
						surveyType: 'unknown',
						surveyId: null,
						tempToken,
						notify: (message, type) => window.SiteUI?.notify?.(message, type),
					});
					if (resolved && attempt < 2) {
						return submitProfile(attempt + 1, null);
					}
				}
			}

			window.SiteUI?.notify?.(
				error?.message ||
					t(
						'complete_profile.network_error',
						'Erreur reseau. Veuillez reessayer.',
					),
				'error',
			);
		} finally {
			if (submitBtn) {
				submitBtn.disabled = false;
				submitBtn.innerHTML = previousHtml;
			}
		}
	};

	const init = () => {
		if (!root) return;

		if (!tempToken) {
			window.SiteUI?.notify?.(
				t(
					'complete_profile.token_missing',
					'Lien invalide: token temporaire manquant.',
				),
				'error',
			);
			setTimeout(() => {
				window.location.href = 'browse-surveys.html';
			}, 600);
			return;
		}

		renderIntro();
		render();
	};

	document.addEventListener('DOMContentLoaded', init);

	document.addEventListener('site:language-changed', () => {
		if (!root) return;
		renderIntro();
		render();
	});

	window.addEventListener('beforeunload', cancelIntroTypewriter);
})();

