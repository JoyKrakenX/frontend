const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(frontendRoot, '..', 'backend');
const readFrontend = (file) => fs.readFileSync(path.join(frontendRoot, file), 'utf8');
const readBackend = (file) => fs.readFileSync(path.join(backendRoot, file), 'utf8');

const adminHtml = readFrontend('survey-results-admin.html');
const adminJs = readFrontend('survey-results-admin.js');
const adminCss = readFrontend('survey-results-admin.css');
const qrRoute = readBackend('routes/qrcode.js');
const app = readBackend('app.js');
const surveyAnalyticsRoute = readBackend('routes/surveyAnalytics.js');
const surveyAnalyticsModel = readBackend('models/SurveyAnalyticsEvent.js');
const surveyAnalyticsService = readBackend('services/surveyAnalyticsService.js');

assert.doesNotMatch(adminHtml, /fraud-admin-panel|quarantine-table|quarantine-status|fraud-integrity-card/i);
assert.doesNotMatch(adminJs, /loadQuarantineQueue|reviewQuarantineOpinion|getQuarantineEndpoint|fraud-admin-panel/i);
assert.doesNotMatch(adminCss, /fraud-admin-panel|quarantine-table|fraud-integrity-card/i);
assert.doesNotMatch(adminHtml, /id="detailed-stats"|class="opinions-section"/, 'legacy detailed stats and opinions UI must be removed from admin results');
assert.doesNotMatch(adminJs, /document\.getElementById\('detailed-stats'\)\.innerHTML|renderBinaryOpinions|renderMultipleOpinions/, 'admin JS must not render deleted stats/opinions sections');
assert.match(adminHtml, /id="survey-header"[\s\S]*?id="admin-overlay-result-card"[\s\S]*?id="admin-analytics-dashboard"/, 'admin overlay result card must sit directly below the survey header and before analytics dashboard');
assert.match(adminCss, /body\[data-page='survey-results-admin'\][\s\S]*?\.analytics-card[\s\S]*?background:\s*linear-gradient\([\s\S]*?rgba\(17,\s*24,\s*39/i, 'admin analytics cards must reuse the dark Community overlay atmosphere');

[
	'analytics-kpi-strip',
	'qr-acquisition-card',
	'conversion-card',
	'opinion-dynamics-card',
	'chat-activity-card',
	'profile-card',
	'retention-card',
].forEach((token) => {
	assert.match(adminHtml + adminJs + adminCss, new RegExp(token), `${token} must exist in the admin analytics dashboard`);
});

assert.match(adminJs, /fetchAdminAnalytics/, 'admin page must fetch the dedicated analytics endpoint');
assert.match(adminJs, /survey-analytics\/\$\{encodeURIComponent\(id\)\}\/admin/, 'admin page must call the analytics admin API');
assert.match(adminJs, /analytics:update/, 'admin page must listen for realtime analytics updates');
assert.match(adminJs, /audience participante active/i, 'admin export must include active-participant audience disclaimer');
assert.doesNotMatch(adminJs, /fetchAllQuarantineItemsForExport|nonCleanRawItems|confirmedFraudVotes|quarantinedVotes/i, 'exports must not include quarantine/fraud sections');
assert.doesNotMatch(adminJs, /replay:\s*'Replay'|unknown:\s*'Inconnu'|countryName \|\| countryCode \|\| 'Unknown'/, 'admin analytics UI must not expose Replay, Inconnu or Unknown country labels');
assert.match(adminJs, /filterKnownAnalyticsCountries/, 'admin analytics must filter unknown countries out of Top 5 display and exports');

assert.match(surveyAnalyticsModel, /scanId/, 'analytics event model must store scanId');
assert.match(surveyAnalyticsModel, /countryCode/, 'analytics event model must store country code');
assert.doesNotMatch(surveyAnalyticsModel, /\bip\b\s*:/i, 'analytics event model must never store a raw IP field');
assert.match(surveyAnalyticsService, /buildAdminAnalyticsSnapshot/, 'analytics service must expose the admin snapshot builder');
assert.match(surveyAnalyticsService, /topCountries/, 'analytics service must compute top scan countries');
assert.match(surveyAnalyticsService, /averageScanToVoteSeconds/, 'analytics service must compute scan-to-vote delay');
assert.match(surveyAnalyticsService, /returningVoters/, 'analytics service must compute retention');

assert.match(surveyAnalyticsRoute, /router\.post\('\/:surveyId\/scan'/, 'analytics route must expose public scan logging');
assert.match(surveyAnalyticsRoute, /router\.get\('\/:surveyId\/admin'/, 'analytics route must expose admin analytics');
assert.match(app, /\/api\/survey-analytics/, 'app must mount survey analytics routes');

assert.match(qrRoute, /trackableUrls/, 'QR response must expose source-tagged trackable URLs');
assert.match(qrRoute, /source:\s*'tv'/, 'QR route must generate a TV source URL');
assert.match(qrRoute, /source:\s*'social'/, 'QR route must generate a social source URL');
assert.match(qrRoute, /source:\s*'direct'/, 'QR route must generate a direct source URL');
assert.doesNotMatch(qrRoute, /source:\s*'replay'/, 'QR route must not advertise replay as a visible analytics source');

['survey.html', 'survey-choices.html', 'survey-flash-binary.html', 'survey-flash-multiple.html'].forEach((file) => {
	assert.match(readFrontend(file), /shared\/survey-analytics-tracker\.js/, `${file} must load the scan tracker`);
});
['survey.js', 'survey-choices.js', 'survey-flash-binary.js', 'survey-flash-multiple.js'].forEach((file) => {
	const source = readFrontend(file);
	assert.match(source, /CommunitySurveyAnalytics\.getScanId/, `${file} must send scanId with votes`);
});
assert.match(readFrontend('chatroom.js'), /CommunitySurveyAnalytics\.recordEmojiReaction/, 'chatroom must record emoji analytics events');

console.log('admin analytics contract ok');
