/** @format */

(() => {
	if (window.ChatPreviewRenderer) return;

	const DEFAULT_LIMIT = 30;
	const CACHE_TTL_MS = 12000;

	const t = (key, fallback, params) =>
		window.SiteI18n?.t?.(key, fallback, params) || fallback;

	const getToken = () =>
		window.SiteApi?.getToken?.() ||
		localStorage.getItem('token') ||
		localStorage.getItem('jwt_token') ||
		'';

	const escapeHtml = (value) =>
		String(value || '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#039;');

	const buildAvatarFallback = (pseudo) =>
		`https://ui-avatars.com/api/?name=${encodeURIComponent(
			String(pseudo || 'Utilisateur'),
		)}&background=6366f1&color=fff`;

	const normalizeType = (type) => (type === 'multiple' ? 'multiple' : 'binary');

	async function fetchMessages({ surveyId, type, limit = DEFAULT_LIMIT }) {
		const params = new URLSearchParams({
			type: normalizeType(type),
			limit: String(Math.max(1, Math.min(50, Number(limit) || DEFAULT_LIMIT))),
		});
		const response = await fetch(
			`/api/chat/${encodeURIComponent(surveyId)}/messages?${params.toString()}`,
			{
				headers: {
					Authorization: `Bearer ${getToken()}`,
					'Content-Type': 'application/json',
				},
			},
		);
		if (!response.ok) throw new Error(`HTTP_${response.status}`);
		const payload = await response.json();
		return Array.isArray(payload?.messages) ? payload.messages : [];
	}

	function resolvePseudo(message) {
		return String(
			message?.user?.pseudo ||
				message?.userPseudo ||
				message?.pseudo ||
				t('shared.auth.user_fallback', 'Utilisateur'),
		);
	}

	function resolveAvatar(message, pseudo) {
		return (
			message?.user?.picture ||
			message?.picture ||
			message?.avatar ||
			buildAvatarFallback(pseudo)
		);
	}

	function renderStatusBubble(stack, text, type = 'info') {
		const icon =
			type === 'error' ? 'exclamation-circle'
			: type === 'loading' ? 'spinner fa-spin'
			: 'info-circle';
		const node = document.createElement('div');
		node.className = `message system-message ${type}`;
		node.innerHTML = `
			<div class="message-stack system-message-stack">
				<div class="message-text message-text-bubble system-bubble">
					<span class="system-label"><i class="fas fa-${icon}"></i><span>Systeme</span></span>
					<span class="message-inline-body">${escapeHtml(text)}</span>
				</div>
			</div>
		`;
		stack.appendChild(node);
	}

	function renderMessage(stack, message) {
		const pseudo = resolvePseudo(message);
		const avatar = resolveAvatar(message, pseudo);
		const node = document.createElement('div');
		node.className = `message chat-preview-message ${
			message?.isSystemMessage ? 'system-message' : 'other-message'
		}`;
		node.setAttribute('role', 'listitem');
		node.dataset.messageId = String(message?.id || message?._id || '');
		node.innerHTML = `
			<div class="message-row received">
				<div class="message-avatar avatar">
					<img src="${escapeHtml(avatar)}" alt="${escapeHtml(pseudo)}" title="${escapeHtml(
						pseudo,
					)}" loading="lazy">
				</div>
				<div class="message-stack">
					<div class="bubble-wrapper">
						<div class="message-text message-text-bubble bubble">
							<span class="message-inline-username" title="${escapeHtml(
								pseudo,
							)}">${escapeHtml(pseudo)}</span>
							<span class="message-inline-body">${escapeHtml(message?.message || '')}</span>
						</div>
					</div>
				</div>
			</div>
		`;
		stack.appendChild(node);
	}

	function createStack(list) {
		list.innerHTML = '';
		const stack = document.createElement('div');
		stack.className = 'chat-preview-message-list';
		stack.setAttribute('role', 'list');

		const spacer = document.createElement('div');
		spacer.className = 'chat-message-bottom-spacer chat-preview-bottom-spacer';
		spacer.setAttribute('aria-hidden', 'true');
		stack.appendChild(spacer);
		list.appendChild(stack);
		return stack;
	}

	function finalizeScroll(list) {
		window.requestAnimationFrame(() => {
			list.scrollTop = list.scrollHeight;
		});
	}

	async function render({
		list,
		empty = null,
		surveyId,
		type = 'binary',
		theme = '',
		limit = DEFAULT_LIMIT,
		force = false,
	} = {}) {
		if (!list || !surveyId) return;

		list.classList.add('is-chat-preview', 'chat-preview-scroll-host');
		if (empty) empty.classList.add('hidden');

		const cacheKey = `${surveyId}:${normalizeType(type)}:${limit}`;
		const lastKey = list.dataset.chatPreviewKey || '';
		const lastFetch = Number(list.dataset.chatPreviewFetchedAt || 0);
		const isFresh = Date.now() - lastFetch < CACHE_TTL_MS;
		if (!force && lastKey === cacheKey && isFresh && list.dataset.chatPreviewLoaded === 'true') {
			return;
		}

		list.dataset.chatPreviewKey = cacheKey;
		list.dataset.chatPreviewLoaded = 'false';

		const loadingStack = createStack(list);
		renderStatusBubble(
			loadingStack,
			t('shared.chat_preview.loading', 'Chargement des messages du chat...'),
			'loading',
		);

		try {
			const messages = await fetchMessages({ surveyId, type, limit });
			const stack = createStack(list);
			if (!messages.length) {
				renderStatusBubble(
					stack,
					t(
						'shared.chat_preview.empty',
						`Bienvenue dans le chat du sondage "${theme || 'Sondage'}"`,
					),
				);
			} else {
				messages.forEach((message) => renderMessage(stack, message));
			}
			list.dataset.chatPreviewLoaded = 'true';
			list.dataset.chatPreviewFetchedAt = String(Date.now());
			finalizeScroll(list);
		} catch (_error) {
			const stack = createStack(list);
			renderStatusBubble(
				stack,
				t(
					'shared.chat_preview.unavailable',
					'Messages du chat momentanement indisponibles.',
				),
				'error',
			);
			list.dataset.chatPreviewLoaded = 'true';
			list.dataset.chatPreviewFetchedAt = String(Date.now());
		}
	}

	window.ChatPreviewRenderer = Object.freeze({ render });
})();
