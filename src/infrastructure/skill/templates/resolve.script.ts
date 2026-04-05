/**
 * scripts/get-summary.py 内容模板（部署到 Skill 目录中的独立脚本，仅使用 Python 标准库）
 *
 * 约定：
 * - 输入：命令行参数 argv[1]，应为项目内文件或目录「相对项目根目录」的相对路径
 * - 行为：遵循主程序的结果 md 命名规则，推导目标对象对应的结果 md 路径；若结果 md 存在则输出其相对项目根路径
 * - 输出：
 *   - 命中：stdout 输出对应 Markdown 结果文件的相对路径（相对项目根目录，单行）
 *   - 未命中：stdout 输出字符串 "N/A"（单行）
 *   - 参数错误：stderr 输出错误信息并以 exit code 1 退出
 */
export function getResolveScriptContent(): string {
  return `#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path, PurePosixPath


DEFAULT_OUTPUT_DIR = ".skill-any-code-result"


def _to_posix_rel(s: str) -> str:
  # 最大兼容：支持 \\、./、尾部 /
  v = (s or "").strip().replace("\\\\", "/")
  while v.startswith("./"):
    v = v[2:]
  # 保留根目录语义："." / "" 视为项目根目录
  if v in (".", ""):
    return "."
  # 裁剪尾部斜杠（目录也允许输入 xxx/）
  if v.endswith("/") and len(v) > 1:
    v = v[:-1]
  return v


def _detect_project_root(script_path: Path) -> Path:
  # 约定：<projectRoot>/.agents/skills/skill-any-code/scripts/get-summary.py
  # parents: [scripts, skill-any-code, skills, .agents, projectRoot, ...]
  return script_path.resolve().parents[4]


def _file_md_rel(target_rel: str) -> PurePosixPath:
  p = PurePosixPath(target_rel)
  dir_part = str(p.parent) if str(p.parent) not in (".", "") else ""
  # 文件结果 Markdown：使用“完整文件名（含扩展名）+ .md”
  # 例如：src/app.ts -> src/app.ts.md
  name = f"{p.name}.md"

  if dir_part:
    return PurePosixPath(DEFAULT_OUTPUT_DIR) / dir_part / name
  return PurePosixPath(DEFAULT_OUTPUT_DIR) / name


def _dir_md_rel(target_rel: str) -> PurePosixPath:
  if target_rel in (".", ""):
    return PurePosixPath(DEFAULT_OUTPUT_DIR) / "index.md"
  return PurePosixPath(DEFAULT_OUTPUT_DIR) / target_rel / "index.md"


def main() -> int:
  if len(sys.argv) < 2 or not sys.argv[1]:
    sys.stderr.write("Usage: python get-summary.py <relative-path>\\n")
    return 1

  raw = sys.argv[1]
  raw_posix = raw.replace("\\\\", "/").strip()
  rel = _to_posix_rel(raw)

  project_root = _detect_project_root(Path(__file__))
  target_abs = (project_root / PurePosixPath(rel)).resolve()

  if not target_abs.exists():
    sys.stdout.write("N/A\\n")
    return 0

  # 输入可能是目录（含尾 /）或真实目录
  is_dir = target_abs.is_dir() or raw_posix.endswith("/")
  md_rel = _dir_md_rel(rel) if is_dir else _file_md_rel(rel)
  md_abs = (project_root / Path(os.fspath(md_rel))).resolve()

  if md_abs.exists():
    sys.stdout.write(str(md_rel).replace("\\\\", "/") + "\\n")
  else:
    sys.stdout.write("N/A\\n")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
`
}
