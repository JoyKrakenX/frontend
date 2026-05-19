const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const chatroomHtml = read('chatroom.html');
const chatroomCss = read('chatroom-focus.css') + '\n' + read('chatroom.css');
const chatroomJs = read('chatroom.js');
const flashOverlayCss = read('survey-flash-overlay-results.css');
const modalCss = read('shared/modal-sheet.css');
const surveyHtml = read('survey.html');
const surveyCss = read('survey.css');
const createSurveyHtml = read('create-survey.html');
const createSurveyJs = read('create-survey.js');
const createSurveyChoicesHtml = read('create-survey-choices.html');
const createSurveyChoicesJs = read('create-survey-choices.js');
const browseCss = read('browse-surveys.css');
const browseJs = read('browse-surveys.js');
const mySurveysCss = read('my-surveys.css');
const mySurveysHtml = read('my-surveys.html');
const qrJs = read('qr-generator.js');
const mySurveysJs = read('my-surveys.js');
const adminResultsHtml = read('survey-results-admin.html');
const adminResultsJs = read('survey-results-admin.js');
const sharedChatPreviewJs = read('shared/chat-preview-renderer.js');
const sharedResultsSharePath = path.join(root, 'shared/results-share-snapshot.js');
assert.ok(
	fs.existsSync(sharedResultsSharePath),
	'shared results snapshot share helper must exist',
);
const sharedResultsShareJs = fs.readFileSync(sharedResultsSharePath, 'utf8');
const pwaServiceWorker = read('site-push-sw.js');
const htmlFiles = fs
	.readdirSync(root)
	.filter((file) => file.endsWith('.html'))
	.map((file) => [file, read(file)]);

htmlFiles.forEach(([file, source]) => {
	assert.doesNotMatch(
		source,
		/\?v=202(?:\d|[a-z-])*(?:user-menu-fix|close-glyph|panel-stats|plan-audit1)/,
		`${file} must not reference stale local asset cache tokens`,
	);
});

[
	'survey.js',
	'survey-choices.js',
	'survey-flash-binary.js',
	'survey-flash-multiple.js',
].forEach((file) => {
	const source = read(file);
	assert.doesNotMatch(source, /flash-chat-preview-frame/, `${file} must not inject iframe chat previews`);
	assert.doesNotMatch(source, /renderChatPreviewOverlay/, `${file} must render direct scrollable comments`);
	assert.match(source, /ChatPreviewRenderer\.render/, `${file} must use the shared chat message preview renderer`);
	assert.match(source, /openChatRoomFromPreview/, `${file} must keep click-through chatroom navigation`);
	assert.match(source, /pointerdown/, `${file} must track preview pointer start to distinguish scroll from click`);
	assert.match(source, /chatPreviewSuppressClick/, `${file} must suppress navigation after preview scroll or drag`);
});

[
	['survey.html', surveyHtml],
	['survey-choices.html', read('survey-choices.html')],
	['survey-flash-binary.html', read('survey-flash-binary.html')],
	['survey-flash-multiple.html', read('survey-flash-multiple.html')],
].forEach(([file, source]) => {
	assert.match(source, /shared\/chat-preview-renderer\.js/, `${file} must load the shared chat preview renderer`);
	assert.match(source, /shared\/results-share-snapshot\.js/, `${file} must load the shared results snapshot share helper`);
	assert.match(source, /chat (?:direct|en direct)/i, `${file} must label the preview as direct chat`);
	assert.doesNotMatch(source, /Participant comments|Commentaires des participants|Commentaires<\/span>|Comments<\/span>/i, `${file} must not keep legacy comments copy in the preview title`);
});

assert.match(sharedChatPreviewJs, /\/api\/chat\/\$\{encodeURIComponent\(surveyId\)\}\/messages/, 'shared chat preview must load real chatroom messages');
assert.match(sharedChatPreviewJs, /chat-message-bottom-spacer/, 'shared chat preview must include a spacer equivalent to chatroom');
assert.match(sharedChatPreviewJs, /chat-preview-message-list/, 'shared chat preview must render a scrollable message list');
assert.doesNotMatch(sharedChatPreviewJs, /live-opinion-card|flash-opinion/, 'shared chat preview must not render opinion cards');
assert.doesNotMatch(sharedChatPreviewJs, /message-inline-avatar/i, 'shared chat preview must not render inline avatar images');

