// User-authored post-text filters. Rules are compiled and evaluated entirely
// in the content script; neither rules nor matched text leave the browser.

export const MAX_REGEX_RULES = 50;
export const MAX_REGEX_LENGTH = 200;

export interface CompiledRegexRule {
  source: string;
  regex: RegExp;
}

export interface RegexRuleError {
  rule: string;
  message: string;
}

/** A deliberately conservative guard against common catastrophic-backtracking
 * shapes. It is not a formal ReDoS proof, so length/count caps remain in place. */
function unsafeShape(pattern: string): boolean {
  return (
    /\\[1-9]/.test(pattern) ||
    /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d*,?\d*\})/.test(pattern) ||
    /(?:\.\*|\.\+){2,}/.test(pattern)
  );
}

function parseRule(rule: string): { pattern: string; flags: string } {
  const trimmed = rule.trim();
  if (!trimmed.startsWith("/")) return { pattern: trimmed, flags: "iu" };

  let slash = -1;
  let escaped = false;
  for (let i = trimmed.length - 1; i > 0; i -= 1) {
    const ch = trimmed[i];
    if (ch !== "/") continue;
    escaped = false;
    for (let j = i - 1; j >= 0 && trimmed[j] === "\\"; j -= 1) escaped = !escaped;
    if (!escaped) {
      slash = i;
      break;
    }
  }
  if (slash <= 0) return { pattern: trimmed, flags: "iu" };
  return { pattern: trimmed.slice(1, slash), flags: trimmed.slice(slash + 1) || "iu" };
}

export function compileRegexRules(rules: string[]): {
  compiled: CompiledRegexRule[];
  errors: RegexRuleError[];
} {
  const compiled: CompiledRegexRule[] = [];
  const errors: RegexRuleError[] = [];
  const unique = [...new Set(rules.map((r) => r.trim()).filter(Boolean))];

  for (const rule of unique.slice(0, MAX_REGEX_RULES)) {
    const { pattern, flags } = parseRule(rule);
    if (rule.length > MAX_REGEX_LENGTH) {
      errors.push({ rule, message: `规则超过 ${MAX_REGEX_LENGTH} 个字符` });
      continue;
    }
    if (!pattern) {
      errors.push({ rule, message: "表达式不能为空" });
      continue;
    }
    if (unsafeShape(pattern)) {
      errors.push({ rule, message: "规则可能导致页面卡顿，请简化重复或反向引用" });
      continue;
    }
    if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
      errors.push({ rule, message: "正则标志无效或重复" });
      continue;
    }
    try {
      // Global/sticky state would otherwise make repeated scans alternate.
      const safeFlags = flags.replace(/[gy]/g, "");
      compiled.push({ source: rule, regex: new RegExp(pattern, safeFlags) });
    } catch (e) {
      errors.push({
        rule,
        message:
          e instanceof Error
            ? e.message.replace(/^Invalid regular expression:\s*/i, "")
            : "无效正则",
      });
    }
  }
  if (unique.length > MAX_REGEX_RULES) {
    errors.push({
      rule: unique[MAX_REGEX_RULES] ?? "",
      message: `最多保存 ${MAX_REGEX_RULES} 条规则`,
    });
  }
  return { compiled, errors };
}

export function matchRegexText(text: string, rules: CompiledRegexRule[]): CompiledRegexRule | null {
  if (!text) return null;
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(text)) return rule;
  }
  return null;
}
