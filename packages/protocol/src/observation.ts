import { z } from 'zod';

export const ActionResultSchema = z.object({
  ok: z.boolean(),
  /** Present when ok is false. Surface-level failure, not task failure. */
  error: z.string().optional(),
  /** Milliseconds the surface took to apply the action. */
  tookMs: z.number().min(0),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const ObservationSchema = z.object({
  stepIndex: z.number().int().min(0),
  /** Base64 PNG of the full surface. Always present. */
  screenshotPngB64: z.string(),
  /** Pixel size of the screenshot, so agents need not decode it to know the frame. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /**
   * Text rendering of the surface where one exists cheaply: the character grid for
   * terminal surfaces, the accessibility tree for browsers. Optional on purpose -
   * an agent that requires it is not solving the pixels-only problem.
   */
  screenText: z.string().optional(),
  /** Current URL for browser surfaces. */
  url: z.string().optional(),
  /** Result of the previous action, so the agent can detect a dropped input. */
  lastResult: ActionResultSchema.optional(),
  /** Steps and dollars left. Agents are expected to abstain rather than overrun. */
  remaining: z.object({ steps: z.number().int().min(0), usd: z.number().min(0) }),
});
export type Observation = z.infer<typeof ObservationSchema>;
