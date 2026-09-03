export class BellwetherError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The run hit its dollar ceiling. Aborts the whole suite, not just the trial. */
export class BudgetExceededError extends BellwetherError {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(`budget exceeded: spent $${spentUsd.toFixed(4)} of $${limitUsd.toFixed(2)}`, 'E_BUDGET');
  }
}

/** The agent process died, hung, or spoke the wrong protocol. Trial is void, not failed. */
export class AgentError extends BellwetherError {
  constructor(message: string) {
    super(message, 'E_AGENT');
  }
}

/** The environment could not be brought up. Trial is void, not failed. */
export class EnvironmentError extends BellwetherError {
  constructor(message: string) {
    super(message, 'E_ENV');
  }
}

/** A verifier could not determine pass or fail. Never silently treated as a fail. */
export class VerifierError extends BellwetherError {
  constructor(message: string) {
    super(message, 'E_VERIFIER');
  }
}
