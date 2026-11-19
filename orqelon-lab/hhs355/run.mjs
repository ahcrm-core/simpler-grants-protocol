/** Native Safari/VoiceOver observations. Does not repair or programmatically focus the page. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACCEPTANCE_SHA = '4b8bb6f32bfeba87b43195691bae9df3f6a67dc54321316257d1a95d53660727';
const INITIAL_KEY = 'Option+Tab'; // Frozen before either role runs; no adaptive fallback.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = data => createHash('sha256').update(data).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => {
  if (i % 2 === 0) pairs.push([value.replace(/^--/, ''), all[i + 1]]);
  return pairs;
}, []));
if (!['baseline', 'candidate'].includes(args.role) || !args['product-dir'] || !args['output-dir']) {
  throw new Error('Required: --product-dir PATH --output-dir PATH --role baseline|candidate');
}
const PRODUCT = path.resolve(args['product-dir']);
const OUT = path.resolve(args['output-dir']);
const CLIENT = path.join(PRODUCT, 'website/dist/client');
fs.mkdirSync(OUT, { recursive: true });
for (const name of ['result.json', 'events.jsonl', 'voiceover-safari.mov']) {
  if (fs.existsSync(path.join(OUT, name))) throw new Error(`Refusing existing run evidence: ${name}`);
}
const started = performance.now();
const report = {
  schema: 'HHS355_NATIVE_VOICEOVER_RUN_V1', role: args.role,
  startedAtUTC: new Date().toISOString(), initialNavigationKey: INITIAL_KEY,
  scope: 'API-docs route; native Safari/VoiceOver only',
  cases: [], evidenceGates: {
    'RECORDING-01': { status: 'UNVERIFIED', reason: 'Actual movie frames require independent review.' },
    'RECORDING-02': { status: 'UNVERIFIED', reason: 'Actual system-audio signal and utterances require independent verification.' },
  }, errors: [], status: 'INCOMPLETE',
};
const json = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n');
const event = (kind, value = {}) => {
  const entry = { atUTC: new Date().toISOString(), elapsedMs: performance.now() - started, kind, ...value };
  fs.appendFileSync(path.join(OUT, 'events.jsonl'), JSON.stringify(entry) + '\n');
  return entry;
};
const errorText = error => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
async function command(file, argv, options = {}) {
  const { stdout } = await exec(file, argv, { encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024, ...options });
  return stdout.trim();
}
async function optionalCommand(file, argv, options = {}) {
  try { return { status: 'OBSERVED', value: await command(file, argv, options) }; }
  catch (error) { return { status: 'UNAVAILABLE', error: errorText(error) }; }
}
function inventory(root) {
  const entries = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) {
        const bytes = fs.readFileSync(file);
        entries.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: bytes.length, sha256: sha(bytes) });
      } else throw new Error(`Unexpected non-file build entry: ${file}`);
    }
  }
  walk(root);
  return { algorithm: 'sha256(JSON.stringify(sorted path/bytes/sha256 entries))', sha256: sha(JSON.stringify(entries)), entries };
}
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} exceeded ${milliseconds}ms`);
        error.code = 'HARNESS_ACTION_TIMEOUT';
        reject(error);
      }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Observation only: no DOM writes, focus movement, synthetic events, or product repair.
const DOM_READ = `JSON.stringify((() => {
  const active = document.activeElement;
  const skip = document.querySelector('a.sl-skip-link');
  const heading = document.querySelector('h1#_top');
  const version = document.querySelector('#version-select');
  const servers = document.querySelectorAll('#swagger-ui .scheme-container .servers select');
  const server = servers[0];
  const rect = element => { const r = element?.getBoundingClientRect(); return r ? {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height} : null; };
  const h = rect(heading), s = rect(skip);
  const text = element => element?.textContent?.trim() || '';
  return {
    atBrowserUTC: new Date().toISOString(), url: location.href, readyState: document.readyState,
    documentHasFocus: document.hasFocus(),
    title: document.title, viewportHeight: innerHeight, viewportWidth: innerWidth,
    activeTag: active?.tagName, activeId: active?.id, activeText: text(active).slice(0,200),
    activeInMain: !!active?.closest('main'), skipCount: document.querySelectorAll('a.sl-skip-link').length,
    skipFocused: active === skip, skipRect:s,
    skipVisible: !!s && s.width>0 && s.height>0 && s.top>=0 && s.bottom<=innerHeight && s.left>=0 && s.right<=innerWidth && getComputedStyle(skip).visibility!=='hidden',
    headingFocused: active===heading, headingInMain:!!heading?.closest('main'), headingRect:h,
    headerRect:rect(document.querySelector('header')),
    versionFocused: active===version, versionValue:version?.value,
    versionOptions:version ? Array.from(version.options, o=>({value:o.value,text:o.text,selected:o.selected})) : [],
    serverCount:servers.length, serverFocused:active===server, serverValue:server?.value,
    serverAriaLabel:server?.getAttribute('aria-label'),
    renderedVersion:text(document.querySelector('#swagger-ui .info .version'))
  };
})())`;
let voiceOver, macOSQuit, MacOSApplications;
let voStarted = false, server, recorder, recorderDone, recorderExit;
let stage = 'preflight';
const recorderPaths = {
  movie: path.join(OUT, 'voiceover-safari.mov'), lifecycle: path.join(OUT, 'recorder-lifecycle.json'),
  ready: path.join(OUT, 'recorder.ready'), stop: path.join(OUT, 'recorder.stop'),
};
function checkRecorder() {
  if (recorder && recorderExit !== undefined) {
    const error = new Error(`Recorder exited during session: ${JSON.stringify(recorderExit)}`);
    error.code = 'RECORDER_EXITED';
    throw error;
  }
}
async function snapshot(label) {
  checkRecorder();
  const script = 'on run argv\n tell application "Safari" to do JavaScript (item 1 of argv) in document 1\nend run';
  const observed = JSON.parse(await command('/usr/bin/osascript', ['-e', script, DOM_READ]));
  observed.frontmostProcess = await optionalCommand('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true']);
  event('dom-observation', { label, observed });
  return observed;
}
async function screen(label) {
  const file = `${label.replace(/[^A-Za-z0-9_-]/g, '_')}.png`;
  await command('/usr/sbin/screencapture', ['-x', path.join(OUT, file)]);
  event('screen-frame', { label, file, sha256: sha(fs.readFileSync(path.join(OUT, file))) });
  return file;
}
async function key(value) {
  checkRecorder();
  event('native-key-start', { key: value });
  await bounded(voiceOver.press(value, { application: MacOSApplications.Safari, capture: false }), 20_000, `Native key ${value}`);
  event('native-key-end', { key: value });
}
async function freshSpeech(label) {
  checkRecorder();
  const beforeFocus = await snapshot(`${label}-before-vo-f4`);
  const before = (await voiceOver.spokenPhraseLog()).length;
  const checkpoint = event('vo-f4-start', { label, logOffset: before });
  // In Guidepup 0.40.0 perform() activates VoiceOver itself. Send the same
  // native VO-F4 chord to Safari so measurement does not steal app focus.
  await bounded(voiceOver.press('Control+Option+F4', { application: MacOSApplications.Safari, capture: true }), 25_000, `VO-F4 ${label}`);
  const log = await voiceOver.spokenPhraseLog();
  const phrases = log.slice(before);
  const afterFocus = await snapshot(`${label}-after-vo-f4`);
  const result = { label, startedAtUTC: checkpoint.atUTC, logOffset: before, logEnd: log.length, phrases, freshEvent: phrases.length > 0, hasNonEmptyCapture:phrases.some(s=>s.trim().length>0), beforeFocus, afterFocus };
  json('spoken-phrases.json', log);
  event('vo-f4-end', result);
  return result;
}
async function waitFor(label, predicate, timeout = 15_000) {
  const start = performance.now();
  let state;
  do {
    state = await snapshot(label);
    if (predicate(state)) return state;
    await delay(250);
  } while (performance.now() - start < timeout);
  throw new Error(`Readiness timeout ${label}; last observation ${JSON.stringify(state)}`);
}
const readyFor = (state, version) => state.readyState === 'complete' && state.serverCount === 1 &&
  state.versionValue === version && state.serverValue === `/api/v${version}` && state.renderedVersion.includes(version);
async function navigateTo(label, property, navigationKey) {
  for (let count = 0; count <= 40; count++) {
    const state = await snapshot(`${label}-${count}`);
    if (state[property]) return state;
    if (count < 40) await key(navigationKey);
  }
  throw new Error(`Native navigation did not reach ${label} within 40 ${navigationKey} keys`);
}
const normalizedSpeech = speech => speech.phrases.join(' ').toLowerCase()
  .replace(/\bzero\b/g, '0').replace(/\bfive\b/g, '5').replace(/\bfour\b/g, '4')
  .replace(/\b(?:point|dot)\b/g, '.').replace(/\bslash\b/g, '/')
  .replace(/\s*([/.])\s*/g, '$1').replace(/\bv\s+(?=0)/g, 'v').replace(/\s+/g, ' ').trim();
