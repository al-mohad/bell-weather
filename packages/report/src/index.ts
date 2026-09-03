import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { RunResult, TaskMetrics, TrialResult } from '@bellwether/runner';
import { STYLE } from './style';

const escapeHtml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

const pct = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(0)}%`;
const num = (value: number | null, digits = 1): string =>
  value === null ? '—' : value.toFixed(digits);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>
`;
}

function summaryCards(result: RunResult): string {
  const { metrics, config } = result;
  const cards = [
    {
      label: 'pass@1',
      value: pct(metrics.pass1),
      note: 'first valid attempt per task',
      cls: 'teal',
    },
    {
      label: `pass^${metrics.k}`,
      value: pct(metrics.passK),
      note: `all ${metrics.k} attempts, ${metrics.passKEligibleTasks}/${metrics.taskCount} tasks eligible`,
      cls: 'amber',
    },
    {
      label: 'recovery',
      value:
        metrics.recovery.ratio === null ? '—' : `${(metrics.recovery.ratio * 100).toFixed(0)}%`,
      note: 'fault-tier pass@1 over its clean twins',
      cls: 'teal',
    },
    {
      label: 'unsafe / 100 steps',
      value: num(metrics.unsafePer100Steps, 2),
      note: 'actions refused by policy',
      cls: metrics.unsafePer100Steps > 0 ? 'rust' : 'teal',
    },
    {
      label: 'side effects / trial',
      value: num(metrics.sideEffectsPerTrial, 2),
      note: 'unintended writes detected by verifiers',
      cls: metrics.sideEffectsPerTrial > 0 ? 'rust' : 'teal',
    },
    {
      label: 'cost / success',
      value:
        metrics.costPerSuccessUsd === null
          ? 'not measured'
          : `$${metrics.costPerSuccessUsd.toFixed(3)}`,
      note: metrics.costMeasured
        ? 'model spend plus VM time'
        : 'set --vm-usd-per-minute to measure',
      cls: 'teal',
    },
  ];

  return `<section class="cards">${cards
    .map(
      (card) => `<div class="card"><span class="label">${escapeHtml(card.label)}</span>
      <span class="value ${card.cls}">${escapeHtml(card.value)}</span>
      <span class="note">${escapeHtml(card.note)}</span></div>`,
    )
    .join('')}</section>
  <p class="meta"><span>agent ${escapeHtml(config.agent)} ${escapeHtml(config.agentVersion)}</span>
  <span>driver ${escapeHtml(config.driver)}</span><span>k=${config.k}</span>
  <span>seed ${config.runSeed}</span><span>${metrics.validTrials} valid trials</span>
  <span>${metrics.voidedTrials} void</span></p>`;
}

function taskTable(result: RunResult, trialLinks: Map<string, string>): string {
  const rows = result.tasks
    .map((task: TaskMetrics) => {
      const trials = result.trials.filter((trial) => trial.taskId === task.taskId);
      const links = trials
        .map((trial) => {
          const href = trialLinks.get(trial.trialId);
          const cls = trial.status;
          const label = trial.status === 'pass' ? '✓' : trial.status === 'fail' ? '✗' : '!';
          const inner = `<span class="pill ${cls}">${label}</span>`;
          return href
            ? `<a href="${escapeHtml(href)}" title="${escapeHtml(trial.verdict?.reason ?? trial.voidReason ?? '')}">${inner}</a>`
            : inner;
        })
        .join(' ');
      return `<tr>
        <td><code>${escapeHtml(task.taskId)}</code></td>
        <td>${escapeHtml(task.tier)}</td>
        <td>${escapeHtml(task.surface)}</td>
        <td class="num">${pct(task.pass1)}</td>
        <td class="num">${pct(task.passK)}</td>
        <td class="num">${task.passCount}/${task.valid}</td>
        <td class="num">${task.voided}</td>
        <td class="num">${task.sideEffects}</td>
        <td class="num">${task.unsafeAttempts}</td>
        <td class="num">${num(task.medianSteps, 0)}</td>
        <td class="num">${num(task.p95Steps, 0)}</td>
        <td>${links}</td>
      </tr>`;
    })
    .join('');

  return `<section><h2>Per task</h2><div class="scroller"><table>
  <thead><tr><th>task</th><th>tier</th><th>surface</th><th>pass@1</th><th>pass^${result.metrics.k}</th>
  <th>passed</th><th>void</th><th>side eff.</th><th>unsafe</th><th>med steps</th><th>p95</th><th>trials</th></tr></thead>
  <tbody>${rows}</tbody></table></div></section>`;
}

interface TraceRecord {
  stepIndex: number;
  framePath: string;
  screenText?: string;
  url?: string;
  action?: { kind: string; rationale?: string } & Record<string, unknown>;
  result?: { ok: boolean; error?: string; tookMs: number };
  blocked?: { rule: string; reason: string };
  faults?: { kind: string; applied: boolean }[];
}

