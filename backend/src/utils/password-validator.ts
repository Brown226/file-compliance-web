/**
 * 密码复杂度验证工具
 * 
 * 密码规则：
 * 1. 长度 >= 8 位
 * 2. 必须包含大写英文字符 [A-Z]
 * 3. 必须包含小写英文字符 [a-z]
 * 4. 必须包含数字 [0-9]
 * 5. 必须包含特殊符号（!@#$%^&*()_+-=[]{}|;':",./<>?~` 等）
 */

const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_RULES: Array<{ regex: RegExp; description: string }> = [
  { regex: /[A-Z]/, description: '大写英文字母' },
  { regex: /[a-z]/, description: '小写英文字母' },
  { regex: /[0-9]/, description: '数字' },
  { regex: /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?~`\\]/, description: '特殊符号' },
];

export interface PasswordValidationResult {
  valid: boolean;
  message: string;
}

/**
 * 验证密码是否符合复杂度要求
 * @param password 要验证的密码
 * @returns 验证结果，包含 valid 和 message 字段
 */
export function validatePasswordComplexity(password: string): PasswordValidationResult {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: '密码不能为空' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: `密码长度不能小于${PASSWORD_MIN_LENGTH}位` };
  }

  const missingRequirements: string[] = [];
  for (const rule of PASSWORD_RULES) {
    if (!rule.regex.test(password)) {
      missingRequirements.push(rule.description);
    }
  }

  if (missingRequirements.length > 0) {
    return {
      valid: false,
      message: `密码缺少以下元素：${missingRequirements.join('、')}`,
    };
  }

  return { valid: true, message: '密码符合复杂度要求' };
}

/**
 * 密码复杂度要求的文字描述（用于前端提示）
 */
export const PASSWORD_REQUIREMENT_DESCRIPTION = `密码要求：至少${PASSWORD_MIN_LENGTH}位，包含大写字母、小写字母、数字、特殊符号`;

/**
 * 密码复杂度正则（用于前端即时校验）
 * 注意：JavaScript不支持在一个正则中同时检测多种字符类型，建议用4个独立正则分别检测
 */
export const PASSWORD_REGEX_RULES = PASSWORD_RULES.map(r => ({
  regex: r.regex,
  description: r.description,
}));
