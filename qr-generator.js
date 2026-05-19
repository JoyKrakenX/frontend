/** @format */

const CONFIG = {
	api: {
		endpoints: {
			generateQR: '/api/qrcode/generate',
			getSurvey: '/api/survey',
			getSurveyMultiple: '/api/survey_2',
		},
	},
};

let currentSurvey = null;
let qrData = null;
let currentLinks = {
	answer: '',
	results: '',
	dashboard: 'my-surveys.html',
};
let isLoading = false;

const t = (key, fallback, params) =>
	window.SiteI18n?.t?.(key, fallback, params) || fallback;
const getIntlLocale = () => window.SiteI18n?.getIntlLocale?.() || 'fr-FR';

function notify(message, type = 'info') {
	if (window.SiteUI?.notify) {
		window.SiteUI.notify(message, type);
		return;
	}
	console[type === 'error' ? 'error' : 'log'](message);
}

function getParams() {
	const params = new URLSearchParams(window.location.search);
	const surveyId = String(params.get('surveyId') || '').trim();
	const type = String(params.get('type') || '').trim();
	return {
		surveyId,
		type: type === 'multiple' ? 'multiple' : 'binary',
	};
}

function getAuthToken() {
	return (
		window.SiteApi?.getToken?.() ||
		localStorage.getItem('token') ||
		localStorage.getItem('jwt_token') ||
		''
	);
}

function isFlashSurvey() {
	return currentSurvey?.explain === false;
}

function getSurveyTypeLabel(type) {
	if (type === 'binary') {
		return isFlashSurvey() ? 'Binaire (Flash)' : 'Binaire (Oui/Non)';
	}
	return isFlashSurvey() ? 'Choix multiples (Flash)' : 'Choix multiples';
}

function setLoadingState(isBusy) {
	const loading = document.getElementById('loading');
	const dashboard = document.querySelector('.dashboard-container');
	if (loading) loading.classList.toggle('hidden', !isBusy);
	if (dashboard) dashboard.classList.toggle('hidden', isBusy);
}

function formatDate(value) {
	if (!value) return '--';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '--';
	return date.toLocaleDateString(getIntlLocale(), {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

async function fetchSurveyInfo(surveyId, type) {
	const endpoint =
		type === 'binary' ?
			`${CONFIG.api.endpoints.getSurvey}/${surveyId}`
		: 	`${CONFIG.api.endpoints.getSurveyMultiple}/${surveyId}`;

	const token = getAuthToken();

	const response = await fetch(endpoint, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});

	if (!response.ok) {
		throw new Error(`HTTP_${response.status}`);
	}

	currentSurvey = await response.json();
	return currentSurvey;
}

async function generateQRCode(surveyId, type, force = false) {
	const response = await fetch(CONFIG.api.endpoints.generateQR, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ surveyId, type, force }),
	});

	if (!response.ok) {
		const payload = await response.text();
		throw new Error(`HTTP_${response.status}: ${payload}`);
	}

	qrData = await response.json();
	if (!qrData?.qrPath) {
		throw new Error('QR_PATH_MISSING');
	}
	const answerLink = String(qrData?.urls?.answer || '').trim();
	const resultsLink = String(qrData?.urls?.results || '').trim();
	const dashboardLink = String(qrData?.urls?.dashboard || '').trim();
	if (!answerLink || !resultsLink || !dashboardLink) {
		throw new Error('QR_URLS_MISSING');
	}

	currentLinks = {
		answer: answerLink,
		results: resultsLink,
		dashboard: dashboardLink,
	};

	const qrImg = document.getElementById('qrcode-img');
	const timestamp = Date.now();
	const qrURL = `${qrData.qrPath}${qrData.qrPath.includes('?') ? '&' : '?'}t=${timestamp}`;
	if (qrImg) {
		qrImg.onload = () => {
			qrImg.style.animation = 'fadeInUp 0.35s ease';
		};
		qrImg.onerror = () => {
			notify('Impossible de charger le QR Code', 'error');
		};
		qrImg.src = qrURL;
		qrImg.alt = `QR Code pour le sondage ${surveyId}`;
	}

	const primaryLink = currentLinks.answer || '';
	const linkInput = document.getElementById('survey-link');
	const shareLinkInput = document.getElementById('share-link-input');
	if (linkInput) linkInput.value = primaryLink;
	if (shareLinkInput) shareLinkInput.value = primaryLink;
}

