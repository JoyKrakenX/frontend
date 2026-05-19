/** @format */

(() => {
	const publicApi = (path, options = {}) =>
		window.SiteApi.request(path, { auth: false, ...options });
	const api = (path, options = {}) => window.SiteApi.request(path, { auth: true, ...options });
	const notify = (message, type = 'info') => window.SiteUI?.notify?.(message, type);
	const query = new URLSearchParams(window.location.search || '');
	const requestedPlanCode = String(query.get('plan') || '').trim().toUpperCase();

	const state = {
		authenticated: false,
		organizations: [],
		catalog: {
			plans: [],
			addons: [],
			commercialRules: {},
			faq: [],
			billingPrinciples: [],
			trialPolicy: {},
			enterpriseTeaser: null,
		},
		summary: null,
		invoices: [],
		members: [],
		selectedPlanCode: '',
		pendingCheckout: null,
		pendingMemberActionIds: new Set(),
		addAdminPending: false,
	};

	const nodes = {
		heroPrimaryCta: document.getElementById('hero-primary-cta'),
		publicLoginCta: document.getElementById('public-login-cta'),
		trialNote: document.getElementById('billing-trial-note'),
		proofGrid: document.getElementById('billing-proof-grid'),
		publicCtaCard: document.getElementById('public-cta-card'),
		orgBillingSection: document.getElementById('org-billing-section'),
		status: document.getElementById('subscription-status'),
		orgSelector: document.getElementById('org-selector'),
		planName: document.getElementById('plan-name'),
		basePlanName: document.getElementById('base-plan-name'),
		cycleWindow: document.getElementById('cycle-window'),
		nextBilling: document.getElementById('next-billing'),
		trialEnds: document.getElementById('trial-ends'),
		paymentCurrency: document.getElementById('payment-currency'),
		planContext: document.getElementById('plan-context'),
		planCards: document.getElementById('public-plan-grid'),
		planSelectionSummary: document.getElementById('plan-selection-summary'),
		planActionRow: document.getElementById('plan-action-row'),
		planComparison: document.getElementById('plan-comparison-table'),
		billingRules: document.getElementById('billing-rules'),
		billingFaq: document.getElementById('billing-faq'),
		activeAddonsSection: document.getElementById('active-addons-section'),
		activeAddons: document.getElementById('active-addons'),
		availableAddons: document.getElementById('available-addons'),
		securePaymentCard: document.getElementById('secure-payment-card'),
		conversionPreview: document.getElementById('conversion-preview'),
		checkoutStatusNote: document.getElementById('checkout-status-note'),
		usageCard: document.getElementById('usage-card'),
		usagePeriod: document.getElementById('usage-period'),
		usageList: document.getElementById('usage-list'),
		invoicesCard: document.getElementById('invoices-card'),
		invoicesBody: document.getElementById('invoices-body'),
		checkoutButton: document.getElementById('btn-checkout'),
		retryButton: document.getElementById('btn-retry'),
		billingExemptBanner: document.getElementById('billing-exempt-banner'),
		membersCard: document.getElementById('members-card'),
		addAdminForm: document.getElementById('add-admin-form'),
		addAdminEmail: document.getElementById('add-admin-email'),
		addAdminButton: document.getElementById('btn-add-admin'),
		adminFeedback: document.getElementById('admin-management-feedback'),
		adminPanel: document.getElementById('admin-management-panel'),
		membersBody: document.getElementById('members-body'),
		modal: document.getElementById('checkout-confirm-modal'),
		modalIntro: document.getElementById('checkout-confirm-intro'),
		confirmAmountUsd: document.getElementById('confirm-amount-usd'),
		confirmChargeAmount: document.getElementById('confirm-charge-amount'),
		confirmFxRate: document.getElementById('confirm-fx-rate'),
		confirmFxValidity: document.getElementById('confirm-fx-validity'),
	};

	const esc = (value) =>
		String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	const locale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';
	const code = (value) => String(value || '').trim().toUpperCase();
	const hasToken = () => Boolean(String(window.SiteApi?.getToken?.() || '').trim());
	const hide = (node, hidden) => node?.classList.toggle('hidden', Boolean(hidden));
	const setButtonBusy = (button, busyLabel) => {
		if (!button) return () => {};
		if (!button.dataset.originalHtml) {
			button.dataset.originalHtml = button.innerHTML;
		}
		if (!button.dataset.originalDisabled) {
			button.dataset.originalDisabled = button.disabled ? '1' : '0';
		}
		button.disabled = true;
		button.classList.add('is-busy');
		button.setAttribute('aria-busy', 'true');
		button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${esc(
			busyLabel || 'Chargement...',
		)}</span>`;
		return () => {
			button.classList.remove('is-busy');
			button.removeAttribute('aria-busy');
			button.innerHTML = button.dataset.originalHtml || button.innerHTML;
			button.disabled = button.dataset.originalDisabled === '1';
		};
	};
	const note = (node, message = '', level = 'info') => {
		if (!node) return;
		node.textContent = message;
		node.dataset.level = level;
	};
	const fmtCount = (value) =>
		new Intl.NumberFormat(locale()).format(Number(value || 0));
	const fmtDate = (value) => {
		if (!value) return '-';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(locale());
	};
	const fmtMoney = (value, currency = 'USD') => {
		const digits = ['XOF', 'GNF'].includes(String(currency || '').toUpperCase()) ? 0 : 2;
		return new Intl.NumberFormat(locale(), {
			style: 'currency',
			currency,
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		}).format(Number(value || 0));
	};
	const currentBaseCode = () => code(state.summary?.subscription?.planCode || '');
	const currentEffectiveCode = () =>
		code(
			state.summary?.subscription?.effectivePlanCode ||
				state.summary?.subscription?.planCode ||
				'',
		);
	const currentBasePlan = () => state.summary?.plans?.base || null;
	const currentEffectivePlan = () => state.summary?.plans?.effective || null;
	const selectedPlan = () =>
		state.catalog.plans.find((plan) => plan.code === code(state.selectedPlanCode)) || null;
	const isTrialing = () =>
		String(state.summary?.subscription?.status || '').toLowerCase() === 'trialing';
	const canManageBilling = () => Boolean(state.summary?.entitlement?.canManageBilling);
	const isBillingExempt = () => Boolean(state.summary?.entitlement?.billingExempt);
	const activeRole = () => {
		const currentOrganizationId = String(state.summary?.organization?._id || '');
		return (
			state.organizations.find(
				(entry) => String(entry?.organization?._id || '') === currentOrganizationId,
			)?.role || ''
		);
	};
	const planPrice = (plan) => {
		if (!plan) return '-';
		if (String(plan.priceLabel || '').trim()) return String(plan.priceLabel).trim();
		if (!Number.isFinite(Number(plan.priceMonthlyUsd))) return 'Sur devis';
		if (Number(plan.priceMonthlyUsd) === 0) return '0 USD / mois';
		return `${fmtMoney(plan.priceMonthlyUsd, 'USD')} / mois`;
	};
	const goToLogin = () =>
		window.SiteApi?.beginGoogleAuth?.({ returnTo: '/billing.html' });
	const openModal = () =>
		window.SiteModalSheet?.open
			? window.SiteModalSheet.open(nodes.modal)
			: nodes.modal?.classList.remove('hidden');
	const closeModal = () =>
		window.SiteModalSheet?.close
			? window.SiteModalSheet.close(nodes.modal)
			: nodes.modal?.classList.add('hidden');

	const renderHero = () => {
		const trialPolicy = state.catalog.trialPolicy || {};
		nodes.trialNote.textContent = `Community Unlimited · 45 USD / mois · ${Number(trialPolicy.trialDays || 14)} jours d'essai gratuits.`;
		nodes.proofGrid.innerHTML = [
			"<div class=\"hero-proof-item\"><strong>Participants gratuits</strong><span>Vos votants et membres de communauté n'ont pas besoin d'abonnement.</span></div>",
			'<div class="hero-proof-item"><strong>Tout illimité</strong><span>Sondages, votes, chatroom, exports, analytics et admins sans quotas de volume.</span></div>',
			'<div class="hero-proof-item"><strong>14 jours gratuits</strong><span>L organisation teste Community Unlimited avant la première facturation.</span></div>',
			'<div class="hero-proof-item"><strong>Zéro add-on</strong><span>Plus de packs, plus d upgrade par capacité, plus de seuil caché.</span></div>',
		].join('');
	};

	const renderRulesAndFaq = () => {
		const rules = state.catalog.commercialRules || {};
		const principles = Array.isArray(state.catalog.billingPrinciples)
			? state.catalog.billingPrinciples
			: [];
		nodes.billingRules.innerHTML = `
			<div class="rules-grid">
				<div class="rule-item"><strong>Offre</strong><span>Community Unlimited</span></div>
				<div class="rule-item"><strong>Prix</strong><span>45 USD / mois</span></div>
				<div class="rule-item"><strong>Essai</strong><span>${Number(rules.trialDays || 14)} jours gratuits</span></div>
				<div class="rule-item"><strong>Participants</strong><span>Gratuits</span></div>
			</div>
			<ul class="rules-principles-list">${principles
				.map((item) => `<li>${esc(item)}</li>`)
				.join('')}</ul>
		`;
		nodes.billingFaq.innerHTML = (Array.isArray(state.catalog.faq) ? state.catalog.faq : [])
			.map(
				(item) => `
					<details class="faq-item-card">
						<summary>${esc(item.question || '')}</summary>
						<p>${esc(item.answer || '')}</p>
					</details>
				`,
			)
			.join('');
	};
	const renderSummary = () => {
		if (!state.authenticated || !state.summary) {
			hide(nodes.orgBillingSection, true);
			hide(nodes.securePaymentCard, true);
			hide(nodes.usageCard, true);
			hide(nodes.invoicesCard, true);
			hide(nodes.membersCard, true);
			hide(nodes.publicCtaCard, false);
			note(nodes.checkoutStatusNote, '', 'info');
			return;
		}

		hide(nodes.orgBillingSection, false);
		hide(nodes.securePaymentCard, false);
		hide(nodes.usageCard, false);
		hide(nodes.invoicesCard, false);
		hide(nodes.membersCard, false);
		hide(nodes.publicCtaCard, true);
		document.body.dataset.billingExempt = isBillingExempt() ? 'true' : 'false';

		const statusMap = {
			trialing: 'Essai',
			active: 'Actif',
			past_due: 'Paiement en retard',
			suspended: 'Suspendu',
			grace: 'Grâce',
			canceled: 'Annulé',
		};
		nodes.status.textContent =
			statusMap[String(state.summary?.subscription?.status || '').toLowerCase()] ||
			state.summary?.subscription?.status ||
			'-';
		nodes.status.className = `badge-status status-${String(
			state.summary?.subscription?.status || 'unknown',
		).toLowerCase()}`;
		nodes.planName.textContent = currentEffectivePlan()?.displayName || '-';
		nodes.basePlanName.textContent = currentBasePlan()?.displayName || '-';
		nodes.cycleWindow.textContent = `${fmtDate(
			state.summary?.subscription?.currentPeriodStartAt ||
				state.summary?.usage?.periodStartAt,
		)} -> ${fmtDate(
			state.summary?.subscription?.currentPeriodEndAt ||
				state.summary?.usage?.periodEndAt,
		)}`;
		nodes.nextBilling.textContent = fmtDate(state.summary?.subscription?.nextBillingAt);
		nodes.trialEnds.textContent = fmtDate(state.summary?.subscription?.trialEndsAt);
		nodes.paymentCurrency.textContent =
			state.summary?.organization?.paymentCurrency ||
			state.summary?.organization?.currency ||
			'USD';
		nodes.planContext.textContent = isTrialing()
			? `Vous êtes actuellement sur ${currentBasePlan()?.displayName || 'Free'} avec un essai ${currentEffectivePlan()?.displayName || 'Growth'} jusqu'au ${fmtDate(state.summary?.subscription?.trialEndsAt)}.`
			: state.summary?.nextBestAction?.label || '';
		hide(nodes.planContext, !nodes.planContext.textContent);
		nodes.billingExemptBanner.textContent = isBillingExempt()
			? 'Compte exempté de facturation: vos actions owner sur cette organisation ne sont pas soumises aux restrictions de paiement.'
			: '';
		hide(nodes.billingExemptBanner, !nodes.billingExemptBanner.textContent);
		nodes.orgSelector.innerHTML = state.organizations
			.map((entry) => {
				const organization = entry.organization || {};
				const selected =
					String(organization._id || '') ===
					String(state.summary?.organization?._id || '')
						? ' selected'
						: '';
				return `<option value="${esc(organization._id || '')}"${selected}>${esc(organization.name || 'Organisation')}</option>`;
			})
			.join('');
	};

	const renderPlans = () => {
		if (!state.catalog.plans.length) {
			nodes.planCards.innerHTML = '<div class="muted">Catalogue indisponible.</div>';
			nodes.planSelectionSummary.textContent = '';
			return;
		}

		if (!state.selectedPlanCode) {
			state.selectedPlanCode =
				requestedPlanCode ||
				(state.authenticated ? currentEffectiveCode() : '') ||
				state.catalog.plans.find((plan) => plan.recommended)?.code ||
				state.catalog.plans[0]?.code ||
				'';
		}

		const comparablePlans = state.catalog.plans.filter((plan) => !plan.isQuoteOnly);
		nodes.planCards.innerHTML = state.catalog.plans
			.map((plan) => {
				const current = state.authenticated && plan.code === currentBaseCode();
				const effective = state.authenticated && plan.code === currentEffectiveCode();
				const selected = plan.code === code(state.selectedPlanCode);
				const selectable =
					state.authenticated &&
					canManageBilling() &&
					!plan.isQuoteOnly &&
					plan.code !== 'FREE';
				const badges = [
					plan.recommended
						? '<span class="plan-badge plan-badge-recommended">Recommandé</span>'
						: '',
					current
						? '<span class="plan-badge plan-badge-current">Plan de base</span>'
						: '',
					isTrialing() && effective && !current
						? '<span class="plan-badge plan-badge-selected">Essai</span>'
						: '',
					selectable && selected
						? '<span class="plan-badge plan-badge-selected">Sélectionné</span>'
						: '',
				]
					.filter(Boolean)
					.join('');
				const cardClasses = [
					'plan-card',
					plan.isQuoteOnly ? 'plan-card-enterprise' : '',
					selectable ? 'plan-card-selectable' : '',
					selected ? 'plan-card-selected' : '',
				]
					.filter(Boolean)
					.join(' ');
				const selectableAttrs = selectable
					? `tabindex="0" data-plan-code="${esc(plan.code)}" data-plan-selectable="true" role="radio" aria-checked="${selected ? 'true' : 'false'}"`
					: '';
				const enterpriseTeaser = state.catalog.enterpriseTeaser || {};
				const body = plan.isQuoteOnly
					? `<p class="muted enterprise-teaser-text">${esc(
							enterpriseTeaser.description ||
								plan.description ||
								'Accompagnement commercial, capacités sur mesure et cadrage spécifique.',
						)}</p>`
					: `<ul class="plan-quotas-list">${(plan.highlights || [])
							.map((item) => `<li><span>${esc(item)}</span></li>`)
							.join('')}</ul>`;

				let footerAction = '';
				if (plan.isQuoteOnly) {
					footerAction = `<a class="btn-secondary enterprise-contact-btn" href="contact.html?topic=enterprise-sales&source=billing&plan=${encodeURIComponent(plan.code)}">${esc(plan.ctaLabel || "Parler à l'équipe")}</a>`;
				} else if (!state.authenticated) {
					const publicLabel =
						plan.code === 'FREE'
							? plan.ctaLabel || 'Commencer gratuitement'
							: 'Se connecter pour choisir';
					footerAction = `<button class="btn-secondary plan-public-cta" type="button" data-plan-login="${esc(plan.code)}">${esc(publicLabel)}</button>`;
				} else if (canManageBilling()) {
					footerAction = `<button class="btn-secondary plan-select-btn" type="button" data-plan-code="${esc(plan.code)}">${selected ? 'Plan sélectionné' : 'Sélectionner'}</button>`;
				}

				return `<article class="${cardClasses}" ${selectableAttrs}><div class="plan-card-head"><h4>${esc(plan.displayName)}</h4><div class="plan-badges">${badges}</div></div><div class="plan-price">${esc(planPrice(plan))}</div><div class="muted">${esc(plan.audience || plan.description || '')}</div>${body}${footerAction}</article>`;
			})
			.join('');

		const selected = selectedPlan();
		nodes.planSelectionSummary.textContent = !selected
			? "Sélectionnez un plan pour voir le résumé de l'action."
			: !state.authenticated
				? selected.isQuoteOnly
					? 'Enterprise passe par un parcours commercial sur devis.'
					: `Connectez-vous pour activer ${selected.displayName} et gérer votre abonnement depuis cette page.`
				: selected.isQuoteOnly
					? 'Enterprise passe par un parcours commercial sur devis.'
					: selected.code === 'FREE'
						? "Le plan Free reste l'entrée du produit. Passez à un plan payant pour augmenter vos capacités."
						: selected.code !== currentBaseCode()
							? isTrialing() && selected.code === currentEffectiveCode()
								? `Vous convertirez votre essai actuel en abonnement ${selected.displayName}.`
								: `Vous passerez de ${currentBasePlan()?.displayName || 'votre plan actuel'} vers ${selected.displayName}.`
							: `Vous renouvellerez le plan ${selected.displayName}.`;

		hide(nodes.planActionRow, !(state.authenticated && canManageBilling()));
		if (nodes.checkoutButton?.querySelector('span')) {
			nodes.checkoutButton.querySelector('span').textContent = !selected
				? 'Activer ce plan'
				: selected.isQuoteOnly
					? "Contacter l'équipe"
					: selected.code === 'FREE'
						? 'Le plan Free est déjà disponible'
						: selected.code !== currentBaseCode()
							? `Activer ${selected.displayName}`
							: `Renouveler ${selected.displayName}`;
		}
		if (nodes.checkoutButton) {
			nodes.checkoutButton.disabled =
				!selected || isBillingExempt() || selected.code === 'FREE';
		}

		const headers = comparablePlans
			.map((plan) => `<th>${esc(plan.displayName)}</th>`)
			.join('');
		const rows = [
			['Prix', (plan) => planPrice(plan)],
			[
				'Admins',
				(plan) =>
					plan.quotas?.admins === null ? 'Illimité' : fmtCount(plan.quotas?.admins || 0),
			],
			[
				'Réponses / mois',
				(plan) =>
					plan.quotas?.votes === null ? 'Illimité' : fmtCount(plan.quotas?.votes || 0),
			],
			[
				'Simultanes live',
				(plan) =>
					plan.quotas?.chatConcurrent === null
						? 'Illimité'
						: fmtCount(plan.quotas?.chatConcurrent || 0),
			],
			[
				'Campagnes',
				(plan) =>
					plan.quotas?.surveys === null
						? 'Illimité'
						: fmtCount(plan.quotas?.surveys || 0),
			],
			[
				'Exports',
				(plan) =>
					plan.quotas?.exports === null
						? 'Illimité'
						: fmtCount(plan.quotas?.exports || 0),
			],
		]
			.map(
				([label, mapper]) =>
					`<tr><th>${esc(label)}</th>${comparablePlans
						.map((plan) => `<td>${esc(String(mapper(plan)))}</td>`)
						.join('')}</tr>`,
			)
			.join('');
		nodes.planComparison.innerHTML = `<table class="plan-comparison-table"><thead><tr><th>Capacité</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
	};
	const renderAddons = () => {
		hide(nodes.activeAddonsSection, true);
		if (nodes.activeAddons) nodes.activeAddons.innerHTML = '';
		if (nodes.availableAddons) nodes.availableAddons.innerHTML = '';
		return;
		const active = Array.isArray(state.summary?.addons?.active)
			? state.summary.addons.active
			: [];
		const available = Array.isArray(state.summary?.addons?.available)
			? state.summary.addons.available
			: [];
		const availableCodes = new Set(available.map((addon) => code(addon.code)));

		hide(nodes.activeAddonsSection, !(state.authenticated && active.length));
		nodes.activeAddons.innerHTML = active.length
			? active
					.map(
						(addon) =>
							`<div class="stack-item"><strong>${esc(
								addon.displayName,
							)}</strong><span class="muted">Quantite: ${fmtCount(addon.quantity || 1)}${
								addon.endsAt
									? ` - actif jusqu'au ${esc(fmtDate(addon.endsAt))}`
									: ''
							}</span></div>`,
					)
					.join('')
			: '<div class="muted">Aucun add-on actif sur cette organisation.</div>';

		nodes.availableAddons.innerHTML = state.catalog.addons.length
			? state.catalog.addons
					.map((addon) => {
						const availableForCurrentPlan = availableCodes.has(code(addon.code));
						let footer = '';
						if (!state.authenticated) {
							footer = `<button class="btn-secondary addon-cta-btn" type="button" data-addon-login="${esc(addon.code)}">Se connecter pour l’ajouter</button>`;
						} else if (availableForCurrentPlan) {
							footer = `<button class="btn-secondary addon-cta-btn" type="button" data-addon-code="${esc(addon.code)}" ${
								isTrialing() ? 'disabled' : ''
							}>${esc(addon.ctaLabel || 'Ajouter')}</button>${
								isTrialing()
									? '<div class="muted">Disponible apres conversion vers un plan payant.</div>'
									: ''
							}`;
						} else {
							footer = '<div class="muted">Disponible sur un plan payant compatible.</div>';
						}
						return `<article class="addon-card"><div class="addon-card-head"><h4>${esc(addon.displayName)}</h4><span class="plan-price">${fmtMoney(addon.priceUsd || 0, 'USD')}${addon.kind === 'recurring' ? ' / mois' : ''}</span></div><p class="muted">${esc(addon.description || '')}</p>${footer}</article>`;
					})
					.join('')
			: '<div class="muted">Aucun pack disponible pour le moment.</div>';
	};

	const renderQuoteAndUsage = () => {
		const quote = state.summary?.billingQuotePreview || {};
		nodes.conversionPreview.innerHTML = `
			<div class="conversion-line"><span>Catalogue</span><span>${fmtMoney(quote.amountUsd || 0, 'USD')}</span></div>
			<div class="conversion-line"><span>Devise de règlement</span><span>${esc(quote.paymentCurrency || 'XOF')}</span></div>
			<div class="conversion-line"><span>Montant estime</span><span>${
				quote.available
					? fmtMoney(quote.chargeAmount || 0, quote.paymentCurrency || 'XOF')
					: 'Calculé au checkout'
			}</span></div>
			<div class="conversion-line conversion-total"><span>Taux FX</span><span>${
				quote.available && quote.rate ? esc(String(quote.rate)) : 'Confirmé avant paiement'
			}</span></div>
		`;
		nodes.usagePeriod.textContent =
			state.summary?.usage?.periodType === 'billing_cycle'
				? 'Cycle de facturation réel'
				: 'Mois calendaire UTC';
		const metrics = Array.isArray(state.summary?.usage?.metrics)
			? state.summary.usage.metrics
			: [];
		nodes.usageList.innerHTML = metrics.length
			? metrics
					.map(
						(metric) => `
							<div class="usage-item${metric.alertLevel ? ` alert-${metric.alertLevel}` : ''}">
								<div class="usage-top"><strong>${esc(metric.label)}</strong><span>${fmtCount(metric.consumed)} / ${metric.quota === null ? 'Illimité' : fmtCount(metric.quota)}</span></div>
								<div class="progress"><span style="width:${metric.percent === null ? 0 : metric.percent}%"></span></div>
								<div class="muted">Restant: ${metric.remaining === null ? 'Illimité' : esc(fmtCount(metric.remaining))}</div>
							</div>
						`,
					)
					.join('')
			: '<div class="muted">Aucune consommation disponible.</div>';
	};

	const renderInvoices = () => {
		nodes.invoicesBody.innerHTML = state.invoices.length
			? state.invoices
					.map((invoice) => {
						const kindLabels = {
							addon: 'Add-on',
							upgrade: 'Changement de plan',
							retry: 'Relance',
							renewal: 'Renouvellement',
						};
						const kind = String(invoice.kind || 'renewal').toLowerCase();
						return `<tr><td>${esc(fmtDate(invoice.createdAt))}</td><td>${esc(kindLabels[kind] || invoice.kind || '-')}</td><td>${esc(String(invoice.status || '-'))}</td><td>${fmtMoney(invoice.totalAmountUsd || 0, 'USD')}</td><td>${esc(String(invoice.periodKey || '-'))}</td></tr>`;
					})
					.join('')
			: '<tr><td colspan="5" class="text-center text-secondary">Aucune facture pour le moment.</td></tr>';
		if (nodes.retryButton) {
			nodes.retryButton.disabled =
				!state.invoices.some((invoice) =>
					['failed', 'pending'].includes(String(invoice.status || '').toLowerCase()),
				) || isBillingExempt();
		}
	};

	const renderMembers = () => {
		nodes.membersBody.innerHTML = state.members.length
			? state.members
					.map((member) => {
						const memberId = String(member?._id || '').trim();
						const role = String(member?.role || 'member').trim().toLowerCase();
						const user = member?.user || member?.userId || {};
						const pending = state.pendingMemberActionIds.has(memberId);
						const action =
							role === 'member'
								? `<button class="btn-secondary btn-member-action" type="button" data-member-action="promote-admin" data-member-id="${esc(memberId)}" ${pending ? 'disabled' : ''}>Promouvoir admin</button>`
								: role === 'admin'
									? `<button class="btn-secondary btn-member-action" type="button" data-member-action="delete-admin" data-member-id="${esc(memberId)}" ${pending ? 'disabled' : ''}>Retirer admin</button>`
									: '<span class="member-action-lock">Propriétaire protégé</span>';
						return `<tr><td>${esc(user?.pseudo || user?.name || 'Utilisateur')}</td><td>${esc(user?.email || '-')}</td><td><span class="member-role-badge role-${esc(role)}">${esc(role)}</span></td><td class="member-actions-cell">${action}</td></tr>`;
					})
					.join('')
			: '<tr><td colspan="4" class="text-center text-secondary">Aucun membre trouvé.</td></tr>';
		const canManageMembers = ['owner', 'admin'].includes(String(activeRole()).toLowerCase());
		const disabled =
			!state.summary?.organization?._id || !canManageMembers || state.addAdminPending;
		nodes.adminPanel.classList.toggle('is-readonly', !canManageMembers);
		nodes.addAdminForm.classList.toggle('is-pending', Boolean(state.addAdminPending));
		nodes.addAdminEmail.disabled = disabled;
		nodes.addAdminButton.disabled = disabled;
	};

	const prepareCheckoutModal = (payload) => {
		state.pendingCheckout = payload;
		nodes.modalIntro.textContent =
			payload?.mode === 'addon'
				? 'Vérifiez le pack sélectionné avant de continuer vers FedaPay.'
				: 'Vérifiez les détails avant de continuer vers FedaPay.';
		nodes.confirmAmountUsd.textContent = fmtMoney(payload?.amountUsd || 0, 'USD');
		nodes.confirmChargeAmount.textContent = payload?.chargeCurrency
			? fmtMoney(payload.chargeAmount || 0, payload.chargeCurrency)
			: '-';
		nodes.confirmFxRate.textContent = payload?.fxRate
			? String(payload.fxRate)
			: 'Confirme au checkout';
		nodes.confirmFxValidity.textContent = payload?.fxLockExpiresAt
			? fmtDate(payload.fxLockExpiresAt)
			: '-';
	};

	const loadMembers = async () => {
		const organizationId = String(state.summary?.organization?._id || '').trim();
		if (!organizationId) {
			state.members = [];
			renderMembers();
			return;
		}
		try {
			state.members = await api(
				`/api/organizations/${encodeURIComponent(organizationId)}/members`,
			);
			note(nodes.adminFeedback, '', 'info');
		} catch (_error) {
			state.members = [];
			note(nodes.adminFeedback, 'Membres indisponibles pour le moment.', 'error');
		}
		renderMembers();
	};

	const resetAuthenticatedState = () => {
		state.authenticated = false;
		state.organizations = [];
		state.summary = null;
		state.invoices = [];
		state.members = [];
		note(nodes.checkoutStatusNote, '', 'info');
		renderSummary();
		renderPlans();
		renderAddons();
		renderInvoices();
		renderMembers();
	};

	const loadPublicCatalog = async () => {
		const catalog = await publicApi('/api/public/billing-catalog');
		state.catalog = {
			plans: Array.isArray(catalog?.plans) ? catalog.plans : [],
			addons: Array.isArray(catalog?.addons) ? catalog.addons : [],
			commercialRules: catalog?.commercialRules || {},
			faq: Array.isArray(catalog?.faq) ? catalog.faq : [],
			billingPrinciples: Array.isArray(catalog?.billingPrinciples)
				? catalog.billingPrinciples
				: [],
			trialPolicy: catalog?.trialPolicy || {},
			enterpriseTeaser: catalog?.enterpriseTeaser || null,
		};
		renderHero();
		renderRulesAndFaq();
		renderPlans();
		renderAddons();
		renderSummary();
	};

	const loadAuthenticatedData = async () => {
		if (!hasToken()) {
			resetAuthenticatedState();
			return;
		}
		nodes.usageList.innerHTML = '<div class="muted">Chargement...</div>';
		nodes.conversionPreview.innerHTML = '<div class="muted">Chargement...</div>';
		nodes.invoicesBody.innerHTML =
			'<tr><td colspan="5" class="text-center text-secondary">Chargement...</td></tr>';
		nodes.membersBody.innerHTML =
			'<tr><td colspan="4" class="text-center text-secondary">Chargement...</td></tr>';
		try {
			const [organizations, summary, invoices] = await Promise.all([
				api('/api/organizations/mine'),
				api('/api/billing/summary'),
				api('/api/billing/invoices'),
			]);
			state.authenticated = true;
			state.organizations = Array.isArray(organizations) ? organizations : [];
			state.summary = summary || null;
			state.invoices = Array.isArray(invoices) ? invoices : [];
			if (
				requestedPlanCode &&
				state.catalog.plans.some((plan) => plan.code === requestedPlanCode)
			) {
				state.selectedPlanCode = requestedPlanCode;
			} else if (
				!state.selectedPlanCode ||
				!state.catalog.plans.some((plan) => plan.code === state.selectedPlanCode)
			) {
				state.selectedPlanCode =
					currentEffectiveCode() ||
					state.catalog.plans.find((plan) => plan.recommended)?.code ||
					state.catalog.plans[0]?.code ||
					'';
			}
			renderSummary();
			renderPlans();
			renderAddons();
			renderQuoteAndUsage();
			renderInvoices();
			await loadMembers();
		} catch (error) {
			if (Number(error?.status || error?.payload?.status || 0) === 401) {
				resetAuthenticatedState();
				return;
			}
			notify(
				error?.payload?.message || error?.message || 'Erreur de chargement de la facturation.',
				'error',
			);
			resetAuthenticatedState();
		}
	};

	const refreshBillingState = async () => {
		await loadPublicCatalog();
		await loadAuthenticatedData();
	};

	const requestCheckout = async (triggerButton = nodes.checkoutButton) => {
		if (!state.authenticated) {
			goToLogin();
			return;
		}
		const plan = selectedPlan();
		if (!plan) return;
		if (plan.isQuoteOnly) {
			window.location.href = `contact.html?topic=enterprise-sales&source=billing&plan=${encodeURIComponent(plan.code)}`;
			return;
		}
		if (plan.code === 'FREE') {
			notify('Le plan Free reste déjà disponible sans paiement.', 'info');
			return;
		}
		const mode = plan.code !== currentBaseCode() ? 'upgrade' : 'renewal';
		const releaseBusy = setButtonBusy(
			triggerButton,
			mode === 'upgrade' ? 'Activation en cours...' : 'Préparation du paiement...',
		);
		try {
			const payload = await api('/api/billing/checkout', {
				method: 'POST',
				data: { mode, planCode: mode === 'upgrade' ? plan.code : undefined },
			});
			if (!payload?.checkoutLink) {
				notify('Paiement initialisé.', 'success');
				await loadAuthenticatedData();
				return;
			}
			prepareCheckoutModal(payload);
			openModal();
		} catch (error) {
			notify(error?.payload?.message || error?.message || 'Erreur de paiement.', 'error');
		} finally {
			releaseBusy();
			renderPlans();
			renderInvoices();
		}
	};

	const requestAddonCheckout = async (addonCode, triggerButton = null) => {
		if (!state.authenticated) {
			goToLogin();
			return;
		}
		const releaseBusy = setButtonBusy(triggerButton, 'Préparation du paiement...');
		try {
			const payload = await api('/api/billing/addons/checkout', {
				method: 'POST',
				data: { addonCode, quantity: 1 },
			});
			if (!payload?.checkoutLink) {
				notify('Paiement initialisé.', 'success');
				await loadAuthenticatedData();
				return;
			}
			prepareCheckoutModal(payload);
			openModal();
		} catch (error) {
			notify(
				error?.payload?.message || error?.message || "Erreur de paiement pour l'add-on.",
				'error',
			);
		} finally {
			releaseBusy();
			renderAddons();
		}
	};
	const retryPayment = async (triggerButton = nodes.retryButton) => {
		if (!state.authenticated) return;
		const releaseBusy = setButtonBusy(triggerButton, 'Relance en cours...');
		try {
			const payload = await api('/api/billing/retry-payment', {
				method: 'POST',
				data: {},
			});
			if (!payload?.checkoutLink) {
				notify('Relance initiée.', 'success');
				await loadAuthenticatedData();
				return;
			}
			prepareCheckoutModal(payload);
			openModal();
		} catch (error) {
			notify(error?.payload?.message || error?.message || 'Erreur de relance.', 'error');
		} finally {
			releaseBusy();
			renderPlans();
			renderInvoices();
		}
	};

	const pollCheckoutStatus = async (invoiceId, attempts = 8) => {
		note(nodes.checkoutStatusNote, 'Vérification du paiement en cours...', 'info');
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			try {
				const payload = await api(
					`/api/billing/checkout-status/${encodeURIComponent(invoiceId)}`,
				);
				const status = String(payload?.status || '').toLowerCase();
				if (status === 'paid') {
					note(
						nodes.checkoutStatusNote,
						'Paiement confirmé. Abonnement mis à jour.',
						'success',
					);
					notify('Paiement confirmé. Abonnement mis à jour.', 'success');
					await loadAuthenticatedData();
					return;
				}
				if (['failed', 'void', 'refunded'].includes(status)) {
					note(nodes.checkoutStatusNote, 'Paiement non valide ou refusé.', 'error');
					notify('Paiement non valide ou refusé.', 'error');
					await loadAuthenticatedData();
					return;
				}
			} catch (error) {
				note(
					nodes.checkoutStatusNote,
					error?.message || 'Erreur de vérification du paiement.',
					'error',
				);
			}
			await new Promise((resolve) => window.setTimeout(resolve, 3500));
		}
	};

	const addAdmin = async () => {
		const email = String(nodes.addAdminEmail?.value || '').trim().toLowerCase();
		if (!email) {
			note(nodes.adminFeedback, 'Saisissez un email valide.', 'error');
			return;
		}
		state.addAdminPending = true;
		renderMembers();
		try {
			await api(
				`/api/organizations/${encodeURIComponent(String(state.summary?.organization?._id || ''))}/members`,
				{
					method: 'POST',
					data: { email, role: 'admin' },
				},
			);
			nodes.addAdminEmail.value = '';
			note(nodes.adminFeedback, `Admin ajouté: ${email}.`, 'success');
			notify(`Admin ajouté: ${email}.`, 'success');
			await loadAuthenticatedData();
		} catch (error) {
			note(
				nodes.adminFeedback,
				error?.payload?.message || error?.message || 'Impossible d’ajouter cet admin.',
				'error',
			);
			notify(
				error?.payload?.message || error?.message || 'Impossible d’ajouter cet admin.',
				'error',
			);
		} finally {
			state.addAdminPending = false;
			renderMembers();
		}
	};

	const updateMemberRole = async (memberId, nextRole) => {
		state.pendingMemberActionIds.add(memberId);
		renderMembers();
		try {
			await api(
				`/api/organizations/${encodeURIComponent(String(state.summary?.organization?._id || ''))}/members/${encodeURIComponent(memberId)}`,
				{ method: 'PATCH', data: { role: nextRole } },
			);
			notify(
				nextRole === 'admin' ? 'Membre promu admin.' : 'Droits admin retirés.',
				'success',
			);
			await loadAuthenticatedData();
		} catch (error) {
			notify(
				error?.payload?.message || error?.message || 'Action membre indisponible.',
				'error',
			);
		} finally {
			state.pendingMemberActionIds.delete(memberId);
			renderMembers();
		}
	};

	const bindEvents = () => {
		document.getElementById('back-btn')?.addEventListener('click', () => window.history.back());
		nodes.heroPrimaryCta?.addEventListener('click', () => goToLogin());
		nodes.publicLoginCta?.addEventListener('click', () => goToLogin());
		nodes.orgSelector?.addEventListener('change', async (event) => {
			const organizationId = String(event.target?.value || '').trim();
			if (
				!organizationId ||
				organizationId === String(state.summary?.organization?._id || '').trim()
			) {
				return;
			}
			try {
				await api(`/api/organizations/active/${encodeURIComponent(organizationId)}`, {
					method: 'PATCH',
				});
				await loadAuthenticatedData();
			} catch (error) {
				notify(
					error?.payload?.message || error?.message || 'Erreur changement organisation.',
					'error',
				);
			}
		});

		nodes.planCards?.addEventListener('click', (event) => {
			const loginButton = event.target?.closest?.('button[data-plan-login]');
			if (loginButton) {
				goToLogin();
				return;
			}
			const selectButton = event.target?.closest?.('button[data-plan-code]');
			if (selectButton) {
				state.selectedPlanCode = code(selectButton.getAttribute('data-plan-code'));
				renderPlans();
				return;
			}
			const card = event.target?.closest?.('.plan-card[data-plan-selectable="true"]');
			if (!card) return;
			state.selectedPlanCode = code(card.getAttribute('data-plan-code'));
			renderPlans();
		});

		nodes.planCards?.addEventListener('keydown', (event) => {
			const card = event.target?.closest?.('.plan-card[data-plan-selectable="true"]');
			if (!card) return;
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				state.selectedPlanCode = code(card.getAttribute('data-plan-code'));
				renderPlans();
			}
		});

		nodes.checkoutButton?.addEventListener('click', (event) =>
			requestCheckout(event.currentTarget),
		);
		nodes.retryButton?.addEventListener('click', (event) =>
			retryPayment(event.currentTarget),
		);

		nodes.availableAddons?.addEventListener('click', (event) => {
			const loginButton = event.target?.closest?.('button[data-addon-login]');
			if (loginButton) {
				goToLogin();
				return;
			}
			const button = event.target?.closest?.('button[data-addon-code]');
			if (!button || button.disabled) return;
			requestAddonCheckout(button.getAttribute('data-addon-code'), button);
		});

		nodes.addAdminForm?.addEventListener('submit', async (event) => {
			event.preventDefault();
			await addAdmin();
		});

		nodes.membersBody?.addEventListener('click', async (event) => {
			const button = event.target?.closest?.('button[data-member-action][data-member-id]');
			if (!button) return;
			const memberId = String(button.getAttribute('data-member-id') || '').trim();
			const action = String(button.getAttribute('data-member-action') || '').trim();
			if (action === 'delete-admin') {
				if (!window.confirm('Retirer les droits admin de ce membre ?')) return;
				await updateMemberRole(memberId, 'member');
				return;
			}
			if (action === 'promote-admin') {
				await updateMemberRole(memberId, 'admin');
			}
		});

		document.getElementById('checkout-modal-close')?.addEventListener('click', () => closeModal());
		document.getElementById('checkout-modal-cancel')?.addEventListener('click', () => closeModal());
		document.getElementById('checkout-modal-confirm')?.addEventListener('click', () => {
			const checkoutLink = String(state.pendingCheckout?.checkoutLink || '').trim();
			if (!checkoutLink) {
				notify('Lien de paiement indisponible.', 'error');
				return;
			}
			closeModal();
			window.location.href = checkoutLink;
		});
	};

	const init = async () => {
		try {
			await refreshBillingState();
			const invoiceId = String(query.get('invoiceId') || '').trim();
			if (invoiceId && state.authenticated) {
				await pollCheckoutStatus(invoiceId);
				query.delete('invoiceId');
				const nextQuery = query.toString();
				window.history.replaceState(
					{},
					'',
					`${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`,
				);
			}
		} catch (error) {
			notify(
				error?.payload?.message || error?.message || 'Catalogue de facturation indisponible.',
				'error',
			);
			nodes.planCards.innerHTML =
				'<div class="muted">Impossible de charger la facturation pour le moment.</div>';
			nodes.availableAddons.innerHTML =
				'<div class="muted">Impossible de charger les packs pour le moment.</div>';
		}
	};

	document.addEventListener('DOMContentLoaded', () => {
		bindEvents();
		init();
	});
})();
