#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, Option } from 'commander';
import { createLogger } from '@bellwether/core';
import { LiveDriver, RecordingDriver, ReplayDriver, SimDriver } from '@bellwether/solari';
import type { SolariDriver } from '@bellwether/solari';
import { runSuite, selfTestSuite } from '@bellwether/runner';
import type { RunResult, Tier } from '@bellwether/runner';
import { renderReport } from '@bellwether/report';
import { compileTrace, emitFlowModule, emitMcpServer } from '@bellwether/compile';
import type { Flow } from '@bellwether/compile';
import { loadSuite } from './suites';
import { loadRegistry, resolveAgent } from './registry';

const program = new Command();

program
  .name('bellwether')
  .description('Reliability benchmark for computer-use agents on legacy enterprise software')
  .version('0.1.0');

function buildDriver(name: string, options: { cassette?: string; record?: string }): SolariDriver {
  const base: SolariDriver =
    name === 'sim'
      ? new SimDriver()
      : name === 'live'
        ? new LiveDriver()
        : new ReplayDriver(
            options.cassette ??
              (() => {
                throw new Error('--driver replay needs --cassette <path>');
              })(),
          );
  return options.record ? new RecordingDriver(base, options.record) : base;
}

program
  .command('run')
  .description('Run a suite k times per task and write results.json plus a report')
  .option('-s, --suite <name|path>', 'suite to run', 'core')
  .addOption(
    new Option('-d, --driver <driver>', 'execution backend')
      .choices(['sim', 'live', 'replay'])
      .default('sim'),
  )
  .option('-a, --agent <name>', 'agent from agents/registry.json', 'scripted')
  .option('-k, --k <count>', 'independent attempts per task', '5')
  .option('--seed <number>', 'run seed; the same seed reproduces the same faults')
  .option('-c, --concurrency <count>', 'trials in flight', '4')
  .option('--budget-usd <amount>', 'hard ceiling; the run aborts when exceeded', '25')
  .option(
    '--vm-usd-per-minute <rate>',
    'VM rate from the current Solari price list; 0 means cost is not measured',
    '0',
  )
  .option('--tasks <ids...>', 'only these task ids')
  .option('--tiers <tiers...>', 'only these tiers (basic, hard, legacy, fault, safety)')
  .addOption(new Option('--surface <surface>', 'only this surface').choices(['browser', 'desktop']))
  .option('-o, --out <dir>', 'output directory', '.bellwether/run')
  .option('--record <path>', 'record every driver call to a cassette')
  .option('--cassette <path>', 'cassette to replay (with --driver replay)')
  .option('--no-report', 'skip HTML rendering')
  .action(async (options) => {
    const logger = createLogger();
    const suite = await loadSuite(options.suite);
    const agent = resolveAgent(options.agent);
    const driver = buildDriver(options.driver, options);

    const vmRate = Number(options.vmUsdPerMinute);
    if (options.driver === 'live' && vmRate === 0) {
      logger.warn(
        'cost will not be measured: pass --vm-usd-per-minute from the current price list',
      );
    }

    try {
      const result = await runSuite(suite, {
        driver,
        agent,
        k: Number(options.k),
        runSeed: options.seed ? Number(options.seed) : undefined,
        maxUsd: Number(options.budgetUsd),
        concurrency: Number(options.concurrency),
        cost: { vmUsdPerMinute: vmRate },
        outDir: options.out,
        filters: {
          tasks: options.tasks,
          tiers: options.tiers as Tier[] | undefined,
          surface: options.surface,
        },
        logger,
      });

      if (options.report) renderReport(result, { resultsDir: options.out });
      printSummary(result, options.out);
      process.exitCode = result.aborted ? 2 : 0;
    } finally {
      await driver.close();
    }
  });

program
  .command('verify-verifiers')
  .description('Prove every verifier accepts its known-good state and rejects every known-bad one')
  .option('-s, --suite <name|path>', 'suite to check', 'core')
  .action(async (options) => {
    const suite = await loadSuite(options.suite);
    const cases = await selfTestSuite(suite.tasks);
    const failures = cases.filter((entry) => !entry.ok);

    for (const entry of cases) {
      const mark = entry.ok ? 'ok  ' : 'FAIL';
      process.stdout.write(
        `${mark} ${entry.taskId} :: ${entry.fixture} (expected ${entry.expected}, got ${entry.actual})\n`,
      );
      if (!entry.ok) process.stdout.write(`       verifier said: ${entry.reason}\n`);
    }
    process.stdout.write(
      `\n${cases.length - failures.length}/${cases.length} verifier fixtures behaved as specified\n`,
    );
    if (failures.length > 0) {
      process.stderr.write('a verifier that cannot fail is a benchmark bug\n');
      process.exitCode = 1;
    }
  });

