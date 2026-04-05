# 🚢 Skill-Any-Code

**Turn any codebase into a navigable skill.** 🚢

Understand large codebases **without** dumping the entire repository into an LLM context window.

`skill-any-code` is a CLI for engineers who need to understand unfamiliar repositories fast. It analyzes a project, generates structured Markdown summaries, and exposes the result as a project-local skill so humans and coding agents can progressively reveal only the code they actually need.


## Why 🎯

Large codebases are hard to understand because raw source code does not come with a map.

Search helps you jump around. LLMs help you explain what you are looking at. But neither solves the real problem: most of the time, you do not need more code. You need the right entry point.

`skill-any-code` treats codebase indexing as a first-class artifact. Instead of throwing an entire repository at an LLM, it builds a navigable understanding layer on top of the repo and lets you drill down step by step.


## Quick Start 🚀

```bash
# Install the CLI:
npm i -g skill-any-code

# Initialize the config file:
skill-any-code init
```

Set your LLM configuration in `~/.config/skill-any-code/config.yaml`:

```yaml
llm:
  base_url: "YOUR_LLM_BASE_URL"
  api_key: "YOUR_LLM_API_KEY"
  model: "YOUR_MODEL_NAME"
```

Analyze a project:

```bash
cd /path/to/your/project
sac
```


## How It Works ⚙️

1. **Analyze** — Walk the repo and summarize files + directories into structured Markdown.
2. **Store** — Drop results into a predictable, project-local output tree.
3. **Skill** — Generate a skill that maps source paths → summaries so agents navigate with **progressive disclosure**.


## Why It's Different ✨

- 🧩 **Not “just summaries”** — It turns repository understanding into a reusable navigation layer.
- 🎯 **Context, not noise** — It is designed to expose only the context that matters.
- 🤖 **Skill-native** — After analysis, tools like Cursor, Claude Code, Codex, and OpenCode can follow the generated skill instead of reading the entire repository blindly.
- 📂 **Structure-first** — You start at the root, move into a relevant directory, then drill into the exact file you need.


## What You Get 📦

- 📁 **`.skill-any-code-result/`** — Local analysis tree mirroring your project layout  
- 📝 **Markdown** — Per-directory and per-file summaries  
- 🔗 **Deployed skill** — Under project-local skill dirs for supported agent tools, mapping source locations to the right analysis file 
