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

	const root = document.getElementById('app');
	const infoBox = document.getElementById('informations-box');
	const urlParams = new URLSearchParams(window.location.search);
	const tempToken = urlParams.get('token');
	const totalSteps = 4;

	const typeWriter = (
		text,
		callback,
		{ baseSpeed = 45, startDelay = 380, punctuationPause = 180 } = {},
	) => {
		const punctuation = new Set(['.', ',', '!', '?', ';', ':']);
		let index = 0;
		const next = () => {
			if (index >= text.length) return;
			const char = text.charAt(index);
			callback(char);
			index += 1;
			const extra = punctuation.has(char) ? punctuationPause : 0;
			setTimeout(next, baseSpeed + extra);
		};
		setTimeout(next, Math.max(0, startDelay));
	};

	const escapeHtml = (value) =>
		String(value || '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');

	const clampStep = (value) => Math.max(0, Math.min(totalSteps - 1, value));

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
		infoBox.textContent = '';
		typeWriter(
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

	const setupDatePicker = () => {
		const input = document.getElementById('birthdate-input');
		if (!input || typeof flatpickr !== 'function') return;

		destroyDatePicker();
		state.flatpickr = flatpickr(input, {
			locale: window.flatpickr?.l10ns?.fr || 'fr',
			dateFormat: 'Y-m-d',
			altInput: true,
			altFormat: 'd/m/Y',
			disableMobile: true,
			maxDate: 'today',
			minDate: '1900-01-01',
			monthSelectorType: 'dropdown',
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
		bindYearControls();
	};

	const syncYearSelect = () => {
		const yearSelect = document.getElementById('birth-year-select');
		if (!yearSelect) return;
		const selectedDate = state.flatpickr?.selectedDates?.[0];
		if (selectedDate) {
			yearSelect.value = String(selectedDate.getFullYear());
		}
	};

	const applyYear = (yearValue) => {
		if (!state.flatpickr || !yearValue) return;
		const current = state.flatpickr.selectedDates[0] || new Date();
		const month = current.getMonth();
		const day = current.getDate();
		const year = Number(yearValue);
		const nextDate = new Date(year, month, day);
		if (Number.isNaN(nextDate.getTime())) return;
		state.flatpickr.setDate(nextDate, true, 'Y-m-d');
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

	const submitProfile = async () => {
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
			const response = await fetch('/api/auth/complete-profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tempToken,
					pseudo: state.values.pseudo.trim(),
					birthdate: state.values.birthdate,
					gender: state.values.gender,
				}),
			});

			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				window.SiteUI?.notify?.(
					payload?.message ||
						t(
							'complete_profile.submit_error',
							'Erreur lors de la validation du profil.',
						),
					'error',
				);
				return;
			}

			if (payload?.token) {
				window.SiteApi?.setToken?.(payload.token);
				localStorage.setItem('token', payload.token);
			}

			window.SiteUI?.notify?.(
				t(
					'complete_profile.submit_success',
					'Profil complété avec succès. Redirection...',
				),
				'success',
			);
			setTimeout(() => {
				window.location.href = 'browse-surveys.html';
			}, 500);
		} catch (_error) {
			window.SiteUI?.notify?.(
				t(
					'complete_profile.network_error',
					'Erreur réseau. Veuillez réessayer.',
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
})();

