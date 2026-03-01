/** @format */

(function initDependencyLoader(global) {
	const DEFAULT_TIMEOUT_MS = 2500;
	const CHECK_INTERVAL_MS = 50;
	const pendingByName = new Map();

	function getDependencyName(dependency) {
		const rawName =
			dependency?.name || dependency?.localSrc || dependency?.src || 'dependency';
		return String(rawName).trim();
	}

	function isDependencyAvailable(dependency) {
		try {
			return Boolean(dependency?.test?.());
		} catch (_error) {
			return false;
		}
	}

	function toAbsoluteUrl(src) {
		try {
			return new URL(String(src || ''), global.location.origin).href;
		} catch (_error) {
			return String(src || '');
		}
	}

	function findExistingScript(localSrc) {
		const scripts = global.document?.querySelectorAll?.('script[src]');
		if (!scripts?.length) return null;
		const expected = toAbsoluteUrl(localSrc);
		for (const script of scripts) {
			const actual = toAbsoluteUrl(script.getAttribute('src'));
			if (actual === expected) return script;
		}
		return null;
	}

	function injectScript(localSrc) {
		const existing = findExistingScript(localSrc);
		if (existing) return existing;

		const script = global.document.createElement('script');
		script.src = String(localSrc || '');
		script.async = false;
		script.defer = false;
		script.setAttribute('data-dependency-loader', 'true');
		(global.document.head || global.document.body || global.document.documentElement).appendChild(
			script,
		);
		return script;
	}

	function normalizeTimeout(value) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
	}

	function ensureDependency(dependency = {}) {
		const name = getDependencyName(dependency);
		if (isDependencyAvailable(dependency)) {
			return Promise.resolve({
				name,
				ok: true,
				source: 'runtime',
			});
		}

		if (pendingByName.has(name)) {
			return pendingByName.get(name);
		}

		const timeoutMs = normalizeTimeout(dependency.timeoutMs);
		const localSrc =
			typeof dependency.localSrc === 'string' && dependency.localSrc.trim() ?
				dependency.localSrc.trim()
			:	'';

		const promise = new Promise((resolve) => {
			let settled = false;
			let checkerId = null;
			let timeoutId = null;
			let scriptNode = null;
			let onLoad = null;
			let onError = null;

			const finish = (result) => {
				if (settled) return;
				settled = true;
				if (checkerId) global.clearInterval(checkerId);
				if (timeoutId) global.clearTimeout(timeoutId);
				if (scriptNode && onLoad) {
					scriptNode.removeEventListener('load', onLoad);
				}
				if (scriptNode && onError) {
					scriptNode.removeEventListener('error', onError);
				}
				pendingByName.delete(name);
				resolve({ name, ...result });
			};

			const checkNow = () => {
				if (isDependencyAvailable(dependency)) {
					finish({
						ok: true,
						source: localSrc ? 'local' : 'runtime',
					});
				}
			};

			timeoutId = global.setTimeout(() => {
				finish({
					ok: false,
					error: 'timeout',
					source: localSrc || 'runtime',
				});
			}, timeoutMs);

			checkerId = global.setInterval(checkNow, CHECK_INTERVAL_MS);

			if (localSrc) {
				scriptNode = injectScript(localSrc);
				onLoad = () => checkNow();
				onError = () => {
					finish({
						ok: false,
						error: 'load_error',
						source: localSrc,
					});
				};
				scriptNode.addEventListener('load', onLoad);
				scriptNode.addEventListener('error', onError);
			}

			checkNow();
		});

		pendingByName.set(name, promise);
		return promise;
	}

	async function ensureDependencies(dependencies = []) {
		const result = {};
		for (const dependency of dependencies) {
			const response = await ensureDependency(dependency);
			result[getDependencyName(dependency)] = Boolean(response.ok);
		}
		return result;
	}

	global.ensureDependency = ensureDependency;
	global.ensureDependencies = ensureDependencies;
})(window);
