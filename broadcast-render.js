/** @format */

(() => {
	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const escapeHtml = (value) =>
		String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

	const toPercent = (part, total) => {
		if (!Number.isFinite(Number(total)) || Number(total) <= 0) return 0;
		return Math.round((Number(part || 0) / Number(total)) * 100);
	};

	const buildResultBarsMarkup = (results = {}) => {
		const totalOpinions = Number(results.totalOpinions || 0);
		if (results.type === 'multiple') {
			const optionKeys = Array.isArray(results.optionKeys) ? results.optionKeys : [];
			return optionKeys
				.map((key) => {
					const count = Number(results.counts?.[key] || 0);
					const percent = toPercent(count, totalOpinions);
					const label = results.labels?.[key] || key;
					return `
						<div class="overlay-result-bar">
							<span class="overlay-result-label">${escapeHtml(label)}</span>
							<div class="overlay-result-track"><div class="overlay-result-fill" style="width:${percent}%;"></div></div>
							<span class="overlay-result-value">${count} · ${percent}%</span>
						</div>
					`;
				})
				.join('');
		}

		const yes = Number(results.counts?.yes || 0);
		const no = Number(results.counts?.no || 0);
		return [
			{ label: t('broadcast.overlays.results.yes', 'Oui'), value: yes },
			{ label: t('broadcast.overlays.results.no', 'Non'), value: no },
		]
			.map((item) => {
				const percent = toPercent(item.value, totalOpinions);
				return `
					<div class="overlay-result-bar">
						<span class="overlay-result-label">${escapeHtml(item.label)}</span>
						<div class="overlay-result-track"><div class="overlay-result-fill" style="width:${percent}%;"></div></div>
						<span class="overlay-result-value">${item.value} · ${percent}%</span>
					</div>
				`;
			})
			.join('');
	};

	const buildFeaturedCueMarkup = (cue) => {
		if (!cue) {
			return `<div class="overlay-featured-card">${escapeHtml(
				t(
					'broadcast.overlays.featured.empty',
					'Aucun message mis en avant.',
				),
			)}</div>`;
		}
		const sourceLabel =
			cue.sourceType === 'survey_comment' ?
				t('broadcast.sources.survey_comment', 'Commentaire')
			:	t('broadcast.sources.chat_message', 'Chat');
		return `
			<div class="overlay-featured-card">
				<div class="overlay-featured-author">
					<strong>${escapeHtml(
						cue.pseudoSnapshot ||
							t('broadcast.common.participant', 'Participant'),
					)}</strong>
					<span class="overlay-featured-source">${escapeHtml(sourceLabel)}</span>
				</div>
				<p class="overlay-subtitle">${escapeHtml(cue.textSnapshot || '')}</p>
			</div>
		`;
	};

	const buildTickerMarkup = (snapshot = {}) => {
		const cues = Array.isArray(snapshot.cues) ? snapshot.cues.slice(0, Number(snapshot.config?.maxTickerItems || 10)) : [];
		if (!snapshot.config?.tickerEnabled || !cues.length) return '';
		const items = cues
			.map((cue) => `${cue.pseudoSnapshot || 'Participant'}: ${cue.textSnapshot || ''}`)
			.filter(Boolean)
			.join('   •   ');
		const configuredDuration = Math.max(14, Math.min(22, Number(snapshot.config?.tickerSpeed || 18)));
		const recommendedDuration = Math.max(14, Math.min(22, Math.ceil(items.length / 10.5)));
		const tickerDuration = Math.round((configuredDuration + recommendedDuration) / 2);
		return `
			<div class="overlay-card ticker">
				<div class="overlay-ticker-track" style="animation-duration:${tickerDuration}s;">
					<span>${escapeHtml(items)}</span>
					<span aria-hidden="true">${escapeHtml(items)}</span>
				</div>
			</div>
		`;
	};

	const buildOverlayMarkup = ({ snapshot, mode }) => {
		const survey = snapshot?.survey || {};
		const results = snapshot?.results || {};
		const cluster = [];
		if (mode === 'results' || mode === 'combined') {
			cluster.push(`
				<div class="overlay-card results">
					<span class="overlay-eyebrow"><i class="fas fa-tower-broadcast"></i> ${escapeHtml(String(survey.type || '').toUpperCase())} ${escapeHtml(String(survey.mode || '').toUpperCase())}</span>
					<h2 class="overlay-title">${escapeHtml(
						survey.theme ||
							t('broadcast.overlays.results.live_title', 'Résultats live'),
					)}</h2>
					<p class="overlay-subtitle">${escapeHtml(survey.question || '')}</p>
					<div class="overlay-result-bars">${buildResultBarsMarkup(results)}</div>
					<p class="overlay-subtitle">${Number(results.totalOpinions || 0)} ${escapeHtml(
						t('broadcast.overlays.results.votes', 'votes'),
					)} · ${escapeHtml(
						survey.isClosed ?
							t('broadcast.overlays.results.closed', 'Clôturé')
						:	t('broadcast.overlays.results.open', 'Ouvert'),
					)}</p>
				</div>
			`);
		}
		if (mode === 'chat' || mode === 'combined') {
			cluster.push(buildFeaturedCueMarkup(snapshot?.featuredCue));
			const ticker = buildTickerMarkup(snapshot);
			if (ticker) cluster.push(ticker);
		}
		return `
			<div class="overlay-surface">
				<div class="overlay-cluster mode-${escapeHtml(mode)}">${cluster.join('')}</div>
			</div>
		`;
	};

	window.BroadcastRender = Object.freeze({
		escapeHtml,
		toPercent,
		buildOverlayMarkup,
		buildResultBarsMarkup,
		buildFeaturedCueMarkup,
		buildTickerMarkup,
	});
})();
