import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import {
  AgentError,
  BudgetExceededError,
  EnvironmentError,
  VerifierError,
  makeRng,
  trialId as makeTrialId,
  trialSeed,
  trialSlug,
  withSpan,
} from '@bellwether/core';
import type { Logger, Budget } from '@bellwether/core';
import { FaultInjector } from '@bellwether/faults';
import { DEFAULT_POLICY, Guardrails } from '@bellwether/guardrails';
import { ActionSchema, isTerminal } from '@bellwether/protocol';
import type { Observation } from '@bellwether/protocol';
import type { MachineHandle, SolariDriver } from '@bellwether/solari';
import { DriverSurface } from '@bellwether/surfaces';
import { createVerifyContext } from '@bellwether/verifiers';
import type { Outcome, Verdict } from '@bellwether/verifiers';
import { AgentClient } from './agent-client';
import type { AgentSpec } from './agent-client';
import { TraceWriter } from './trace';
import { FREE, vmCost } from './cost';
import type { CostModel } from './cost';
import type { Task } from './task';

export interface TrialOptions {
  runId: string;
  runSeed: number;
  trialIndex: number;
  driver: SolariDriver;
  agent: AgentSpec;
  budget: Budget;
  cost?: CostModel;
  outDir: string;
  logger: Logger;
}

export interface TrialResult {
  trialId: string;
  taskId: string;
  trialIndex: number;
  seed: number;
  /**
   * `void` means the harness or the agent process broke, not that the agent failed
   * the task. Void trials are excluded from pass rates and reported separately -
   * silently folding infrastructure flake into a capability number is how
   * benchmarks start lying.
   */
  status: 'pass' | 'fail' | 'void';
  voidReason?: string;
  outcome: Outcome;
  steps: number;
  wallMs: number;
  usd: number;
  sideEffects: number;
  /** Guardrail blocks: actions the agent tried that policy refused. */
  unsafeAttempts: number;
  verdict?: Verdict;
  tracePath: string;
  agent: { name: string; version: string };
  evidenceUrl?: string;
}

interface Provisioned {
  surface: DriverSurface;
  machine: MachineHandle;
  cleanup: () => Promise<void>;
}

async function provision(task: Task, driver: SolariDriver): Promise<Provisioned> {
  const base = {
    template: task.env.template,
    cpu: task.env.cpu,
    memMb: task.env.memMb,
    fromSnapshot: task.env.snapshotId,
    onTimeout: 'kill' as const,
  };

  if (task.surface === 'desktop') {
    const desktop = await driver.createDesktop({ ...base, resolution: task.env.resolution });
    await runBootCommands(task, desktop);
    return {
      surface: new DriverSurface(desktop, desktop),
      machine: desktop,
      cleanup: async () => {
        await desktop.kill().catch(() => undefined);
      },
    };
  }

  // Browser tasks need two resources: a sandbox hosting the app under test, and a
  // cloud browser pointed at its preview URL. The verifier reads ground truth from
  // the sandbox, never from the page.
  const sandbox = await driver.createSandbox(base);
  await runBootCommands(task, sandbox);
  const browser = await driver.createBrowser({ stealth: true, recordSession: true });
  const appUrl = await sandbox.previewUrl(task.env.port ?? 80);
  await browser.navigate(appUrl);
  return {
    surface: new DriverSurface(browser, sandbox),
    machine: sandbox,
    cleanup: async () => {
      await browser.kill().catch(() => undefined);
      await sandbox.kill().catch(() => undefined);
    },
  };
}

async function runBootCommands(task: Task, machine: MachineHandle): Promise<void> {
  if (task.env.snapshotId || !task.env.boot?.length) return;
  for (const command of task.env.boot) {
    const result = await machine.exec('sh', { args: ['-c', command], timeoutMs: 300_000 });
    if (result.exitCode !== 0) {
      throw new EnvironmentError(
        `boot command failed (${result.exitCode}): ${command}\n${result.stderr}`,
      );
    }
  }
}

/**
 * Runs one independent attempt at one task.
 *
 * Determinism contract: given the same run seed, task id and trial index, this
 * function issues the same faults in the same order. Anything else that varies -
 * a model's sampling, a real network - is the agent's or the platform's
 * nondeterminism, and is exactly what pass^k is measuring.
 */
