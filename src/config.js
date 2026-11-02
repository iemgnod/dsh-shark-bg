/**
 * 插件配置的取值定义与归一化。
 *
 * 这里是唯一一份“哪些字段存在、合法范围是多少”的声明：宿主侧的存储、
 * HTTP 路由和客户端页面都从同一份 DEFAULTS / FIELD 表推导，避免三处各写一遍。
 */

/** 每个字段的默认值与合法区间。 */
export const DEFAULTS = {
  /** 是否启用背景海洋。关掉后画布隐藏、界面恢复原样。 */
  enabled: true,
  /** 主遮罩浓度（百分比）：越大海水越淡、文字越清晰。 */
  veil: 40,
  /** 底部输入区遮罩浓度（百分比）。 */
  veilStrong: 88,
  /** 鲨鱼数量。0 表示只留海水与鱼群。 */
  sharkCount: 6,
  /** 鲨鱼体型倍率，相对默认尺寸。 */
  sharkSize: 1,
  /** 鱼群密度（百分比），0 表示没有小鱼。 */
  fishDensity: 45,
  /** 游动速度倍率。 */
  speed: 1,
  /** 网格线浓度倍率，0 表示不要网格。 */
  gridScale: 1,
  /** 静止画面：不做动画，只画一帧。 */
  still: false,
};

/** 数值字段的区间，[最小, 最大, 步长]。 */
export const RANGES = {
  veil: [0, 100, 1],
  veilStrong: [0, 100, 1],
  sharkCount: [0, 12, 1],
  sharkSize: [0.4, 2, 0.05],
  fishDensity: [0, 100, 1],
  speed: [0.2, 3, 0.05],
  gridScale: [0, 3, 0.05],
};

const INT_FIELDS = new Set(['veil', 'veilStrong', 'sharkCount', 'fishDensity']);
const BOOL_FIELDS = new Set(['enabled', 'still']);

/**
 * 把任意输入夹回合法区间。未知键被忽略，坏值回退默认。
 * @param {unknown} raw
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = source[key];
    if (BOOL_FIELDS.has(key)) {
      if (typeof value === 'boolean') out[key] = value;
      continue;
    }
    const range = RANGES[key];
    if (range === undefined) continue;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    const [lo, hi, step] = range;
    let next = Math.min(hi, Math.max(lo, numeric));
    if (INT_FIELDS.has(key)) next = Math.round(next);
    else next = Math.round(next / step) * step;
    out[key] = Number(next.toFixed(2));
  }
  return out;
}

/**
 * 只挑出补丁里出现且合法的键，供 POST 合并使用。
 * @param {unknown} raw
 */
export function pickPatch(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const patch = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (key in source) patch[key] = source[key];
  }
  return patch;
}
