/** @format */

(() => {
	const MIN_OPTIONS = 2;
	const MAX_OPTIONS = 6;

	const CONFIG = {
		api: {
			createSurvey: '/api/survey_2',
			authMe: '/api/auth/me',
		},
	};

	const state = {
		options: ['', ''],
		submitting: false,
	};

	const els = {
		loading: null,
		dashboard: null,
		form: null,
		theme: null,
		contexte: null,
		question: null,
		explainYes: null,
		explainNo: null,
		optionsList: null,
		optionsCounter: null,
		addOptionBtn: null,
		previewCheckbox: null,
		previewSection: null,
		previewTheme: null,
		previewContexte: null,
		previewQuestion: null,
		previewOptions: null,
		modal: null,
		modalTheme: null,
		modalQuestion: null,
		modalOptionsCount: null,
	};

	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const notify = (message, type = 'info') => {
		if (window.SiteUI?.notify) {
			window.SiteUI.notify(message, type);
			return;
		}

		const existing = document.querySelector('.notification');
		if (existing) existing.remove();

		const notification = document.createElement('div');
		notification.className = `notification ${type}`;
		notification.style.cssText = `
			position: fixed;
			top: 20px;
			right: 20px;
			padding: 0.9rem 1.2rem;
			border-radius: 10px;
			background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981'};
			color: #fff;
			z-index: 2000;
			box-shadow: 0 8px 22px rgba(0,0,0,0.35);
			max-width: min(420px, 92vw);
		`;
		notification.textContent = String(message || '');
		document.body.appendChild(notification);
		setTimeout(() => notification.remove(), 4200);
	};

	const showLoading = (show) => {
		if (els.loading) els.loading.classList.toggle('hidden', !show);
		if (els.dashboard) els.dashboard.classList.toggle('hidden', Boolean(show));
	};

	const normalizeOption = (value) => String(value || '').trim();

	const normalizeOptionsForValidation = () =>
		state.options.map((value) => normalizeOption(value));

	const hasDuplicateOptions = (options) => {
		const seen = new Set();
		for (const option of options) {
			const normalized = normalizeOption(option).toLowerCase();
			if (seen.has(normalized)) return true;
			seen.add(normalized);
		}
		return false;
	};

	const buildLegacyOptionsPayload = (options) => {
		const payload = {};
		for (let index = 0; index < MAX_OPTIONS; index += 1) {
			payload[`reponse_${index + 1}`] = options[index] || null;
		}
		return payload;
	};

	const setThemeError = (message) => {
		let errorNode = document.getElementById('theme-error');
		if (!errorNode) {
			errorNode = document.createElement('div');
			errorNode.id = 'theme-error';
			errorNode.className = 'field-error';
			errorNode.setAttribute('aria-live', 'polite');
			els.theme?.parentNode?.appendChild(errorNode);
		}
		errorNode.textContent = String(message || '');
		try {
			els.theme?.focus({ preventScroll: true });
			els.theme?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		} catch (_error) {
			els.theme?.focus();
		}
	};

	const clearThemeError = () => {
		document.getElementById('theme-error')?.remove();
	};

	const getExplainFlag = () => {
		if (els.explainNo?.checked) return false;
		return true;
	};

	const updateOptionsCounter = () => {
		if (!els.optionsCounter) return;
		const count = state.options.length;
		els.optionsCounter.textContent = `${count} option${count > 1 ? 's' : ''}`;
	};

	const updateAddButtonState = () => {
		if (!els.addOptionBtn) return;
		els.addOptionBtn.disabled = state.options.length >= MAX_OPTIONS;
	};

	const buildOptionTitle = (index) =>
		t(
			'create_survey_choices.option_title',
			`Option ${index + 1}`,
			{ index: index + 1 },
		);

	const buildOptionPlaceholder = (index) =>
		t(
			'create_survey_choices.option_placeholder',
			`Ex: Option ${index + 1}`,
			{ index: index + 1 },
		);

	const buildRemoveOptionAria = (index) =>
		t(
			'create_survey_choices.option_remove_aria',
			`Supprimer l'option ${index + 1}`,
			{ index: index + 1 },
		);

	const renderOptions = () => {
		if (!els.optionsList) return;

		els.optionsList.innerHTML = state.options
			.map((value, index) => {
				const isRequired = index < MIN_OPTIONS;
				return `
					<div class="option-item ${isRequired ? 'is-required' : 'is-optional'}" data-option-item="${index}">
						<div class="option-header">
							<div class="option-header-main">
								<span class="option-number">${buildOptionTitle(index)}</span>
								<span class="option-required">${
									isRequired
										? t('create_survey_choices.option_required_badge', 'Obligatoire')
										: t('create_survey_choices.option_optional_badge', 'Option libre')
								}</span>
							</div>
							<div class="option-actions">
								${
									isRequired
										? ''
										: `<button class="option-remove-btn" type="button" data-option-remove="${index}" aria-label="${buildRemoveOptionAria(index)}">
											<i class="fas fa-times" aria-hidden="true"></i>
										</button>`
								}
							</div>
						</div>
						<input
							type="text"
							id="reponse-${index + 1}"
							name="reponse_${index + 1}"
							class="form-control option-input"
							data-option-input="${index}"
							value="${String(value || '')
								.replaceAll('&', '&amp;')
								.replaceAll('<', '&lt;')
								.replaceAll('>', '&gt;')
								.replaceAll('\"', '&quot;')}"
							placeholder="${buildOptionPlaceholder(index)}"
							${isRequired ? 'required' : ''}
						/>
						<div class="option-help">
							${
								isRequired
									? t('create_survey_choices.option_required_help', 'Option obligatoire')
									: t('create_survey_choices.option_optional_help', 'Option supplementaire')
							}
						</div>
					</div>
				`;
			})
			.join('');

		updateOptionsCounter();
		updateAddButtonState();
		updatePreview();
	};

	const addOption = () => {
		if (state.options.length >= MAX_OPTIONS) return;
		state.options.push('');
		renderOptions();

		const newInput = document.getElementById(`reponse-${state.options.length}`);
		newInput?.focus();
	};

	const removeOption = (index) => {
		const targetIndex = Number(index);
		if (!Number.isFinite(targetIndex)) return;
		if (state.options.length <= MIN_OPTIONS) return;
		if (targetIndex < MIN_OPTIONS) return;
		if (targetIndex < 0 || targetIndex >= state.options.length) return;

		state.options.splice(targetIndex, 1);
		renderOptions();
	};

	const updatePreview = () => {
		if (!els.previewTheme || !els.previewContexte || !els.previewQuestion) return;

		const theme = normalizeOption(els.theme?.value);
		const contexte = normalizeOption(els.contexte?.value);
		const question = normalizeOption(els.question?.value);
		const options = normalizeOptionsForValidation().filter(Boolean);

		els.previewTheme.textContent = theme || 'Non defini';
		els.previewContexte.textContent = contexte || 'Aucun contexte fourni';
		els.previewQuestion.textContent = question || 'Non definie';

		if (els.previewOptions) {
			els.previewOptions.innerHTML = options.length
				? options
						.map(
							(option, index) =>
								`<div class="preview-option-item">${String.fromCharCode(65 + index)}. ${option}</div>`,
						)
						.join('')
				: `<div class="preview-option-item">${t(
						'create_survey_choices.preview_empty_option',
						'Aucune option pour le moment',
					)}</div>`;
		}

		if (els.modalTheme) els.modalTheme.textContent = theme || 'Non defini';
		if (els.modalQuestion) els.modalQuestion.textContent = question || 'Non definie';
		if (els.modalOptionsCount) {
			els.modalOptionsCount.textContent = `${options.length} option${options.length > 1 ? 's' : ''}`;
		}
	};

	const togglePreview = (open) => {
		const shouldOpen = Boolean(open);
		els.previewSection?.classList.toggle('hidden', !shouldOpen);
		if (els.previewCheckbox) els.previewCheckbox.checked = shouldOpen;
		if (shouldOpen) updatePreview();
	};

	const validateForm = () => {
		const theme = normalizeOption(els.theme?.value);
		const question = normalizeOption(els.question?.value);
		const options = normalizeOptionsForValidation();

		if (!theme || !question) {
			return {
				valid: false,
				message: t(
					'create_survey_choices.validation.theme_question_required',
					'Veuillez renseigner le theme et la question.',
				),
			};
		}

		if (theme.length < 3) {
			return {
				valid: false,
				message: t(
					'create_survey_choices.validation.theme_too_short',
					'Le theme doit contenir au moins 3 caracteres.',
				),
				field: 'theme',
			};
		}

		if (question.length < 5) {
			return {
				valid: false,
				message: t(
					'create_survey_choices.validation.question_too_short',
					'La question doit contenir au moins 5 caracteres.',
				),
			};
		}

		if (options.length < MIN_OPTIONS) {
			return {
				valid: false,
				message: t(
					'create_survey_choices.validation.min_options',
					`Au moins ${MIN_OPTIONS} options sont requises.`,
				),
			};
		}

		if (options.length > MAX_OPTIONS) {
			return {
				valid: false,
				message: t(
					'create_survey_choices.validation.max_options',
					`Le maximum est ${MAX_OPTIONS} options.`,
				),
			};
		}

		for (let index = 0; index < options.length; index += 1) {
			if (!options[index]) {
				return {
					valid: false,
					message: t(
						'create_survey_choices.validation.option_empty',
						`L'option ${index + 1} est vide.`,
						{ index: index + 1 },
					),
				};
			}
		}

		if (hasDuplicateOptions(options)) {
			return {
				valid: false,
				message: t(
					'create_survey_choices.validation.option_duplicate',
					'Les options doivent etre uniques.',
				),
			};
		}

		return { valid: true };
	};

	const openConfirmModal = () => {
		if (!els.modal) return;
		if (window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(els.modal);
		} else {
			els.modal.classList.remove('hidden');
		}
	};

	const closeConfirmModal = () => {
		if (!els.modal) return;
		if (window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(els.modal);
		} else {
			els.modal.classList.add('hidden');
		}
	};

	const buildSurveyPayload = () => {
		const options = normalizeOptionsForValidation();
		return {
			theme: normalizeOption(els.theme?.value),
			contexte: normalizeOption(els.contexte?.value),
			question: normalizeOption(els.question?.value),
			explain: getExplainFlag(),
			options,
			...buildLegacyOptionsPayload(options),
		};
	};

	const confirmSurveyCreation = async () => {
		if (state.submitting) return;

		const token = localStorage.getItem('token');
		if (!token) {
			notify(
				t(
					'create_survey_choices.auth_required',
					'Veuillez vous connecter pour creer un sondage.',
				),
				'warning',
			);
			window.location.href = 'browse-surveys.html';
			return;
		}

		state.submitting = true;
		showLoading(true);
		closeConfirmModal();

		try {
			const payload = buildSurveyPayload();
			const response = await fetch(CONFIG.api.createSurvey, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(payload),
			});

			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				if (String(data?.message || '').toLowerCase().includes('theme')) {
					setThemeError(data.message);
				}
				throw new Error(data?.message || `Erreur ${response.status}`);
			}

			notify(
				t(
					'create_survey_choices.success_create',
					'Sondage a choix multiples cree avec succes !',
				),
				'success',
			);

			const surveyId = data?.surveyId || data?._id || null;
			window.setTimeout(() => {
				if (surveyId) {
					window.location.href = `qr-generator.html?surveyId=${encodeURIComponent(surveyId)}&type=multiple`;
					return;
				}
				window.location.href = 'my-surveys.html';
			}, 1100);
		} catch (error) {
			console.error('create-survey-choices confirmSurveyCreation:', error);
			notify(
				error?.message ||
					t(
						'create_survey_choices.error_create',
						'Erreur reseau. Veuillez reessayer.',
					),
				'error',
			);
		} finally {
			state.submitting = false;
			showLoading(false);
		}
	};

	const hardResetForm = ({ askConfirmation = false } = {}) => {
		if (askConfirmation) {
			const ok = window.confirm(
				t(
					'create_survey_choices.confirm_reset',
					'Voulez-vous vraiment reinitialiser le formulaire ?',
				),
			);
			if (!ok) return;
		}

		els.form?.reset();
		state.options = ['', ''];
		if (els.explainYes) els.explainYes.checked = true;
		renderOptions();
		togglePreview(false);
		clearThemeError();
		updatePreview();
		notify(t('create_survey_choices.form_reset', 'Formulaire reinitialise.'), 'info');
	};

	const bindEvents = () => {
		document.getElementById('back-btn')?.addEventListener('click', () => {
			window.history.back();
		});

		document.getElementById('preview-btn')?.addEventListener('click', () => {
			togglePreview(els.previewSection?.classList.contains('hidden'));
		});

		document.getElementById('close-preview')?.addEventListener('click', () => {
			togglePreview(false);
		});

		els.previewCheckbox?.addEventListener('change', (event) => {
			togglePreview(Boolean(event.target.checked));
		});

		document.getElementById('refresh-btn')?.addEventListener('click', () => {
			hardResetForm({ askConfirmation: false });
		});

		document.getElementById('reset-btn')?.addEventListener('click', () => {
			hardResetForm({ askConfirmation: true });
		});

		els.addOptionBtn?.addEventListener('click', addOption);

		els.optionsList?.addEventListener('click', (event) => {
			const removeBtn = event.target.closest('[data-option-remove]');
			if (!removeBtn) return;
			removeOption(Number(removeBtn.dataset.optionRemove));
		});

		els.optionsList?.addEventListener('input', (event) => {
			const input = event.target.closest('[data-option-input]');
			if (!input) return;
			const index = Number(input.dataset.optionInput);
			if (!Number.isFinite(index)) return;
			state.options[index] = String(input.value || '');
			updatePreview();
		});

		[els.theme, els.contexte, els.question].forEach((input) => {
			input?.addEventListener('input', () => {
				if (input === els.theme) clearThemeError();
				updatePreview();
			});
		});

		els.form?.addEventListener('submit', (event) => {
			event.preventDefault();
			clearThemeError();
			const validation = validateForm();
			if (!validation.valid) {
				if (validation.field === 'theme') setThemeError(validation.message);
				notify(validation.message, 'error');
				return;
			}
			updatePreview();
			openConfirmModal();
		});

		document.getElementById('modal-cancel')?.addEventListener('click', closeConfirmModal);
		document
			.querySelector('#confirm-modal .close-modal')
			?.addEventListener('click', closeConfirmModal);
		document.getElementById('modal-confirm')?.addEventListener('click', () => {
			confirmSurveyCreation().catch((error) => {
				console.error('confirmSurveyCreation unhandled:', error);
			});
		});

		els.modal?.addEventListener('click', (event) => {
			if (event.target === event.currentTarget) closeConfirmModal();
		});

		document.getElementById('login-btn')?.addEventListener('click', () => {
			window.location.href = '/api/auth/google';
		});
	};

	const initAuthState = async () => {
		const token = localStorage.getItem('token');
		if (!token) return;

		const userNameNode = document.getElementById('user-name');
		if (!userNameNode) return;

		const cachedPseudo = localStorage.getItem('userPseudo');
		if (cachedPseudo) {
			userNameNode.textContent = cachedPseudo;
		}

		try {
			const response = await fetch(CONFIG.api.authMe, {
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
			});
			if (!response.ok) return;
			const user = await response.json();
			const pseudo = String(user?.pseudo || user?.username || '').trim();
			if (!pseudo) return;
			userNameNode.textContent = pseudo;
			localStorage.setItem('userPseudo', pseudo);
		} catch (_error) {
			// ignore auth bootstrap failures on this page
		}
	};

	const cacheElements = () => {
		els.loading = document.getElementById('loading');
		els.dashboard = document.querySelector('.dashboard-container');
		els.form = document.getElementById('survey-form');
		els.theme = document.getElementById('survey-title');
		els.contexte = document.getElementById('contexte');
		els.question = document.getElementById('question');
		els.explainYes = document.getElementById('explain-multiple-yes');
		els.explainNo = document.getElementById('explain-multiple-no');
		els.optionsList = document.getElementById('options-list');
		els.optionsCounter = document.getElementById('options-counter');
		els.addOptionBtn = document.getElementById('add-option-btn');
		els.previewCheckbox = document.getElementById('checkbox-data');
		els.previewSection = document.getElementById('preview-section');
		els.previewTheme = document.getElementById('preview-theme');
		els.previewContexte = document.getElementById('preview-contexte');
		els.previewQuestion = document.getElementById('preview-question');
		els.previewOptions = document.getElementById('preview-options');
		els.modal = document.getElementById('confirm-modal');
		els.modalTheme = document.getElementById('modal-theme');
		els.modalQuestion = document.getElementById('modal-question');
		els.modalOptionsCount = document.getElementById('modal-options-count');
	};

	const init = async () => {
		cacheElements();
		if (!els.form || !els.optionsList) return;

		showLoading(true);
		bindEvents();
		renderOptions();
		togglePreview(false);
		updatePreview();
		await initAuthState();
		showLoading(false);
	};

	document.addEventListener('DOMContentLoaded', () => {
		init().catch((error) => {
			console.error('create-survey-choices init failed:', error);
			showLoading(false);
			notify('Erreur de chargement de la page.', 'error');
		});
	});
})();
