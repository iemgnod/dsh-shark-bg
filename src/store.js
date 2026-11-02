/**
 * 配置的持久化。
 *
 * 配置属于这台机器的 profile，而不是某个会话，所以存成一个小 JSON 文件。
 * 读操作宽容：文件缺失或损坏都回退默认值；只有写操作走原子 rename。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { normalizeConfig, pickPatch } from './config.js';

const FILE_NAME = 'shark-bg.json';

/** 宿主运行所在的 profile 目录，配置文件与其它 profile 数据放在一起。 */
function defaultFile() {
  const profileDir = process.env.DSH_PROFILE_DIR;
  if (typeof profileDir === 'string' && profileDir !== '') return join(profileDir, FILE_NAME);
  const dshHome = process.env.DSH_HOME;
  if (typeof dshHome === 'string' && dshHome !== '') return join(dshHome, FILE_NAME);
  return join(homedir(), '.dsh', FILE_NAME);
}

export class ConfigStore {
  /** @param {{ file?: string, logger?: { warn?: (message: string) => void } }} [options] */
  constructor(options = {}) {
    this.file = typeof options.file === 'string' && options.file !== '' ? options.file : defaultFile();
    this.logger = options.logger;
    /** @type {ReturnType<typeof normalizeConfig> | undefined} */
    this.state = undefined;
  }

  /** 当前值；只有在没有缓存时才读盘，所以外部手改文件会在宿主重启后生效。 */
  read() {
    if (this.state !== undefined) return { ...this.state };
    this.state = this.#load();
    return { ...this.state };
  }

  #load() {
    let text;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code !== 'ENOENT') this.logger?.warn?.(`dsh-shark-bg: 读取 ${this.file} 失败：${String(error)}`);
      return normalizeConfig(undefined);
    }
    try {
      return normalizeConfig(JSON.parse(text));
    } catch {
      this.logger?.warn?.(`dsh-shark-bg: ${this.file} 不是合法 JSON，已回退默认值`);
      return normalizeConfig(undefined);
    }
  }

  /**
   * 合并一个补丁、落盘，并返回最终状态。
   * @param {Record<string, unknown>} patch
   */
  write(patch) {
    const merged = { ...this.read(), ...pickPatch(patch) };
    const next = normalizeConfig(merged);
    const body = `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, body, 'utf8');
      renameSync(temporary, this.file);
    } catch (error) {
      this.logger?.warn?.(`dsh-shark-bg: 写入 ${this.file} 失败：${String(error)}`);
      throw new Error(`无法保存鲨鱼背景设置：${String(error)}`);
    }
    this.state = { ...next };
    return { ...next };
  }
}