function updateSurveyMeta({ surveyId, type }) {
	const theme = currentSurvey?.theme || 'Sondage sans titre';
	const surveyInfo = document.getElementById('survey-info');
	const surveyTypeDisplay = document.getElementById('survey-type-display');
	const surveyIdDisplay = document.getElementById('survey-id-display');
	const surveyDateDisplay = document.getElementById('survey-date-display');

	if (surveyInfo) surveyInfo.textContent = theme;
	if (surveyTypeDisplay) surveyTypeDisplay.textContent = getSurveyTypeLabel(type);
	if (surveyIdDisplay) surveyIdDisplay.textContent = surveyId;
	if (surveyDateDisplay) surveyDateDisplay.textContent = formatDate(currentSurvey?.createdAt);
}

function openLink(url) {
	const normalized = String(url || '').trim();
	if (!normalized) {
		notify('Lien indisponible', 'error');
		return;
	}
	window.location.href = normalized;
}

async function downloadQRCode() {
	if (!qrData?.qrPath) {
		notify('QR Code non disponible', 'error');
		return;
	}

	const { surveyId, type } = getParams();
	const filename = `sondage-${surveyId}-${type}-qr.png`;

	try {
		const response = await fetch(qrData.qrPath, { cache: 'no-store' });
		if (!response.ok) throw new Error(`HTTP_${response.status}`);
		const blob = await response.blob();
		const isSvg =
			blob.type === 'image/svg+xml' ||
			String(qrData?.meta?.format || '').toLowerCase() === 'svg';
		const downloadBlob = isSvg ? await convertSvgBlobToPngBlob(blob) : blob;
		const downloadUrl = URL.createObjectURL(downloadBlob);
		const link = document.createElement('a');
		link.href = downloadUrl;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(downloadUrl);
		notify('QR Code téléchargé avec succès', 'success');
	} catch (error) {
		console.error('Download QR failed:', error);
		notify('Erreur lors du téléchargement du QR Code', 'error');
	}
}

async function convertSvgBlobToPngBlob(svgBlob) {
	const svgText = await svgBlob.text();
	const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

	const image = await new Promise((resolve, reject) => {
		const node = new Image();
		node.onload = () => resolve(node);
		node.onerror = reject;
		node.src = svgDataUrl;
	});

	const naturalWidth = Math.max(1, Number(image.naturalWidth || 1));
	const naturalHeight = Math.max(1, Number(image.naturalHeight || 1));
	const targetMaxDimension = 1600;
	const scaleFactor = Math.max(
		1,
		targetMaxDimension / Math.max(naturalWidth, naturalHeight),
	);
	const width = Math.round(naturalWidth * scaleFactor);
	const height = Math.round(naturalHeight * scaleFactor);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE');
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(image, 0, 0, width, height);

	const pngBlob = await new Promise((resolve, reject) => {
		canvas.toBlob((result) => {
			if (result) resolve(result);
			else reject(new Error('PNG_EXPORT_FAILED'));
		}, 'image/png');
	});

	return pngBlob;
}

async function copyToClipboard(value) {
	const text = String(value || '').trim();
	if (!text) {
		notify('Lien indisponible', 'error');
		return false;
	}

	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch (_error) {
		// Fallback below
	}

	const ghostInput = document.createElement('input');
	ghostInput.value = text;
	document.body.appendChild(ghostInput);
	ghostInput.select();
	const copied = document.execCommand('copy');
	ghostInput.remove();
	return copied;
}