export async function runTrial(task: Task, options: TrialOptions): Promise<TrialResult> {
  const seed = trialSeed(options.runSeed, task.id, options.trialIndex);
  const trialId = makeTrialId(task.id, options.trialIndex);
  const tracePath = join(options.outDir, 'trials', trialSlug(task.id, options.trialIndex));
  const costModel = options.cost ?? FREE;
  const logger = options.logger.child({ trialId, seed });

  return withSpan(
    'bellwether.trial',
    {
      'bw.task': task.id,
      'bw.trial': options.trialIndex,
      'bw.seed': seed,
      'bw.agent': options.agent.name,
    },
    async (span) => {
      const started = performance.now();
      const guardrails = new Guardrails({ ...DEFAULT_POLICY, ...task.policy });
      const faults = new FaultInjector(task.faults ?? [], makeRng(seed));
      const agent = new AgentClient(options.agent);

      let provisioned: Provisioned | undefined;
      let trace: TraceWriter | undefined;
      let steps = 0;
      let agentUsd = 0;
      let outcome: Outcome = 'error';
      let identity = { agent: options.agent.name, version: 'unknown' };

      const finalize = (
        status: TrialResult['status'],
        extra: Partial<TrialResult> = {},
      ): TrialResult => {
        const wallMs = Math.round(performance.now() - started);
        const usd = agentUsd + vmCost(costModel, wallMs);
        span.setAttributes({ 'bw.status': status, 'bw.steps': steps, 'bw.usd': usd });
        return {
          trialId,
          taskId: task.id,
          trialIndex: options.trialIndex,
          seed,
          status,
          outcome,
          steps,
          wallMs,
          usd,
          sideEffects: extra.verdict?.sideEffects ?? 0,
          unsafeAttempts: guardrails.blockedActions.length,
          tracePath,
          agent: { name: identity.agent, version: identity.version },
          ...extra,
        };
      };

      try {
        options.budget.assertWithinLimit();
        provisioned = await provision(task, options.driver);
        const { surface, machine } = provisioned;

        const init = await agent.start({
          taskId: task.id,
          goal: task.goal,
          context: task.context,
          surface: task.surface,
          budget: { steps: task.maxSteps, usd: options.budget.remainingUsd },
          display: surface.display,
          seed,
        });
        identity = { agent: init.agent, version: init.version };

        trace = new TraceWriter(tracePath, {
          runId: options.runId,
          trialId,
          taskId: task.id,
          trialIndex: options.trialIndex,
          seed,
          agent: init.agent,
          agentVersion: init.version,
          driver: options.driver.name,
          surface: task.surface,
          display: surface.display,
          startedAt: new Date().toISOString(),
          evidenceUrl: await surface.evidenceUrl(),
        });

        for (let stepIndex = 0; stepIndex < task.maxSteps; stepIndex++) {
          options.budget.assertWithinLimit();
          await faults.beforeStep(stepIndex, surface);
          const faultsThisStep = faults.log.filter((entry) => entry.stepIndex === stepIndex);

          const frame = await surface.observe();
          const framePath = trace.frame(stepIndex, frame.pngB64);

          const observation: Observation = {
            stepIndex,
            screenshotPngB64: frame.pngB64,
            width: frame.width,
            height: frame.height,
            screenText: frame.screenText,
            url: frame.url,
            remaining: {
              steps: task.maxSteps - stepIndex,
              usd: Math.max(0, options.budget.remainingUsd - agentUsd),
            },
          };

          const stepResult = await agent.step(observation);
          const action = ActionSchema.parse(stepResult.action);
          steps = stepIndex + 1;
          if (stepResult.usage?.usd) {
            agentUsd += stepResult.usage.usd;
            options.budget.chargeUsd(stepResult.usage.usd);
          }

          const decision = guardrails.evaluate(action);
          guardrails.record(stepIndex, action, decision);

          if (!decision.allow) {
            logger.warn('guardrail blocked action', { rule: decision.rule, kind: action.kind });
            trace.step({
              stepIndex,
              framePath,
              screenText: frame.screenText,
              url: frame.url,
              action,
              blocked: { rule: decision.rule ?? 'unknown', reason: decision.reason ?? '' },
              faults: faultsThisStep,
              usdSpent: agentUsd,
            });
            continue;
          }

          const result = await surface.apply(action);
          trace.step({
            stepIndex,
            framePath,
            screenText: frame.screenText,
            url: frame.url,
            action,
            result,
            faults: faultsThisStep,
            usdSpent: agentUsd,
          });

          if (isTerminal(action)) {
            outcome = action.kind === 'done' ? 'done' : 'abstain';
            break;
          }
          if (steps >= task.maxSteps) outcome = 'budget';
        }
        if (outcome === 'error') outcome = 'budget';

        const verdict = await verify(task, machine, guardrails, outcome);
        await agent.close({ reason: outcome, verdict: verdict.pass ? 'pass' : 'fail' });
        trace.finish({ stderr: agent.stderrLog, verdict });
        logger.info('trial complete', { status: verdict.pass ? 'pass' : 'fail', steps, outcome });
        return finalize(verdict.pass ? 'pass' : 'fail', { verdict });
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;

        const reason = error instanceof Error ? error.message : String(error);
        const isVoid =
          error instanceof AgentError ||
          error instanceof EnvironmentError ||
          error instanceof VerifierError;
        logger.error(isVoid ? 'trial void' : 'trial errored', { reason });
        trace?.finish({
          stderr: agent.stderrLog,
          verdict: { pass: false, reason, sideEffects: 0 },
        });
        await agent.close({ reason: 'error', verdict: 'unknown' }).catch(() => undefined);
        return finalize('void', { voidReason: reason });
      } finally {
        await provisioned?.cleanup();
      }
    },
  );
}

async function verify(
  task: Task,
  machine: MachineHandle,
  guardrails: Guardrails,
  outcome: Outcome,
): Promise<Verdict> {
  const context = createVerifyContext({
    machine,
    blocked: guardrails.blockedActions,
    outcome,
    statePath: task.env.statePath,
    psql: task.env.psql,
  });
  return task.verify(context);
}
