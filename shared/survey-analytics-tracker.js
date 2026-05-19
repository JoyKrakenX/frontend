/** @format */

(function initCommunitySurveyAnalytics() {
	const STORAGE_PREFIX = 'communitySurveyScan';
	const SOURCE_VALUES = new Set(['tv', 'replay', 'social', 'direct']);

	function getParams() {
		return new URLSearchParams(window.location.search || '');
	}

	function getSurveyId() {
		const params = getParams();
		return String(params.get('id') || params.get('Id') || '').trim();
	}

	function inferType() {
		const params = getParams();
		const explicitType = String(params.get('type') || '').trim().toLowerCase();
		if (explicitType === 'multiple') return 'multiple';
		if (explicitType === 'binary') return 'binary';
		return /choices|multiple/i.test(window.location.pathname || '') ? 'multiple' : 'binary';
	}

	function inferFlash() {
		const params = getParams();
		if (params.get('flash') === '1' || params.get('flash') === 'true') return true;
		return /survey-flash-/i.test(window.location.pathname || '');
	}

	function inferSource() {
		const raw = String(getParams().get('source') || '').trim().toLowerCase();
		return SOURCE_VALUES.has(raw) ? raw : 'direct';
	}

	function storageKey(surveyId = getSurveyId(), type = inferType()) {
		return `${STORAGE_PREFIX}:${String(surveyId || '').trim()}:${String(type || 'binary').trim()}`;
	}

	function persistScanId(scanId, surveyId = getSurveyId(), type = inferType()) {
		const safeScanId = String(scanId || '').trim();
		if (!safeScanId || !surveyId) return;
		try {
			sessionStorage.setItem(storageKey(surveyId, type), safeScanId);
			localStorage.setItem(storageKey(surveyId, type), safeScanId);
		} catch (_error) {
			// Storage can be unavailable in strict privacy modes; analytics remains best-effort.
		}
	}

	function getScanId(surveyId = getSurveyId(), type = inferType()) {
		if (!surveyId) return '';
		try {
			return (
				sessionStorage.getItem(storageKey(surveyId, type)) ||
				localStorage.getItem(storageKey(surveyId, type)) ||
				''
			);
		} catch (_error) {
			return '';
		}
	}

	async function trackScan() {
		const surveyId = getSurveyId();
		const type = inferType();
		if (!surveyId || getScanId(surveyId, type)) return getScanId(surveyId, type);
		try {
			const response = await fetch(`/api/survey-analytics/${encodeURIComponent(surveyId)}/scan`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type,
					flash: inferFlash(),
					source: inferSource(),
					pathname: window.location.pathname || '',
				}),
			});
			if (!response.ok) return '';
			const payload = await response.json().catch(() => ({}));
			persistScanId(payload.scanId, surveyId, type);
			return String(payload.scanId || '');
		} catch (_error) {
			return '';
		}
	}

	function recordEmojiReaction(_payload = {}) {
		return Promise.resolve(false);
	}

	window.CommunitySurveyAnalytics = {
		getScanId,
		trackScan,
		recordEmojiReaction,
	};

	if (/survey(?:-choices|-flash-binary|-flash-multiple)?\.html$/i.test(window.location.pathname || '')) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', () => {
				void trackScan();
			}, { once: true });
		} else {
			void trackScan();
		}
	}
})();