function speechCheck(speech, purpose, version) {
  if (!speech.freshEvent) return { status: 'UNVERIFIED', reason: 'No new captured speech event after this VO-F4.' };
  const text = normalizedSpeech(speech);
  let matches = false;
  if (purpose === 'heading') matches = /open\s*api docs/.test(text) && /heading/.test(text);
  if (purpose === 'version') matches = /api version/.test(text) && text.includes(version);
  if (purpose === 'server') matches = /\bservers?\b/.test(text) && text.includes(`/api/v${version}`);
  return { status: matches ? 'PASS' : 'UNVERIFIED', reason: matches ? 'Fresh actual phrase text matches the frozen semantic requirement.' : 'Fresh captured words do not unambiguously establish the required purpose/value; retain for review.', normalizedText: text };
}
function caseResult(id, observations, conditions, speech) {
  const failed = Object.entries(conditions).filter(([, ok]) => !ok).map(([name]) => name);
  const status = failed.length ? 'FAIL' : speech && speech.status !== 'PASS' ? speech.status : 'PASS';
  const result = { id, status, observations, conditions, failedConditions: failed, ...(speech ? { speechEvaluation: speech } : {}) };
  report.cases.push(result);
  json('result.json', report);
  event('case-result', { id, status, failedConditions: failed });
  return result;
}
async function isolatedCase(id, fn) {
  stage = id;
  try { await fn(); }
  catch (error) {
    report.cases.push({ id, status: 'ERROR', error: errorText(error), classification: 'REQUIRES_TRIAGE', note: 'This alone is not a verified product FIRST RED.' });
    event('case-error', { id, error: errorText(error) });
    json('result.json', report);
    // A timed-out native operation is not cancelled by Promise.race. Do not
    // start later cases while that operation could still be delivering keys.
    if (['HARNESS_ACTION_TIMEOUT', 'RECORDER_EXITED'].includes(error?.code)) throw error;
  }
}