async function copySurveyLink() {
	const copied = await copyToClipboard(currentLinks.answer);
	if (copied) notify('Lien copié dans le presse-papiers', 'success');
	else notify('Impossible de copier le lien', 'error');
}

async function copyShareLink() {
	const copied = await copyToClipboard(currentLinks.answer);
	if (copied) notify('Lien copié dans le presse-papiers', 'success');
	else notify('Impossible de copier le lien', 'error');
}

function shareOnPlatform(platform) {
	const surveyLink = currentLinks.answer;
	if (!surveyLink) {
		notify('Lien de partage indisponible', 'error');
		return;
	}

	const surveyTitle = currentSurvey?.theme || 'Mon sondage';
	const surveyQuestion = currentSurvey?.question || 'Participez à mon sondage';
	let shareUrl = '';

	switch (platform) {
		case 'whatsapp':
			shareUrl = `https://wa.me/?text=${encodeURIComponent(`${surveyTitle} - ${surveyQuestion}\n${surveyLink}`)}`;
			break;
		case 'facebook':
			shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(surveyLink)}`;
			break;
		case 'x':
		case 'twitter':
			shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(`${surveyTitle}\n${surveyLink}`)}`;
			break;
		case 'email':
			shareUrl = `mailto:?subject=${encodeURIComponent(surveyTitle)}&body=${encodeURIComponent(`${surveyQuestion}\n\nParticipez ici : ${surveyLink}`)}`;
			break;
		default:
			return;
	}

	window.open(shareUrl, '_blank', 'noopener,noreferrer');
	const shareModal = document.getElementById('share-modal');
	if (window.SiteModalSheet?.close) {
		window.SiteModalSheet.close(shareModal);
	} else if (shareModal) {
		shareModal.classList.add('hidden');
	}
}

function bindModalButtons() {
	document.querySelectorAll('#share-modal .close-modal').forEach((button) => {
		button.addEventListener('click', () => {
			const modal = document.getElementById('share-modal');
			if (window.SiteModalSheet?.close) {
				window.SiteModalSheet.close(modal);
			} else if (modal) {
				modal.classList.add('hidden');
			}
		});
	});

	document.querySelectorAll('#share-modal .share-option').forEach((button) => {
		button.addEventListener('click', (event) => {
			const platform = event.currentTarget.getAttribute('data-platform');
			shareOnPlatform(platform);
		});
	});
}

function bindEventListeners() {
	document.getElementById('back-btn')?.addEventListener('click', () => {
		window.history.back();
	});

	document.getElementById('refresh-btn')?.addEventListener('click', () => {
		loadQR(true).catch(() => {});
	});

	document.getElementById('new-qr-btn')?.addEventListener('click', () => {
		loadQR(true).catch(() => {});
	});

	document.getElementById('share-btn')?.addEventListener('click', () => {
		const shareModal = document.getElementById('share-modal');
		if (!shareModal) return;
		if (window.SiteModalSheet?.open) {
			window.SiteModalSheet.open(shareModal);
		} else {
			shareModal.classList.remove('hidden');
		}
	});

	document.getElementById('download-btn')?.addEventListener('click', () => {
		downloadQRCode().catch(() => {});
	});

	document.getElementById('copy-link-btn')?.addEventListener('click', () => {
		copySurveyLink().catch(() => {});
	});

	document.getElementById('copy-share-link')?.addEventListener('click', () => {
		copyShareLink().catch(() => {});
	});

	document.getElementById('view-results-btn')?.addEventListener('click', () => {
		openLink(currentLinks.results);
	});

	document.getElementById('test-survey-btn')?.addEventListener('click', () => {
		openLink(currentLinks.results);
	});

	document.getElementById('manage-surveys-btn')?.addEventListener('click', () => {
		openLink(currentLinks.dashboard || 'my-surveys.html');
	});

	document.getElementById('survey-link')?.addEventListener('click', (event) => {
		event.currentTarget.select();
	});

	document
		.getElementById('share-link-input')
		?.addEventListener('click', (event) => {
			event.currentTarget.select();
		});

	bindModalButtons();
}

