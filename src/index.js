/**
 * dsh-shark-bg 的宿主半侧。
 *
 * 它只做三件事：持有配置、把配置暴露给页面（通过 webServer 路由）、
 * 把配置交给客户端半侧读取。背景本身完全由 client.js 绘制。
 */

import { registerConfigRoutes } from './routes.js';
import { ConfigStore } from './store.js';

export const name = 'dsh-shark-bg';
export const inject = ['webServer'];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ file?: string }} [rawConfig]
 */
export function apply(ctx, rawConfig = {}) {
  const config = rawConfig ?? {};
  const logger = ctx.logger ?? ctx.get?.('logger');
  const store = new ConfigStore({
    file: typeof config.file === 'string' && config.file !== '' ? config.file : undefined,
    logger,
  });

  registerConfigRoutes(ctx, { store });

  const state = store.read();
  logger?.info?.(`dsh-shark-bg: 已加载（鲨鱼 ${state.sharkCount} 条，遮罩 ${state.veil}%）`);
}