async function localServer() {
  const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.yaml':'text/yaml', '.yml':'text/yaml', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.woff':'font/woff', '.woff2':'font/woff2', '.ico':'image/x-icon' };
  const instance = http.createServer((request, response) => {
    let file;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const candidate = path.resolve(CLIENT, '.' + pathname);
      if (candidate === CLIENT || candidate.startsWith(CLIENT + path.sep)) {
        file = [candidate, path.join(candidate, 'index.html'), candidate + '.html'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      }
    } catch { /* Malformed requests remain missing. */ }
    event('http', { method: request.method, url: request.url, status: file ? 200 : 404 });
    if (!file) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      // Declared harness transport policy: block remote analytics/subresources without editing product bytes.
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-src 'none'",
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', resolve); });
  return instance;
}

async function run() {
  if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('This harness runs only on an ephemeral GitHub-hosted macOS runner.');
  }
  const acceptanceFile = path.join(HERE, 'quality/acceptance-v1.json');
  if (sha(fs.readFileSync(acceptanceFile)) !== ACCEPTANCE_SHA) throw new Error('Frozen acceptance hash mismatch');
  const acceptance = readJSON(acceptanceFile);
  report.acceptanceSHA256 = ACCEPTANCE_SHA;
  report.sourceCommit = await command('git', ['rev-parse', 'HEAD'], { cwd: PRODUCT });
  if (report.sourceCommit !== acceptance.inputs[args.role].commit) throw new Error('Product commit differs from frozen role input');
  report.sourceStatus = await command('git', ['status', '--porcelain=v1'], { cwd: PRODUCT });
  const diff = await command('git', ['diff', 'HEAD', '--binary'], { cwd: PRODUCT });
  fs.writeFileSync(path.join(OUT, 'source-working.diff'), diff);
  report.trackedDiffSHA256 = sha(diff);
  report.productLockSHA256 = sha(fs.readFileSync(path.join(PRODUCT, 'pnpm-lock.yaml')));
  report.testLockSHA256 = sha(fs.readFileSync(path.join(HERE, 'package-lock.json')));
  report.harnessSHA256 = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
  report.recorderSourceSHA256 = sha(fs.readFileSync(path.join(HERE, 'ScreenRecorder.swift')));
  report.buildCommand = 'pnpm install --frozen-lockfile && pnpm --filter website run build';
  report.buildBefore = inventory(CLIENT);
  json('build-before.json', report.buildBefore);
  report.buildBefore = { sha256: report.buildBefore.sha256, fileCount: report.buildBefore.entries.length };
  report.environment = {
    node: process.version, architecture: process.arch,
    runner: Object.fromEntries(['RUNNER_OS','RUNNER_ARCH','RUNNER_ENVIRONMENT','ImageOS','ImageVersion','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','LANG'].map(k=>[k, process.env[k] || null])),
    macOS: await optionalCommand('/usr/bin/sw_vers', []),
    safari: await optionalCommand('/usr/bin/defaults', ['read', '/Applications/Safari.app/Contents/Info', 'CFBundleShortVersionString']),
    safariBuild: await optionalCommand('/usr/bin/defaults', ['read', '/Applications/Safari.app/Contents/Info', 'CFBundleVersion']),
    safariTabPreference: await optionalCommand('/usr/bin/defaults', ['read', 'com.apple.Safari', 'WebKitTabToLinksPreferenceKey']),
    safariAppleEventsPreference: await optionalCommand('/usr/bin/defaults', ['read', 'com.apple.Safari', 'AllowJavaScriptFromAppleEvents']),
    packages: await optionalCommand('npm', ['ls', '--depth=0', '--json'], { cwd: HERE }),
  };
  const guidepup = await import('@guidepup/guidepup');
  ({ voiceOver, macOSQuit, MacOSApplications } = guidepup);
  await bounded(voiceOver.start({ capture: true, settings: {
    SCRDisplayTextEnabled: true, SCRDisplayTextFontSize: 22,
    SCRCategories_SCRCategorySystemWide_SCRSpeechComponentSettings_SCRDisableSpeech: false,
    SCRCInvertedTCommanderCaptureEnabled: false,
    SCRCUserDefaultsSingleLetterQuickNavEnabled: false,
  } }), 45_000, 'VoiceOver startup');
  voStarted = true;
  report.environment.guidepupVoiceOverAssetVersion = voiceOver.version;
  report.environment.nativeVoiceOverVersion = await optionalCommand('/usr/bin/defaults', ['read', '/System/Library/CoreServices/VoiceOver.app/Contents/Info', 'CFBundleShortVersionString']);
  report.environment.nativeVoiceOverBuild = await optionalCommand('/usr/bin/defaults', ['read', '/System/Library/CoreServices/VoiceOver.app/Contents/Info', 'CFBundleVersion']);
  report.environment.voiceOverSettings = await voiceOver.getSettings();
  json('environment.json', report.environment);
  server = await localServer();
  const url = `http://127.0.0.1:${server.address().port}${acceptance.inputs.route}`;
  report.url = url;
  report.httpPolicy = 'Loopback static build; CSP blocks third-party page subresources. Build/setup network access is not restricted by this policy.';
  await bounded(guidepup.macOSActivate(MacOSApplications.Safari), 25_000, 'Safari activation');
  // Normal native address-bar navigation, before the frozen test sequence.
  await key('Command+l');
  const urlEntryStarted = performance.now();
  event('native-url-entry-start', { length:url.length });
  await bounded(voiceOver.type(url, { capture: false }), 90_000, 'URL entry');
  event('native-url-entry-end', { durationMs:performance.now()-urlEntryStarted });
  await key('Enter');
  await waitFor('initial-page-readiness-and-AppleEvents-preflight', s => readyFor(s, '0.5.0'), 30_000);
  await screen('preflight');
  const stdout = fs.openSync(path.join(OUT, 'recorder-stdout.log'), 'wx');
  const stderr = fs.openSync(path.join(OUT, 'recorder-stderr.log'), 'wx');
  recorder = spawn(path.join(HERE, 'record-screen'), Object.values(recorderPaths), { stdio: ['ignore', stdout, stderr] });
  fs.closeSync(stdout); fs.closeSync(stderr);
  recorderDone = new Promise(resolve => {
    recorder.once('error', error => { recorderExit = { error: errorText(error) }; resolve(recorderExit); });
    recorder.once('exit', (code, signal) => { recorderExit = { code, signal }; resolve(recorderExit); });
  });
  const recordStart = performance.now();
  while (!fs.existsSync(recorderPaths.ready)) {
    checkRecorder();
    if (performance.now() - recordStart > 50_000) throw new Error('Recorder READY not observed within 50s');
    await delay(100);
  }
  checkRecorder();
  event('recorder-ready', { readyFile: fs.readFileSync(recorderPaths.ready, 'utf8') });
  stage = 'cases';
  await cases();
}

