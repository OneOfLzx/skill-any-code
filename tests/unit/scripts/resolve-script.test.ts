/**
 * V2.6 独立查询脚本（scripts/get-summary，Python）单元测试
 * 对应测试文档 10.4.3：UT-V23-SCRIPT-001 ~ UT-V23-SCRIPT-008
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { getResolveScriptContent } from '../../../src/infrastructure/skill/templates/resolve.script';

describe('独立查询脚本内容 (V23-SCRIPT)', () => {
  it('UT-V26-SCRIPT-004: 脚本为 Python 标准库实现', () => {
    const content = getResolveScriptContent();
    expect(content).toContain('#!/usr/bin/env python3')
    // 不应再出现 Node require
    expect(content).not.toMatch(/require\s*\(/)
  });

  it('脚本应包含输出目录常量与 N/A 逻辑', () => {
    const content = getResolveScriptContent();
    expect(content).toContain('N/A');
    expect(content).toContain('.skill-any-code-result');
  });
});
