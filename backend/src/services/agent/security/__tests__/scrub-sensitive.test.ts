/**
 * 任务 2：scrub-sensitive 脱敏测试
 *
 * 验证 scrubSensitive 对 7 类敏感信息的脱敏行为：
 * - Windows/Unix 用户路径
 * - JWT token
 * - Bearer token
 * - API key（sk- 前缀 + 32 位以上长串）
 * - 邮箱
 * - base64 长字符串
 *
 * 覆盖计划文档任务 2 的 4 个用例 + 边界补充。
 */
import { describe, it, expect } from 'vitest';
import { scrubSensitive } from '../scrub-sensitive';

describe('scrubSensitive', () => {
  it('脱敏 JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = scrubSensitive(`token=${jwt}`);
    expect(out).toContain('[jwt]');
    expect(out).not.toContain(jwt);
  });

  it('脱敏 Bearer token', () => {
    const out = scrubSensitive('Authorization: Bearer abc12345678901234567890==');
    expect(out).toContain('[bearer-token]');
    expect(out).not.toContain('abc12345678901234567890');
  });

  it('脱敏 sk- 前缀 API key', () => {
    const key = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const out = scrubSensitive(`apiKey=${key}`);
    expect(out).toContain('[api-key]');
    expect(out).not.toContain(key);
  });

  it('脱敏邮箱', () => {
    const out = scrubSensitive('contact zhangsan@example.com now');
    expect(out).toContain('[email]');
    expect(out).not.toContain('zhangsan@example.com');
  });

  it('脱敏 base64 长串（60 字符以上，含 +/= 避免被 api-key 规则抢先）', () => {
    // 连续 31+31+10 = 72 字符，属 base64 字符集；中间无 ≥32 的纯字母数字段，
    // 因此不会被规则5(api-key)抢先，应命中规则7(base64)
    const b64 = 'A'.repeat(31) + '+' + 'B'.repeat(31) + '='.repeat(10);
    const out = scrubSensitive(`data=${b64}`);
    expect(out).toContain('[base64]');
    expect(out).not.toContain(b64);
  });

  it('脱敏 Windows 用户路径', () => {
    const out = scrubSensitive('C:\\Users\\zhangsan\\Documents\\report.pdf 已上传');
    expect(out).toContain('[user-path]');
    expect(out).not.toContain('zhangsan');
  });

  it('脱敏 Unix 用户路径', () => {
    const out = scrubSensitive('/home/zhangsan/uploads/report.pdf');
    expect(out).toContain('[user-path]');
    expect(out).not.toContain('/home/zhangsan');
  });

  it('脱敏 32 位以上长字母数字串（密钥/令牌）', () => {
    const long = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const out = scrubSensitive(`secret=${long}`);
    expect(out).not.toContain(long);
  });

  it('空文本 / 无敏感信息文本原样返回', () => {
    expect(scrubSensitive('')).toBe('');
    expect(scrubSensitive('普通审查文本，无敏感信息')).toBe('普通审查文本，无敏感信息');
  });

  it('正常中文长文本不被误伤为 api-key/base64', () => {
    const text = '合同审查报告：第 3 条付款条款约定分期支付。';
    expect(scrubSensitive(text)).toBe(text);
  });
});