function showInlineError(message) {
	const container = document.getElementById('qrcode-container');
	if (!container) return;
	container.innerHTML = `
		<div class="error-state">
			<i class="fas fa-exclamation-triangle"></i>
			<p>${message}</p>
			<button id="retry-load-qr" class="btn-primary" type="button">
				<i class="fas fa-rotate-right"></i> Réessayer
			</button>
		</div>
	`;
	container
		.querySelector('#retry-load-qr')
		?.addEventListener('click', () => loadQR(true).catch(() => {}));
}

function renderQrPageState({
	title,
	message,
	variant = 'warning',
	icon = 'fa-circle-info',
	actions,
}) {
	setLoadingState(false);
	const dashboard = document.querySelector('.dashboard-container');
	if (!dashboard) return;
	dashboard.classList.remove('hidden');
	window.SiteUI?.renderPageState?.({
		mount: dashboard,
		variant,
		icon,
		title,
		message,
		actions: actions || [
			{
				label: 'Parcourir les sondages',
				icon: 'fa-list',
				href: 'browse-surveys.html',
			},
			{
				label: 'Mes sondages',
				icon: 'fa-folder-open',
				href: 'my-surveys.html',
				secondary: true,
			},
		],
	});
}

async function loadQR(forceRefresh = false) {
	if (isLoading) return;
	isLoading = true;
	setLoadingState(true);

	try {
		const { surveyId, type } = getParams();
		if (!surveyId) {
			renderQrPageState({
				title: 'Lien incomplet',
				message:
					"L'identifiant du sondage est absent. Ouvrez d'abord un sondage puis revenez sur son QR code.",
				variant: 'warning',
				icon: 'fa-link-slash',
			});
			return;
		}

		if (!getAuthToken()) {
			renderQrPageState({
				title: 'Connexion requise',
				message:
					'Connectez-vous pour générer ou consulter le QR code de ce sondage.',
				variant: 'warning',
				icon: 'fa-lock',
				actions: [
					{
						label: 'Se connecter',
						icon: 'fa-right-to-bracket',
						onClick: () => window.SiteApi?.beginGoogleAuth?.(),
					},
					{
						label: 'Parcourir les sondages',
						icon: 'fa-list',
						href: 'browse-surveys.html',
						secondary: true,
					},
				],
			});
			return;
		}

		await fetchSurveyInfo(surveyId, type);
		updateSurveyMeta({ surveyId, type });
		await generateQRCode(surveyId, type, forceRefresh);

		setLoadingState(false);
		notify('QR Code chargé avec succès', 'success');
	} catch (error) {
		setLoadingState(false);
		if (['HTTP_401', 'HTTP_403'].includes(error?.message)) {
			renderQrPageState({
				title: 'Connexion requise',
				message:
					'Connectez-vous pour générer ou consulter le QR code de ce sondage.',
				variant: 'warning',
				icon: 'fa-lock',
				actions: [
					{
						label: 'Se connecter',
						icon: 'fa-right-to-bracket',
						onClick: () => window.SiteApi?.beginGoogleAuth?.(),
					},
					{
						label: 'Parcourir les sondages',
						icon: 'fa-list',
						href: 'browse-surveys.html',
						secondary: true,
					},
				],
			});
			return;
		}
		const message =
			error?.message === 'PARAMS_MISSING' ? "Paramètres manquants dans l'URL"
			: error?.message === 'QR_PATH_MISSING' ? 'Aucun chemin QR reçu du serveur'
			: error?.message === 'QR_URLS_MISSING' ? 'URLs QR manquantes dans la réponse serveur'
			: 'Erreur lors du chargement du QR Code';
		console.error('Failed to load QR page:', error);
		showInlineError(message);
		notify(message, 'error');
	} finally {
		isLoading = false;
	}
}

document.addEventListener('DOMContentLoaded', () => {
	bindEventListeners();
	loadQR(false).catch(() => {});
});
