// Lightweight Charts (vendored, Apache 2.0) for the plugins that draw candles. plugins/build.mjs
// evaluates the library inside the plugin's factory and hands it over under this name, so it
// never touches window; only plugins that import this module get the library (build option
// `charts: true` in the plugin's package.json "monos" section).
/* global __EGX_LIGHTWEIGHT_CHARTS__ */
export const LightweightCharts = __EGX_LIGHTWEIGHT_CHARTS__
