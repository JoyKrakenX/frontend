/** @format */

(() => {
	if (window.SiteCreateSurveyModal) return;

	const MODAL_ID = 'shared-create-survey-modal';

	const t = (key, fallback) =>
		window.SiteI18n?.t?.(key, fallback) || fallback;

	const ensureModal = () => {
		let modal = document.getElementById(MODAL_ID);
		if (modal) return modal;

		document.body.insertAdjacentHTML(
			'beforeend',
			`
			<div id="${MODAL_ID}" class="modal hidden" aria-hidden="true" role="dialog" aria-labelledby="shared-create-survey-title" data-modal-size="md">
				<div class="modal-content">
					<div class="modal-header">
						<h3 id="shared-create-survey-title" data-i18n="shared.surveys.create_title">Cr\u00e9er un sondage</h3>
						<button class="close-modal" type="button" data-modal-close aria-label="${t('shared.modals.close', 'Fermer la fen\u00eatre')}">×</button>
					</div>
					<div class="modal-body">
						<p data-i18n="shared.surveys.create_pick_type">Choisissez le type de sondage \u00e0 cr\u00e9er :</p>
						<div class="survey-type-options">
							<button class="survey-type-btn" type="button" data-survey-target="create-survey.html">
								<i class="fas fa-check-double"></i>
								<span data-i18n="shared.surveys.binary">Sondage binaire</span>
								<small data-i18n="shared.surveys.binary_desc">R\u00e9ponse Oui / Non</small>
							</button>
							<button class="survey-type-btn" type="button" data-survey-target="create-survey-choices.html">
								<i class="fas fa-list-check"></i>
								<span data-i18n="shared.surveys.multiple">Sondage multiple</span>
								<small data-i18n="shared.surveys.multiple_desc">2 \u00e0 6 options de r\u00e9ponse (minimum 2)</small>
							</button>
						</div>
					</div>
					<div class="modal-footer">
						<button class="btn-secondary" type="button" data-modal-close data-i18n="shared.modals.cancel">Annuler</button>
					</div>
				</div>
			</div>`,
		);

		modal = document.getElementById(MODAL_ID);
		window.SiteI18n?.applyTranslations?.(modal);
		modal
			.querySelectorAll('[data-modal-close], .close-modal')
			.forEach((node) => {
				node.setAttribute('type', 'button');
				node.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					close();
				});
			});
		modal.addEventListener('click', (event) => {
			const closeTarget = event.target.closest('[data-modal-close], .close-modal');
			if (!closeTarget) return;
			event.preventDefault();
			event.stopPropagation();
			close();
		});
		return modal;
	};

	const open = () => {
		const modal = ensureModal();
		if (window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(modal);
		} else {
			modal.classList.remove('hidden');
		}
		document.dispatchEvent(new CustomEvent('site:create-survey-modal:open'));
	};

	const close = () => {
		const modal = document.getElementById(MODAL_ID);
		if (!modal) return;
		if (window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(modal);
		} else {
			modal.classList.add('hidden');
		}
	};

	const bindEvents = () => {
		if (document.body.dataset.createSurveyModalBound === 'true') return;
		document.body.dataset.createSurveyModalBound = 'true';

		document.addEventListener(
			'click',
			(event) => {
				const trigger = event.target.closest(
					'#new-survey-btn, #create-survey-btn, #create-open-btn, [data-open-create-survey-modal]',
				);
				if (!trigger) return;
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				open();
			},
			true,
		);

		document.addEventListener('click', (event) => {
			const target = event.target.closest('[data-survey-target]');
			if (!target) return;
			const href = target.getAttribute('data-survey-target');
			if (!href) return;
			window.location.href = href;
		});

		document.addEventListener('open:create-survey-modal', open);
	};

	const init = () => {
		ensureModal();
		bindEvents();
	};

	document.addEventListener('DOMContentLoaded', init);
	window.SiteCreateSurveyModal = Object.freeze({ init, open, close });
})();

