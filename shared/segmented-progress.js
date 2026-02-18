/** @format */

(() => {
	if (window.SiteSegmentedProgress) return;

	class SiteSegmentedProgress {
		constructor(container) {
			this.container = container;
			this.total = 0;
			this.items = [];
		}

		setData(items = [], total = null) {
			this.items = Array.isArray(items) ? items : [];
			this.total = Number.isFinite(Number(total)) ? Number(total) : this.items.reduce((sum, item) => sum + Number(item?.value || 0), 0);
			this.render();
		}

		render() {
			if (!this.container) return;
			const total = this.total > 0 ? this.total : 1;
			const segments = this.items
				.map((item) => {
					const value = Number(item?.value || 0);
					const pct = Math.max(0, Math.min(100, (value / total) * 100));
					const color = String(item?.color || '#6366f1');
					const label = String(item?.label || '');
					return `<div class="segmented-progress-segment" style="width:${pct}%;background:${color}" title="${label}: ${value}"><span class="segmented-progress-segment-label">${pct >= 9 ? `${Math.round(pct)}%` : ''}</span></div>`;
				})
				.join('');

			this.container.classList.add('segmented-progress');
			this.container.innerHTML = `
				<div class="segmented-progress-track" role="img" aria-label="Répartition des votes">
					${segments || '<div class="segmented-progress-zero">En attente de votes</div>'}
				</div>`;
		}
	}

	window.SiteSegmentedProgress = SiteSegmentedProgress;
})();
