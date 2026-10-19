// Host half of monos-market: nothing runs on the host; the plugin is its client.js (شاشة السوق: قائمة EGX30 وملخص «منذ آخر إغلاق» و«متابعتي» وتفاصيل السهم).
// The row in cordis.patch.yml mounts it, so the Plugin Manager can switch it on and off.
export const name = 'monos-market'

export function apply() {}