async function cases() {
  let activated = false;
  await isolatedCase('VO355-01', async () => {
    const state = await navigateTo('skip', 'skipFocused', INITIAL_KEY);
    const frame = await screen('VO355-01-skip');
    caseResult('VO355-01', { state, frame }, { uniqueSkip: state.skipCount===1, focused: state.skipFocused, documentFocused:state.documentHasFocus, visible: state.skipVisible });
  });
  await isolatedCase('VO355-02', async () => {
    const before = await snapshot('before-skip-enter');
    if (!before.skipFocused) throw new Error('Skip is not focused; dependent activation cannot be claimed');
    await key('Enter'); activated = true;
    const state = await snapshot('immediate-heading');
    const speech = await freshSpeech('immediate-heading');
    const frame = await screen('VO355-02-heading');
    caseResult('VO355-02', { state, speech, frame }, { focusedHeading:state.headingFocused, documentFocused:state.documentHasFocus, insideMain:state.headingInMain }, speechCheck(speech, 'heading'));
  });
  await isolatedCase('VO355-03', async () => {
    if (!activated) throw new Error('Skip activation did not execute; no settled-focus claim');
    const waitStarted = performance.now();
    event('settling-start');
    await delay(15_050);
    const elapsedMs = performance.now() - waitStarted;
    event('settling-end', { elapsedMs });
    const state = await snapshot('settled-heading');
    const speech = await freshSpeech('settled-heading');
    const frame = await screen('VO355-03-settled');
    const rect = state.headingRect;
    caseResult('VO355-03', { state, speech, frame, elapsedMs }, {
      waited15Seconds:elapsedMs>=15_000, focusedHeading:state.headingFocused, documentFocused:state.documentHasFocus, insideMain:state.headingInMain,
      visibleBelowHeader:!!rect && rect.height>0 && rect.top>=(state.headerRect?.bottom||0)-1 && rect.bottom<=state.viewportHeight,
    }, speechCheck(speech, 'heading'));
  });
  await isolatedCase('VO355-04', async () => {
    if (!activated) throw new Error('No skip activation; dependent next Tab cannot be claimed');
    const before = await snapshot('before-next-ordinary-tab');
    if (!before.headingFocused || !before.headingInMain || !before.documentHasFocus) throw new Error('The heading/page no longer has keyboard focus; cannot claim the heading-to-next-Tab transition');
    await key('Tab');
    const state = await snapshot('next-ordinary-tab');
    const speech = await freshSpeech('next-ordinary-tab');
    const frame = await screen('VO355-04-version');
    caseResult('VO355-04', { before, state, speech, frame }, { focusedVersion:state.versionFocused, documentFocused:state.documentHasFocus, insideMain:state.activeInMain, version:state.versionValue==='0.5.0' }, speechCheck(speech, 'version', '0.5.0'));
  });
  await isolatedCase('VO355-05', async () => {
    const state = await navigateTo('server-0.5.0', 'serverFocused', INITIAL_KEY);
    const speech = await freshSpeech('server-0.5.0');
    const frame = await screen('VO355-05-server');
    caseResult('VO355-05', { state, speech, frame }, { focused:state.serverFocused, documentFocused:state.documentHasFocus, unique:state.serverCount===1, value:state.serverValue==='/api/v0.5.0' }, speechCheck(speech, 'server', '0.5.0'));
  });
  await isolatedCase('VO355-06', async () => {
    await navigateTo('api-version-before-change', 'versionFocused', 'Shift+Tab');
    await key('Space'); await key('ArrowDown'); await key('Enter');
    const state = await waitFor('redraw-0.4.0', s => readyFor(s, '0.4.0'));
    const frame = await screen('VO355-06-redraw');
    caseResult('VO355-06', { state, frame }, { selected:state.versionValue==='0.4.0', url:new URL(state.url).searchParams.get('version')==='0.4.0', rendered:state.renderedVersion.includes('0.4.0'), serverValue:state.serverValue==='/api/v0.4.0' });
  });
  await isolatedCase('VO355-07', async () => {
    const state = await navigateTo('server-0.4.0', 'serverFocused', INITIAL_KEY);
    const speech = await freshSpeech('server-0.4.0');
    const frame = await screen('VO355-07-server-redraw');
    caseResult('VO355-07', { state, speech, frame }, { focused:state.serverFocused, documentFocused:state.documentHasFocus, unique:state.serverCount===1, value:state.serverValue==='/api/v0.4.0' }, speechCheck(speech, 'server', '0.4.0'));
  });
}