assert.match(sharedResultsShareJs, /window\.CommunityResultsShare/, 'results snapshot helper must expose CommunityResultsShare');
assert.match(sharedResultsShareJs, /html2canvas@1\.4\.1/, 'results snapshot helper must load html2canvas when needed');
assert.match(sharedResultsShareJs, /share-snapshot-link/, 'results snapshot image must include a redirect link footer');
assert.match(sharedResultsShareJs, /community-snapshot-card/, 'results snapshot must compose a dedicated Community card');
assert.match(sharedResultsShareJs, /overlay-result-bars/, 'results snapshot must preserve progress bars');
assert.match(sharedResultsShareJs, /navigator\.canShare[\s\S]*files/, 'results snapshot helper must use native file sharing when available');
assert.match(sharedResultsShareJs, /navigator\.share[\s\S]*files/, 'results snapshot helper must send the generated image file through Web Share');
assert.match(sharedResultsShareJs, /downloadSnapshotImage/, 'results snapshot helper must provide a downloadable image fallback');
[
	['survey.js', '#live-overlay-result-card .overlay-card.results'],
	['survey-choices.js', '#live-overlay-result-card .overlay-card.results'],
	['survey-flash-binary.js', '#flash-overlay-result-card .overlay-card.results'],
	['survey-flash-multiple.js', '#flash-overlay-result-card .overlay-card.results'],
].forEach(([file, selector]) => {
	const source = read(file);
	assert.match(source, /CommunityResultsShare\.shareOverlaySnapshot/, `${file} must share a generated results snapshot`);
	assert.match(source, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file} must target the visible results overlay card`);
	assert.match(source, /behavior:\s*['"]smooth['"]/s, `${file} results button must smooth-scroll to the results overlay`);
});
assert.match(pwaServiceWorker, /community-pwa-v20260519-ui-billing-1/, 'PWA cache must be bumped for snapshot sharing');
assert.match(pwaServiceWorker, /\/shared\/results-share-snapshot\.js/, 'PWA precache must include the results snapshot share helper');
assert.match(pwaServiceWorker, /\/shared\/chat-preview-renderer\.js/, 'PWA precache must include the shared chat preview renderer');

assert.doesNotMatch(chatroomHtml, /id="sound-toggle-btn"/, 'chatroom sound button must be removed');
assert.doesNotMatch(chatroomHtml, /id="participants-btn"/, 'participants button must be removed from chatroom controls');
assert.doesNotMatch(chatroomHtml, /id="info-btn"/, 'info button must be removed from chatroom controls');
assert.match(chatroomHtml, /id="message-stat-trigger"[\s\S]*?aria-controls="info-panel"/, 'message stat must open info panel');
assert.match(chatroomHtml, /id="participants-stat-trigger"[\s\S]*?aria-controls="participants-panel"/, 'online stat must open participants panel');
assert.match(chatroomJs, /bindStatPanelTrigger\('participants-stat-trigger',\s*'participants-panel'/, 'participants stat trigger must bind participants panel');
assert.match(chatroomJs, /bindStatPanelTrigger\('message-stat-trigger',\s*'info-panel'/, 'message stat trigger must bind info panel');
assert.doesNotMatch(chatroomJs, /sound-toggle-btn/, 'chatroom JS must not bind removed sound button');
assert.match(
	chatroomCss,
	/#chat-live-video-stage[\s\S]*?border:\s*0\s*!important/,
	'chat live video stage must remove its own border',
);
assert.match(
	chatroomCss,
	/#chat-live-video-stage[\s\S]*?\.overlay-card[\s\S]*?border:\s*0\s*!important/,
	'chat live video stage descendants must remove visible borders',
);

assert.doesNotMatch(
	read('survey-flash-multiple.html'),
	/id="live-result-section"\s+class="flash-legacy-anchor"/,
	'flash multiple legacy live-result anchor must be removed',
);
assert.doesNotMatch(
	read('survey-flash-binary.html'),
	/id="live-result-section"\s+class="flash-legacy-anchor"/,
	'flash binary legacy live-result anchor must be removed',
);
assert.match(
	flashOverlayCss,
	/\.flash-results[\s\S]*?border:\s*0\s*!important/,
	'flash results parent containers must have borderless layout',
);
assert.match(
	flashOverlayCss,
	/\.overlay-card\.results[\s\S]*?border:\s*1px/,
	'result card border must remain visible',
);
assert.match(
	flashOverlayCss,
	/\.flash-comments-card[\s\S]*?border:\s*1px/,
	'comments card border must remain visible',
);

assert.doesNotMatch(modalCss, /animation:\s*modalSheet(?:Desktop|Mobile)In/, 'modal CSS must not auto-run sheet animations');
assert.match(modalCss, /\.modal\.hidden[\s\S]*?\.modal-content[\s\S]*?transform:/, 'hidden modal content must have a stable offscreen state');

assert.match(surveyHtml, /class="flash-meta-grid"/, 'classic survey header must use flash meta grid markup');
assert.match(surveyHtml, /<section class="card flash-survey-header">/, 'classic survey header must use the exact flash header section wrapper');
assert.match(surveyHtml, /id="created-date"/, 'classic survey header must expose created-date chip');
assert.match(surveyHtml, /id="ended-date"/, 'classic survey header must expose ended-date chip');
assert.doesNotMatch(surveyHtml, /id="survey-status"/, 'classic survey header must not keep the legacy survey-status text');
assert.match(surveyHtml, /class="survey-status-row"[\s\S]*?id="status-badge"[\s\S]*?id="votes-count"[\s\S]*?<section class="card flash-survey-header">/, 'classic survey pills must sit outside the header just above the flash header card');
['survey-choices.html', 'survey-flash-binary.html', 'survey-flash-multiple.html'].forEach((file) => {
	assert.match(read(file), /class="survey-status-row"[\s\S]*?id="status-badge"[\s\S]*?id="votes-count"[\s\S]*?<section class="card flash-survey-header">/, `${file} pills must sit outside the page header just above the flash header card`);
});
assert.match(read('survey.js'), /questionCard\.classList\.toggle\('is-hidden-after-vote',\s*shouldHide\)/, 'classic survey question card must hide after participation');
assert.match(surveyCss, /body\[data-page='survey'\][\s\S]*?\.flash-survey-header[\s\S]*?border-radius:\s*30px/, 'classic survey must inherit flash header visual radius');
assert.match(surveyCss, /body\[data-page='survey'\][\s\S]*?#survey-theme[\s\S]*?color:\s*#fff/, 'classic survey theme title must be white');
assert.match(surveyCss, /\.survey-status-row[\s\S]*?\.status-badge[\s\S]*?border-radius:\s*999px/, 'classic survey status row pills must use flash pill radius');
assert.match(surveyCss, /body\[data-page='survey'\][\s\S]*?\.meta-chip\s*>\s*span[\s\S]*?font-weight:\s*400/, 'classic survey meta chip text must not be bold');
assert.match(surveyCss, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.flash-meta-grid[\s\S]*?grid-template-columns:\s*1fr/, 'classic survey meta chips must stack on mobile');

assert.match(browseCss, /body\[data-page='browse-surveys'\][\s\S]*?\.welcome-card[\s\S]*?border-radius:\s*30px/, 'browse welcome card must match binary creation welcome radius');
assert.doesNotMatch(browseJs, /survey-participation-badge|survey-participation-check/, 'browse survey cards must not render the participation waiting badge');
assert.doesNotMatch(browseJs, /detail-item--type|survey-type-binary-pill|survey-type-options-icon|survey-type-label/, 'browse survey cards must not render the type detail row');
assert.doesNotMatch(browseJs, /survey-flash-indicator|flashIndicatorMarkup/, 'browse survey cards must not render the Flash badge');
assert.match(read('survey-flash-binary.html'), /class="flash-title-row"[\s\S]*?id="survey-theme"[\s\S]*?survey-flash-indicator/, 'flash binary header must place the Flash badge beside the theme title');
assert.match(read('survey-flash-multiple.html'), /class="flash-title-row"[\s\S]*?id="survey-theme"[\s\S]*?survey-flash-indicator/, 'flash multiple header must place the Flash badge beside the theme title');
assert.doesNotMatch(
	htmlFiles.map(([, source]) => source).join('\n') + '\n' + mySurveysJs + '\n' + read('shared/user-menu.js'),
	new RegExp(['fa', 'chart', 'bar'].join('-')),
	'Community frontend must replace the legacy bar chart icon with a more modern chart icon',
);
assert.match(mySurveysCss, /body\[data-page='my-surveys'\][\s\S]*?\.welcome-card[\s\S]*?border-radius:\s*30px/, 'my-surveys welcome card must match binary creation welcome radius');
assert.match(mySurveysHtml, /<div class="stats-summary">[\s\S]*?id="open-count"[\s\S]*?id="closed-count"[\s\S]*?id="total-votes"[\s\S]*?<\/div>/, 'my-surveys stats must stay in one summary container');
assert.match(mySurveysCss, /body\[data-page='my-surveys'\][\s\S]*?\.stats-summary[\s\S]*?display:\s*inline-flex/, 'my-surveys stats summary must be inline-sized');

assert.match(createSurveyHtml, /id="binary-options-btn"/, 'binary option selector trigger must exist');
assert.match(createSurveyHtml, /id="binary-options-modal"/, 'binary option selector modal must exist');
assert.match(createSurveyJs, /binaryLabels/, 'create survey payload must include binary labels');
assert.match(createSurveyJs, /Oui\s*\/\s*Non[\s\S]*?Vrai\s*\/\s*Faux[\s\S]*?Pour\s*\/\s*Contre[\s\S]*?D.accord\s*\/\s*Pas d.accord[\s\S]*?Satisfait\s*\/\s*Insatisfait[\s\S]*?Accepter\s*\/\s*Refuser/s, 'all binary presets must be defined');
assert.doesNotMatch(createSurveyHtml, /id="status-modal"/, 'binary survey creation must not include the visibility modal');
assert.doesNotMatch(createSurveyChoicesHtml, /id="status-modal"/, 'multiple survey creation must not include the visibility modal');
assert.doesNotMatch(createSurveyJs, /selectedSurveyStatus|hasConfirmedSurveyStatus|ensureStatusIsConfirmed|status:\s*normalizeSurveyStatusInput/, 'binary survey creation JS must not keep visibility state or send status');
assert.doesNotMatch(createSurveyChoicesJs, /visibilityStatus|visibilityConfirmed|ensureStatusIsConfirmed|status:\s*normalizeSurveyStatus/, 'multiple survey creation JS must not keep visibility state or send status');
assert.match(createSurveyJs, /#binary-options-modal \[data-modal-close\]/, 'binary options modal close buttons must have explicit scoped close binding');
assert.doesNotMatch(createSurveyHtml, /id="refresh-btn"|id="preview-btn"/, 'binary creation header must not expose refresh or preview buttons');
assert.doesNotMatch(createSurveyChoicesHtml, /id="refresh-btn"|id="preview-btn"/, 'multiple creation header must not expose refresh or preview buttons');
assert.match(createSurveyHtml + createSurveyChoicesHtml, /class="preview-close-icon"/, 'mobile preview close action must use a compact x icon button');

assert.match(
	qrJs,
	/test-survey-btn[\s\S]{0,240}openLink\(currentLinks\.results\)/,
	'QR tester must open admin results instead of the public answer page',
);
assert.doesNotMatch(mySurveysJs, /details-btn/, 'my-surveys cards must not render a Voir details button');
assert.doesNotMatch(mySurveysCss, /details-btn/, 'my-surveys must not keep dead Voir button styles');
assert.match(mySurveysJs, /survey-results-admin\.html\?Id=/, 'my-surveys card click must open admin results page');
assert.match(adminResultsHtml, /id="admin-vote-gate"/, 'admin results page must contain a vote gate');
assert.match(adminResultsJs, /ADMIN_VOTE_REQUIRED[\s\S]*?renderAdminVoteGate/, 'admin results page must render vote gate before results');
assert.match(adminResultsJs, /submitAdminVoteFromResultsPage[\s\S]*?getAdminVoteEndpoint/, 'admin vote gate must submit from the admin results page');

console.log('community implementation contract ok');