program
  .command('report')
  .description('Re-render the HTML report from an existing results directory')
  .requiredOption('-r, --results <dir>', 'directory containing results.json')
  .action((options) => {
    const result = JSON.parse(
      readFileSync(join(options.results, 'results.json'), 'utf8'),
    ) as RunResult;
    const page = renderReport(result, { resultsDir: options.results });
    process.stdout.write(`${page}\n`);
  });

program
  .command('compile')
  .description('Compile a successful trial trace into a deterministic flow')
  .requiredOption('-t, --trial <dir>', 'trial directory (contains meta.json and trace.jsonl)')
  .option('-o, --out <dir>', 'output directory', '.bellwether/flows')
  .option('-p, --param <pairs...>', 'hoist a literal into a named input, as name=value')
  .option('--emit-ts', 'also emit a typed TypeScript module')
  .option('--emit-mcp', 'also emit an MCP server exposing the flow as a tool')
  .action((options) => {
    const parameters = Object.fromEntries(
      ((options.param as string[] | undefined) ?? []).map((pair) => {
        const index = pair.indexOf('=');
        if (index < 0) throw new Error(`--param expects name=value, got "${pair}"`);
        return [pair.slice(0, index), pair.slice(index + 1)];
      }),
    );

    const flow: Flow = compileTrace(options.trial, { parameters });
    mkdirSync(options.out, { recursive: true });
    const jsonPath = join(options.out, `${flow.taskId}.json`);
    writeFileSync(jsonPath, `${JSON.stringify(flow, null, 2)}\n`);
    process.stdout.write(`${jsonPath}\n`);

    if (options.emitTs) {
      const path = join(options.out, `${flow.taskId}.flow.ts`);
      writeFileSync(path, emitFlowModule(flow));
      process.stdout.write(`${path}\n`);
    }
    if (options.emitMcp) {
      const path = join(options.out, 'mcp-server.mjs');
      writeFileSync(path, emitMcpServer([flow]));
      process.stdout.write(`${path}\n`);
    }
  });

program
  .command('list')
  .description('List the tasks in a suite and the registered agents')
  .option('-s, --suite <name|path>', 'suite to list', 'core')
  .action(async (options) => {
    const suite = await loadSuite(options.suite);
    process.stdout.write(`suite ${suite.id} — ${suite.title}\n\n`);
    for (const task of suite.tasks) {
      process.stdout.write(
        `  ${task.id.padEnd(18)} ${task.tier.padEnd(7)} ${task.surface.padEnd(8)} requires=${task.requires.padEnd(5)} ${task.title}\n`,
      );
    }
    process.stdout.write('\nagents\n\n');
    for (const [name, entry] of Object.entries(loadRegistry().agents)) {
      process.stdout.write(`  ${name.padEnd(14)} ${entry.description ?? ''}\n`);
    }
  });

function printSummary(result: RunResult, outDir: string): void {
  const percent = (value: number | null): string =>
    value === null ? '  n/a' : `${(value * 100).toFixed(0).padStart(4)}%`;
  const lines = [
    '',
    `  suite      ${result.suiteId}   agent ${result.config.agent}   driver ${result.config.driver}   k=${result.metrics.k}`,
    `  pass@1     ${percent(result.metrics.pass1)}`,
    `  pass^${result.metrics.k}     ${percent(result.metrics.passK)}   (${result.metrics.passKEligibleTasks}/${result.metrics.taskCount} tasks eligible)`,
    `  recovery   ${percent(result.metrics.recovery.ratio)}`,
    `  unsafe     ${result.metrics.unsafePer100Steps.toFixed(2)} per 100 steps`,
    `  side eff.  ${result.metrics.sideEffectsPerTrial.toFixed(2)} per trial`,
    `  void       ${result.metrics.voidedTrials}/${result.metrics.trialCount} trials`,
    `  report     ${join(outDir, 'index.html')}`,
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

await program.parseAsync(process.argv);
