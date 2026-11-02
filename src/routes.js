/**
 * 设置页面的 HTTP 桥。
 *
 * 读写只在这里实现一份，页面通过它访问，宿主启动时也通过它读取，
 * 两边就不会出现不同的归一化规则。
 */

import { RANGES } from './config.js';

const PREFIX = '/dsh-shark';
const MAX_BODY_BYTES = 64 * 1024;

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** @param {import('node:http').IncomingMessage} request */
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  return JSON.parse(text);
}

/** @param {string} host */
function loopbackAuthority(host) {
  const name = host.split(':')[0]?.toLowerCase() ?? '';
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {string[]} trustedHosts
 */
function sameOrigin(request, trustedHosts) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return loopbackAuthority(host) || trustedHosts.includes(host);
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ store: import('./store.js').ConfigStore }} deps
 */
export function registerConfigRoutes(ctx, deps) {
  const { store } = deps;
  let gate = {};
  try {
    gate = ctx.get('connection') ?? {};
  } catch {
    gate = {};
  }
  const trustedHosts = Array.isArray(gate?.trustedHosts) ? gate.trustedHosts : [];

  const handler = async (request, response) => {
    try {
      let denied;
      try {
        denied = gate.requestRejection?.(request);
      } catch {
        denied = undefined;
      }
      if (denied !== undefined) return sendJson(response, 403, { error: 'host-rejected', detail: denied });
      if (!sameOrigin(request, trustedHosts)) return sendJson(response, 403, { error: 'untrusted-origin' });

      const url = new URL(request.url ?? '/', 'http://localhost');
      const route = url.pathname.slice(PREFIX.length) || '/';
      const method = request.method ?? 'GET';

      if (method === 'GET' && route === '/state') {
        return sendJson(response, 200, { state: store.read(), ranges: RANGES });
      }

      if (method === 'POST' && route === '/state') {
        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          return sendJson(response, 400, { error: 'bad-request', detail: String(error) });
        }
        try {
          return sendJson(response, 200, { state: store.write(body), ranges: RANGES });
        } catch (error) {
          return sendJson(response, 500, { error: 'write-failed', detail: String(error) });
        }
      }

      return sendJson(response, 404, { error: 'not-found' });
    } catch (error) {
      return sendJson(response, 500, { error: 'internal', detail: String(error) });
    }
  };

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }),
    'dsh-shark-bg: settings routes',
  );
}

export { PREFIX };
