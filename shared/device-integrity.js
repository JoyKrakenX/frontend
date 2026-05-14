/** @format */

(function () {
	'use strict';

	const DB_NAME = 'community-device-integrity';
	const STORE_NAME = 'keys';
	const KEY_ID = 'primary-ecdsa-p256';
	const VERSION = 'device-integrity-v2';
	const SELECTED_COMPONENTS = [
		'audio',
		'canvas',
		'colorDepth',
		'deviceMemory',
		'fontPreferences',
		'fonts',
		'hardwareConcurrency',
		'languages',
		'math',
		'platform',
		'plugins',
		'screenFrame',
		'screenResolution',
		'timezone',
		'touchSupport',
		'vendor',
		'vendorFlavors',
		'webGlBasics',
		'webGlExtensions',
	];

	const enc = new TextEncoder();

	const stableStringify = (value) => {
		if (value === null || typeof value !== 'object') return JSON.stringify(value);
		if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(',')}}`;
	};

	const toBase64Url = (buffer) => {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		bytes.forEach((byte) => {
			binary += String.fromCharCode(byte);
		});
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
	};

	const compactValue = (value, max = 700, depth = 0) => {
		if (depth > 4) return '[depth-limit]';
		if (value === null || typeof value === 'undefined') return null;
		if (typeof value === 'number' || typeof value === 'boolean') return value;
		if (typeof value === 'string') return value.slice(0, max);
		if (Array.isArray(value)) {
			return value
				.slice(0, 25)
				.map((entry) => compactValue(entry, Math.floor(max / 2), depth + 1));
		}
		if (typeof value === 'object') {
			return Object.keys(value)
				.sort()
				.slice(0, 35)
				.reduce((acc, key) => {
					acc[String(key).slice(0, 80)] = compactValue(
						value[key],
						Math.floor(max / 2),
						depth + 1,
					);
					return acc;
				}, {});
		}
		return String(value).slice(0, max);
	};

	const openDb = () =>
		new Promise((resolve, reject) => {
			if (!window.indexedDB) return resolve(null);
			const request = window.indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

	const readStoredKeyPair = async () => {
		const db = await openDb();
		if (!db) return null;
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const request = tx.objectStore(STORE_NAME).get(KEY_ID);
			request.onsuccess = () => resolve(request.result?.keyPair || null);
			request.onerror = () => resolve(null);
		});
	};

	const writeStoredKeyPair = async (keyPair) => {
		const db = await openDb();
		if (!db) return false;
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).put({
				id: KEY_ID,
				keyPair,
				updatedAt: new Date().toISOString(),
			});
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => resolve(false);
		});
	};

	const getKeyPair = async () => {
		if (!window.crypto?.subtle || !window.isSecureContext) return null;
		const stored = await readStoredKeyPair().catch(() => null);
		if (stored?.privateKey && stored?.publicKey) return stored;
		const keyPair = await window.crypto.subtle.generateKey(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['sign', 'verify'],
		);
		await writeStoredKeyPair(keyPair).catch(() => false);
		return keyPair;
	};

	const getWebGlInfo = () => {
		try {
			const canvas = document.createElement('canvas');
			const gl =
				canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
			if (!gl) return {};
			const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
			if (!debugInfo) return {};
			return {
				vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
				renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
			};
		} catch (_error) {
			return {};
		}
	};

	const collectUaData = async () => {
		const uaData = navigator.userAgentData;
		const base = {
			platform: uaData?.platform || '',
			mobile: Boolean(uaData?.mobile),
		};
		if (!uaData?.getHighEntropyValues) return base;
		try {
			const high = await uaData.getHighEntropyValues([
				'architecture',
				'bitness',
				'model',
				'platformVersion',
				'uaFullVersion',
				'fullVersionList',
				'wow64',
			]);
			return {
				...base,
				architecture: high.architecture || '',
				bitness: high.bitness || '',
				model: high.model || '',
				platformVersion: high.platformVersion || '',
				uaFullVersion: high.uaFullVersion || '',
				fullVersionList: compactValue(high.fullVersionList || [], 500),
				wow64: Boolean(high.wow64),
			};
		} catch (_error) {
			return {
				...base,
				highEntropyStatus: 'unavailable',
			};
		}
	};

	const collectSignals = async () => ({
		screen: {
			width: Number(window.screen?.width || 0),
			height: Number(window.screen?.height || 0),
			availWidth: Number(window.screen?.availWidth || 0),
			availHeight: Number(window.screen?.availHeight || 0),
			colorDepth: Number(window.screen?.colorDepth || 0),
			pixelRatio: Number(window.devicePixelRatio || 0),
		},
		timezone:
			Intl.DateTimeFormat?.().resolvedOptions?.().timeZone ||
			'',
		timezoneOffset: new Date().getTimezoneOffset(),
		languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 8) : [],
		platform: navigator.platform || '',
		vendor: navigator.vendor || '',
		maxTouchPoints: Number(navigator.maxTouchPoints || 0),
		hardwareConcurrency: Number(navigator.hardwareConcurrency || 0),
		deviceMemory: Number(navigator.deviceMemory || 0),
		uaData: await collectUaData(),
		webgl: getWebGlInfo(),
	});

	const getFingerprintReport = async () => {
		try {
			if (!window.FingerprintJS?.load) return { visitorId: '', confidence: null, components: {} };
			const agent = await window.FingerprintJS.load();
			const result = await agent.get();
			const components = {};
			const source = result?.components || {};
			SELECTED_COMPONENTS.forEach((name) => {
				if (!Object.prototype.hasOwnProperty.call(source, name)) return;
				const entry = source[name];
				components[name] = {
					value: compactValue(entry?.value ?? entry, 900),
					error: entry?.error ? String(entry.error).slice(0, 180) : undefined,
				};
			});
			return {
				visitorId: result?.visitorId || '',
				confidence: result?.confidence?.score || null,
				components,
			};
		} catch (_error) {
			return { visitorId: '', confidence: null, components: {} };
		}
	};

	const getDeviceIntegrityPayload = async ({ surveyId, surveyType }) => {
		const challengeId =
			window.crypto?.randomUUID?.() ||
			`${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const createdAt = new Date().toISOString();
		const keyPair = await getKeyPair().catch(() => null);
		const publicKey =
			keyPair?.publicKey ?
				await window.crypto.subtle.exportKey('jwk', keyPair.publicKey).catch(() => null)
			:	null;
		const signals = await collectSignals();
		const fingerprint = await getFingerprintReport();
		const signedPayloadObject = {
			version: 2,
			challengeId,
			createdAt,
			signalsVersion: VERSION,
			context: {
				surveyId: String(surveyId || ''),
				surveyType: String(surveyType || ''),
			},
			publicKey,
			fingerprint: {
				visitorId: fingerprint.visitorId || '',
				confidence: fingerprint.confidence,
				signals,
				components: fingerprint.components || {},
			},
		};
		const signedPayload = stableStringify(signedPayloadObject);
		const signature =
			keyPair?.privateKey ?
				await window.crypto.subtle
					.sign(
						{ name: 'ECDSA', hash: 'SHA-256' },
						keyPair.privateKey,
						enc.encode(signedPayload),
					)
					.then(toBase64Url)
					.catch(() => '')
			:	'';

		return {
			version: 2,
			challengeId,
			createdAt,
			signalsVersion: VERSION,
			publicKey,
			signedPayload,
			signature,
			fingerprint: {
				visitorId: fingerprint.visitorId || '',
				confidence: fingerprint.confidence,
				signals,
				components: fingerprint.components || {},
			},
		};
	};

	window.CommunityDeviceIntegrity = {
		version: VERSION,
		getDeviceIntegrityPayload,
	};
})();
