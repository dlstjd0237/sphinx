import { pageCatalog, t } from './i18n.js';
import { sphinxMark } from './logo.js';
import { VERSION } from './version.js';
/** Text for an HTML text node or a double-quoted attribute value. */
export const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
// JSON for the inline script. No "<" gets in, so no value can end the script element.
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
/**
 * Static UI only. Model-authored content always enters the DOM as textContent.
 * The page's own words come from the catalog: the first paint in `language`, and the script carries both
 * languages. data-t* marks an element whose words only change with the language.
 */
export function browserPage({ token, nonce, language = 'en' }) {
  const html = key => esc(t(language, key));
  return `<!doctype html>
<html lang="${esc(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html('page.title.default')}</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#292524;--muted:#6b6259;--line:#dfd8cf;--paper:#faf8f5;--amber:#a45009;--focus:#b45309;--pass:#3d6b35;--retry:#8d271e;--add:#e8f1e3;--add-ink:#2f5d28;--del:#f8e6e2;--del-ink:#8d271e;--mark:#fdf0cc;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "Avenir Next",Avenir,sans-serif}
button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}
button:focus-visible,textarea:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.shell{height:100vh;height:100dvh;display:flex;flex-direction:column}
header{min-height:52px;border-bottom:1px solid var(--line);padding:8px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:14px}.brand strong{display:flex;align-items:center;gap:9px;font:600 19px var(--mono)}.brand svg{color:var(--amber);flex-shrink:0}.brand span{color:var(--muted);font-size:14px}
.brand small{font:12px var(--mono);color:var(--muted);margin-left:-8px}.update{font-size:12px;padding:2px 10px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--amber);cursor:pointer;white-space:nowrap}.update:hover:not(:disabled){border-color:var(--amber)}.update:disabled{color:var(--muted);cursor:default}
.scope{border-bottom:1px solid var(--line);padding:7px 24px;font-size:13px;line-height:1.45;color:var(--muted)}
.facts dt{display:none}.facts dd{font-weight:400!important}.facts div:has(#scope-range){display:none}.facts div+div::before{content:"·";margin-right:8px;color:#b7ab9c}.facts #meta{color:var(--ink);font-weight:600!important}.scope-note{display:none!important}
.facts{display:flex;flex-wrap:wrap;gap:2px 20px;margin:0;align-items:baseline}.facts div{display:flex;gap:6px;min-width:0}.facts dt{color:var(--muted)}.facts dd{margin:0;font-weight:600;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.model-cell{position:relative}.model-chip{font:inherit;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:999px;padding:1px 9px 1px 10px;margin-right:6px;cursor:pointer;white-space:nowrap}.model-chip:hover:not(:disabled){border-color:var(--amber)}.model-chip:disabled{color:var(--muted);cursor:default}.model-chip .caret{color:var(--muted);margin-left:5px;font-size:10px}
.model-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:20;width:300px;max-height:min(70vh,460px);overflow:auto;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(41,37,36,.14);padding:6px 0;font-size:13.5px;color:var(--ink);display:block!important}.model-menu[hidden]{display:none!important}.model-menu div::before{content:none!important}
.model-menu h3{margin:0;padding:8px 14px 2px;font-size:13px;font-weight:600}.model-menu .menu-note{margin:0;padding:0 14px 6px;color:var(--muted);font-size:12px;line-height:1.4}
.model-menu .group{padding:8px 14px 2px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.model-menu .option{display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 14px;border:0;border-radius:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}.model-menu .option:hover:not(:disabled),.model-menu .option:focus-visible{background:var(--paper);outline:none}
.model-menu .option .dot{width:14px;flex:none;color:var(--amber)}.model-menu .option .name{flex:1;overflow-wrap:anywhere}.model-menu .option .desc{display:block;color:var(--muted);font-size:12px;line-height:1.35;margin-top:1px}.model-chip .next{color:var(--amber)}.model-menu p.menu-foot{margin:6px 0 0;cursor:default}.model-menu .option .tag{color:var(--muted);font-size:12px}.model-menu .option:disabled{color:var(--muted);cursor:not-allowed}
.model-menu .custom{display:flex;gap:6px;padding:4px 14px 6px 36px}.model-menu .custom input{flex:1;min-width:0;font:12.5px var(--mono);padding:4px 7px;border:1px solid var(--line);border-radius:6px}.model-menu .custom button{font-size:12.5px;padding:3px 10px}
.model-menu .menu-foot{border-top:1px solid var(--line);margin-top:6px;padding:8px 14px 4px;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12.5px;cursor:pointer}
.model-menu .confirm{display:block!important;margin:2px 10px 8px;padding:8px 10px;border-radius:8px;background:var(--paper);font-size:12.5px}.model-menu .confirm p{margin:0}.model-menu .confirm div{display:flex;gap:6px;margin-top:8px}.model-menu .menu-error{margin:4px 14px;color:var(--retry);font-size:12.5px}
@media(max-width:600px){.model-menu{position:fixed;left:12px;right:12px;top:auto;bottom:12px;width:auto}}
.stamp-row{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:var(--ink);font-size:13px;cursor:pointer}.stamp-row input{accent-color:var(--amber);margin:0}.stamp-row[hidden]{display:none}
.resume{display:flex;align-items:center;gap:10px;margin:4px 0 12px;padding:8px 10px 8px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;max-width:36em}.resume[hidden]{display:none}.resume code{flex:1;font:13.5px var(--mono);overflow-wrap:anywhere}
.plus{color:var(--add-ink)}.minus{color:var(--del-ink)}.facts .mono{font:600 12.5px var(--mono)}.scope-note{margin:2px 0 0;color:var(--muted);font-size:12px}#usage{color:var(--muted);font-weight:400;font-variant-numeric:tabular-nums}
.tabs{display:none}.scope-short{display:none}
.workspace{flex:1;min-height:0;display:grid;grid-template-columns:minmax(400px,46%) minmax(0,1fr);grid-template-rows:minmax(0,auto) minmax(0,1fr);grid-template-areas:"q files" "q diff"}
#question-pane{grid-area:q;border-right:1px solid var(--line)!important}#files-pane{grid-area:files;max-height:30vh;overflow:hidden;border-right:0;border-bottom:1px solid var(--line)}#diff-pane{grid-area:diff;border-right:0}
.pane{min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--line)}.pane:last-child{border-right:0}
.pane h2{font-size:13px;font-weight:600;margin:0;overflow-wrap:anywhere;line-height:1.4}.pane-note{font-size:12px;color:var(--muted);margin:0;padding:8px 14px;overflow-wrap:anywhere}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px 12px 6px}.filters button{min-height:44px;font-size:12.5px;line-height:1.25;padding:4px 8px}
.filters button[aria-pressed=true]{background:#efe5d8;border-color:var(--amber);font-weight:600}.filters .count{display:block;font:11.5px var(--mono);color:var(--muted)}
#file-search{margin:4px 12px 6px;font:inherit;font-size:13px;padding:8px 10px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink);min-height:40px}
.filelist{list-style:none;margin:0;padding:0 0 8px;overflow-y:auto;flex:1;min-height:0}
.file{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:44px;border:0;border-radius:0;padding:7px 12px;text-align:left;font-size:13px;line-height:1.35}
.file[aria-current=true]{background:#efe5d8;box-shadow:inset 3px 0 0 var(--amber)}.file .name{flex:1;min-width:0;overflow-wrap:anywhere}.file .from{display:block;color:var(--muted);font-size:12px}
.badge{flex-shrink:0;min-width:5.6em;font:600 10.5px/1.9 var(--mono);text-transform:uppercase;letter-spacing:.02em;text-align:center;border:1px solid #cfc4b6;border-radius:4px;color:var(--muted)}
.badge.added{color:var(--add-ink);border-color:#a9c39f}.badge.deleted{color:var(--del-ink);border-color:#d6aaa3}.counts{flex-shrink:0;font:12px/1.6 var(--mono);white-space:nowrap}.counts .plus{color:var(--add-ink)}.counts .minus{color:var(--del-ink)}
.file .relevant{display:block;color:var(--amber);font-size:11.5px}
.diffhead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-start;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--line)}.diffhead>div:first-child{min-width:0;flex:1 1 220px}
#diff-meta{margin:2px 0 0;font-size:12px;color:var(--muted)}.diffactions{display:flex;gap:6px;flex-wrap:wrap}.diffactions button{min-height:44px;font-size:13px}
.diffbody{flex:1;min-height:0;overflow:auto;background:#fff}.diffbody:empty{background:transparent}
table.diff{border-collapse:collapse;font:12.5px/1.55 var(--mono);min-width:100%;tab-size:4}
.diff td{padding:0 8px;vertical-align:top}.diff .num{width:1%;text-align:right;color:#8a7f73;white-space:nowrap;user-select:none}.diff .sign{width:1%;padding:0 2px;user-select:none;text-align:center}
.diff .code{white-space:pre;padding-right:16px}.diff .mark{width:1%;padding:0 2px;color:var(--amber);user-select:none}
.diff tr.addition{background:var(--add)}.diff tr.addition .sign{color:var(--add-ink)}.diff tr.deletion{background:var(--del)}.diff tr.deletion .sign{color:var(--del-ink)}
.diff tr.evidence .mark{background:var(--mark);box-shadow:inset 3px 0 0 var(--amber)}.diff tr.evidence .num{color:var(--ink)}
.diff tr.hunk td{background:#f1ece5;color:var(--muted);padding:3px 12px;white-space:pre-wrap;overflow-wrap:anywhere}.diff tr.gap td{background:#f7f3ee;color:var(--muted);padding:2px 12px;font-family:inherit}
.diff tr:focus{outline:2px solid var(--focus);outline-offset:-2px}.legend{font-size:12px;color:var(--muted);margin:0;padding:6px 16px;border-bottom:1px solid var(--line)}
main{width:100%;padding:0 20px;display:flex;flex-direction:column;min-height:0}
.evidence{flex-shrink:0;border-top:1px solid var(--line);padding:10px 0 4px;max-height:34%;overflow-y:auto}.evidence ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.evidence li button{width:100%;min-height:44px;text-align:left;font-size:13px;line-height:1.35;padding:6px 10px}.evidence li .ref-path{display:block;overflow-wrap:anywhere;font:12.5px var(--mono)}.evidence li .ref-lines{display:block;color:var(--muted);font-size:12px}
.evidence li.static{border:1px dashed #cfc4b6;border-radius:6px;padding:6px 10px;font-size:13px}.evidence .pane-note{padding:6px 0 0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.conversation{flex:1;min-height:0;overflow-y:auto;padding:24px 8px 8px 0;scrollbar-width:thin}
#messages{list-style:none;margin:0;padding:0}.turn{margin:0 0 24px}.turn.human{margin-left:32px;padding:12px 16px;background:#f0ebe4;border-left:2px solid #c6b7a5}
.speaker{font-size:13px;font-weight:600;margin-bottom:6px}.turn-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.turn.question .turn-text{font-size:18px;line-height:1.6;font-weight:500}
.turn-note{font-size:12px;color:var(--muted);margin-top:6px}.turn.notice{color:var(--muted)}.question-number{font-size:13px;color:var(--muted);margin-bottom:6px}
.question{font-size:18px;line-height:1.6;white-space:pre-wrap;margin:8px 0 20px;font-weight:500}.feedback,.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 20px}
.message.passed{font-size:20px;line-height:1.45;font-weight:500;color:var(--pass);padding:18px 20px;border:1px solid #b9d0b1;border-radius:8px;background:#eef5ea}.message.passed::before{content:"✓ ";font-weight:600}.status.passed-note{font-size:13px;color:var(--muted);margin-top:-8px}.status.passed-note::before{content:none}
ul{padding-left:22px}.status{font-size:13px;color:var(--muted);margin:0 0 12px}
.composer{flex-shrink:0;border-top:1px solid var(--line);padding:16px 0 12px}.error{font-size:14px;color:#8d271e;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px}
label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}
textarea{display:block;width:100%;min-height:76px;max-height:180px;resize:vertical;padding:12px 14px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink);line-height:1.5}
textarea:disabled{background:#f6f2ed;color:var(--muted)}textarea::placeholder{color:#82796f}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.actions button,.recovery button,.skipbar button{min-height:44px}
button{border:1px solid #c3b8aa;border-radius:6px;padding:7px 12px;background:transparent;color:var(--ink);font-size:14px;line-height:1.5}
button.primary{background:var(--amber);color:#fff;border-color:var(--amber);margin-left:auto;min-width:72px}.actions button,header .tools button{min-height:44px}
button:hover:not(:disabled){background:#eee7dc}button.primary:hover:not(:disabled){background:#8b4208}
.disputing textarea{border-color:#8d271e}.disputing #submit{background:#8d271e;border-color:#8d271e}
button.quiet{border-color:transparent;color:var(--muted)}button.quiet:hover:not(:disabled){color:var(--ink)}
.hint{font-size:12px;color:var(--muted);margin:10px 0 0}.recovery-reason{margin:-8px 0 18px;padding:10px 14px;border-left:2px solid #8d271e;background:#f8ece9;color:#6f1f18;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}.recovery{display:grid;gap:12px;margin:0 0 20px}.recovery button{text-align:left;width:100%}.recovery p{margin:4px 0 0;font-size:13px;color:var(--muted)}
.consent{margin:-8px 0 20px}.consent:focus{outline:none}.consent .actions{margin-top:0}.consent button.primary{margin-left:0}
header .tools{display:flex;gap:4px}
.score{display:grid;grid-template-columns:auto auto;grid-template-rows:auto auto;column-gap:14px;align-items:center;margin-left:auto;margin-right:14px;padding:6px 16px;border:1px solid var(--line);border-radius:12px;background:#fff}
.score-head{display:flex;flex-direction:column;line-height:1.15;grid-row:1/3}.score-label{font-size:11.5px;color:var(--muted)}.score-value{font:600 20px/1.1 var(--mono);font-variant-numeric:tabular-nums}
.score-value.pending{font-family:inherit;font-size:13px;font-weight:500;line-height:1.6;color:var(--muted)}
.score-dots{display:flex;gap:4px}.score-dots i{width:11px;height:11px;border-radius:50%;border:1.5px solid #cfc4b6;background:transparent}
.score-dots i.hit{background:var(--pass);border-color:var(--pass)}.score-dots i.miss{border-color:#c0574a;background:#f6e2df}
.score-dots i.fresh{animation:pop .5s ease}@keyframes pop{0%{transform:scale(.3)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
.score-meta{font-size:11px;color:var(--muted);white-space:nowrap}
@media(prefers-reduced-motion:reduce){.score-dots i.fresh{animation:none}}
@media(max-width:600px){.score{margin-right:4px;padding:4px 10px}.score-meta{display:none}}
.skipbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}.skipbar p{flex-basis:100%;margin:0;color:var(--muted);font-size:13px}
.skipbar input{flex:1;min-width:180px;font:inherit;font-size:14px;padding:6px 10px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink)}
button.danger{background:#8d271e;border-color:#8d271e;color:#fff}button.danger:hover:not(:disabled){background:#6f1f18}
.turn.activity{margin:0 0 20px;font-size:13px;color:var(--muted)}.activity summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:baseline}.activity summary::-webkit-details-marker{display:none}
.activity summary .latest::before{content:"✓ ";color:#7c8a5c}.activity.live summary .latest::before{content:"● ";color:var(--amber);animation:pulse 1.2s ease-in-out infinite}
.activity .count{color:#8f857a;white-space:nowrap}.activity .count::after{content:" ▸"}.activity details[open] .count::after{content:" ▾"}
.activity ol{list-style:none;margin:8px 0 0;padding:0 0 0 14px;border-left:1px solid var(--line);max-height:220px;overflow-y:auto}.activity ol li{padding:1px 0 1px 8px}
.turn.streaming .turn-text::after{content:"▍";color:var(--amber);animation:pulse 1s steps(2) infinite}
.status.busy::before{content:"● ";color:var(--amber);animation:pulse 1.2s ease-in-out infinite}.status.phase-question,.status.phase-passed,.status.phase-paused,.status.phase-error,.status.phase-skipped,.status.phase-stopped{display:inline-block;font-size:13px;font-weight:600;line-height:1;padding:6px 10px;border:1px solid currentColor;border-radius:999px}.status.phase-question{color:var(--amber)}.status.phase-question::before{content:"◆ "}.status.phase-question.retry{color:var(--retry)}.status.phase-question.retry::before{content:"↺ "}.status.phase-passed{color:var(--pass)}.status.phase-passed::before{content:"✓ "}.status.phase-paused,.status.phase-skipped,.status.phase-stopped{color:var(--muted)}.status.phase-paused::before,.status.phase-stopped::before{content:"‖ "}.status.phase-skipped::before{content:"↷ "}.status.phase-error{color:var(--retry)}.status.phase-error::before{content:"! "}@keyframes pulse{50%{opacity:.25}}
@media(prefers-reduced-motion:reduce){.status.busy::before,.activity.live summary .latest::before{animation:none}}
footer{flex-shrink:0;display:flex;flex-wrap:wrap;gap:2px 8px;padding:0 0 14px;color:var(--muted);font-size:12px;line-height:1.5}footer p{margin:0}[hidden]{display:none!important}
#back-question{display:none}
@media(max-width:1099px){.workspace{grid-template-columns:minmax(360px,52%) minmax(0,1fr)}}
@media(max-width:899px){#back-question{display:inline-block}.tabs{display:flex;gap:4px;padding:6px 12px;border-bottom:1px solid var(--line)}.tabs button{flex:1;min-height:44px;font-size:14px}.tabs button[aria-selected=true]{background:#efe5d8;border-color:var(--amber);font-weight:600}
.workspace{display:flex}.pane{display:none;flex:1;border-right:0}.workspace.show-files #files-pane,.workspace.show-diff #diff-pane,.workspace.show-question #question-pane{display:flex}
#question-pane{overflow-y:auto}.conversation{flex:none;overflow:visible;padding-right:0}.evidence{max-height:none;overflow:visible}}
@media(max-width:700px){header{flex-wrap:wrap;row-gap:0}.score{flex:1 1 0;min-width:0;max-width:max-content}header .tools{flex-basis:100%;justify-content:flex-end}}
@media(max-width:600px){header{padding:8px 12px}.brand{gap:8px}.brand span{display:none}.scope{padding:6px 12px 7px;font-size:12.5px}.facts{gap:0 12px}.facts .mono{font-size:12px}#scope-note{display:none}.scope-short{display:block}.hint,footer{font-size:11.5px}main{padding:0 14px}.conversation{padding-top:16px}.turn.human{margin-left:16px}.actions{gap:4px}button{padding:7px 10px}.hint{max-width:34em}.diffhead{padding:8px 12px}.legend{padding:6px 12px}}
:lang(ko) body{font-family:"Avenir Next",Avenir,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif}
:lang(ko){word-break:keep-all}
:lang(ko) .badge,:lang(ko) .model-menu .group{letter-spacing:0;font-size:12px}
</style></head><body><div class="shell">
<header><div class="brand"><strong>${sphinxMark({ size: 26, id: 'brand-mark' })}sphinx</strong><small id="version">v${VERSION}</small><button id="update" class="update" type="button" hidden></button><span data-t="page.header.subtitle">${html('page.header.subtitle')}</span></div><div id="score" class="score" hidden><span class="score-head"><span class="score-label" data-t="page.score.label">${html('page.score.label')}</span><strong id="score-value" class="score-value"></strong></span><span id="score-dots" class="score-dots" role="img"></span><span id="score-meta" class="score-meta"></span></div><div class="tools"><button id="skip" class="quiet" type="button" data-t="page.header.skip">${html('page.header.skip')}</button><button id="pause" class="quiet" type="button">${html('page.header.pause')}</button></div></header>
<section class="scope" aria-label="${html('page.scope.label')}" data-t-label="page.scope.label"><dl class="facts"><div><dt data-t="page.scope.repository">${html('page.scope.repository')}</dt><dd id="meta"></dd></div><div><dt id="scope-op-label" data-t="page.scope.operation">${html('page.scope.operation')}</dt><dd id="scope-op">${html('page.scope.loading')}</dd></div><div><dt data-t="page.scope.comparison">${html('page.scope.comparison')}</dt><dd id="scope-range" class="mono">${html('page.scope.loading')}</dd></div><div><dt data-t="page.scope.changed">${html('page.scope.changed')}</dt><dd id="scope-stats">${html('page.scope.loading')}</dd></div><div id="scope-excluded-row" hidden><dt data-t="page.scope.excluded">${html('page.scope.excluded')}</dt><dd id="scope-excluded"></dd></div><div><dt data-t="page.scope.progress">${html('page.scope.progress')}</dt><dd id="scope-progress">${html('page.scope.connecting')}</dd></div><div class="model-cell"><dd><button id="language" class="model-chip" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="language-menu" title="${html('page.language.chipTitle')}" data-t-title="page.language.chipTitle" hidden></button><button id="distance" class="model-chip" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="distance-menu" hidden></button><button id="model" class="model-chip" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="model-menu" hidden></button><span id="usage"></span></dd><section id="language-menu" class="model-menu" role="dialog" aria-label="${html('page.language.menuLabel')}" data-t-label="page.language.menuLabel" hidden></section><section id="distance-menu" class="model-menu" role="dialog" aria-label="${html('page.distance.menuLabel')}" data-t-label="page.distance.menuLabel" hidden></section><section id="model-menu" class="model-menu" role="dialog" aria-label="${html('page.model.menuLabel')}" data-t-label="page.model.menuLabel" hidden></section></div></dl>
<p id="scope-note" class="scope-note">${html('page.scope.note')}</p><p class="scope-note scope-short" data-t="page.scope.noteShort">${html('page.scope.noteShort')}</p></section>
<nav class="tabs" role="tablist" aria-label="${html('page.tabs.label')}" data-t-label="page.tabs.label"><button id="tab-question" role="tab" type="button" aria-controls="question-pane" aria-selected="true" data-t="page.tabs.question">${html('page.tabs.question')}</button><button id="tab-files" role="tab" type="button" aria-controls="files-pane" aria-selected="false" data-t="page.tabs.files">${html('page.tabs.files')}</button><button id="tab-diff" role="tab" type="button" aria-controls="diff-pane" aria-selected="false" data-t="page.tabs.diff">${html('page.tabs.diff')}</button></nav>
<div id="announce" class="sr" aria-live="polite"></div>
<div id="workspace" class="workspace show-question">
<aside id="files-pane" class="pane" aria-label="${html('page.files.paneLabel')}" data-t-label="page.files.paneLabel">
<div class="filters" role="group" aria-label="${html('page.files.filtersLabel')}" data-t-label="page.files.filtersLabel"><button id="filter-all" type="button" aria-pressed="true"><span data-t="page.files.filterAll">${html('page.files.filterAll')}</span><span id="count-all" class="count"></span></button><button id="filter-relevant" type="button" aria-pressed="false"><span data-t="page.files.filterRelevant">${html('page.files.filterRelevant')}</span><span id="count-relevant" class="count"></span></button></div>
<input id="file-search" type="search" autocomplete="off" spellcheck="false" placeholder="${html('page.files.searchPlaceholder')}" aria-label="${html('page.files.searchLabel')}" data-t-placeholder="page.files.searchPlaceholder" data-t-label="page.files.searchLabel">
<p id="filter-total" class="pane-note" aria-live="polite"></p>
<ul id="file-list" class="filelist" aria-label="${html('page.tabs.files')}" data-t-label="page.tabs.files"></ul><p id="files-note" class="pane-note"></p></aside>
<section id="diff-pane" class="pane" aria-label="${html('page.tabs.diff')}" data-t-label="page.tabs.diff">
<div class="diffhead"><div><h2 id="diff-title">${html('page.diff.noFile')}</h2><p id="diff-meta">${html('page.diff.browse')}</p></div>
<div class="diffactions"><button id="context-more" type="button" hidden data-t="page.diff.moreContext">${html('page.diff.moreContext')}</button><button id="context-all" type="button" hidden data-t="page.diff.fullFile">${html('page.diff.fullFile')}</button><button id="back-question" type="button" data-t="page.diff.backToQuestion">${html('page.diff.backToQuestion')}</button></div></div>
<p id="diff-legend" class="legend" hidden data-t="page.diff.legend">${html('page.diff.legend')}</p>
<p id="diff-note" class="pane-note" role="status" hidden></p><div id="diff-body" class="diffbody"></div></section>
<main id="question-pane" class="pane" aria-label="${html('page.tabs.question')}" data-t-label="page.tabs.question">
<div id="skipbar" class="skipbar" hidden><input id="skipreason" maxlength="500" autocomplete="off" placeholder="${html('page.skip.reasonPlaceholder')}" aria-label="${html('page.skip.reasonLabel')}" data-t-placeholder="page.skip.reasonPlaceholder" data-t-label="page.skip.reasonLabel"><button id="skipconfirm" class="danger" type="button" data-t="page.skip.confirm">${html('page.skip.confirm')}</button><button id="skipcancel" class="quiet" type="button" data-t="page.action.cancel">${html('page.action.cancel')}</button><p data-t="page.skip.note">${html('page.skip.note')}</p></div>
<div id="conversation" class="conversation" aria-label="${html('page.conversation.label')}" data-t-label="page.conversation.label">
<ol id="messages" aria-label="${html('page.conversation.listLabel')}" data-t-label="page.conversation.listLabel"></ol>
<p id="feedback" class="feedback" hidden></p><section id="question" hidden><p id="prompt" class="question"></p><ul id="choices" hidden></ul></section>
<p id="message" class="message" role="status" hidden></p><div id="resume" class="resume" hidden><code id="resume-command"></code><button id="resume-copy" class="quiet" type="button">${html('page.resume.copy')}</button></div><div id="status" class="status" role="status" aria-live="polite">${html('page.status.connecting')}</div><p id="recovery-reason" class="recovery-reason" hidden></p><div id="recovery" class="recovery" hidden></div><div id="consent" class="consent" role="group" aria-labelledby="message" aria-describedby="consent-hint" tabindex="-1" hidden></div>
</div>
<section id="evidence" class="evidence" aria-labelledby="evidence-title" hidden><h2 id="evidence-title" data-t="page.evidence.title">${html('page.evidence.title')}</h2><ul id="evidence-list"></ul><p id="evidence-note" class="pane-note"></p></section>
<div id="composer" class="composer"><p id="error" class="error" role="alert" hidden></p>
<form id="form"><label id="label" for="response">${html('page.composer.answerLabel')}</label><textarea id="response" rows="2" maxlength="8000" autocomplete="off" spellcheck="true" placeholder="${html('page.composer.answerPlaceholder')}"></textarea>
<div class="actions"><button type="button" class="quiet" id="hint">${html('page.composer.showHint')}</button><button type="button" class="quiet" data-action="learn" data-t="page.composer.explain">${html('page.composer.explain')}</button><button type="button" class="quiet" id="dispute">${html('page.composer.dispute')}</button><button id="submit" class="primary" type="submit">${html('page.composer.send')}</button></div>
<p class="hint" data-t="page.composer.keysHint">${html('page.composer.keysHint')}</p></form></div>
<footer><label id="stamp-row" class="stamp-row" hidden><input id="stamp" type="checkbox"><span data-t="page.stamp.label">${html('page.stamp.label')}</span></label><p id="privacy" data-t="page.footer.privacy">${html('page.footer.privacy')}</p><p id="waiting">${html('page.waiting.idle')}</p></footer>
</main></div></div>
<script nonce="${nonce}">
const token=${scriptJSON(token)},base='/'+token,$=id=>document.getElementById(id);
let hinted=false,disputing=false,current,submitting=false,finished=false,connected=false,lastQuestion,lastGraded,lastMessages='',lastConsent='';const openGroups=new Set();
// The page's own words in both languages. tx draws one in the page's language the way t() in i18n.js does: English
// where Korean lacks the key and the key where English does, each {name} filled once, { one, other } chosen by a raw count.
const CATALOG=${scriptJSON(pageCatalog())};
let pageLanguage=${scriptJSON(language)},lastStateLanguage;
const tx=(key,params={})=>{const entry=CATALOG[pageLanguage]?.[key]??CATALOG.en[key],text=entry!==null&&typeof entry==='object'?(params.count===1?entry.one:entry.other):entry;
 return typeof text==='string'?text.replace(/\\{(\\w+)\\}/g,(match,name)=>Object.hasOwn(params,name)?String(params[name]):match):key;};
// Redraws the page's own words in a language: the words marked data-t*, the composer's words for its mode, the diff
// pane and the notes written once. It clears the memos, so the render that always follows (render calls this first,
// the chip renders after it) redraws the lists, chips, open menus and controls. The draft and the focus stay.
function applyLanguage(language){
 pageLanguage=language;document.documentElement.lang=language;
 for(const item of document.querySelectorAll('[data-t]'))item.textContent=tx(item.dataset.t);
 for(const item of document.querySelectorAll('[data-t-placeholder]'))item.placeholder=tx(item.dataset.tPlaceholder);
 for(const item of document.querySelectorAll('[data-t-label]'))item.setAttribute('aria-label',tx(item.dataset.tLabel));
 for(const item of document.querySelectorAll('[data-t-title]'))item.title=tx(item.dataset.tTitle);
 lastMessages=lastConsent=lastFiles=lastEvidence='';
 disputeText(disputing);
 if(!selected)emptyDiffText();else if(diffFailure)$('diff-note').textContent=diffFailure();else if(diff&&diff.path===selected)drawDiff(undefined,true);else $('diff-meta').textContent=tx('page.diff.loading');
 if(filesText)$('files-note').textContent=filesText();
 if(!current?.change?.header)$('scope-note').textContent=tx('page.scope.note');
 $('resume-copy').textContent=tx('page.resume.copy');
}
const text=(id,value)=>{$(id).textContent=value||'';$(id).hidden=!value;};
// An error shows in any unfinished step; outside a question, only its line.
const fail=value=>{text('error',value);if(value&&!finished)$('composer').hidden=false;};
const operation=state=>state?.event==='pre-commit'?'commit':'push';
const compact=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n);
const usageText=(u,t)=>{if(!t)return '';const total=(t.input||0)+(t.output||0);if(!total&&t.cost==null)return '';
 return [tx('page.usage.tokens',{n:compact(total)}),...(t.cost!=null?[t.cost===0?'$0':t.cost<0.0001?'<$0.0001':t.cost<0.01?'$'+t.cost.toFixed(4):'$'+t.cost.toFixed(2)]:[]),...(u?.limit!=null?[tx('page.usage.calls',{calls:u.calls,limit:u.limit})]:[])].join(' · ');};
const PROVIDERS={openrouter:'OpenRouter',openai:'Endpoint',claude:'Claude Code',codex:'Codex'};
const routeText=r=>r?.provider?[PROVIDERS[r.provider]||r.provider,r.model].filter(Boolean).join(' '):'';
// The repository's understanding score, shown rather than explained: one dot
// per recent answer (green = right first time), filling empty slots while calibrating.
let lastScored=-1;
function scoreView(sc){
 $('score').hidden=!sc;if(!sc)return;
 const recent=sc.recent||[],slots=sc.calibrating?sc.answered+sc.needed:Math.max(recent.length,1);
 const dots=[];
 for(let i=0;i<slots;i++){const dot=document.createElement('i'),hit=recent[i];
  if(i<recent.length){dot.className=hit?'hit':'miss';dot.title=tx(hit?'page.score.dotHit':'page.score.dotMiss');}else dot.title=tx('page.score.dotEmpty');
  if(i===recent.length-1&&lastScored!==-1&&sc.answered>lastScored)dot.className+=' fresh';
  dots.push(dot);}
 $('score-dots').replaceChildren(...dots);
 $('score-dots').setAttribute('aria-label',tx('page.score.dotsLabel',{hits:recent.filter(Boolean).length,total:recent.length}));
 $('score-value').textContent=sc.calibrating?tx('page.score.warmingUp'):sc.accuracy+'%';$('score-value').className='score-value'+(sc.calibrating?' pending':'');
 $('score').title=sc.calibrating?tx('page.score.needMore',{count:sc.needed,n:sc.needed}):tx('page.score.accuracyTitle');
 const meta=[];if(sc.streak>1)meta.push(tx('page.score.streak',{n:sc.streak}));if(sc.skipRate!=null)meta.push(tx('page.score.skipRate',{n:sc.skipRate}));
 $('score-meta').textContent=meta.join(' · ');lastScored=sc.answered;
}
// The reviewer model picker: a chip in the info line opening a small menu.
// Mid-review it asks once first, because switching restarts the review.
let menuOpen=false,pendingPick=null,menuError='';
const MODEL_NAMES={claude:'Claude Code',codex:'Codex',openrouter:'OpenRouter',openai:'Endpoint'};
const node=(tag,cls,value)=>{const item=document.createElement(tag);if(cls)item.className=cls;if(value!==undefined)item.textContent=value;return item;};
function modelView(state){
 const groups=state.models?.groups||[],chip=$('model'),route=routeText(state.route),usage=usageText(state.usage,state.tokens);
 const offered=groups.length>0&&!finished&&!!route;
 chip.hidden=!offered;
 if(offered){chip.replaceChildren(node('span','',route),node('span','caret','▾'));chip.disabled=!!state.models.busy;
  chip.title=tx(state.models.busy?'page.model.busyTitle':'page.model.chipTitle');}
 text('usage',offered?usage:[route,usage].filter(Boolean).join(' · '));
 if(!offered||state.models.busy)closeMenu();else if(menuOpen)buildMenu(state);
}
function closeMenu(){if(!menuOpen)return;menuOpen=false;pendingPick=null;menuError='';$('model-menu').hidden=true;$('model').setAttribute('aria-expanded','false');}
function buildMenu(state){
 const route=state.route||{},reviewing=!!state.models?.reviewing,keep=document.getElementById('model-save')?.checked===true;
 const parts=[node('h3','',tx('page.model.menuTitle')),node('p','menu-note',tx(reviewing?'page.model.noteReviewing':'page.model.noteGrading'))];
 // The restart question goes at the top, where the eye already is.
 if(pendingPick){const box=node('div','confirm'),actions=node('div'),go=node('button','primary',tx('page.model.restart')),no=node('button','quiet',tx('page.action.cancel'));go.type=no.type='button';
  go.onclick=()=>commit(pendingPick);no.onclick=()=>{pendingPick=null;buildMenu(current);};box.append(node('p','',tx('page.model.restartConfirm',{label:pendingPick.label})));actions.append(go,no);box.append(actions);parts.push(box);}
 for(const group of state.models.groups){
  parts.push(node('div','group',group.label+' · '+group.billing));
  for(const option of group.models){
   const selected=route.provider===group.provider&&route.model===option.model,button=node('button','option');button.type='button';
   button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(selected));button.disabled=!!option.disabled;if(option.disabled)button.title=option.disabled;
   button.append(node('span','dot',selected?'●':''),node('span','name',option.label),node('span','tag',option.disabled?tx('page.model.off'):option.note||''));
   button.onclick=()=>pick(state,{provider:group.provider,model:option.model,label:(MODEL_NAMES[group.provider]||group.label)+' '+option.label});
   parts.push(button);
  }
  if(group.custom){
   const row=node('div','custom'),input=node('input'),use=node('button','quiet',tx('page.model.use'));input.placeholder=tx('page.model.customPlaceholder');input.setAttribute('aria-label',tx('page.model.customLabel',{group:group.label}));input.spellcheck=false;use.type='button';
   use.onclick=()=>{const model=input.value.trim();if(model)pick(state,{provider:group.provider,model,label:(MODEL_NAMES[group.provider]||group.label)+' '+model});};
   input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();use.onclick();}};
   row.append(input,use);parts.push(row);
  }
 }
 if(menuError)parts.push(node('p','menu-error',menuError()));
 const foot=node('label','menu-foot'),save=node('input');save.type='checkbox';save.id='model-save';save.checked=keep;foot.append(save,node('span','',tx('page.model.saveDefault')));parts.push(foot);
 $('model-menu').replaceChildren(...parts);
 if(pendingPick)$('model-menu').scrollTop=0;
}
function pick(state,choice){menuError='';if(state.models?.reviewing){pendingPick=choice;buildMenu(state);return;}commit(choice);}
async function commit(choice){
 const save=document.getElementById('model-save')?.checked===true;pendingPick=null;
 try{const res=await fetch(base+'/action?model=1',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({provider:choice.provider,model:choice.model,saveDefault:save})});
  const data=await res.json().catch(()=>({}));if(!res.ok){menuError=()=>data.error||tx('page.model.switchFailed');buildMenu(current);return;}closeMenu();}
 catch{menuError=()=>tx('page.menu.unreachable');buildMenu(current);}
}
$('model').onclick=()=>{if(menuOpen){closeMenu();return;}closeDistance();closeLanguage();menuOpen=true;menuError='';$('model-menu').hidden=false;$('model-menu').style.left=$('model').offsetLeft+'px';$('model').setAttribute('aria-expanded','true');buildMenu(current);$('model-menu').querySelector?.('[aria-checked="true"]')?.focus?.();};
document.onkeydown=event=>{if(event.key!=='Escape')return;if(menuOpen){closeMenu();$('model').focus();}if(distanceOpen){closeDistance();$('distance').focus();}if(languageOpen){closeLanguage();$('language').focus();}};
// A click inside the menu can rebuild it, detaching the clicked button; that is not a click outside.
document.onclick=event=>{if(event.target?.isConnected===false)return;if(menuOpen&&!$('model-menu').contains?.(event.target)&&!$('model').contains?.(event.target))closeMenu();if(distanceOpen&&!$('distance-menu').contains?.(event.target)&&!$('distance').contains?.(event.target))closeDistance();if(languageOpen&&!$('language-menu').contains?.(event.target)&&!$('language').contains?.(event.target))closeLanguage();};
$('resume-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('resume-command').textContent);$('resume-copy').textContent=tx('page.resume.copied');setTimeout(()=>{$('resume-copy').textContent=tx('page.resume.copy');},1500);}catch{}};
// A background tab says when it is waiting on you.
const waitingOnYou=()=>['question','recovery','consent'].includes(current?.phase)&&!finished;
function titleView(){document.title=tx(waitingOnYou()&&document.visibilityState==='hidden'?(current.phase==='consent'?(operation(current)==='commit'?'page.title.consentCommit':'page.title.consentPush'):'page.title.answersNeeded'):'page.title.default');}
document.onvisibilitychange=titleView;
// For a push that may be a pull request: whether to post the stamp there once you pass.
function stampView(state){
 const s=state.stamp,row=$('stamp-row');row.hidden=!s||finished;if(row.hidden)return;
 $('stamp').checked=!!s.post;
 row.title=tx(s.action?'page.stamp.tooltipAction':'page.stamp.tooltip');
}
$('stamp').onchange=async()=>{const want=$('stamp').checked;try{const res=await fetch(base+'/action?stamp=1',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({post:want})});if(!res.ok)$('stamp').checked=!want;}catch{$('stamp').checked=!want;}};
// The question distance: shown as a chip, explained in its tooltip, and changeable
// for this repository. It applies from the next check, since this one's questions exist.
// Each distance's name and description keys.
const DISTANCE_TEXT={high:['page.distance.high','page.distance.highDesc'],mixed:['page.distance.mixed','page.distance.mixedDesc'],low:['page.distance.low','page.distance.lowDesc']};
let distanceOpen=false;
function distanceView(state){
 const d=state.distance,chip=$('distance');
 chip.hidden=!d||finished;if(chip.hidden){closeDistance();return;}
 // An unknown value shows as it is, and its missing description as "undefined".
 const known=DISTANCE_TEXT[d.current],label=known?tx(known[0]):d.current;
 chip.replaceChildren(node('span','',tx('page.distance.chip',{label})),...(d.next?[node('span','next',' '+tx('page.distance.chipNext',{label:tx(DISTANCE_TEXT[d.next][0])}))]:[]),node('span','caret','▾'));
 chip.title=tx('page.distance.chipTitle',{label,desc:known&&tx(known[1]),high:tx(DISTANCE_TEXT.high[1]),mixed:tx(DISTANCE_TEXT.mixed[1]),low:tx(DISTANCE_TEXT.low[1])});
 if(distanceOpen)buildDistance(state);
}
function closeDistance(){if(!distanceOpen)return;distanceOpen=false;$('distance-menu').hidden=true;$('distance').setAttribute('aria-expanded','false');}
function buildDistance(state){
 const d=state.distance,chosen=d.next||d.current,parts=[node('h3','',tx('page.distance.menuTitle')),node('p','menu-note',tx('page.distance.menuNote',{label:tx(DISTANCE_TEXT[d.current][0]).toLowerCase()}))];
 for(const value of ['high','mixed','low']){
  const button=node('button','option'),text=node('span','name'),name=tx(DISTANCE_TEXT[value][0]);button.type='button';button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(value===chosen));
  text.append(node('span','',value==='mixed'?tx('page.distance.withDefault',{label:name}):name),node('span','desc',tx(DISTANCE_TEXT[value][1])));
  button.append(node('span','dot',value===chosen?'●':''),text);
  button.onclick=()=>chooseDistance(value);parts.push(button);
 }
 parts.push(node('p','menu-foot',tx(d.next?'page.distance.footNext':d.scope==='repository'?'page.distance.footRepository':'page.distance.footMachine')));
 $('distance-menu').replaceChildren(...parts);
}
async function chooseDistance(value){
 try{const res=await fetch(base+'/action?distance=1',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({distance:value})});if(res.ok)closeDistance();}catch{}
}
$('distance').onclick=()=>{if(distanceOpen){closeDistance();return;}closeMenu();closeLanguage();distanceOpen=true;$('distance-menu').hidden=false;$('distance-menu').style.left=$('distance').offsetLeft+'px';$('distance').setAttribute('aria-expanded','true');buildDistance(current);};
// The questionnaire language: a chip naming the page's language, opening a menu of both. A pick redraws the page at
// once and saves it on the server. A failed pick shows in the menu, and the page then follows the server's next state.
const LANGUAGE_NAMES=${scriptJSON({ en: t('en', 'common.language.en'), ko: t('ko', 'common.language.ko') })};
let languageOpen=false,languageError='';
function languageView(){
 const chip=$('language');chip.hidden=finished;if(chip.hidden){closeLanguage();return;}
 chip.replaceChildren(node('span','',LANGUAGE_NAMES[pageLanguage]),node('span','caret','▾'));
 if(languageOpen)buildLanguage();
}
function closeLanguage(){if(!languageOpen)return;languageOpen=false;languageError='';$('language-menu').hidden=true;$('language').setAttribute('aria-expanded','false');}
function buildLanguage(){
 const parts=[node('h3','',tx('page.language.menuTitle'))];
 for(const value of ['en','ko']){
  // Each name is in its own language, which a screen reader then speaks in that language.
  const button=node('button','option'),name=node('span','name',LANGUAGE_NAMES[value]);button.type='button';name.lang=value;
  button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(value===pageLanguage));
  button.append(node('span','dot',value===pageLanguage?'●':''),name);button.onclick=()=>chooseLanguage(value);parts.push(button);
 }
 if(languageError)parts.push(node('p','menu-error',languageError()));
 $('language-menu').replaceChildren(...parts);
}
async function chooseLanguage(value){
 // The redraw replaces the option that had focus, so focus goes back to the chip, as Escape does.
 languageError='';applyLanguage(value);if(current)render(current);$('language').focus();
 try{const res=await fetch(base+'/action?language=1',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({language:value})}),data=await res.json().catch(()=>({}));
  if(res.ok&&!data.languageError){closeLanguage();return;}
  // A failed save still switched this Git operation. A refused pick switched nothing, so the next state decides.
  if(res.ok)languageError=()=>data.languageError;else{languageError=()=>data.error||tx('page.menu.unreachable');lastStateLanguage=undefined;}}
 catch{languageError=()=>tx('page.menu.unreachable');lastStateLanguage=undefined;}
 if(languageOpen)buildLanguage();
}
$('language').onclick=()=>{if(languageOpen){closeLanguage();return;}closeMenu();closeDistance();languageOpen=true;languageError='';$('language-menu').hidden=false;$('language-menu').style.left=$('language').offsetLeft+'px';$('language').setAttribute('aria-expanded','true');buildLanguage();$('language-menu').querySelector?.('[aria-checked="true"]')?.focus?.();};

// A newer release is offered quietly; installing waits until this check ends.
function updateView(u){const b=$('update');if(!u?.available){b.hidden=true;return;}b.hidden=false;
 if(u.status==='scheduled'){b.textContent=tx('page.update.scheduled',{version:u.latest});b.disabled=true;b.title='';}
 else if(u.status==='failed'){b.textContent=tx('page.update.failed');b.disabled=true;b.title=tx('page.update.failedTitle',{command:u.command||'npm install -g sphinx-understand@latest'});}
 else if(!u.command){b.textContent=tx('page.update.available',{version:u.latest});b.disabled=true;b.title=u.note||'';}
 else{b.textContent=tx('page.update.availableAction',{version:u.latest});b.disabled=false;b.title=tx('page.update.actionTitle',{command:u.command});}}
$('update').onclick=async()=>{const b=$('update');b.disabled=true;b.textContent=tx('page.update.scheduling');
 try{const res=await fetch(base+'/action?update=1',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:'{}'});const data=await res.json();updateView(data.update||{available:true,status:'failed'});}catch{updateView({available:true,status:'failed'});}};
const resize=()=>{$('response').style.height='auto';$('response').style.height=Math.min($('response').scrollHeight||76,180)+'px';};
function controls(){
 if(!current)return;
 const canAnswer=current.phase==='question'&&!current.operationClosed&&connected&&!submitting;
 // Only answer controls follow the question state; browsing the change never locks.
 for(const button of document.querySelectorAll('#composer button'))button.disabled=!canAnswer;
 $('pause').disabled=!connected||submitting||finished;
 for(const id of ['skip','skipconfirm','skipcancel'])$(id).disabled=!connected||finished;
 $('hint').disabled=!canAnswer||hinted;$('hint').textContent=tx(hinted?'page.composer.hintShown':'page.composer.showHint');
 for(const button of [...$('recovery').querySelectorAll('button'),...$('consent').querySelectorAll('button')])button.disabled=!connected||submitting||finished;
 $('response').disabled=current.phase!=='question'||current.operationClosed||submitting;
}
function history(messages){
 const signature=JSON.stringify([current?.phase,messages]);
 if(signature===lastMessages)return;
 lastMessages=signature;
 const scroll=$('conversation'),nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<100;
 $('messages').replaceChildren();
 for(let index=0;index<messages.length;index++){
  const item=messages[index];
  if(item.kind==='activity'){
   // Consecutive review steps collapse to one line showing the latest step.
   const steps=[item];while(messages[index+1]?.kind==='activity')steps.push(messages[++index]);
   const row=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),latest=document.createElement('span'),count=document.createElement('span'),list=document.createElement('ol');
   const live=index===messages.length-1&&current?.phase==='working';
   row.className='turn activity'+(live?' live':'');latest.className='latest';latest.textContent=steps.at(-1).text;
   count.className='count';count.textContent=steps.length===1?'':tx('page.conversation.steps',{n:steps.length});
   summary.append(latest,count);
   for(const step of steps){const li=document.createElement('li');li.textContent=step.text;list.append(li);}
   details.open=openGroups.has(item.id);details.ontoggle=()=>{if(details.open)openGroups.add(item.id);else openGroups.delete(item.id);};
   details.append(summary,list);row.append(details);$('messages').append(row);continue;
  }
  const row=document.createElement('li'),name=document.createElement('div'),body=document.createElement('p');
  row.className='turn '+(item.role==='human'?'human':'sphinx')+(item.kind==='question'?' question':item.kind==='notice'?' notice':'')+(item.streaming?' streaming':'');
  name.className='speaker';name.textContent=tx(item.role==='human'?'page.conversation.you':'page.conversation.sphinx');body.className='turn-text';body.textContent=item.text;
  row.append(name);
  if(item.kind==='question'&&item.number){const caption=document.createElement('div');caption.className='question-number';caption.textContent=tx(item.followUp?'page.conversation.questionFollowUp':'page.conversation.questionNumber',{n:item.number});row.append(caption);}
  row.append(body);
  if(item.choices?.length){const list=document.createElement('ul');for(const choice of item.choices){const li=document.createElement('li');li.textContent=choice;list.append(li);}row.append(list);}
  if(item.role==='human'&&['checking','not-graded'].includes(item.status)){const note=document.createElement('div');note.className='turn-note';note.textContent=tx(item.status==='checking'?'page.conversation.checking':'page.conversation.notGraded');row.append(note);}
  $('messages').append(row);
 }
 if(nearBottom)scroll.scrollTop=scroll.scrollHeight;
}
function render(state){
 if(current&&state.sequence<current.sequence)return;
 const previous=current;current=state;finished=state.operationClosed||['passed','paused','error','skipped','stopped'].includes(state.phase);
 // A state names the questionnaire language. The page follows a change from the last state's language (a pick made
 // elsewhere), never a mere difference from its own, and a state without one changes nothing. Drawing the same state
 // again, as the chip does, brings no new state.
 if(state!==previous&&state.language&&state.language!==lastStateLanguage){lastStateLanguage=state.language;if(state.language!==pageLanguage)applyLanguage(state.language);}
 const repo=state.repoName||state.repoRoot?.split(/[\\\\/]/).filter(Boolean).at(-1),branch=state.target?.replace(/^refs\\/heads\\//,'');
 text('meta',repo||state.change?.header?.repository||'');$('meta').title=state.repoRoot||'';
 modelView(state);distanceView(state);languageView();stampView(state);titleView();
 $('resume').hidden=!(['paused','stopped'].includes(state.phase)&&state.resume);if(state.resume)$('resume-command').textContent=state.resume;scoreView(state.score);updateView(state.update);const messages=state.messages||[];
 // While Git waits, pausing stops it, so the button says so in the scope line's words.
 const isCommit=operation(state)==='commit';$('pause').textContent=tx(state.waitingGit?(isCommit?'page.header.stopCommit':'page.header.stopPush'):'page.header.pause');
 // Unattended GUI Git shows nothing else while it waits, so when the hook will stop on its own the page says when.
 const abandon=state.abandonAfterMs>0?tx(isCommit?'page.waiting.abandonCommit':'page.waiting.abandonPush',{minutes:minutes(state.abandonAfterMs)}):'';
 text('waiting',finished?'':state.phase==='consent'?[tx(isCommit?'page.waiting.consentCommit':'page.waiting.consentPush'),...(abandon?[abandon,tx(isCommit?'page.waiting.cancelledCommit':'page.waiting.cancelledPush')]:[tx('page.waiting.consentClosing')])].join(' ')
  :state.waitingGit?[tx(isCommit?'page.waiting.passCommit':'page.waiting.passPush'),abandon||tx(isCommit?'page.waiting.closingStopCommit':'page.waiting.closingStopPush')].join(' '):tx('page.waiting.idle'));
 const label=state.phase==='question'?tx('page.status.questionOf',{n:state.progress.completed+1,total:state.progress.total}):tx(state.phase==='working'?'page.status.reviewing':state.phase==='recovery'?'page.status.recovery':state.phase==='consent'?'page.status.consent':state.phase==='passed'?'page.status.passed':state.phase==='paused'?(state.waitingGit?'page.status.stopped':'page.status.paused'):state.phase==='skipped'?'page.status.skipped':state.phase==='stopped'?'page.status.stopped':state.phase==='error'?'page.status.error':'page.status.waiting');
 const retry=state.phase==='question'&&[...messages].reverse().find(item=>item.kind==='question')?.followUp;
 text('status',label+(retry?' · '+tx('page.status.retry'):''));$('message').className='message'+(['passed','consent'].includes(state.phase)?' passed':'');scope(state,branch,label);$('status').className='status phase-'+state.phase+(state.phase==='working'?' busy':'')+(retry?' retry':'');if((state.phase==='question'&&!retry)||state.phase==='consent')$('status').hidden=true;text('message',state.message);text('error',state.phase==='recovery'?'':state.error);text('recovery-reason',state.phase==='recovery'?state.error:''); if(['passed','stopped'].includes(state.phase)&&String(state.message||'').includes('\\n')){const [lead,...rest]=state.message.split('\\n');text('message',lead);text('status',rest.join(' '));$('status').className='status passed-note';}
 history(messages);
 // Live activity already shows progress; avoid stacking generic spinners under it.
 if(state.phase==='working'&&(messages.at(-1)?.kind==='activity'||messages.at(-1)?.streaming)){$('status').hidden=true;$('message').hidden=true;}
 text('feedback',messages.length?'':state.feedback);
 $('question').hidden=state.phase!=='question'||messages.some(item=>item.kind==='question'&&item.questionId===state.question?.id);
 $('composer').hidden=!['question','working'].includes(state.phase)&&!state.error;
 $('form').hidden=!['question','working'].includes(state.phase);
 $('recovery').hidden=state.phase!=='recovery';$('consent').hidden=state.phase!=='consent';$('pause').hidden=finished||state.phase==='consent';$('skip').hidden=finished||state.phase==='consent';if(finished||state.phase==='consent')$('skipbar').hidden=true;
 if(state.question){
  text('prompt',state.question.prompt);$('choices').replaceChildren();
  for(const choice of state.question.choices||[]){const li=document.createElement('li');li.textContent=choice;$('choices').append(li);}
  $('choices').hidden=!(state.question.choices||[]).length;
  const key=state.id+':'+state.question.id;
  // A saved, ungraded response (for example after a provider failure) is restored when the question is first shown.
  if(lastQuestion!==key){const draft=state.draft;$('response').value=draft?.text||'';lastQuestion=key;if(disputing!==(draft?.kind==='dispute')){setDispute(!disputing);text('error',state.error);}resize();hinted=false;if(filter==='relevant')filter='all';lastEvidence='';lastFiles='';}
 }
 const graded=[...messages].reverse().find(item=>item.role==='human'&&item.status==='graded');
 if(graded&&lastGraded!==graded.id){lastGraded=graded.id;$('response').value='';resize();if(disputing)setDispute(false);}
 $('recovery').replaceChildren();
 if(state.phase==='recovery')for(const choice of state.choices||[]){
  if(choice.value==='pause')continue;
  const row=document.createElement('div'),button=document.createElement('button'),description=document.createElement('p');
  button.type='button';button.textContent=choice.label;button.onclick=()=>send(choice.value);description.textContent=choice.description;row.append(button,description);$('recovery').append(row);
 }
 // After a pass, Git waits on one row of choices, explained in one line. Red stays reserved for skipping the check.
 // Built once per step, so a display-only update never takes focus from a button.
 const consentKey=state.phase==='consent'?JSON.stringify([state.id,state.choices]):'';
 if(consentKey!==lastConsent){
  lastConsent=consentKey;$('consent').replaceChildren();
  if(consentKey){const row=node('div','actions'),choices=state.choices||[],hint=node('p','hint',choices.map(choice=>choice.description).join(' '));hint.id='consent-hint';
   for(const choice of choices){const button=node('button',choice.value==='proceed'?'primary':'',choice.label);button.type='button';button.onclick=()=>send(choice.value);row.append(button);}
   $('consent').append(row,hint);}
 }
 checkpoint(state);evidenceList();controls();
 // A new step (question, recovery decision, result) must never sit below the fold.
 if(previous?.phase!==state.phase||previous?.question?.id!==state.question?.id){const scroll=$('conversation');scroll.scrollTop=scroll.scrollHeight;
  // On a phone a question starts at the top. A choice or a result scrolls only as far as it needs, the last one
  // brought into view winning: the consent buttons over the message, the message over what follows it.
  if(globalThis.matchMedia?.('(max-width: 899px)').matches){if(['question','working','recovery'].includes(state.phase))[...document.querySelectorAll('#messages .turn.question')].at(-1)?.scrollIntoView?.({block:'start'});
   else{if(state.phase==='consent')setTab('question');for(const id of state.phase==='consent'?['message','consent']:['status','message'])$(id).scrollIntoView?.({block:'nearest'});}}}
 if(state.phase==='question'&&(previous?.phase!=='question'||previous?.question?.id!==state.question?.id)&&document.visibilityState!=='hidden')$('response').focus({preventScroll:true});
 // The choice takes focus as a group, so Tab reaches Continue next and a stray Enter confirms nothing.
 if(state.phase==='consent'&&previous?.phase!=='consent'&&document.visibilityState!=='hidden')$('consent').focus({preventScroll:true});
}
async function send(action){
 if(!current||submitting||finished||!connected)return;
 if(['answer','learn','dispute'].includes(action)&&current.phase!=='question')return;
 if(['proceed','stop'].includes(action)&&current.phase!=='consent')return;
 const response=$('response').value.trim();
 if(['answer','dispute'].includes(action)&&!response){text('error',tx(action==='dispute'?'page.composer.emptyDispute':'page.composer.emptyAnswer'));$('response').focus();return;}
 submitting=true;controls();
 try{
  const res=await fetch(base+'/action',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({id:current.id,revision:current.revision,action,...(['answer','learn','dispute'].includes(action)?{questionId:current.question.id,response}:action==='skip'&&$('skipreason').value.trim()?{response:$('skipreason').value.trim()}:{})})});
  const data=await res.json();if(!res.ok){fail(data.error||tx('page.composer.submitFailed'));return;}render(data);
 }catch{if(!finished)fail(tx('page.composer.connectionLost'));}
 finally{submitting=false;controls();}
}
// Dispute is a reversible mode: the same box and Send button carry the reason.
function setDispute(on){
 disputing=on;$('form').classList.toggle('disputing',on);disputeText(on);
 text('error','');$('response').focus();
}
// The composer's words for answering or disputing; a language change redraws them without setDispute's side effects.
function disputeText(on){
 $('label').textContent=tx(on?'page.composer.disputeLabel':'page.composer.answerLabel');
 $('response').placeholder=tx(on?'page.composer.disputePlaceholder':'page.composer.answerPlaceholder');
 $('submit').textContent=tx(on?'page.composer.sendDispute':'page.composer.send');$('dispute').textContent=tx(on?'page.composer.backToAnswer':'page.composer.dispute');
}
$('dispute').onclick=()=>setDispute(!disputing);
const submit=()=>send(disputing?'dispute':'answer');
$('form').onsubmit=event=>{event.preventDefault();submit();};
$('response').oninput=resize;
$('response').onkeydown=event=>{
 if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
 event.preventDefault();if(!event.repeat)submit();
};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>send(button.dataset.action);
$('pause').onclick=()=>send('pause');
// The hint reveals which code the reviewer read: think first, then look.
$('hint').onclick=()=>{hinted=true;lastEvidence='';lastFiles='';evidenceList();files();controls();announce(tx('page.announce.hintShown'));};
$('skip').onclick=()=>{$('skipbar').hidden=false;$('skipreason').focus();};
$('skipcancel').onclick=()=>{$('skipbar').hidden=true;};
$('skipconfirm').onclick=()=>send('skip');
$('skipreason').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();send('skip');}else if(event.key==='Escape')$('skipbar').hidden=true;};

// Change context: a read-only view of the exact frozen comparison. Every value
// from the repository enters the DOM through textContent, never markup.
// filesText and diffFailure draw the notes a load leaves, so a language switch can redraw them.
let change,changeFor,changeLoading=false,filter='all',query='',selected,diff,diffSeq=0,tab='question',lastFiles='',lastEvidence='',filesText,diffFailure;const contextFor=new Map();
const el=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;if(value!=null)node.textContent=value;return node;};
const num=n=>Number(n).toLocaleString('en-US');
// A plural key's params: the raw count picks the English form, and the number is shown grouped.
const counted=n=>({count:n,n:num(n)});
// The abandon window the way the hook's own message names it: whole minutes, at least one.
const minutes=ms=>tx('page.unit.minutes',counted(Math.max(1,Math.round(ms/60000))));
const short=oid=>oid?oid.slice(0,10):'';
const announce=value=>{$('announce').textContent='';$('announce').textContent=value;};
// The totals as parts: the files, the line counts, then any files without line counts.
function totalsParts(t){
 const parts=[tx('page.unit.files',counted(t.files)),'+'+num(t.additions)+' −'+num(t.deletions)+' '+tx('page.totals.lines')];
 if(t.binaryFiles)parts.push(tx('page.totals.binaryFiles',counted(t.binaryFiles)));
 if(t.uncountedFiles)parts.push(tx('page.totals.uncounted',{n:num(t.uncountedFiles)}));
 return parts;
}
const totalsText=t=>t?totalsParts(t).join(' · '):'';
// Additions in green and deletions in red, as git diff --stat shows them.
function totalsView(target,t){
 if(!t){target.replaceChildren();return;}
 const span=(cls,value)=>{const node=document.createElement('span');if(cls)node.className=cls;node.textContent=value;return node;};
 const [count,,...rest]=totalsParts(t);
 target.replaceChildren(span('',count+' · '),span('plus','+'+num(t.additions)),span('',' '),span('minus','−'+num(t.deletions)),span('',' '+tx('page.totals.lines')+rest.map(part=>' · '+part).join('')));
}
function scope(state,branch,label){
 const c=state.change,h=c?.header,target=()=>tx(state.event==='pre-commit'?'page.scope.commitTo':'page.scope.pushTo',{branch});
 $('scope-progress').textContent=label;
 if(!c){$('scope-op').textContent=branch?target():tx('page.status.waiting');$('scope-range').textContent=tx('page.scope.loading');$('scope-stats').textContent=tx('page.scope.loading');return;}
 if(h){
  const dest=(h.destination||'').replace(/^refs\\/heads\\//,'');
  $('scope-op').textContent=h.event==='pre-commit'?tx('page.scope.commitToStaged',{branch:dest}):tx('page.scope.pushTo',{branch:(h.remote&&h.remote!=='.'?h.remote+' / ':'')+dest});
  $('scope-range').textContent=h.staged?(h.base?short(h.base):tx('page.scope.emptyRepository'))+' → '+tx('page.scope.stagedIndex'):(h.base?short(h.base):tx('page.scope.newBranch'))+' → '+short(h.head);
  $('scope-range').title=[tx('page.scope.rangeCheckpoint',{oid:h.checkpoint}),h.base&&tx('page.scope.rangeBase',{oid:h.base}),h.head&&tx('page.scope.rangeHead',{oid:h.head})].filter(Boolean).join('\\n');
  totalsView($('scope-stats'),c.totals);
  $('scope-excluded-row').hidden=!h.excludedFiles;$('scope-excluded').textContent=h.excludedFiles?tx('page.scope.excludedFiles',counted(h.excludedFiles)):'';
  $('scope-note').textContent=[tx('page.scope.note'),...(h.excludedFiles?[tx('page.scope.noteExcluded',counted(h.excludedFiles))]:[])].join(' ');
 }else{
  $('scope-op').textContent=branch?target():'—';
  $('scope-range').textContent=tx(c.status==='loading'?'page.scope.loading':'page.scope.unavailable');
  $('scope-stats').textContent=c.status==='loading'?tx('page.files.loading'):c.reason?tx('page.scope.unavailableReason',{reason:c.reason}):tx('page.scope.unavailable');
 }
}
function checkpoint(state){
 if(changeFor&&changeFor!==state.id){change=undefined;changeFor=undefined;selected=undefined;diff=undefined;contextFor.clear();lastFiles='';clearDiff();}
 if(state.change?.status==='ready'&&changeFor!==state.id&&!changeLoading)loadChange(state.id);
 if(state.change?.status!=='ready'&&!change)$('files-note').textContent=state.change?.status==='unavailable'?tx('page.files.unavailableReason',{reason:state.change.reason||tx('page.files.unknownReason')}):tx('page.files.loading');
 files();
}
async function getJSON(path){const res=await fetch(base+path);let data={};try{data=await res.json();}catch{}return {ok:res.ok,status:res.status,data};}
async function loadChange(id){
 changeLoading=true;filesText=undefined;
 try{
  const r=await getJSON('/change?id='+encodeURIComponent(id));
  if(current?.id!==id)return;
  if(r.ok&&r.data.status==='ready'){change=r.data;changeFor=id;lastFiles='';filesNoteView(filesNote);files();evidenceList();}
  else filesNoteView(()=>tx('page.files.unavailable',{reason:r.data.error||r.data.reason||tx('page.files.requestFailed')}));
 }catch{filesNoteView(()=>tx('page.files.loadFailed'));}
 finally{changeLoading=false;}
}
// A server's reason stays as it was sent; only the page's own words change language.
function filesNoteView(draw){filesText=draw;$('files-note').textContent=draw();}
function filesNote(){
 if(!change)return '';
 const notes=[];
 if(change.listed<change.totals.files)notes.push(tx('page.files.listingFirst',{...counted(change.totals.files),listed:num(change.listed)}));
 if(change.header.excludedFiles)notes.push(tx('page.files.excludedNote',counted(change.header.excludedFiles)));
 return notes.join(' ');
}
function refs(){return hinted&&current?.evidence&&current.question&&current.evidence.questionId===current.question.id?current.evidence.refs:null;}
function relevantPaths(){return new Set((refs()||[]).filter(ref=>ref.inChange).map(ref=>ref.viewPath));}
function statsOf(list){return list.reduce((t,f)=>{t.files++;if(f.binary)t.binaryFiles++;else if(f.additions==null)t.uncountedFiles++;else{t.additions+=f.additions;t.deletions+=f.deletions;}return t;},{files:0,additions:0,deletions:0,binaryFiles:0,uncountedFiles:0});}
const STATUS={added:'page.fileStatus.added',modified:'page.fileStatus.modified',deleted:'page.fileStatus.deleted',renamed:'page.fileStatus.renamed'};
function files(){
 const relevant=relevantPaths(),all=change?.files||[];
 const subset=filter==='relevant'?all.filter(f=>relevant.has(f.path)):all;
 const shown=query?subset.filter(f=>(f.path+' '+(f.oldPath||'')).toLowerCase().includes(query.toLowerCase())):subset;
 const signature=JSON.stringify([changeFor,filter,query,selected,[...relevant],all.length]);
 $('filter-relevant').hidden=!hinted;document.querySelector?.('.filters')?.toggleAttribute?.('hidden',!hinted);
 $('filter-all').setAttribute('aria-pressed',String(filter==='all'));$('filter-relevant').setAttribute('aria-pressed',String(filter==='relevant'));
 const cited=statsOf(all.filter(f=>relevant.has(f.path)));
 $('count-all').textContent=change?tx('page.unit.files',counted(change.totals.files)):'';
 $('count-relevant').textContent=change?(refs()?tx('page.unit.files',counted(cited.files)):'—'):'';
 if(signature===lastFiles)return;lastFiles=signature;
 const list=$('file-list');list.replaceChildren();
 if(!change){$('filter-total').textContent='';return;}
 $('filter-total').textContent=filter==='relevant'
  ?(relevant.size?tx('page.files.citedTotal',{totals:totalsText(cited)}):tx(refs()?'page.files.citesNone':'page.files.noQuestion'))
  :query?tx('page.files.allTotalQuery',{totals:totalsText(change.totals),query}):tx('page.files.allTotal',{totals:totalsText(change.totals)});
 for(const f of shown){
  const li=el('li'),button=el('button','file');button.type='button';button.dataset.path=f.path;
  if(f.path===selected)button.setAttribute('aria-current','true');
  const badge=el('span','badge '+f.status,tx(f.binary?'page.fileStatus.binary':STATUS[f.status]));
  const name=el('span','name',f.path);
  if(f.oldPath)name.append(el('span','from',tx('page.files.from',{path:f.oldPath})));
  if(relevant.has(f.path))name.append(el('span','relevant',tx('page.files.cited')));
  const counts=el('span','counts');
  if(f.binary||f.additions==null)counts.textContent=tx(f.binary?'page.files.countsBinary':'page.files.countsNone');
  else{counts.append(el('span','plus','+'+num(f.additions)),' ',el('span','minus','−'+num(f.deletions)));}
  button.setAttribute('aria-label',[tx(f.binary?'page.files.ariaNameBinary':'page.files.ariaName',{status:tx(STATUS[f.status]),path:f.path})+(f.oldPath?' '+tx('page.files.from',{path:f.oldPath}):''),
   f.binary||f.additions==null?tx('page.totals.noLineCounts'):tx('page.files.ariaCounts',{added:f.additions,removed:f.deletions}),relevant.has(f.path)&&tx('page.files.ariaCited')].filter(Boolean).join(', '));
  button.append(badge,name,counts);button.onclick=()=>openFile(f.path,{show:true});
  li.append(button);list.append(li);
 }
 if(!shown.length)list.append(el('li','pane-note',tx(filter==='relevant'?'page.files.noneLinked':'page.files.noneMatch')));
}
$('filter-all').onclick=()=>{filter='all';files();announce(tx('page.announce.allFiles'));};
$('filter-relevant').onclick=()=>{filter='relevant';files();announce(tx('page.announce.relevantFiles'));};
$('file-search').oninput=()=>{query=$('file-search').value.trim();files();};
$('file-list').onkeydown=event=>{
 if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
 const buttons=[...$('file-list').querySelectorAll('button')];if(!buttons.length)return;
 const at=buttons.indexOf(document.activeElement);event.preventDefault();
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,at+(event.key==='ArrowDown'?1:-1)));
 buttons[next].focus();
};
function setTab(name){
 tab=name;$('workspace').className='workspace show-'+name;
 for(const id of ['question','files','diff'])$('tab-'+id).setAttribute('aria-selected',String(id===name));
}
for(const id of ['question','files','diff'])$('tab-'+id).onclick=()=>{setTab(id);announce(tx(id==='question'?'page.announce.questionView':id==='files'?'page.announce.filesView':'page.announce.diffView'));};
$('back-question').onclick=()=>{setTab('question');$('response').focus({preventScroll:true});announce(tx('page.announce.backToQuestion'));};
// The empty diff pane's words, apart from clearDiff's clearing so a language switch can redraw them.
function emptyDiffText(){$('diff-title').textContent=tx('page.diff.noFile');$('diff-meta').textContent=tx(hinted?'page.diff.browseHinted':'page.diff.browse');}
function clearDiff(){emptyDiffText();$('diff-body').replaceChildren();$('diff-note').hidden=true;$('diff-legend').hidden=true;$('context-more').hidden=true;$('context-all').hidden=true;}
// Why a diff shows no lines, by the change view's note code.
const NOTES={binary:'page.diffNote.binary',symlink:'page.diffNote.symlink',submodule:'page.diffNote.submodule',unsupported:'page.diffNote.unsupported','rename-only':'page.diffNote.renameOnly','mode-only':'page.diffNote.modeOnly',empty:'page.diffNote.empty','too-large':'page.diffNote.tooLarge','non-utf8':'page.diffNote.nonUtf8'};
async function openFile(path,{show=false,range,quiet=false}={}){
 if(!current||!change)return;
 selected=path;files();if(show)setTab('diff');
 const level=contextFor.get(path)||'3',id=current.id,seq=++diffSeq;
 diffFailure=undefined;$('diff-title').textContent=path;$('diff-meta').textContent=tx('page.diff.loading');
 try{
  const r=await getJSON('/diff?id='+encodeURIComponent(id)+'&path='+encodeURIComponent(path)+'&context='+encodeURIComponent(level));
  if(seq!==diffSeq||current?.id!==id)return;
  if(!r.ok){diff=undefined;$('diff-body').replaceChildren();diffFailureView(()=>r.data.error||tx('page.diff.unavailable'));return;}
  diff=r.data;
  if(range&&level!=='all'&&!visible(range)&&!diff.note){contextFor.set(path,'all');return openFile(path,{range,quiet});}
  drawDiff(quiet?undefined:range,quiet);
 }catch{if(seq===diffSeq)diffFailureView(()=>tx('page.diff.loadFailed'));}
}
// As for the files note, a server's reason stays as it was sent.
function diffFailureView(draw){diffFailure=draw;$('diff-meta').textContent='';$('diff-note').textContent=draw();$('diff-note').hidden=false;}
function rowsOf(d){return (d?.hunks||[]).flatMap(h=>h.rows);}
function visible(range){return rowsOf(diff).some(row=>row[range.side]!=null&&row[range.side]>=range.start&&row[range.side]<=range.end);}
function marked(row,ranges){return ranges.some(r=>row[r.side]!=null&&row[r.side]>=r.start&&row[r.side]<=r.end);}
function drawDiff(focus,quiet=false){
 const d=diff,ranges=(refs()||[]).filter(ref=>ref.viewPath===d.path).flatMap(ref=>ref.ranges);
 const level=d.context;
 $('diff-title').textContent=d.path;
 $('diff-meta').textContent=[d.binary&&tx('page.fileStatus.binary'),tx(STATUS[d.status])+(d.oldPath?' '+tx('page.files.from',{path:d.oldPath}):''),d.binary||d.additions==null?tx('page.totals.noLineCounts'):'+'+num(d.additions)+' −'+num(d.deletions),d.modeChange?tx('page.diff.mode',{from:d.modeChange.from,to:d.modeChange.to}):'',d.hunks.length?(level==='all'?tx('page.diff.fullFileMeta'):tx('page.diff.contextLines',{n:level})):''].filter(Boolean).join(' · ');
 const notes=[];if(d.note)notes.push(tx(NOTES[d.note]||'page.diffNote.fallback'));
 if(d.truncated)notes.push(tx('page.diff.truncated',{shown:num(d.truncated.shownRows),total:num(d.truncated.totalRows)}));
 if(ranges.length&&!rowsOf(d).some(row=>marked(row,ranges)))notes.push(tx('page.diff.evidenceOutside'));
 $('diff-note').textContent=notes.join(' ');$('diff-note').hidden=!notes.length;
 $('context-more').hidden=$('context-all').hidden=!d.hunks.length||level==='all';
 $('diff-legend').hidden=!d.hunks.length;
 const table=el('table','diff'),body=el('tbody');table.append(body);table.setAttribute('aria-label',tx('page.diff.tableLabel',{path:d.path}));
 let previous,first;
 for(const hunk of d.hunks){
  const hiddenLines=previous?hunk.newStart-(previous.newStart+previous.newLines):Math.max(hunk.newStart,hunk.oldStart)-1;
  if(hiddenLines>0&&level!=='all'){const tr=el('tr','gap'),td=el('td',null,tx('page.diff.hiddenLines',counted(hiddenLines)));td.colSpan=5;tr.append(td);body.append(tr);}
  const head=el('tr','hunk'),cell=el('td',null,'@@ −'+hunk.oldStart+','+hunk.oldLines+' +'+hunk.newStart+','+hunk.newLines+' @@'+(hunk.section?' '+hunk.section:''));cell.colSpan=5;head.append(cell);body.append(head);
  for(const row of hunk.rows){
   const hit=ranges.length&&marked(row,ranges);
   const tr=el('tr',row.type+(hit?' evidence':''));
   const sign=row.type==='addition'?'+':row.type==='deletion'?'−':' ';
   tr.append(el('td','mark',hit?'▸':''),el('td','num',row.old??''),el('td','num',row.new??''),el('td','sign',sign),el('td','code',row.text+(row.noNewline?'  '+tx('page.diff.noNewline'):'')));
   tr.setAttribute('aria-label',[tx(row.type==='addition'?'page.diff.rowAdded':row.type==='deletion'?'page.diff.rowRemoved':'page.diff.rowUnchanged',{n:row.type==='deletion'?row.old:row.new}),hit&&tx('page.diff.rowRead')].filter(Boolean).join(', '));
   if(hit&&!first&&focus&&marked(row,[focus]))first=tr;
   body.append(tr);
  }
  if(hunk.cut){const tr=el('tr','gap'),td=el('td',null,tx('page.diff.limitReached'));td.colSpan=5;tr.append(td);body.append(tr);}
  previous=hunk;
 }
 $('diff-body').replaceChildren(...(d.hunks.length?[table]:[]));
 if(first){first.tabIndex=-1;first.scrollIntoView?.({block:'center'});first.focus?.({preventScroll:true});announce(tx('page.announce.diffMarked',{path:d.path}));}
 else if(!quiet)announce(tx('page.announce.diff',{path:d.path}));
}
$('context-more').onclick=()=>{if(!diff)return;const now=contextFor.get(diff.path)||'3';contextFor.set(diff.path,now==='3'?'25':'all');openFile(diff.path);};
$('context-all').onclick=()=>{if(!diff)return;contextFor.set(diff.path,'all');openFile(diff.path);};
function rangeText(r){return tx(r.side==='old'?(r.end>r.start?'page.evidence.oldLines':'page.evidence.oldLine'):r.end>r.start?'page.evidence.lines':'page.evidence.line',{start:r.start,end:r.end});}
function evidenceList(){
 const active=current&&['question','working'].includes(current.phase)&&current.question&&hinted;
 $('evidence').hidden=!active;
 if(!active){if(lastEvidence!=='inactive'){lastEvidence='inactive';if(diff&&diff.path===selected)drawDiff(undefined,true);}return;}
 const list=refs(),signature=JSON.stringify([current.id,current.question.id,list,Boolean(change),current.change?.status]);
 if(signature===lastEvidence)return;lastEvidence=signature;
 $('evidence-list').replaceChildren();
 if(!list){$('evidence-note').textContent=tx(current.change?.status==='unavailable'?'page.evidence.unavailable':'page.evidence.loading');return;}
 for(const ref of list){
  const li=el('li'),path=el('span','ref-path',ref.path),lines=el('span','ref-lines',ref.ranges.length?ref.ranges.map(rangeText).join(', '):tx('page.evidence.wholeFile'));
  if(ref.inChange&&change){
   const button=el('button');button.type='button';button.append(path,lines);
   button.setAttribute('aria-label',[tx('page.evidence.open',{path:ref.path}),...ref.ranges.map(rangeText)].join(', '));
   button.onclick=()=>openFile(ref.viewPath,{show:true,range:ref.ranges[0]});li.append(button);
  }else{li.className='static';lines.textContent=(ref.inChange?'':tx('page.evidence.outsideChange')+' ')+lines.textContent;li.append(path,lines);}
  $('evidence-list').append(li);
 }
 $('evidence-note').textContent=tx(list.length?'page.evidence.note':'page.evidence.noLocation');
 files();
 // Keep the code beside the question: open its first cited hunk once, without
 // switching views. Never replace a file the person chose; refresh its markers.
 const firstRef=list.find(ref=>ref.inChange);
 if(change&&!selected&&firstRef)openFile(firstRef.viewPath,{range:firstRef.ranges[0],quiet:true});
 else if(diff&&diff.path===selected)drawDiff(undefined,true);
}
const events=new EventSource(base+'/events');events.onmessage=event=>{try{connected=true;render(JSON.parse(event.data));if(current?.operationClosed){connected=false;events.close();}}catch{}};
events.onerror=()=>{connected=false;controls();if(current?.operationClosed){events.close();return;}$('waiting').hidden=true;fail(tx('page.connection.reconnecting'));};
</script></body></html>`;
}
