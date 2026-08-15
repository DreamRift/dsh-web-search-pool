/**
 * 核心调度库的聚合导出。不依赖 DSH，可独立单测，未来可被 HTTP 外壳（扩展路径 B1）复用。
 * @module search-pool/core
 */

export * from './constants.js';
export * from './errors.js';
export * from './key-pool.js';
export * from './query-intent.js';
export * from './rate-limiter.js';
export * from './resolve-params.js';
export * from './scheduler.js';