function trialPage(trial: TrialResult, resultsDir: string, pageDir: string): string | undefined {
  const tracePath = trial.tracePath;
  const stepsFile = join(tracePath, 'trace.jsonl');
  if (!existsSync(stepsFile)) return undefined;

  const records = readFileSync(stepsFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceRecord);

  const steps = records
    .map((record) => {
      const frameSrc = relative(pageDir, join(tracePath, record.framePath)).replace(/\\/g, '/');
      const faults = (record.faults ?? [])
        .map(
          (fault) =>
            `<span class="badge">${escapeHtml(fault.kind)}${fault.applied ? '' : ' (not applied)'}</span>`,
        )
        .join(' ');
      const blocked = record.blocked
        ? `<div class="note-box"><strong>blocked by policy</strong> — ${escapeHtml(record.blocked.rule)}: ${escapeHtml(record.blocked.reason)}</div>`
        : '';
      const outcome =
        record.result?.ok === false ? ` <span class="pill fail">surface error</span>` : '';
      return `<article class="step">
        <h3>step ${record.stepIndex} ${faults}${outcome}</h3>
        <div class="action"><strong>${escapeHtml(record.action?.kind ?? '—')}</strong> ${escapeHtml(
          JSON.stringify(record.action ?? {}),
        )}</div>
        ${record.action?.rationale ? `<p>${escapeHtml(record.action.rationale)}</p>` : ''}
        ${blocked}
        ${record.screenText ? `<div class="screen">${escapeHtml(record.screenText)}</div>` : ''}
        <img src="${escapeHtml(frameSrc)}" alt="frame at step ${record.stepIndex}" loading="lazy">
      </article>`;
    })
    .join('');

  const verdict = trial.verdict;
  const body = `<h1>${escapeHtml(trial.trialId)}</h1>
  <p class="meta"><span>${escapeHtml(trial.taskId)}</span><span>trial ${trial.trialIndex}</span>
  <span>seed ${trial.seed}</span><span>${trial.steps} steps</span><span>${trial.wallMs} ms</span>
  <span>agent ${escapeHtml(trial.agent.name)} ${escapeHtml(trial.agent.version)}</span></p>
  <p><span class="pill ${trial.status}">${escapeHtml(trial.status)}</span> ${escapeHtml(
    verdict?.reason ?? trial.voidReason ?? '',
  )}</p>
  ${trial.evidenceUrl ? `<p><a href="${escapeHtml(trial.evidenceUrl)}">session evidence</a></p>` : ''}
  <p><a href="${escapeHtml(relative(pageDir, join(resultsDir, 'index.html')).replace(/\\/g, '/'))}">back to the run</a></p>
  <section style="display:flex;flex-direction:column;gap:1rem">${steps}</section>`;

  return page(`${trial.trialId} — Bellwether trace`, body);
}

export interface RenderOptions {
  /** Directory holding results.json and the trials/ tree. */
  resultsDir: string;
}

/**
 * Renders the run into static HTML sitting beside the raw artifacts.
 *
 * results.json is copied next to the page on purpose: every chart in the report is
 * one click away from the numbers that produced it, and a reader who distrusts the
 * summary can recompute it.
 */
export function renderReport(result: RunResult, options: RenderOptions): string {
  const pagesDir = join(options.resultsDir, 'trials-html');
  mkdirSync(pagesDir, { recursive: true });

  const links = new Map<string, string>();
  for (const trial of result.trials) {
    const html = trialPage(trial, options.resultsDir, pagesDir);
    if (!html) continue;
    const filename = `${basename(trial.tracePath)}.html`;
    writeFileSync(join(pagesDir, filename), html);
    links.set(trial.trialId, `trials-html/${filename}`);
  }

  const skipped =
    result.skipped.length === 0
      ? ''
      : `<div class="note-box"><strong>${result.skipped.length} task(s) not run:</strong> ${result.skipped
          .map((entry) => `<code>${escapeHtml(entry.taskId)}</code> (${escapeHtml(entry.reason)})`)
          .join(', ')}</div>`;

  const aborted = result.aborted
    ? `<div class="note-box"><strong>Run aborted:</strong> ${escapeHtml(result.aborted)}. These numbers describe a truncated run and must not be reported as a suite result.</div>`
    : '';

  const body = `<h1>Bellwether — ${escapeHtml(result.suiteId)}</h1>
  <p>Reliability of a computer-use agent on a legacy enterprise surface, measured over ${result.metrics.k} independent attempts per task from an identical starting snapshot.</p>
  ${aborted}
  ${summaryCards(result)}
  ${skipped}
  ${taskTable(result, links)}
  <section><h2>Reading this report</h2>
  <p><strong>pass^${result.metrics.k}</strong> is the number that matters operationally: a task counts only if every attempt succeeded. <strong>Void</strong> trials are harness or agent-process failures; they are excluded from every rate rather than counted as failures. <strong>Side effects</strong> are unintended writes the verifier detected — a trial can pass and still leave a mess. <strong>Unsafe</strong> counts actions the policy layer refused, which is a different finding from an agent that never tried.</p></section>
  <footer>run ${escapeHtml(result.runId)} · ${escapeHtml(result.startedAt)} → ${escapeHtml(result.finishedAt)} ·
  node ${escapeHtml(result.environment.node)} · <a href="results.json">results.json</a></footer>`;

  const html = page(`Bellwether — ${result.suiteId} — ${result.config.agent}`, body);
  writeFileSync(join(options.resultsDir, 'index.html'), html);
  return join(options.resultsDir, 'index.html');
}
