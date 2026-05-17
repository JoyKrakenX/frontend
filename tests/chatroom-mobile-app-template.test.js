const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'chatroom.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'chatroom-live-template.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'chatroom.js'), 'utf8');

const requiredHtmlIds = [
	'community-mobile-watch-stage',
	'community-mobile-sheet-handle',
	'community-mobile-viewer-count',
	'community-mobile-xp-pill',
	'community-mobile-filter-btn',
	'community-mobile-filter-sheet',
	'community-mobile-reactions-rail',
	'community-mobile-replies-view',
	'community-mobile-message-actions-sheet',
	'community-mobile-gift-card',
];

requiredHtmlIds.forEach((id) => {
	assert.match(html, new RegExp(`id="${id}"`), `missing #${id} in chatroom.html`);
});

const requiredCssSelectors = [
	'.community-mobile-watch-stage',
	'.community-mobile-app-header',
	'.community-mobile-filter-sheet',
	'.community-mobile-reactions-rail',
	'.community-mobile-replies-view',
	'.community-mobile-message-actions-sheet',
	'.community-mobile-keyboard-open',
];

requiredCssSelectors.forEach((selector) => {
	assert.ok(css.includes(selector), `missing ${selector} in chatroom-live-template.css`);
});

[
	'function setCommunityMobileSheetState',
	'function startCommunityMobileSheetDrag',
	'function finishCommunityMobileSheetDrag',
	'function openCommunityMobileFilterSheet',
	'function closeCommunityMobileFilterSheet',
	'function openCommunityMobileMessageActions',
	'function openCommunityMobileRepliesView',
	'function syncCommunityMobileViewerCount',
	'function formatCommunityMobilePseudo',
	'function initializeCommunityMobileAppTemplate',
].forEach((signature) => {
	assert.ok(js.includes(signature), `missing ${signature} in chatroom.js`);
});

assert.match(
	js,
	/window\.addEventListener\('pointerup',\s*finishCommunityMobileSheetDrag\)/,
	'mobile sheet drag must finish even when the pointer leaves the handle',
);
assert.match(
	js,
	/window\.addEventListener\('pointercancel',\s*finishCommunityMobileSheetDrag\)/,
	'mobile sheet drag must clean up on pointer cancellation',
);
assert.match(
	js,
	/community-mobile-close-chat[\s\S]{0,260}leaveChatRoomAndExit/,
	'mobile header X must leave the chatroom instead of only dismissing the sheet',
);
assert.match(
	js,
	/message-username" title="\$\{escapeHtml\(displayPseudo\)\}">\$\{escapeHtml\(displayPseudo\)\}<\/span>/,
	'mobile stream usernames must use the formatted display handle',
);

assert.match(
	html,
	/<button[^>]+data-mobile-filter-mode="top"[\s\S]*?Principaux messages/,
	'mobile filter sheet must expose Principaux messages',
);
assert.match(
	html,
	/<button[^>]+data-mobile-filter-mode="all"[\s\S]*?Tous les messages/,
	'mobile filter sheet must expose Tous les messages',
);

assert.match(
	css,
	/community-mobile-reactions-collapsed[\s\S]*?community-mobile-reactions-rail[\s\S]*?height:\s*76px/,
	'collapsed mobile reactions rail must become a single compact bubble',
);
assert.match(
	css,
	/community-mobile-chat-fullscreen[\s\S]*?top:\s*var\(--community-mobile-sheet-top-full\)\s*!important/,
	'mobile fullscreen sheet state must override focus-layout sizing',
);
assert.match(
	css,
	/community-mobile-chat-peek[\s\S]*?top:\s*var\(--community-mobile-sheet-top-peek\)\s*!important/,
	'mobile peek sheet state must override focus-layout sizing',
);
assert.match(
	css,
	/community-mobile-chat-dismissed[\s\S]*?transform:\s*translateY\(calc\(100% - 34px\)\)\s*!important/,
	'mobile dismissed sheet state must override focus-layout transforms',
);
assert.match(
	css,
	/community-mobile-reactions-collapsed[\s\S]*?community-mobile-rail-collapse[\s\S]*?display:\s*none/,
	'collapsed mobile reactions rail must hide the collapse arrow',
);
assert.match(
	css,
	/community-mobile-replies-header[\s\S]*?background:\s*#fff/,
	'mobile replies header must stay white with black controls',
);
assert.match(
	css,
	/community-top-fans-header[\s\S]*?background:\s*#fff/,
	'mobile Top fans header must stay white with black controls',
);

console.log('chatroom mobile app-like contract ok');
