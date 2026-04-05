/**
 * 诊断脚本：验证 Windows 下 path.relative 与 ignore 库的行为
 * 用于复现用户报告的 .skill-any-code-result 黑名单失效问题
 */
const path = require('path');
const ignore = require('ignore');

// 模拟用户项目路径（含中文、数字、点）
const projectRoot = 'C:\\Software\\paper\\12.08材料\\计算细分类型的结果';
const fullPathDir = path.join(projectRoot, '.skill-any-code-result');
const fullPathFile = path.join(projectRoot, '.skill-any-code-result', 'index.md');

const relativeDir = path.relative(projectRoot, fullPathDir);
const relativeFile = path.relative(projectRoot, fullPathFile);

console.log('=== path.relative 输出 ===');
console.log('projectRoot:', projectRoot);
console.log('fullPathDir:', fullPathDir);
console.log('fullPathFile:', fullPathFile);
console.log('relativeDir (目录):', JSON.stringify(relativeDir), 'length:', relativeDir.length);
console.log('relativeFile (文件):', JSON.stringify(relativeFile), 'length:', relativeFile.length);
console.log('relativeDir 含反斜杠:', relativeDir.includes('\\'));
console.log('relativeDir 以 .\\ 开头:', relativeDir.startsWith('.\\'));
console.log('relativeDir 以 ./ 开头:', relativeDir.startsWith('./'));

// 归一化后
const normDir = relativeDir.replace(/\\/g, '/');
const normFile = relativeFile.replace(/\\/g, '/');
console.log('\n=== 归一化后 ===');
console.log('normDir:', JSON.stringify(normDir));
console.log('normFile:', JSON.stringify(normFile));

// 目录检查时传入的 key（analysis.service 逻辑）
const keyDir = path.dirname(fullPathDir) === projectRoot 
  ? relativeDir + (path.sep === '\\' ? '\\' : '/') 
  : relativeDir + '/';
// 实际代码是: const key = entry.isDirectory() ? `${relativePath}/` : relativePath
const keyDirActual = relativeDir + '/';
console.log('\n=== 传入 isIgnored 的 key ===');
console.log('目录 key:', JSON.stringify(keyDirActual));
console.log('文件 key:', JSON.stringify(relativeFile));

// ignore 库匹配（包裹 try-catch，避免单次失败中断）
function safeIgnores(ig, p) {
  try {
    return ig.ignores(p);
  } catch (e) {
    return `THROW: ${e.message}`;
  }
}
const ig = ignore().add('.skill-any-code-result/');
const testCases = [
  ['.skill-any-code-result/', '期望匹配的目录'],
  ['.skill-any-code-result/index.md', '期望匹配的文件'],
  [relativeFile.replace(/\\/g, '/'), '实际 relativeFile 归一化后'],
  [keyDirActual.replace(/\\/g, '/'), '实际目录 key 归一化后'],
  // 模拟 path.relative 可能返回的异常格式
  ['./.skill-any-code-result/', '若返回 .\\ 前缀的目录'],
  ['./.skill-any-code-result/index.md', '若返回 .\\ 前缀的文件'],
  ['\\.skill-any-code-result\\index.md'.replace(/\\/g, '/'), '若返回 \\ 前缀(会抛错)'],
];
console.log('\n=== ignore 库匹配结果 ===');
for (const [p, desc] of testCases) {
  const r = safeIgnores(ig, p);
  console.log(desc, ':', JSON.stringify(p), '->', typeof r === 'boolean' ? (r ? 'MATCH' : 'NO MATCH') : r);
}

// 测试 path.relative 在 projectRoot 带尾斜杠时的行为
console.log('\n=== projectRoot 尾斜杠影响 ===');
const projectRootTrailing = projectRoot + path.sep;
const rel2 = path.relative(projectRootTrailing, fullPathFile);
console.log('projectRoot 带尾斜杠时 relativeFile:', JSON.stringify(rel2));
console.log('归一化后:', JSON.stringify(rel2.replace(/\\/g, '/')));
console.log('match:', safeIgnores(ig, rel2.replace(/\\/g, '/')));
