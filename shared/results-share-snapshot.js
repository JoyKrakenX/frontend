/** @format */

(() => {
	if (window.CommunityResultsShare) return;

	const HTML2CANVAS_URL =
		'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
	let html2CanvasLoadPromise = null;

	function loadScriptOnce(src) {
		const existing = document.querySelector(`script[src="${src}"]`);
		if (existing?.dataset.loaded === 'true') return Promise.resolve();
		if (existing) {
			return new Promise((resolve, reject) => {
				existing.addEventListener('load', resolve, { once: true });
				existing.addEventListener('error', reject, { once: true });
			});
		}

		return new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = src;
			script.async = true;
			script.crossOrigin = 'anonymous';
			script.addEventListener(
				'load',
				() => {
					script.dataset.loaded = 'true';
					resolve();
				},
				{ once: true },
			);
			script.addEventListener('error', reject, { once: true });
			document.head.appendChild(script);
		});
	}

	async function ensureHtml2Canvas() {
		if (typeof window.html2canvas === 'function') return window.html2canvas;
		html2CanvasLoadPromise =
			html2CanvasLoadPromise || loadScriptOnce(HTML2CANVAS_URL);
		await html2CanvasLoadPromise;
		if (typeof window.html2canvas !== 'function') {
			throw new Error('html2canvas unavailable');
		}
		return window.html2canvas;
	}

	function resolveShareUrl(shareUrl) {
		try {
			return new URL(shareUrl || window.location.href, window.location.href).href;
		} catch (_error) {
			return window.location.href;
		}
	}

	function normalizeFilename(value) {
		const base = String(value || 'community-results')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/gi, '-')
			.replace(/^-+|-+$/g, '')
			.toLowerCase();
		return `${base || 'community-results'}.png`;
	}

	function buildSnapshotNode(card, { shareUrl, title }) {
		const rect = card.getBoundingClientRect();
		const width = Math.max(320, Math.min(820, Math.round(rect.width || 520)));
		const wrapper = document.createElement('div');
		wrapper.className = 'results-share-snapshot-capture community-snapshot-card';
		wrapper.setAttribute('aria-hidden', 'true');
		wrapper.style.cssText = [
			'position:fixed',
			'left:-10000px',
			'top:0',
			`width:${width}px`,
			'padding:24px',
			'box-sizing:border-box',
			'background:radial-gradient(circle at 16% 8%,rgba(139,92,246,.42),transparent 34%),radial-gradient(circle at 92% 18%,rgba(34,211,238,.24),transparent 30%),linear-gradient(145deg,#0b1020,#1e1b4b 58%,#111827)',
			'color:#fff',
			'font-family:inherit',
			'pointer-events:none',
			'z-index:-1',
		].join(';');

		const clone = card.cloneNode(true);
		clone.removeAttribute('id');
		clone.classList.add('share-snapshot-card');
		clone.style.width = '100%';
		clone.style.maxWidth = 'none';
		clone.style.margin = '0';
		clone.style.border = '1px solid rgba(255,255,255,.2)';
		clone.style.boxShadow = '0 24px 54px rgba(2,6,23,.42)';
		clone.querySelectorAll('.overlay-result-bars').forEach((bars) => {
			bars.style.gap = '12px';
		});
		clone.querySelectorAll('.overlay-result-track').forEach((track) => {
			track.style.background = 'rgba(255,255,255,.14)';
		});
		clone.querySelectorAll('.overlay-result-fill').forEach((fill) => {
			fill.style.background = 'linear-gradient(90deg,#a78bfa,#22d3ee)';
		});

		const footer = document.createElement('div');
		footer.className = 'share-snapshot-link';
		footer.style.cssText = [
			'margin-top:14px',
			'padding:12px 14px',
			'border:1px solid rgba(255,255,255,.22)',
			'border-radius:18px',
			'background:rgba(15,23,42,.62)',
			'box-shadow:0 14px 30px rgba(15,23,42,.22)',
			'color:rgba(255,255,255,.92)',
			'font-size:13px',
			'line-height:1.35',
			'overflow-wrap:anywhere',
		].join(';');
		footer.innerHTML = `
			<div style="font-weight:800;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:rgba(255,255,255,.7);">Community</div>
			<div style="font-weight:700;margin-top:3px;">${escapeHtml(title || 'Resultats du sondage')}</div>
			<div style="margin-top:5px;">${escapeHtml(shareUrl)}</div>
		`;

		wrapper.appendChild(clone);
		wrapper.appendChild(footer);
		document.body.appendChild(wrapper);
		return wrapper;
	}

	function canvasToBlob(canvas) {
		return new Promise((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('snapshot blob unavailable'));
				}
			}, 'image/png', 0.96);
		});
	}

	async function captureOverlaySnapshot(options = {}) {
		const card = document.querySelector(options.cardSelector || '.overlay-card.results');
		if (!(card instanceof HTMLElement)) {
			throw new Error('results overlay card unavailable');
		}

		const shareUrl = resolveShareUrl(options.shareUrl);
		const title =
			String(options.title || '').trim() ||
			card.querySelector('.overlay-title')?.textContent?.trim() ||
			'Community results';
		const html2canvas = await ensureHtml2Canvas();
		const node = buildSnapshotNode(card, { shareUrl, title });

		try {
			await new Promise((resolve) => requestAnimationFrame(() => resolve()));
			const canvas = await html2canvas(node, {
				backgroundColor: null,
				logging: false,
				scale: Math.min(2.4, Math.max(1.5, window.devicePixelRatio || 1)),
				useCORS: true,
			});
			const blob = await canvasToBlob(canvas);
			const file = new File([blob], normalizeFilename(title), {
				type: 'image/png',
				lastModified: Date.now(),
			});
			return { blob, file, shareUrl, title };
		} finally {
			node.remove();
		}
	}

	function buildPlatformUrl(platform, text, shareUrl) {
		const payload = [text, shareUrl].filter(Boolean).join('\n');
		switch (platform) {
			case 'whatsapp':
				return `https://wa.me/?text=${encodeURIComponent(payload)}`;
			case 'facebook':
				return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
					shareUrl,
				)}`;
			case 'twitter':
				return `https://x.com/intent/tweet?text=${encodeURIComponent(payload)}`;
			default:
				return '';
		}
	}

	function downloadSnapshotImage(blob, filename) {
		const objectUrl = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = filename || 'community-results.png';
		link.rel = 'noopener';
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
	}

	async function copySnapshotToClipboard(blob, text) {
		if (window.ClipboardItem && navigator.clipboard?.write) {
			await navigator.clipboard.write([
				new ClipboardItem({
					'image/png': blob,
					'text/plain': new Blob([text], { type: 'text/plain' }),
				}),
			]);
			return true;
		}
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return false;
		}
		throw new Error('clipboard unavailable');
	}

	function notify(options, message, type = 'info') {
		if (typeof options.notify === 'function') {
			options.notify(message, type);
			return;
		}
		window.SiteUI?.notify?.(message, type);
	}

	async function shareOverlaySnapshot(options = {}) {
		const platform = String(options.platform || '').trim();
		const snapshot = await captureOverlaySnapshot(options);
		const text = String(options.text || snapshot.title || '').trim();
		const shareText = [text, snapshot.shareUrl].filter(Boolean).join('\n');
		const filename = normalizeFilename(options.filenamePrefix || snapshot.title);

		if (platform === 'copy') {
			let copiedImage = false;
			try {
				copiedImage = await copySnapshotToClipboard(snapshot.blob, shareText);
			} catch (_error) {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(shareText);
				}
				downloadSnapshotImage(snapshot.blob, filename);
			}
			notify(
				options,
				copiedImage ?
					'Capture et lien copies dans le presse-papiers.'
				:	'Lien copie. La capture a ete telechargee.',
				'success',
			);
			return true;
		}

		const nativePayload = {
			title: snapshot.title,
			text,
			url: snapshot.shareUrl,
			files: [snapshot.file],
		};

		if (navigator.canShare?.({ files: nativePayload.files }) && navigator.share) {
			try {
				await navigator.share({
					title: nativePayload.title,
					text: nativePayload.text,
					url: nativePayload.url,
					files: nativePayload.files,
				});
			} catch (error) {
				if (error?.name !== 'AbortError') throw error;
			}
			return true;
		}

		downloadSnapshotImage(snapshot.blob, filename);
		const fallbackUrl = buildPlatformUrl(platform, text, snapshot.shareUrl);
		if (fallbackUrl) {
			window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
		}
		notify(
			options,
			'Capture telechargee. Le partage du lien est ouvert dans un nouvel onglet.',
			'info',
		);
		return true;
	}

	function escapeHtml(value) {
		return String(value || '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	window.CommunityResultsShare = Object.freeze({
		captureOverlaySnapshot,
		downloadSnapshotImage,
		shareOverlaySnapshot,
	});
})();
