# AGENTS

Operative guide for agents and project collaborators.

## Objective
This document defines how to work in the repository and how to keep the project context alive without documentary drift.

## About CodePods
You are running inside **CodePods**, a manager for AI coding agents that run in isolated Docker containers. The agent (you) is inside a container, and can interact with the host system if the **Codepods** MCP (Model Context Protocol) server is available. If the MCP server is present, you can use its tools to open services, close services, and communicate with the CodePods platform. If it is not available, you can still work normally on the codebase.

## Mandatory document structure
- Context folder: `.context/`
- Required documents in `.context/`:
  - `design.md`: current technical summary of the solution (not historical).
  - `todo.md`: global task list and status (not subtasks of the active task).
  - `task.md`: current task, objective and status; updated on each relevant interaction.
  - `decisions.md`: persistent rules/decisions for the project.
  - `changelog.md`: summary per version/integration into `main` or `dev`; each integration opens a new cumulative entry.

## Branch rules and task execution
- Do not work directly on `main` or `dev`.
- All work happens on `feature/task-name` branches.
- If a new task appears while on `dev`, create a new `feature/...` branch and a new `task.md` for that task.
- If the scope of the same task increases, the same `feature/...` branch can be kept and `task.md` updated.
- If it is not confirmed that it is the same task, treat it as potential future work and register it in `todo.md`.
- **Before merging any feature to `dev`, explicitly confirm with the user that the feature is finished.**
- **Checkpoint commits:** during development on a `feature/...` branch, frequent commits should be made and pushed to the remote as checkpoints, even if the feature is not finished. This allows syncing progress and recovering state at any moment.

## Critical rule about `task.md`
- Always read and update `task.md` during execution.
- Temporary work notes are allowed.
- Do not let it grow uncontrolled: compact and move stable context to other documents (`design.md`, `decisions.md`, `changelog.md`, etc.).

## README
- `README.md` lives at the repository root (not in `.context`).
- It should contain summarized and purposeful information for humans and agents.
- It should not include version history or grow indefinitely.

## Additional documentation
- If new documents are needed (deployment, integrations, etc.), create them in `docs/`.
- Always confirm before creating additional documents outside those defined as mandatory.

## Managing important changes
- Any relevant change (stack, architecture, high-impact decisions) must be confirmed before updating key documentation.
- Example: switching from C# to TypeScript requires explicit confirmation before modifying `design.md` or other reference documents.

## Mandatory flow per interaction
1. Read `task.md`.
2. Execute code/documentation changes for the current task.
3. Update `task.md` with brief status and current notes.
4. If applicable, update `todo.md`, `decisions.md`, `design.md` and/or `changelog.md`.
5. Confirm with the user before registering important changes in base documents.