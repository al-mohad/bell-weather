/** One stylesheet, inlined into every page, so a report directory is portable. */
export const STYLE = `
:root {
  --paper: #f2f4f5; --surface: #fbfcfc; --surface-2: #e7eced;
  --ink: #131c24; --ink-soft: #46565f; --ink-faint: #6f8189;
  --rule: #cbd5d7; --teal: #0f6b6b; --amber: #97600a; --rust: #94382a;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0d1418; --surface: #141d22; --surface-2: #1b262c;
    --ink: #dee6e8; --ink-soft: #a2b1b7; --ink-faint: #74868d;
    --rule: #2a373e; --teal: #56b6af; --amber: #d7a44c; --rust: #dd8471;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1.25rem; background: var(--paper); color: var(--ink);
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 68rem; margin: 0 auto; display: flex; flex-direction: column; gap: 2rem; }
h1 { font-size: 1.7rem; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 1.1rem; margin: 0; border-top: 1px solid var(--rule); padding-top: 0.9rem; }
p { margin: 0; color: var(--ink-soft); }
a { color: var(--teal); }
.meta { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-faint); display: flex; flex-wrap: wrap; gap: 0.3rem 1.2rem; }
.cards { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
.card { background: var(--surface); border: 1px solid var(--rule); padding: 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.card .label { font-family: var(--mono); font-size: 0.66rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); }
.card .value { font-family: var(--mono); font-size: 1.7rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.card .note { font-size: 0.8rem; color: var(--ink-soft); }
.teal { color: var(--teal); } .amber { color: var(--amber); } .rust { color: var(--rust); }
.scroller { overflow-x: auto; border: 1px solid var(--rule); background: var(--surface); }
table { border-collapse: collapse; width: 100%; min-width: 46rem; font-size: 0.86rem; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-top: 1px solid var(--rule); vertical-align: top; }
thead th { font-family: var(--mono); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-soft); background: var(--surface-2); font-weight: 500; }
td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
.pill { display: inline-block; font-family: var(--mono); font-size: 0.66rem; text-transform: uppercase; padding: 0.1rem 0.4rem; border-radius: 2px; }
.pill.pass { background: rgba(15,107,107,0.14); color: var(--teal); }
.pill.fail { background: rgba(148,56,42,0.14); color: var(--rust); }
.pill.void { background: rgba(151,96,10,0.14); color: var(--amber); }
.note-box { background: var(--surface); border: 1px solid var(--rule); border-left: 3px solid var(--amber); padding: 0.9rem 1rem; font-size: 0.88rem; }
.screen { background: #001b0e; color: #33ff77; font-family: var(--mono); font-size: 12px; line-height: 1.25; padding: 0.9rem; overflow-x: auto; white-space: pre; border: 1px solid var(--rule); }
.step { background: var(--surface); border: 1px solid var(--rule); padding: 0.9rem; display: flex; flex-direction: column; gap: 0.6rem; }
.step h3 { margin: 0; font-family: var(--mono); font-size: 0.8rem; color: var(--ink-faint); font-weight: 500; }
.step .action { font-family: var(--mono); font-size: 0.82rem; }
.step img { max-width: 100%; image-rendering: pixelated; border: 1px solid var(--rule); }
.badge { font-family: var(--mono); font-size: 0.7rem; padding: 0.1rem 0.4rem; border: 1px solid var(--rule); }
footer { border-top: 1px solid var(--rule); padding-top: 1rem; font-family: var(--mono); font-size: 0.72rem; color: var(--ink-faint); }
`;
