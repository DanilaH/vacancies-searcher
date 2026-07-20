# Agent Handoff Index

Use this directory as the compact project map for a fresh Codex agent.

Read in this order:

1. [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) - stable product goal, architecture, files, commands, constraints.
2. [CURRENT_STATE.md](./CURRENT_STATE.md) - what works now, DB/service status, known problems.
3. [DECISIONS.md](./DECISIONS.md) - decisions that should not be casually reversed.
4. [NEXT_TASK.md](./NEXT_TASK.md) - immediate next task, verification checklist, copy-paste prompt.

PM/Architect workflow now lives in:

- [../docs/ROADMAP.md](../docs/ROADMAP.md) - working roadmap, sequencing, dependencies, parallelization notes.
- [../docs/STATUS.md](../docs/STATUS.md) - current phase, completed work, active/next task, risks.
- [../docs/tasks/](../docs/tasks/) - bounded task files for Planner/Executor workflow.
- [../docs/tasks/TEMPLATE.md](../docs/tasks/TEMPLATE.md) - task file template.

For implementation work, prefer the active `docs/tasks/TASK-XXX-*.md` file over prose prompts. `.agent/NEXT_TASK.md` should point to the active task file and keep a compact handoff prompt.

If context conflicts, trust the current code and tests first, then these files, then product docs.
