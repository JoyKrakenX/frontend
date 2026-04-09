/** @format */

(() => {
	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;
	const notify = (message, type = 'info') => window.SiteUI?.notify?.(message, type);

	const PLAN_DISPLAY_ORDER = ['CREATOR', 'BUSINESS', 'TV_STANDARD', 'TV_PRO', 'ENTERPRISE'];
	const PLAN_QUOTA_KEYS = ['votes', 'chatConcurrent', 'surveys', 'admins', 'exports'];

	const DEFAULT_ENTERPRISE_TEASER = Object.freeze({
		code: 'ENTERPRISE',
		displayName: 'Enterprise',
		priceLabel: 'Sur devis',
		isSelectable: false,
		contactUrl:
			'contact.html' + '?topic=enterprise-sales&source=billing&plan=ENTERPRISE',
	});

	const DEFAULT_COMMERCIAL_RULES = Object.freeze({
		trialDays: 30,
		graceDays: 4,
		annualDiscountRange: Object.freeze({ minPercent: 15, maxPercent: 20 }),
		overage: Object.freeze({
			voteUnitUsd: 0.0007,
			chatTierSize: 500,
			chatTierUsd: 40,
			adminUnitUsd: 8,
		}),
		quotaAlerts: Object.freeze([70, 90, 100]),
	});

	const state = {
		organizations: [],
		activeOrganizationId: null,
		summary: null,
		billingExempt: false,
		members: [],
		pendingMemberActionIds: new Set(),
		addAdminPending: false,
		rawPlans: [],
		plansCatalog: [],
		selectedPlanCode: '',
		plansCurrency: 'USD',
		enterpriseTeaser: { ...DEFAULT_ENTERPRISE_TEASER },
		commercialRules: {
			...DEFAULT_COMMERCIAL_RULES,
			overage: { ...DEFAULT_COMMERCIAL_RULES.overage },
			annualDiscountRange: { ...DEFAULT_COMMERCIAL_RULES.annualDiscountRange },
			quotaAlerts: [...DEFAULT_COMMERCIAL_RULES.quotaAlerts],
		},
		plansLoadFailed: false,
		pendingCheckout: null,
		checkoutPollingInvoiceId: null,
		comparisonDisclosureInitialized: false,
	};

	const escapeHtml = (value) =>
		String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

	const fmtDate = (value) => {
		if (!value) return '-';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '-';
		return date.toLocaleString(window.SiteI18n?.getIntlLocale?.() || 'fr-FR');
	};

	const fmtMoney = (amount, currency = 'USD', digits = 2) => {
		const value = Number(amount || 0);
		return new Intl.NumberFormat(window.SiteI18n?.getIntlLocale?.() || 'fr-FR', {
			style: 'currency',
			currency,
			maximumFractionDigits: digits,
			minimumFractionDigits: digits,
		}).format(value);
	};

	const fmtCount = (value) =>
		new Intl.NumberFormat(window.SiteI18n?.getIntlLocale?.() || 'fr-FR').format(
			Number(value || 0),
		);

	const getCurrencyDigits = (currency) => {
		const normalized = String(currency || '').trim().toUpperCase();
		if (['XOF', 'GNF'].includes(normalized)) return 0;
		return 2;
	};

	const toPositiveNumberOrNull = (value) => {
		if (value === null || value === undefined) return null;
		if (typeof value === 'string' && value.trim() === '') return null;
		const numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric < 0) return null;
		return numeric;
	};

	const normalizePlanCode = (value) => String(value || '').trim().toUpperCase();

	const getCurrentPlanCode = () => normalizePlanCode(state.summary?.subscription?.planCode || '');
	const getSelectedPlanCode = () =>
		normalizePlanCode(state.selectedPlanCode || getCurrentPlanCode());

	const getToken = () =>
		window.SiteApi?.getToken?.() ||
		localStorage.getItem('token') ||
		localStorage.getItem('jwt_token');

	const withAuthHeaders = () => ({
		Authorization: `Bearer ${String(getToken() || '').trim()}`,
		'Content-Type': 'application/json',
	});

	const normalizePlanQuotas = (quotas = {}) => {
		const normalized = {};
		PLAN_QUOTA_KEYS.forEach((key) => {
			normalized[key] = toPositiveNumberOrNull(quotas?.[key]);
		});
		return normalized;
	};

	const normalizePlanEntry = (plan = {}) => {
		const code = normalizePlanCode(plan?.code);
		if (!code) return null;
		const displayName = String(plan?.displayName || code).trim() || code;
		const priceMonthlyUsd = toPositiveNumberOrNull(plan?.priceMonthlyUsd);
		return {
			code,
			displayName,
			priceMonthlyUsd,
			quotas: normalizePlanQuotas(plan?.quotas || {}),
			isSelectable:
				plan?.isSelectable === false ?
					false
				: 	Number.isFinite(priceMonthlyUsd),
			isPublic: plan?.isPublic !== false,
			isEnterprise: false,
			priceLabel: null,
			contactUrl: '',
		};
	};

	const normalizeEnterpriseTeaser = (teaser = {}) => {
		const code = normalizePlanCode(teaser?.code || DEFAULT_ENTERPRISE_TEASER.code);
		return {
			code: code || DEFAULT_ENTERPRISE_TEASER.code,
			displayName:
				String(teaser?.displayName || DEFAULT_ENTERPRISE_TEASER.displayName).trim() ||
				DEFAULT_ENTERPRISE_TEASER.displayName,
			priceLabel:
				String(teaser?.priceLabel || DEFAULT_ENTERPRISE_TEASER.priceLabel).trim() ||
				DEFAULT_ENTERPRISE_TEASER.priceLabel,
			isSelectable: false,
			contactUrl:
				String(teaser?.contactUrl || DEFAULT_ENTERPRISE_TEASER.contactUrl).trim() ||
				DEFAULT_ENTERPRISE_TEASER.contactUrl,
		};
	};

	const normalizeCommercialRules = (rules = {}) => {
		const annualDiscountRange = rules?.annualDiscountRange || {};
		const overage = rules?.overage || {};
		const fallback = DEFAULT_COMMERCIAL_RULES;
		const quotaAlerts = Array.isArray(rules?.quotaAlerts)
			? rules.quotaAlerts
					.map((entry) => Number(entry))
					.filter((entry) => Number.isFinite(entry) && entry >= 0)
			: [];

		return {
			trialDays:
				Number.isFinite(Number(rules?.trialDays)) && Number(rules?.trialDays) > 0 ?
					Number(rules.trialDays)
				: 	fallback.trialDays,
			graceDays:
				Number.isFinite(Number(rules?.graceDays)) && Number(rules?.graceDays) >= 0 ?
					Number(rules.graceDays)
				: 	fallback.graceDays,
			annualDiscountRange: {
				minPercent:
					Number.isFinite(Number(annualDiscountRange?.minPercent)) ?
						Number(annualDiscountRange.minPercent)
					: 	fallback.annualDiscountRange.minPercent,
				maxPercent:
					Number.isFinite(Number(annualDiscountRange?.maxPercent)) ?
						Number(annualDiscountRange.maxPercent)
					: 	fallback.annualDiscountRange.maxPercent,
			},
			overage: {
				voteUnitUsd:
					Number.isFinite(Number(overage?.voteUnitUsd)) ?
						Number(overage.voteUnitUsd)
					: 	fallback.overage.voteUnitUsd,
				chatTierSize:
					Number.isFinite(Number(overage?.chatTierSize)) ?
						Number(overage.chatTierSize)
					: 	fallback.overage.chatTierSize,
				chatTierUsd:
					Number.isFinite(Number(overage?.chatTierUsd)) ?
						Number(overage.chatTierUsd)
					: 	fallback.overage.chatTierUsd,
				adminUnitUsd:
					Number.isFinite(Number(overage?.adminUnitUsd)) ?
						Number(overage.adminUnitUsd)
					: 	fallback.overage.adminUnitUsd,
			},
			quotaAlerts: quotaAlerts.length ? quotaAlerts : [...fallback.quotaAlerts],
		};
	};

	const getPlanByCode = (planCode) => {
		const normalizedCode = normalizePlanCode(planCode);
		if (!normalizedCode) return null;
		return state.plansCatalog.find((plan) => plan.code === normalizedCode) || null;
	};

	const getPlanPriceLabel = (plan = {}) => {
		if (plan?.priceLabel) {
			return String(plan.priceLabel);
		}
		const amount = Number(plan?.priceMonthlyUsd);
		if (!Number.isFinite(amount)) {
			return t('billing.custom_quote', 'Sur devis');
		}
		return `${fmtMoney(amount, state.plansCurrency || 'USD', 2)} / ${t('billing.month', 'mois')}`;
	};

	const getDisplayPlan = (planCode, fallbackName = '') => {
		const normalizedCode = normalizePlanCode(planCode);
		if (!normalizedCode) return null;
		const fromCatalog = getPlanByCode(normalizedCode);
		if (fromCatalog) return fromCatalog;
		return {
			code: normalizedCode,
			displayName: String(fallbackName || normalizedCode).trim() || normalizedCode,
			priceMonthlyUsd: null,
			quotas: normalizePlanQuotas({}),
			isSelectable: false,
			isPublic: true,
			isEnterprise: normalizedCode === normalizePlanCode(state.enterpriseTeaser?.code),
			priceLabel: null,
			contactUrl: '',
		};
	};

	const buildFallbackCurrentPlan = () => {
		const currentCode = getCurrentPlanCode();
		const summaryPlan = state.summary?.plan || {};
		if (!currentCode) return null;
		const normalized = normalizePlanEntry({
			...summaryPlan,
			code: currentCode,
			isPublic: true,
		});
		if (!normalized) return null;
		return {
			...normalized,
			isSelectable: true,
		};
	};

	const sortPlans = (plans = []) => {
		return [...plans].sort((left, right) => {
			const leftIndex = PLAN_DISPLAY_ORDER.indexOf(left.code);
			const rightIndex = PLAN_DISPLAY_ORDER.indexOf(right.code);
			const safeLeftIndex = leftIndex === -1 ? PLAN_DISPLAY_ORDER.length + 1 : leftIndex;
			const safeRightIndex = rightIndex === -1 ? PLAN_DISPLAY_ORDER.length + 1 : rightIndex;
			if (safeLeftIndex !== safeRightIndex) return safeLeftIndex - safeRightIndex;
			return String(left.displayName || left.code).localeCompare(
				String(right.displayName || right.code),
			);
		});
	};

	const syncSelectedPlanCode = () => {
		const currentPlanCode = getCurrentPlanCode();
		const previous = normalizePlanCode(state.selectedPlanCode);
		const selectableCodes = state.plansCatalog
			.filter((plan) => plan.isSelectable)
			.map((plan) => plan.code);

		if (previous && selectableCodes.includes(previous)) {
			state.selectedPlanCode = previous;
			return;
		}
		if (currentPlanCode && selectableCodes.includes(currentPlanCode)) {
			state.selectedPlanCode = currentPlanCode;
			return;
		}
		state.selectedPlanCode = selectableCodes[0] || currentPlanCode || '';
	};

	const buildPlansCatalog = () => {
		const currentPlanCode = getCurrentPlanCode();
		const summaryPlan = state.summary?.plan || {};
		const indexed = new Map();

		(Array.isArray(state.rawPlans) ? state.rawPlans : []).forEach((entry) => {
			const normalized = normalizePlanEntry(entry);
			if (!normalized) return;
			indexed.set(normalized.code, normalized);
		});

		if (currentPlanCode && !indexed.has(currentPlanCode)) {
			const currentFallback = normalizePlanEntry({
				...summaryPlan,
				code: currentPlanCode,
				isPublic: true,
			});
			if (currentFallback) {
				indexed.set(currentPlanCode, {
					...currentFallback,
					isSelectable: true,
				});
			}
		}

		if (state.plansLoadFailed && indexed.size === 0) {
			const fallbackCurrent = buildFallbackCurrentPlan();
			state.plansCatalog = fallbackCurrent ? [fallbackCurrent] : [];
			syncSelectedPlanCode();
			return;
		}

		const enterpriseCode = normalizePlanCode(state.enterpriseTeaser?.code || 'ENTERPRISE');
		const enterpriseExisting = indexed.get(enterpriseCode);
		indexed.set(enterpriseCode, {
			...(enterpriseExisting || normalizePlanEntry({ code: enterpriseCode, displayName: enterpriseCode })),
			code: enterpriseCode,
			displayName:
				String(state.enterpriseTeaser?.displayName || enterpriseExisting?.displayName || 'Enterprise').trim() ||
				'Enterprise',
			priceMonthlyUsd: null,
			quotas: normalizePlanQuotas(enterpriseExisting?.quotas || {}),
			isSelectable: false,
			isPublic: true,
			isEnterprise: true,
			priceLabel: String(state.enterpriseTeaser?.priceLabel || t('billing.custom_quote', 'Sur devis')),
			contactUrl: String(state.enterpriseTeaser?.contactUrl || DEFAULT_ENTERPRISE_TEASER.contactUrl),
		});

		state.plansCatalog = sortPlans(Array.from(indexed.values())).map((plan) => {
			const isEnterprise = Boolean(plan.isEnterprise || plan.code === enterpriseCode);
			const hasPrice = Number.isFinite(Number(plan.priceMonthlyUsd));
			const isSelectable = isEnterprise ? false : Boolean(plan.isSelectable && hasPrice);
			return {
				...plan,
				isEnterprise,
				isSelectable,
			};
		});
		syncSelectedPlanCode();
	};

	const statusNode = document.getElementById('subscription-status');
	const planNameNode = document.getElementById('plan-name');
	const nextBillingNode = document.getElementById('next-billing');
	const trialEndsNode = document.getElementById('trial-ends');
	const graceEndsNode = document.getElementById('grace-ends');
	const paymentMethodNode = document.getElementById('payment-method');
	const providerNameNode = document.getElementById('provider-name');
	const usagePeriodNode = document.getElementById('usage-period');
	const usageListNode = document.getElementById('usage-list');
	const overageListNode = document.getElementById('overage-list');
	const conversionPreviewNode = document.getElementById('conversion-preview');
	const checkoutStatusNoteNode = document.getElementById('checkout-status-note');
	const invoicesBodyNode = document.getElementById('invoices-body');
	const billingExemptBannerNode = document.getElementById('billing-exempt-banner');
	const membersBodyNode = document.getElementById('members-body');
	const adminManagementPanelNode = document.getElementById('admin-management-panel');
	const addAdminFormNode = document.getElementById('add-admin-form');
	const addAdminEmailNode = document.getElementById('add-admin-email');
	const addAdminButtonNode = document.getElementById('btn-add-admin');
	const adminManagementFeedbackNode = document.getElementById('admin-management-feedback');
	const orgSelectorNode = document.getElementById('org-selector');
	const planCardsNode = document.getElementById('plan-cards');
	const planOffersStatusNode = document.getElementById('plan-offers-status');
	const planSelectionSummaryNode = document.getElementById('plan-selection-summary');
	const planComparisonTableNode = document.getElementById('plan-comparison-table');
	const planComparisonDetailsNode = document.getElementById('plan-comparison-details');
	const billingRulesNode = document.getElementById('billing-rules');
	const checkoutButtonNode = document.getElementById('btn-checkout');
	const retryButtonNode = document.getElementById('btn-retry');
	const checkoutButtonLabelNode = checkoutButtonNode?.querySelector('span') || null;

	const checkoutModalNode = document.getElementById('checkout-confirm-modal');
	const checkoutConfirmIntroNode = document.getElementById('checkout-confirm-intro');
	const confirmAmountUsdNode = document.getElementById('confirm-amount-usd');
	const confirmChargeAmountNode = document.getElementById('confirm-charge-amount');
	const confirmFxRateNode = document.getElementById('confirm-fx-rate');
	const confirmFxValidityNode = document.getElementById('confirm-fx-validity');

	const setLoadingUsage = () => {
		usageListNode.innerHTML = `<div class="muted">${t('billing.loading', 'Chargement...')}</div>`;
		overageListNode.innerHTML = `<div class="muted">${t('billing.loading', 'Chargement...')}</div>`;
		conversionPreviewNode.innerHTML = `<div class="muted">${t('billing.loading', 'Chargement...')}</div>`;
	};

	const setLoadingPlanOffers = () => {
		if (planCardsNode) {
			planCardsNode.innerHTML = `<div class="muted">${t('billing.loading', 'Chargement...')}</div>`;
		}
		if (planComparisonTableNode) {
			planComparisonTableNode.innerHTML = `<div class="muted">${t('billing.loading', 'Chargement...')}</div>`;
		}
		if (billingRulesNode) {
			billingRulesNode.innerHTML = `<div class="muted">${t('billing.loading', 'Chargement...')}</div>`;
		}
		if (planSelectionSummaryNode) {
			planSelectionSummaryNode.textContent = '';
		}
	};

	const setBillingExemptMode = (isExempt = false) => {
		state.billingExempt = Boolean(isExempt);
		if (document.body) {
			document.body.dataset.billingExempt = state.billingExempt ? 'true' : 'false';
		}
		if (billingExemptBannerNode) {
			billingExemptBannerNode.classList.toggle('hidden', !state.billingExempt);
		}
		if (state.billingExempt) {
			if (checkoutButtonNode) checkoutButtonNode.disabled = true;
			if (retryButtonNode) retryButtonNode.disabled = true;
		}
	};

	const getActiveOrganizationId = () =>
		String(state.summary?.organization?._id || state.activeOrganizationId || '').trim();

	const getActiveOrganizationEntry = () => {
		const activeOrganizationId = getActiveOrganizationId();
		if (!activeOrganizationId) return null;
		return (
			(Array.isArray(state.organizations) ? state.organizations : []).find(
				(entry) =>
					String(entry?.organization?._id || '').trim() === activeOrganizationId,
			) || null
		);
	};

	const canManageActiveOrganizationMembers = () => {
		const entry = getActiveOrganizationEntry();
		if (!entry) return false;
		const role = String(entry.role || '').trim().toLowerCase();
		return role === 'owner' || role === 'admin';
	};

	const setAdminManagementFeedback = (message = '', level = 'info') => {
		if (!adminManagementFeedbackNode) return;
		adminManagementFeedbackNode.textContent = String(message || '').trim();
		adminManagementFeedbackNode.dataset.level = level;
	};

	const renderAdminManagementState = () => {
		const hasActiveOrganization = Boolean(getActiveOrganizationId());
		const canManageMembers = canManageActiveOrganizationMembers();
		const controlsDisabled =
			!hasActiveOrganization || !canManageMembers || state.addAdminPending;

		if (adminManagementPanelNode) {
			adminManagementPanelNode.classList.toggle(
				'is-readonly',
				!hasActiveOrganization || !canManageMembers,
			);
		}

		if (addAdminFormNode) {
			addAdminFormNode.classList.toggle('is-pending', Boolean(state.addAdminPending));
			addAdminFormNode.setAttribute('aria-disabled', controlsDisabled ? 'true' : 'false');
		}
		if (addAdminEmailNode) {
			addAdminEmailNode.disabled = controlsDisabled;
		}
		if (addAdminButtonNode) {
			addAdminButtonNode.disabled = controlsDisabled;
		}
	};

	const getMemberById = (memberId) => {
		const normalizedMemberId = String(memberId || '').trim();
		if (!normalizedMemberId) return null;
		return (
			(Array.isArray(state.members) ? state.members : []).find(
				(member) => String(member?._id || '').trim() === normalizedMemberId,
			) || null
		);
	};

	const isMemberActionPending = (memberId) =>
		state.pendingMemberActionIds.has(String(memberId || '').trim());

	const setMemberActionPending = (memberId, isPending) => {
		const normalizedMemberId = String(memberId || '').trim();
		if (!normalizedMemberId) return;
		if (isPending) {
			state.pendingMemberActionIds.add(normalizedMemberId);
		} else {
			state.pendingMemberActionIds.delete(normalizedMemberId);
		}
		renderMembers(state.members);
	};

	const setAddAdminPending = (isPending) => {
		state.addAdminPending = Boolean(isPending);
		renderAdminManagementState();
		renderMembers(state.members);
	};

	const renderUsage = (usagePayload = {}) => {
		const metrics = Array.isArray(usagePayload.metrics) ? usagePayload.metrics : [];
		if (!metrics.length) {
			usageListNode.innerHTML = `<div class="muted">${t('billing.no_usage', 'Aucune consommation disponible.')}</div>`;
			return;
		}

		usageListNode.innerHTML = metrics
			.map((item) => {
				const quotaText =
					item.quota === null ? t('billing.unlimited', 'Illimites') : fmtCount(item.quota);
				const percent = item.percent === null ? 0 : item.percent;
				const alertClass = item.alertLevel ? `alert-${item.alertLevel}` : '';
				const alertText =
					item.alertLevel === 100
						? t('billing.alert_100', 'Quota atteint. Mettez a niveau votre plan.')
						: item.alertLevel === 90
							? t('billing.alert_90', 'Vous approchez de la limite de quota.')
							: item.alertLevel === 70
								? t('billing.alert_70', 'Consommation elevee detectee.')
								: '';
				return `
					<div class="usage-item ${alertClass}">
						<div class="usage-top">
							<strong>${escapeHtml(item.label)}</strong>
							<span>${fmtCount(item.consumed)} / ${quotaText}</span>
						</div>
						<div class="progress"><span style="width:${percent}%"></span></div>
						${alertText ? `<div class="muted">${escapeHtml(alertText)}</div>` : ''}
					</div>
				`;
			})
			.join('');
	};

	const renderOverageEstimate = (overageEstimate = {}) => {
		const votesUsd = Number(overageEstimate?.votesUsd || 0);
		const chatUsd = Number(overageEstimate?.chatUsd || 0);
		const adminsUsd = Number(overageEstimate?.adminsUsd || 0);
		const totalUsd = Number(overageEstimate?.totalUsd || 0);

		overageListNode.innerHTML = `
			<div class="overage-line"><span>${t('billing.overage_votes', 'Votes')}</span><span>${fmtMoney(votesUsd)}</span></div>
			<div class="overage-line"><span>${t('billing.overage_chat', 'Simultane chatroom')}</span><span>${fmtMoney(chatUsd)}</span></div>
			<div class="overage-line"><span>${t('billing.overage_admins', 'Admins')}</span><span>${fmtMoney(adminsUsd)}</span></div>
			<div class="overage-line overage-total"><span>${t('billing.overage_total', 'Total overage')}</span><span>${fmtMoney(totalUsd)}</span></div>
		`;
	};

	const renderBillingQuotePreview = (summary = {}) => {
		const quote = summary?.billingQuotePreview || {};
		const amountUsd = Number(quote?.amountUsd || 0);
		const paymentCurrency = String(
			quote?.paymentCurrency || summary?.organization?.paymentCurrency || 'XOF',
		)
			.trim()
			.toUpperCase();
		const chargeAmount = Number(quote?.chargeAmount || 0);
		const rate = Number(quote?.rate || 0);
		const source = String(quote?.source || 'OXR').trim();
		const asOf = quote?.asOf || null;

		if (!quote?.available) {
			conversionPreviewNode.innerHTML = `<div class="muted">${t('billing.fx_unavailable', 'Conversion indisponible temporairement. Reessayez dans quelques instants.')}</div>`;
			return;
		}

		conversionPreviewNode.innerHTML = `
			<div class="conversion-line"><span>${t('billing.amount_usd', 'Montant (USD)')}</span><span>${fmtMoney(amountUsd, 'USD', 2)}</span></div>
			<div class="conversion-line"><span>${t('billing.charge_amount', 'Montant debite')}</span><span>${fmtMoney(chargeAmount, paymentCurrency, getCurrencyDigits(paymentCurrency))}</span></div>
			<div class="conversion-line"><span>${t('billing.fx_rate', 'Taux applique')}</span><span>1 USD = ${Number.isFinite(rate) ? rate : '-'} ${escapeHtml(paymentCurrency)}</span></div>
			<div class="conversion-line"><span>${t('billing.fx_source', 'Source')}</span><span>${escapeHtml(source)}</span></div>
			<div class="conversion-line conversion-total"><span>${t('billing.fx_as_of', 'Horodatage taux')}</span><span>${fmtDate(asOf)}</span></div>
		`;
	};

	const renderInvoices = (invoices = []) => {
		if (!Array.isArray(invoices) || !invoices.length) {
			invoicesBodyNode.innerHTML = `<tr><td colspan="4" class="text-center muted">${t('billing.no_invoices', 'Aucune facture pour le moment.')}</td></tr>`;
			return;
		}
		invoicesBodyNode.innerHTML = invoices
			.map((invoice) => {
				const chargeCurrency = invoice?.charge?.currency || invoice?.fx?.quoteCurrency || 'XOF';
				const chargeDigits = getCurrencyDigits(chargeCurrency);
				const chargeLabel = Number.isFinite(Number(invoice?.charge?.amount))
					? `${fmtMoney(invoice.charge.amount, chargeCurrency, chargeDigits)} (${fmtMoney(invoice.totalAmountUsd, 'USD', 2)})`
					: fmtMoney(invoice.totalAmountUsd, 'USD', 2);
				return `
					<tr>
						<td>${fmtDate(invoice.createdAt)}</td>
						<td>${escapeHtml(String(invoice.status || '-'))}</td>
						<td>${chargeLabel}</td>
						<td>${escapeHtml(invoice.periodKey || '-')}</td>
					</tr>
				`;
			})
			.join('');
	};

	const renderMembers = (members = []) => {
		if (!membersBodyNode) return;
		state.members = Array.isArray(members) ? members : [];
		const canManageMembers = canManageActiveOrganizationMembers();
		renderAdminManagementState();

		if (!state.members.length) {
			membersBodyNode.innerHTML = `<tr><td colspan="4" class="text-center muted">${t('billing.no_members', 'Aucun membre.')}</td></tr>`;
			return;
		}
		membersBodyNode.innerHTML = state.members
			.map((member) => {
				const user = member.user || {};
				const memberId = String(member?._id || '').trim();
				const normalizedRole = String(member?.role || '').trim().toLowerCase();
				const isOwner = normalizedRole === 'owner';
				const isAdmin = normalizedRole === 'admin';
				const isPending = memberId ? isMemberActionPending(memberId) : false;
				const controlsDisabled = isPending || state.addAdminPending;
				const roleLabel =
					isOwner ?
						t('billing.member_role_owner', 'Proprietaire')
					: isAdmin ?
						t('billing.member_role_admin', 'Admin')
					:	t('billing.member_role_member', 'Membre');

				let actionsHtml = `<span class="member-action-lock">${escapeHtml(t('billing.member_action_locked', 'Aucune action'))}</span>`;
				if (canManageMembers && memberId) {
					if (isOwner) {
						actionsHtml = `<span class="member-action-lock">${escapeHtml(t('billing.member_owner_locked', 'Proprietaire protege'))}</span>`;
					} else if (isAdmin) {
						actionsHtml = `
							<button
								type="button"
								class="btn-danger btn-member-action"
								data-member-action="delete-admin"
								data-member-id="${escapeHtml(memberId)}"
								${controlsDisabled ? 'disabled' : ''}
							>
								${escapeHtml(
									isPending ?
										t('billing.member_action_pending', 'Traitement...')
									:	t('billing.delete_admin', 'Supprimer admin'),
								)}
							</button>
						`;
					} else {
						actionsHtml = `
							<button
								type="button"
								class="btn-secondary btn-member-action"
								data-member-action="promote-admin"
								data-member-id="${escapeHtml(memberId)}"
								${controlsDisabled ? 'disabled' : ''}
							>
								${escapeHtml(
									isPending ?
										t('billing.member_action_pending', 'Traitement...')
									:	t('billing.promote_admin', 'Promouvoir admin'),
								)}
							</button>
						`;
					}
				}

				return `
					<tr>
						<td>${escapeHtml(user.pseudo || user.name || '-')}</td>
						<td>${escapeHtml(user.email || '-')}</td>
						<td><span class="member-role-badge role-${escapeHtml(normalizedRole || 'member')}">${escapeHtml(roleLabel)}</span></td>
						<td class="member-actions-cell">${actionsHtml}</td>
					</tr>
				`;
			})
			.join('');
	};

	const renderOrganizationSelector = () => {
		if (!orgSelectorNode) return;
		const organizations = Array.isArray(state.organizations) ? state.organizations : [];
		if (!organizations.length) {
			orgSelectorNode.innerHTML = '<option value="">-</option>';
			orgSelectorNode.disabled = true;
			return;
		}

		orgSelectorNode.disabled = false;
		orgSelectorNode.innerHTML = organizations
			.map((entry) => {
				const org = entry.organization || {};
				const selected = String(org._id || '') === String(state.activeOrganizationId || '');
				const roleSuffix = ` (${entry.role || '-'})`;
				return `<option value="${escapeHtml(String(org._id || ''))}" ${selected ? 'selected' : ''}>${escapeHtml(String(org.name || 'Organisation'))}${escapeHtml(roleSuffix)}</option>`;
			})
			.join('');
	};

	const getQuotaDisplayValue = (value, isEnterprise = false) => {
		if (value === null) {
			return isEnterprise
				? t('billing.enterprise_custom_limit', 'Sur mesure')
				: t('billing.unlimited', 'Illimites');
		}
		return fmtCount(value);
	};

	const setPlanOffersStatus = (message = '') => {
		if (!planOffersStatusNode) return;
		planOffersStatusNode.textContent = String(message || '').trim();
	};

	const isTrialingSubscription = () =>
		String(state.summary?.subscription?.status || '').trim().toLowerCase() === 'trialing';

	const renderCheckoutIntent = () => {
		if (!checkoutButtonNode || !checkoutButtonLabelNode) return;
		if (state.billingExempt) {
			checkoutButtonNode.disabled = true;
			checkoutButtonLabelNode.textContent = t(
				'billing.exempt_checkout_locked',
				'Exemption active',
			);
			if (retryButtonNode) retryButtonNode.disabled = true;
			setPlanOffersStatus('');
			return;
		}
		const selectedPlan = getPlanByCode(getSelectedPlanCode());
		const currentPlanCode = getCurrentPlanCode();
		const selectedPlanCode = selectedPlan?.code || '';
		const isUpgrade = Boolean(selectedPlanCode && currentPlanCode && selectedPlanCode !== currentPlanCode);
		const selectedLabel = selectedPlan?.displayName || selectedPlanCode;
		const trialingLockedMessage = t(
			'billing.trialing_checkout_locked',
			"Essai gratuit en cours: la facturation est verrouillee jusqu'a la fin de l'essai.",
		);

		if (isTrialingSubscription()) {
			checkoutButtonNode.disabled = true;
			checkoutButtonLabelNode.textContent = t('billing.pay_now', 'Payer maintenant');
			if (retryButtonNode) retryButtonNode.disabled = true;
			setPlanOffersStatus(trialingLockedMessage);
			return;
		}

		if (retryButtonNode) retryButtonNode.disabled = false;
		if (state.plansLoadFailed) {
			setPlanOffersStatus(
				t(
					'billing.plan_catalog_degraded',
					'Catalogue plans indisponible: affichage limite au plan actuel.',
				),
			);
		} else {
			setPlanOffersStatus('');
		}

		if (!selectedPlan || !selectedPlan.isSelectable) {
			checkoutButtonNode.disabled = true;
			checkoutButtonLabelNode.textContent = t('billing.pay_now', 'Payer maintenant');
			return;
		}

		checkoutButtonNode.disabled = false;
		checkoutButtonLabelNode.textContent = isUpgrade
			? t('billing.pay_now_upgrade', `Changer vers ${selectedLabel}`, { plan: selectedLabel })
			: t('billing.pay_now_renewal', 'Renouveler maintenant');
	};

	const renderPlanCards = () => {
		if (!planCardsNode) return;
		const currentPlanCode = getCurrentPlanCode();
		const selectedPlanCode = getSelectedPlanCode();
		if (!state.plansCatalog.length) {
			planCardsNode.innerHTML = `<div class="muted">${t('billing.plan_cards_unavailable', 'Catalogue de plans indisponible pour le moment.')}</div>`;
			return;
		}

		planCardsNode.innerHTML = state.plansCatalog
			.map((plan) => {
				const isCurrent = plan.code === currentPlanCode;
				const isSelected = plan.code === selectedPlanCode;
				const isRecommended = plan.code === 'TV_STANDARD';
				const selectableAttrs = plan.isSelectable
					? `role="radio" aria-checked="${isSelected ? 'true' : 'false'}" tabindex="0" data-plan-selectable="true"`
					: `aria-disabled="true" data-plan-selectable="false"`;
				const cardClass = [
					'plan-card',
					plan.isSelectable ? 'plan-card-selectable' : 'plan-card-disabled',
					isSelected ? 'plan-card-selected' : '',
				]
					.filter(Boolean)
					.join(' ');

				const badges = [
					isCurrent
						? `<span class="plan-badge plan-badge-current">${escapeHtml(t('billing.plan_badge_current', 'Plan actuel'))}</span>`
						: '',
					isSelected
						? `<span class="plan-badge plan-badge-selected">${escapeHtml(t('billing.plan_badge_selected', 'Selectionne'))}</span>`
						: '',
					isRecommended
						? `<span class="plan-badge plan-badge-recommended">${escapeHtml(t('billing.plan_badge_recommended', 'Recommande'))}</span>`
						: '',
				]
					.filter(Boolean)
					.join('');

				const quotas = [
					{ key: 'votes', label: t('billing.comparison_votes_monthly', 'Votes / mois') },
					{ key: 'chatConcurrent', label: t('billing.comparison_chat_concurrent', 'Simultane / chatroom') },
					{ key: 'surveys', label: t('billing.comparison_surveys_monthly', 'Sondages / mois') },
					{ key: 'admins', label: t('billing.comparison_admins', 'Admins') },
					{ key: 'exports', label: t('billing.comparison_exports', 'Exports') },
				]
					.map((entry) => {
						const value = getQuotaDisplayValue(plan.quotas?.[entry.key] ?? null, plan.isEnterprise);
						return `<li><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(value)}</strong></li>`;
					})
					.join('');

				const overageNote = plan.isEnterprise
					? ''
					: `<a class="plan-overage-link" href="#billing-rules">${escapeHtml(t('billing.plan_overage_note', 'Overage: voir conditions commerciales'))}</a>`;

				const enterpriseCta =
					plan.isEnterprise && plan.contactUrl
						? `<a class="enterprise-contact-btn btn-secondary" href="${escapeHtml(plan.contactUrl)}">${escapeHtml(t('billing.contact_enterprise', "Contacter l'equipe"))}</a>`
						: '';

				return `
					<article class="${cardClass}" data-plan-code="${escapeHtml(plan.code)}" ${selectableAttrs}>
						<div class="plan-card-head">
							<h4>${escapeHtml(plan.displayName)}</h4>
							<div class="plan-badges">${badges}</div>
						</div>
						<div class="plan-price">${escapeHtml(getPlanPriceLabel(plan))}</div>
						<ul class="plan-quotas-list">${quotas}</ul>
						${overageNote ? `<div class="plan-overage-note">${overageNote}</div>` : ''}
						${enterpriseCta}
					</article>
				`;
			})
			.join('');
	};

	const renderPlanComparison = () => {
		if (!planComparisonTableNode) return;
		if (!state.plansCatalog.length) {
			planComparisonTableNode.innerHTML = `<div class="muted">${t('billing.plan_cards_unavailable', 'Catalogue de plans indisponible pour le moment.')}</div>`;
			return;
		}

		const rows = [
			{
				label: t('billing.comparison_price_monthly', 'Prix / mois'),
				getValue: (plan) => getPlanPriceLabel(plan),
			},
			{
				label: t('billing.comparison_votes_monthly', 'Votes / mois'),
				getValue: (plan) => getQuotaDisplayValue(plan.quotas?.votes ?? null, plan.isEnterprise),
			},
			{
				label: t('billing.comparison_chat_concurrent', 'Simultane / chatroom'),
				getValue: (plan) =>
					getQuotaDisplayValue(plan.quotas?.chatConcurrent ?? null, plan.isEnterprise),
			},
			{
				label: t('billing.comparison_surveys_monthly', 'Sondages / mois'),
				getValue: (plan) => getQuotaDisplayValue(plan.quotas?.surveys ?? null, plan.isEnterprise),
			},
			{
				label: t('billing.comparison_admins', 'Admins'),
				getValue: (plan) => getQuotaDisplayValue(plan.quotas?.admins ?? null, plan.isEnterprise),
			},
			{
				label: t('billing.comparison_exports', 'Exports'),
				getValue: (plan) => getQuotaDisplayValue(plan.quotas?.exports ?? null, plan.isEnterprise),
			},
		];

		const thead = `
			<thead>
				<tr>
					<th>${escapeHtml(t('billing.comparison_feature', 'Caracteristique'))}</th>
					${state.plansCatalog.map((plan) => `<th>${escapeHtml(plan.displayName)}</th>`).join('')}
				</tr>
			</thead>
		`;

		const tbody = `
			<tbody>
				${rows
					.map((row) => {
						const values = state.plansCatalog
							.map((plan) => `<td>${escapeHtml(row.getValue(plan))}</td>`)
							.join('');
						return `<tr><th scope="row">${escapeHtml(row.label)}</th>${values}</tr>`;
					})
					.join('')}
			</tbody>
		`;

		planComparisonTableNode.innerHTML = `<table class="plan-comparison-table">${thead}${tbody}</table>`;
	};

	const renderCommercialRules = () => {
		if (!billingRulesNode) return;
		const rules = state.commercialRules || DEFAULT_COMMERCIAL_RULES;
		const annualMin = Number(rules?.annualDiscountRange?.minPercent || 15);
		const annualMax = Number(rules?.annualDiscountRange?.maxPercent || 20);
		const alerts =
			Array.isArray(rules?.quotaAlerts) && rules.quotaAlerts.length ?
				rules.quotaAlerts.map((entry) => `${Number(entry)}%`).join(', ')
			: 	'70%, 90%, 100%';

		billingRulesNode.innerHTML = `
			<h4>${escapeHtml(t('billing.commercial_rules_title', 'Conditions commerciales'))}</h4>
			<p class="muted">${escapeHtml(t('billing.commercial_rules_subtitle', 'Informations issues de la grille tarifaire Community.'))}</p>
			<div class="rules-grid">
				<div class="rule-item"><strong>${escapeHtml(t('billing.rule_trial', 'Essai gratuit'))}</strong><span>${escapeHtml(`${Number(rules?.trialDays || 30)} ${t('billing.days', 'jours')}`)}</span></div>
				<div class="rule-item"><strong>${escapeHtml(t('billing.rule_grace', 'Periode de grace'))}</strong><span>${escapeHtml(`${Number(rules?.graceDays || 4)} ${t('billing.days', 'jours')}`)}</span></div>
				<div class="rule-item"><strong>${escapeHtml(t('billing.rule_annual', 'Paiement annuel'))}</strong><span>${escapeHtml(`-${annualMin}% a -${annualMax}%`)}</span></div>
				<div class="rule-item"><strong>${escapeHtml(t('billing.rule_quota_alerts', 'Alertes quota'))}</strong><span>${escapeHtml(alerts)}</span></div>
			</div>
			<ul class="rules-overage-list">
				<li>${escapeHtml(t('billing.rule_overage_votes', `+$${Number(rules?.overage?.voteUnitUsd || 0.0007)} / vote`))}</li>
				<li>${escapeHtml(t('billing.rule_overage_chat', `+$${Number(rules?.overage?.chatTierUsd || 40)} par palier de +${Number(rules?.overage?.chatTierSize || 500)} simultanes chatroom`))}</li>
				<li>${escapeHtml(t('billing.rule_overage_admins', `+$${Number(rules?.overage?.adminUnitUsd || 8)} / admin / mois`))}</li>
			</ul>
		`;
	};

	const renderPlanSelectionSummary = () => {
		if (!planSelectionSummaryNode) return;
		const currentPlanCode = getCurrentPlanCode();
		const selectedPlanCode = getSelectedPlanCode();
		const currentPlan = getDisplayPlan(currentPlanCode, state.summary?.plan?.displayName || currentPlanCode);
		const selectedPlan = getDisplayPlan(selectedPlanCode, selectedPlanCode);

		if (isTrialingSubscription()) {
			planSelectionSummaryNode.textContent = t(
				'billing.trialing_checkout_locked',
				"Essai gratuit en cours: la facturation est verrouillee jusqu'a la fin de l'essai.",
			);
			renderCheckoutIntent();
			return;
		}

		if (!selectedPlan) {
			planSelectionSummaryNode.textContent = t(
				'billing.selection_summary_unavailable',
				'Selection de plan indisponible pour le moment.',
			);
			renderCheckoutIntent();
			return;
		}

		if (!selectedPlan.isSelectable) {
			planSelectionSummaryNode.textContent = t(
				'billing.selection_summary_enterprise',
				"Ce plan n'est pas disponible en self-service. Utilisez le contact commercial.",
			);
			renderCheckoutIntent();
			return;
		}

		if (currentPlanCode && selectedPlanCode && currentPlanCode !== selectedPlanCode) {
			planSelectionSummaryNode.textContent = t(
				'billing.selection_summary_upgrade',
				`Vous allez changer vers ${selectedPlan.displayName}.`,
				{ plan: selectedPlan.displayName },
			);
			renderCheckoutIntent();
			return;
		}

		planSelectionSummaryNode.textContent = t(
			'billing.selection_summary_renewal',
			`Vous allez renouveler ${currentPlan?.displayName || selectedPlan.displayName}.`,
			{ plan: currentPlan?.displayName || selectedPlan.displayName },
		);
		renderCheckoutIntent();
	};

	const syncComparisonDisclosure = () => {
		if (!planComparisonDetailsNode || state.comparisonDisclosureInitialized) return;
		planComparisonDetailsNode.open = window.innerWidth >= 860;
		state.comparisonDisclosureInitialized = true;
	};

	const renderPlanOffers = () => {
		buildPlansCatalog();
		renderPlanCards();
		renderPlanComparison();
		renderCommercialRules();
		renderPlanSelectionSummary();
		syncComparisonDisclosure();
	};

	const getPaymentMethodLabel = (subscription = {}) => {
		const instrument = subscription.paymentInstrument || {};
		if (!instrument?.canAutoCharge) {
			return t('billing.payment_method_inactive', 'Renouvellement manuel via checkout securise');
		}
		const type = String(instrument.paymentMethodType || 'card').toUpperCase();
		const last4 = instrument.last4 ? ` ****${instrument.last4}` : '';
		return `${type}${last4}`.trim();
	};

	const openCheckoutModal = () => {
		if (!checkoutModalNode) return;
		if (window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(checkoutModalNode);
		} else {
			checkoutModalNode.classList.remove('hidden');
			checkoutModalNode.setAttribute('aria-hidden', 'false');
		}
	};

	const closeCheckoutModal = () => {
		if (!checkoutModalNode) return;
		if (window.SiteModalSheet?.close) {
			window.SiteModalSheet.close(checkoutModalNode);
		} else {
			checkoutModalNode.classList.add('hidden');
			checkoutModalNode.setAttribute('aria-hidden', 'true');
		}
	};

	const setCheckoutModalPayload = (payload = {}) => {
		state.pendingCheckout = payload;
		const chargeCurrency = String(payload.chargeCurrency || 'XOF').trim().toUpperCase();
		const chargeDigits = getCurrencyDigits(chargeCurrency);
		confirmAmountUsdNode.textContent = fmtMoney(payload.amountUsd, 'USD', 2);
		confirmChargeAmountNode.textContent = fmtMoney(payload.chargeAmount, chargeCurrency, chargeDigits);
		confirmFxRateNode.textContent =
			Number.isFinite(Number(payload.fxRate))
				? `1 USD = ${Number(payload.fxRate)} ${chargeCurrency}`
				: '-';
		confirmFxValidityNode.textContent = `${fmtDate(payload.fxLockedAt)} -> ${fmtDate(payload.fxLockExpiresAt)}`;
		if (!checkoutConfirmIntroNode) return;
		if (String(payload.mode || '').toLowerCase() === 'upgrade' && payload.targetPlanCode) {
			const normalizedTargetCode = normalizePlanCode(payload.targetPlanCode);
			const targetPlan = getPlanByCode(normalizedTargetCode);
			const targetLabel = targetPlan?.displayName || normalizedTargetCode;
			checkoutConfirmIntroNode.textContent = t(
				'billing.confirm_modal_intro_upgrade',
				`Vous allez changer d'abonnement vers ${targetLabel}. Verifiez les details avant de continuer vers FedaPay.`,
				{ plan: targetLabel },
			);
			return;
		}
		checkoutConfirmIntroNode.textContent = t(
			'billing.confirm_modal_intro',
			'Veuillez verifier les details avant de continuer vers FedaPay.',
		);
	};

	const renderSummary = (summary = {}) => {
		const sub = summary.subscription || {};
		const plan = summary.plan || {};
		state.summary = summary;
		state.activeOrganizationId = summary?.organization?._id || state.activeOrganizationId;
		setBillingExemptMode(Boolean(summary?.entitlement?.billingExempt));

		statusNode.textContent = String(sub.status || '-');
		statusNode.className = `badge-status status-${String(sub.status || '').toLowerCase()}`;
		planNameNode.textContent = plan.displayName || plan.code || '-';
		nextBillingNode.textContent = fmtDate(sub.nextBillingAt || sub.currentPeriodEndAt);
		trialEndsNode.textContent = fmtDate(sub.trialEndsAt);
		graceEndsNode.textContent = fmtDate(sub.graceEndsAt);
		paymentMethodNode.textContent = getPaymentMethodLabel(sub);
		providerNameNode.textContent = 'FedaPay';
		usagePeriodNode.textContent = summary.usage?.periodKey || '-';
		renderUsage(summary.usage || {});
		renderOverageEstimate(summary.overageEstimate || {});
		renderBillingQuotePreview(summary);
		renderOrganizationSelector();
		renderAdminManagementState();
		renderPlanOffers();
	};

	const setCheckoutStatusNote = (message = '', level = 'info') => {
		if (!checkoutStatusNoteNode) return;
		checkoutStatusNoteNode.textContent = message;
		checkoutStatusNoteNode.dataset.level = level;
	};

	const resolveBillingApiErrorMessage = (payload = {}, fallback = '') => {
		const code = String(payload?.code || '').trim().toUpperCase();
		const details =
			payload?.details && typeof payload.details === 'object' && !Array.isArray(payload.details)
				? payload.details
				: {};

		if (code === 'BILLING_TRIALING_LOCKED') {
			const trialEndsAt = details?.trialEndsAt || state.summary?.subscription?.trialEndsAt || null;
			const trialEndsLabel = fmtDate(trialEndsAt);
			if (trialEndsAt && trialEndsLabel !== '-') {
				return t(
					'billing.error_trialing_locked_until',
					'Essai gratuit en cours. Paiement disponible apres le {date}.',
					{ date: trialEndsLabel },
				);
			}
			return t(
				'billing.trialing_checkout_locked',
				"Essai gratuit en cours: la facturation est verrouillee jusqu'a la fin de l'essai.",
			);
		}

		if (code === 'BILLING_PROVIDER_AMOUNT_CAP') {
			const providerMaxAmount = Number(details?.providerMaxAmount || 0);
			const currency = String(details?.currency || 'XOF').trim().toUpperCase() || 'XOF';
			if (Number.isFinite(providerMaxAmount) && providerMaxAmount > 0) {
				return t(
					'billing.error_provider_amount_cap_with_limit',
					'Montant trop eleve: plafond fournisseur {max} {currency}.',
					{
						max: fmtCount(providerMaxAmount),
						currency,
					},
				);
			}
			return t(
				'billing.error_provider_amount_cap',
				'Montant trop eleve pour le plafond fournisseur. Contactez le support commercial.',
			);
		}

		if (code === 'BILLING_PROVIDER_UNAVAILABLE') {
			return t(
				'billing.error_provider_unavailable',
				'Service de paiement indisponible. Reessayez plus tard.',
			);
		}

		if (code === 'BILLING_CHECKOUT_INIT_FAILED') {
			return t(
				'billing.error_checkout_init_failed',
				"Impossible d'initialiser le paiement. Reessayez.",
			);
		}

		return String(payload?.message || fallback || '').trim() || fallback;
	};

	const resolveMembersApiErrorMessage = (payload = {}, fallback = '') =>
		String(payload?.message || fallback || '').trim() || fallback;

	const assertMembersManagementAvailable = () => {
		const organizationId = getActiveOrganizationId();
		if (!organizationId) {
			throw new Error(
				t(
					'billing.members_no_active_org',
					'Aucune organisation active. Selectionnez une organisation.',
				),
			);
		}
		if (!canManageActiveOrganizationMembers()) {
			throw new Error(
				t(
					'billing.members_permission_denied',
					"Action reservee aux administrateurs de l'organisation.",
				),
			);
		}
		return organizationId;
	};

	const addAdminByEmail = async (emailInput) => {
		const email = String(emailInput || '')
			.trim()
			.toLowerCase();
		if (!email) {
			throw new Error(t('billing.admin_email_required', 'Saisissez un email valide.'));
		}
		const organizationId = assertMembersManagementAvailable();
		setAddAdminPending(true);
		try {
			const response = await fetch(
				`/api/organizations/${encodeURIComponent(organizationId)}/members`,
				{
					method: 'POST',
					headers: withAuthHeaders(),
					body: JSON.stringify({ email, role: 'admin' }),
				},
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(
					resolveMembersApiErrorMessage(
						payload,
						t('billing.admin_add_failed', "Impossible d'ajouter cet admin."),
					),
				);
			}
			if (addAdminEmailNode) addAdminEmailNode.value = '';
			const successMessage = t(
				'billing.admin_add_success',
				`Admin ajoute: ${email}.`,
				{ email },
			);
			setAdminManagementFeedback(successMessage, 'success');
			notify(successMessage, 'success');
			await loadData();
		} finally {
			setAddAdminPending(false);
		}
	};

	const promoteMemberToAdmin = async (memberId) => {
		const normalizedMemberId = String(memberId || '').trim();
		if (!normalizedMemberId) return;
		const organizationId = assertMembersManagementAvailable();
		const member = getMemberById(normalizedMemberId);
		const memberLabel =
			member?.user?.email || member?.user?.pseudo || t('billing.member', 'ce membre');

		setMemberActionPending(normalizedMemberId, true);
		try {
			const response = await fetch(
				`/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(normalizedMemberId)}`,
				{
					method: 'PATCH',
					headers: withAuthHeaders(),
					body: JSON.stringify({ role: 'admin' }),
				},
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(
					resolveMembersApiErrorMessage(
						payload,
						t('billing.admin_promote_failed', 'Promotion admin impossible.'),
					),
				);
			}
			const successMessage = t(
				'billing.admin_promote_success',
				`${memberLabel} est maintenant admin.`,
				{ member: memberLabel },
			);
			setAdminManagementFeedback(successMessage, 'success');
			notify(successMessage, 'success');
			await loadData();
		} finally {
			setMemberActionPending(normalizedMemberId, false);
		}
	};

	const deleteAdminMember = async (memberId) => {
		const normalizedMemberId = String(memberId || '').trim();
		if (!normalizedMemberId) return;
		const organizationId = assertMembersManagementAvailable();
		const member = getMemberById(normalizedMemberId);
		const memberLabel =
			member?.user?.email || member?.user?.pseudo || t('billing.member', 'cet admin');

		setMemberActionPending(normalizedMemberId, true);
		try {
			const response = await fetch(
				`/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(normalizedMemberId)}`,
				{
					method: 'PATCH',
					headers: withAuthHeaders(),
					body: JSON.stringify({ role: 'member' }),
				},
			);
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(
					resolveMembersApiErrorMessage(
						payload,
						t('billing.admin_delete_failed', 'Suppression admin impossible.'),
					),
				);
			}
			const successMessage = t(
				'billing.admin_delete_success',
				`Droits admin retires pour ${memberLabel}.`,
				{ member: memberLabel },
			);
			setAdminManagementFeedback(successMessage, 'success');
			notify(successMessage, 'success');
			await loadData();
		} finally {
			setMemberActionPending(normalizedMemberId, false);
		}
	};

	const handleMemberAction = async (event) => {
		const trigger = event.target?.closest?.('button[data-member-action][data-member-id]');
		if (!trigger || !membersBodyNode?.contains(trigger)) return;
		const action = String(trigger.getAttribute('data-member-action') || '').trim();
		const memberId = String(trigger.getAttribute('data-member-id') || '').trim();
		if (!action || !memberId || isMemberActionPending(memberId)) return;

		try {
			if (action === 'promote-admin') {
				await promoteMemberToAdmin(memberId);
				return;
			}
			if (action === 'delete-admin') {
				const member = getMemberById(memberId);
				const memberLabel =
					member?.user?.email ||
					member?.user?.pseudo ||
					t('billing.member', 'cet admin');
				const confirmed = window.confirm(
					t(
						'billing.admin_delete_confirm',
						`Retirer les droits admin de ${memberLabel} ?`,
						{ member: memberLabel },
					),
				);
				if (!confirmed) return;
				await deleteAdminMember(memberId);
			}
		} catch (error) {
			const message =
				error?.message || t('billing.member_action_failed', "Action membre indisponible.");
			setAdminManagementFeedback(message, 'error');
			notify(message, 'error');
		}
	};

	const requestCheckout = async (mode, planCode = null) => {
		try {
			const payloadBody = { mode };
			if (planCode) {
				payloadBody.planCode = normalizePlanCode(planCode);
			}
			const response = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: withAuthHeaders(),
				body: JSON.stringify(payloadBody),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(
					resolveBillingApiErrorMessage(
						payload,
						t('billing.checkout_error', 'Erreur de paiement.'),
					),
				);
			}
			if (!payload?.checkoutLink) {
				notify(t('billing.checkout_started', 'Paiement initialise.'), 'success');
				await loadData();
				return;
			}

			setCheckoutModalPayload(payload);
			openCheckoutModal();
		} catch (error) {
			notify(error?.message || t('billing.checkout_error', 'Erreur de paiement.'), 'error');
		}
	};

	const retryPayment = async () => {
		try {
			const response = await fetch('/api/billing/retry-payment', {
				method: 'POST',
				headers: withAuthHeaders(),
				body: JSON.stringify({}),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(
					resolveBillingApiErrorMessage(
						payload,
						t('billing.retry_error', 'Erreur de relance.'),
					),
				);
			}
			if (!payload?.checkoutLink) {
				notify(t('billing.retry_started', 'Relance initiee.'), 'success');
				await loadData();
				return;
			}

			setCheckoutModalPayload(payload);
			openCheckoutModal();
		} catch (error) {
			notify(error?.message || t('billing.retry_error', 'Erreur de relance.'), 'error');
		}
	};

	const loadOrganizations = async () => {
		const response = await fetch('/api/organizations/mine', { headers: withAuthHeaders() });
		if (!response.ok) {
			throw new Error('Impossible de charger les organisations.');
		}
		const organizations = await response.json();
		state.organizations = Array.isArray(organizations) ? organizations : [];
	};

	const loadPlans = async () => {
		state.rawPlans = [];
		state.plansLoadFailed = false;
		state.enterpriseTeaser = { ...DEFAULT_ENTERPRISE_TEASER };
		state.commercialRules = normalizeCommercialRules({});
		try {
			const response = await fetch('/api/billing/plans', { headers: withAuthHeaders() });
			if (!response.ok) {
				state.plansLoadFailed = true;
				return;
			}
			const payload = await response.json().catch(() => ({}));
			state.rawPlans = Array.isArray(payload?.plans) ? payload.plans : [];
			state.plansCurrency = String(payload?.currency || 'USD').trim().toUpperCase() || 'USD';
			state.enterpriseTeaser = normalizeEnterpriseTeaser(payload?.enterpriseTeaser || {});
			state.commercialRules = normalizeCommercialRules(payload?.commercialRules || {});
		} catch (_error) {
			state.plansLoadFailed = true;
		}
	};

	const pollCheckoutStatus = async (invoiceId, attemptsLeft = 8) => {
		const normalizedInvoiceId = String(invoiceId || '').trim();
		if (!normalizedInvoiceId) return;
		state.checkoutPollingInvoiceId = normalizedInvoiceId;
		setCheckoutStatusNote(t('billing.pending_verification', 'Verification du paiement en cours...'), 'info');

		for (let attempt = 0; attempt < attemptsLeft; attempt += 1) {
			try {
				const response = await fetch(
					`/api/billing/checkout-status/${encodeURIComponent(normalizedInvoiceId)}`,
					{ headers: withAuthHeaders() },
				);
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload?.message || 'Etat checkout indisponible.');
				}

				const status = String(payload?.status || '').trim().toLowerCase();
				if (status === 'paid') {
					setCheckoutStatusNote(
						t('billing.payment_success', 'Paiement confirme. Abonnement mis a jour.'),
						'success',
					);
					notify(t('billing.payment_success', 'Paiement confirme. Abonnement mis a jour.'), 'success');
					await loadData();
					return;
				}
				if (['failed', 'void', 'refunded'].includes(status)) {
					setCheckoutStatusNote(
						t('billing.payment_failed', 'Paiement non valide ou refuse.'),
						'error',
					);
					notify(t('billing.payment_failed', 'Paiement non valide ou refuse.'), 'error');
					await loadData();
					return;
				}
			} catch (error) {
				setCheckoutStatusNote(error?.message || 'Erreur verification paiement.', 'error');
			}

			await new Promise((resolve) => window.setTimeout(resolve, 3500));
		}

		setCheckoutStatusNote(
			t('billing.pending_verification', 'Verification du paiement en cours...'),
			'info',
		);
	};

	const loadData = async () => {
		const token = String(getToken() || '').trim();
		if (!token) {
			window.location.href = 'browse-surveys.html';
			return;
		}

		state.members = [];
		state.pendingMemberActionIds.clear();
		setBillingExemptMode(false);
		setLoadingUsage();
		setLoadingPlanOffers();
		setAdminManagementFeedback('', 'info');
		renderAdminManagementState();
		renderMembers([]);
		try {
			await Promise.all([loadOrganizations(), loadPlans()]);

			const [summaryResponse, invoicesResponse] = await Promise.all([
				fetch('/api/billing/summary', { headers: withAuthHeaders() }),
				fetch('/api/billing/invoices', { headers: withAuthHeaders() }),
			]);

			if (!summaryResponse.ok) {
				const err = await summaryResponse.json().catch(() => ({}));
				throw new Error(err?.message || 'Resume billing indisponible.');
			}
			const summary = await summaryResponse.json();
			renderSummary(summary);
			const orgId = summary?.organization?._id;

			if (!invoicesResponse.ok) {
				renderInvoices([]);
			} else {
				const invoices = await invoicesResponse.json();
				renderInvoices(invoices);
			}

			if (orgId) {
				const membersResponse = await fetch(`/api/organizations/${encodeURIComponent(orgId)}/members`, {
					headers: withAuthHeaders(),
				});
				if (membersResponse.ok) {
					const members = await membersResponse.json();
					renderMembers(members);
				} else {
					const payload = await membersResponse.json().catch(() => ({}));
					if (membersResponse.status === 403) {
						setAdminManagementFeedback(
							t(
								'billing.members_permission_denied',
								"Action reservee aux administrateurs de l'organisation.",
							),
							'info',
						);
					} else {
						setAdminManagementFeedback(
							resolveMembersApiErrorMessage(
								payload,
								t('billing.members_load_failed', 'Membres indisponibles pour le moment.'),
							),
							'error',
						);
					}
					renderMembers([]);
				}
			} else {
				setAdminManagementFeedback(
					t(
						'billing.members_no_active_org',
						'Aucune organisation active. Selectionnez une organisation.',
					),
					'info',
				);
				renderMembers([]);
			}
		} catch (error) {
			notify(error?.message || 'Erreur de chargement billing.', 'error');
			setBillingExemptMode(false);
			renderUsage({ metrics: [] });
			renderOverageEstimate({});
			renderInvoices([]);
			renderMembers([]);
			setAdminManagementFeedback(
				t('billing.members_load_failed', 'Membres indisponibles pour le moment.'),
				'error',
			);
			renderOrganizationSelector();
			state.summary = null;
			state.plansCatalog = [];
			state.selectedPlanCode = '';
			renderPlanCards();
			renderPlanComparison();
			renderCommercialRules();
			renderPlanSelectionSummary();
		}
	};

	const updateActiveOrganization = async (organizationId) => {
		if (!organizationId) return;
		try {
			const response = await fetch(`/api/organizations/active/${encodeURIComponent(organizationId)}`, {
				method: 'PATCH',
				headers: withAuthHeaders(),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Organisation active non mise a jour.');
			}
			state.activeOrganizationId = organizationId;
			await loadData();
		} catch (error) {
			notify(error?.message || 'Erreur changement organisation.', 'error');
			renderOrganizationSelector();
		}
	};

	const handleCheckoutReturn = async () => {
		const params = new URLSearchParams(window.location.search || '');
		const invoiceId = String(params.get('invoiceId') || '').trim();
		if (!invoiceId) return;
		await pollCheckoutStatus(invoiceId);
		params.delete('invoiceId');
		const query = params.toString();
		const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
		window.history.replaceState({}, '', nextUrl);
	};

	const handlePlanCardSelection = (planCode) => {
		const normalized = normalizePlanCode(planCode);
		if (!normalized) return;
		const plan = getPlanByCode(normalized);
		if (!plan || !plan.isSelectable) return;
		state.selectedPlanCode = normalized;
		renderPlanCards();
		renderPlanSelectionSummary();
	};

	document.addEventListener('DOMContentLoaded', () => {
		document.getElementById('back-btn')?.addEventListener('click', () => {
			window.history.back();
		});

		checkoutButtonNode?.addEventListener('click', () => {
			if (isTrialingSubscription()) {
				notify(
					t(
						'billing.trialing_checkout_locked',
						"Essai gratuit en cours: la facturation est verrouillee jusqu'a la fin de l'essai.",
					),
					'info',
				);
				return;
			}

			const currentPlanCode = getCurrentPlanCode();
			const selectedPlanCode = getSelectedPlanCode();
			const selectedPlan = getPlanByCode(selectedPlanCode);
			if (!selectedPlan || !selectedPlan.isSelectable) {
				notify(
					t(
						'billing.selection_summary_enterprise',
						"Ce plan n'est pas disponible en self-service. Utilisez le contact commercial.",
					),
					'info',
				);
				return;
			}
			const isUpgrade =
				Boolean(selectedPlanCode) &&
				Boolean(currentPlanCode) &&
				selectedPlanCode !== currentPlanCode;
			const mode = isUpgrade ? 'upgrade' : 'renewal';
			requestCheckout(mode, isUpgrade ? selectedPlanCode : null);
		});

		retryButtonNode?.addEventListener('click', () => {
			if (isTrialingSubscription()) {
				notify(
					t(
						'billing.trialing_checkout_locked',
						"Essai gratuit en cours: la facturation est verrouillee jusqu'a la fin de l'essai.",
					),
					'info',
				);
				return;
			}
			retryPayment();
		});

		orgSelectorNode?.addEventListener('change', (event) => {
			const selectedOrgId = String(event.target?.value || '').trim();
			if (!selectedOrgId) return;
			if (selectedOrgId === String(state.activeOrganizationId || '')) return;
			updateActiveOrganization(selectedOrgId);
		});

		addAdminFormNode?.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (state.addAdminPending) return;
			if (addAdminEmailNode && !addAdminEmailNode.checkValidity()) {
				addAdminEmailNode.reportValidity();
				return;
			}
			const email = String(addAdminEmailNode?.value || '').trim();
			if (!email) {
				const message = t('billing.admin_email_required', 'Saisissez un email valide.');
				setAdminManagementFeedback(message, 'error');
				notify(message, 'error');
				return;
			}

			try {
				await addAdminByEmail(email);
			} catch (error) {
				const message =
					error?.message || t('billing.admin_add_failed', "Impossible d'ajouter cet admin.");
				setAdminManagementFeedback(message, 'error');
				notify(message, 'error');
			}
		});

		membersBodyNode?.addEventListener('click', (event) => {
			handleMemberAction(event);
		});

		planCardsNode?.addEventListener('click', (event) => {
			const card = event.target?.closest?.('.plan-card[data-plan-selectable="true"]');
			if (!card) return;
			handlePlanCardSelection(card.getAttribute('data-plan-code'));
		});

		planCardsNode?.addEventListener('keydown', (event) => {
			const card = event.target?.closest?.('.plan-card[data-plan-selectable="true"]');
			if (!card) return;
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				handlePlanCardSelection(card.getAttribute('data-plan-code'));
			}
		});

		document.getElementById('checkout-modal-close')?.addEventListener('click', closeCheckoutModal);
		document.getElementById('checkout-modal-cancel')?.addEventListener('click', closeCheckoutModal);
		document.getElementById('checkout-modal-confirm')?.addEventListener('click', () => {
			const checkoutLink = String(state.pendingCheckout?.checkoutLink || '').trim();
			if (!checkoutLink) {
				notify(t('billing.checkout_error', 'Erreur de paiement.'), 'error');
				return;
			}
			closeCheckoutModal();
			window.location.href = checkoutLink;
		});

		loadData().then(() => handleCheckoutReturn());
	});
})();
