/**
 * Skills 服务 — 本地 SKILL.md 管理（2026-08-03 新增）
 *
 * 场景化能力以 SKILL.md 文件形式存放在 skills 目录（默认 backend/skills，可用
 * 环境变量 AGENT_SKILLS_DIR 覆盖）。格式与 pi 的 skill 兼容：
 *
 *   ---
 *   name: doc-summary
 *   description: 文档总结
 *   disabled: false
 *   ---
 *   （提示词正文，Agent 在对话中按需执行）
 *
 * 运行时：Agent 的 system prompt 动态注入已启用 skills 的 name + description，
 * 让 LLM 知道可用场景化能力（模型调用式 skill，无独立 tool 定义）。
 */

import fs from 'fs';
import path from 'path';

export interface AgentSkill {
  /** skill 名（= 文件名，仅允许 [a-z0-9_-]） */
  name: string;
  /** 一句话描述（注入 system prompt 用） */
  description: string;
  /** 是否禁用（frontmatter disabled: true） */
  disabled: boolean;
  /** 文件名 */
  fileName: string;
  /** frontmatter 之后的正文（提示词内容） */
  content: string;
  /** 文件修改时间 */
  updatedAt: string;
}

export interface SkillMeta {
  name?: string;
  description?: string;
  disabled?: string;
  [key: string]: string | undefined;
}

const SKILL_NAME_RE = /^[a-z0-9_-]+$/;

function getSkillsDir(): string {
  return process.env.AGENT_SKILLS_DIR || path.join(process.cwd(), 'skills');
}

/** 确保 skills 目录存在 */
export function ensureSkillsDir(): void {
  fs.mkdirSync(getSkillsDir(), { recursive: true });
}

function safeSkillPath(name: string): string {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`非法 skill 名：${name}（仅允许小写字母/数字/下划线/中划线）`);
  }
  return path.join(getSkillsDir(), `${name}.md`);
}

/** 解析 SKILL.md 文件（frontmatter + 正文） */
function parseSkillFile(filePath: string): AgentSkill | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: SkillMeta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return {
    name: meta.name || path.basename(filePath, '.md'),
    description: meta.description || '',
    disabled: meta.disabled === 'true',
    fileName: path.basename(filePath),
    content: (m[2] || '').trim(),
    updatedAt: fs.statSync(filePath).mtime.toISOString(),
  };
}

/** 序列化 skill 为 SKILL.md 文件内容 */
function serializeSkill(name: string, description: string, content: string, disabled: boolean): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${description.replace(/\r?\n/g, ' ')}`,
    `disabled: ${disabled}`,
    '---',
    '',
    content.trim(),
    '',
  ].join('\n');
}

export class SkillsService {
  /** 列出全部 skills（按 name 排序） */
  static listSkills(): AgentSkill[] {
    ensureSkillsDir();
    const files = fs.readdirSync(getSkillsDir()).filter((f) => f.endsWith('.md'));
    const skills: AgentSkill[] = [];
    for (const f of files) {
      try {
        const skill = parseSkillFile(path.join(getSkillsDir(), f));
        if (skill) skills.push(skill);
      } catch {
        // 跳过损坏文件，不阻塞整体列表
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 列出已启用的 skills（system prompt 注入用） */
  static listEnabledSkills(): AgentSkill[] {
    return SkillsService.listSkills().filter((s) => !s.disabled);
  }

  /** 读取单个 skill */
  static getSkill(name: string): AgentSkill | null {
    const filePath = safeSkillPath(name);
    if (!fs.existsSync(filePath)) return null;
    return parseSkillFile(filePath);
  }

  /** 新建 skill */
  static createSkill(data: { name: string; description: string; content: string }): AgentSkill {
    ensureSkillsDir();
    const filePath = safeSkillPath(data.name);
    if (fs.existsSync(filePath)) {
      throw new Error(`skill ${data.name} 已存在`);
    }
    const body = data.content.trim();
    if (!body) {
      throw new Error('skill 内容不能为空');
    }
    fs.writeFileSync(filePath, serializeSkill(data.name, data.description || '', body, false), 'utf-8');
    const skill = SkillsService.getSkill(data.name);
    if (!skill) throw new Error('skill 创建后读取失败');
    return skill;
  }

  /** 更新 skill（description/content 至少一个） */
  static updateSkill(name: string, data: { description?: string; content?: string }): AgentSkill {
    const existing = SkillsService.getSkill(name);
    if (!existing) throw new Error(`skill ${name} 不存在`);
    const description = data.description !== undefined ? data.description : existing.description;
    const content = data.content !== undefined ? data.content : existing.content;
    if (!content.trim()) {
      throw new Error('skill 内容不能为空');
    }
    fs.writeFileSync(
      safeSkillPath(name),
      serializeSkill(name, description, content, existing.disabled),
      'utf-8'
    );
    const skill = SkillsService.getSkill(name);
    if (!skill) throw new Error('skill 更新后读取失败');
    return skill;
  }

  /** 启用/禁用 skill（写 frontmatter disabled 字段） */
  static setSkillEnabled(name: string, enabled: boolean): AgentSkill {
    const existing = SkillsService.getSkill(name);
    if (!existing) throw new Error(`skill ${name} 不存在`);
    fs.writeFileSync(
      safeSkillPath(name),
      serializeSkill(name, existing.description, existing.content, !enabled),
      'utf-8'
    );
    const skill = SkillsService.getSkill(name);
    if (!skill) throw new Error('skill 开关更新失败');
    return skill;
  }

  /** 删除 skill */
  static deleteSkill(name: string): void {
    const filePath = safeSkillPath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`skill ${name} 不存在`);
    }
    fs.unlinkSync(filePath);
  }
}
