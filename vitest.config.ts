import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'suites/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/runner/src/**',
        'packages/verifiers/src/**',
        'packages/compile/src/**',
        'packages/protocol/src/**',
        'packages/guardrails/src/**',
        'packages/faults/src/**',
      ],
      exclude: [
        // A codegen entrypoint: it writes JSON Schema files and is exercised by
        // the `schema` script, not by unit tests.
        'packages/protocol/src/emit-schema.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
