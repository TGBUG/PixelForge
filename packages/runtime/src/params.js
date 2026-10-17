import fs from 'node:fs';

export const PARAM_TYPES = new Set([
  'file',
  'files',
  'range',
  'number',
  'boolean',
  'enum',
  'string',
]);

// Resolves user-supplied values against a manifest's params: fills defaults,
// requires missing required files, and enforces min/max. The full param
// vocabulary and form generation arrive in T5; this is the run-time half.
export function resolveParams(declared = [], provided = {}) {
  const resolved = {};

  for (const param of declared) {
    const key = param?.key;
    if (!key) throw new Error('manifest 参数缺少 key');

    const supplied = provided[key];
    const hasValue = supplied !== undefined && supplied !== null && supplied !== '';
    const value = hasValue ? supplied : param.default;

    switch (param.type) {
      case 'file': {
        if (value === undefined || value === null || value === '') {
          if (param.required) throw new Error(`缺少必填参数：${param.label || key}`);
          resolved[key] = null;
          break;
        }
        if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是文件路径`);
        let stat;
        try {
          stat = fs.statSync(value);
        } catch {
          throw new Error(`文件不存在：${param.label || key}`);
        }
        if (!stat.isFile()) throw new Error(`不是文件：${param.label || key}`);
        resolved[key] = value;
        break;
      }
      case 'files':
        throw new Error(`参数 ${key}：files（批量）将在后续版本支持`);
      case 'range':
      case 'number': {
        if (value === undefined || value === null || value === '') {
          if (param.required) throw new Error(`缺少必填参数：${param.label || key}`);
          resolved[key] = undefined;
          break;
        }
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`参数 ${key} 必须是数字`);
        if (param.min !== undefined && number < param.min) {
          throw new Error(`参数 ${key} 不能小于 ${param.min}`);
        }
        if (param.max !== undefined && number > param.max) {
          throw new Error(`参数 ${key} 不能大于 ${param.max}`);
        }
        resolved[key] = number;
        break;
      }
      case 'boolean':
        resolved[key] = Boolean(value);
        break;
      case 'enum': {
        const options = param.options ?? [];
        if (options.length > 0 && !options.some((option) => option.value === value)) {
          throw new Error(`参数 ${key} 的取值不在可选项内`);
        }
        resolved[key] = value;
        break;
      }
      case 'string':
        resolved[key] = value === undefined || value === null ? '' : String(value);
        break;
      default:
        throw new Error(`参数 ${key} 的类型未知：${param.type}`);
    }
  }

  return resolved;
}