try { await run(); }
catch (error) {
  report.errors.push({ stage, error:errorText(error), classification:stage==='preflight'?'INFRASTRUCTURE_OR_BUILD_PRECONDITION':'REQUIRES_TRIAGE' });
  event('run-error', report.errors.at(-1));
} finally {
  if (recorder) {
    fs.writeFileSync(recorderPaths.stop, new Date().toISOString() + '\n', { flag:'wx' });
    try { report.recorderExit = await bounded(recorderDone, 50_000, 'Recorder finalization'); }
    catch (error) { recorder.kill('SIGTERM'); report.errors.push({ stage:'recorder-cleanup', error:errorText(error) }); }
    if (fs.existsSync(recorderPaths.lifecycle)) {
      try { report.recorderLifecycle = readJSON(recorderPaths.lifecycle); }
      catch (error) { report.errors.push({ stage:'recorder-lifecycle', error:errorText(error) }); }
    }
    if (fs.existsSync(recorderPaths.movie)) report.movie = { file:path.basename(recorderPaths.movie), bytes:fs.statSync(recorderPaths.movie).size, sha256:sha(fs.readFileSync(recorderPaths.movie)) };
  }
  if (voStarted) {
    try { json('spoken-phrases.json', await voiceOver.spokenPhraseLog()); }
    catch (error) { report.errors.push({ stage:'speech-log-cleanup', error:errorText(error) }); }
    try { await bounded(voiceOver.stop(), 20_000, 'VoiceOver stop'); }
    catch (error) { report.errors.push({ stage:'voiceover-cleanup', error:errorText(error) }); }
  }
  if (macOSQuit) {
    try { await bounded(macOSQuit(MacOSApplications.Safari), 15_000, 'Safari quit'); }
    catch (error) { report.errors.push({ stage:'safari-cleanup', error:errorText(error) }); }
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
  if (fs.existsSync(CLIENT)) {
    try {
      const after = inventory(CLIENT); json('build-after.json', after);
      report.buildAfter = { sha256:after.sha256, fileCount:after.entries.length };
      report.buildUnchanged = report.buildBefore?.sha256===after.sha256;
    } catch (error) { report.errors.push({ stage:'build-inventory-cleanup', error:errorText(error) }); }
  }
  for (let i=1;i<=7;i++) {
    const id=`VO355-0${i}`;
    if (!report.cases.some(c=>c.id===id)) report.cases.push({ id, status:'NOT_RUN' });
  }
  report.functionalStatus = report.cases.every(c=>c.status==='PASS') ? 'PASS' : 'INCOMPLETE_OR_FAILED';
  report.recordingProcessStatus = report.recorderExit?.code===0 && report.movie?.bytes>0 ? 'COMPLETED_AWAITING_MEDIA_REVIEW' : 'FAILED_OR_NOT_RUN';
  report.status = 'INCOMPLETE'; // Independent video/audio review is intentionally never forged by this harness.
  report.finishedAtUTC = new Date().toISOString();
  report.durationMs = performance.now()-started;
  json('result.json', report);
  console.log(JSON.stringify({ role:report.role, functionalStatus:report.functionalStatus, recordingProcessStatus:report.recordingProcessStatus, acceptanceStatus:report.status, cases:report.cases.map(({id,status})=>({id,status})), errors:report.errors }, null, 2));
  process.exitCode = report.functionalStatus==='PASS' && report.recordingProcessStatus==='COMPLETED_AWAITING_MEDIA_REVIEW' && report.buildUnchanged && report.errors.length===0 ? 0 : 1;
}
