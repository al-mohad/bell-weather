/**
 * The live driver's SDKs are optional peer dependencies: the simulator path must
 * install and typecheck without them, and CI never pulls them. These shorthand
 * ambient declarations let the package compile when they are absent; the local
 * structural interfaces in live.ts and live-browser.ts carry the real typing.
 */
declare module '@solarisdk/sandbox';
declare module '@solarisdk/desktop';
declare module '@solarisdk/browser';
declare module 'playwright-core';
