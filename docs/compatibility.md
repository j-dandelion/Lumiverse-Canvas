# Lumiverse branch compatibility

Canvas maintains one branch for each supported Lumiverse branch:

| Canvas branch | Matching Lumiverse branch | Purpose |
| --- | --- | --- |
| `main` | `main` | Stable compatibility track |
| `staging` | `staging` | Pre-release compatibility track |

Treat each row as a supported pair. Do not infer that a Canvas branch works with the other Lumiverse branch just because the current source happens to be shared.

## Choosing a branch

Lumiverse's Spindle panel can select a branch when installing an extension and switch an installed extension later. If installation is left on **Default**, Git uses the Canvas repository's default branch, `main`. Users on Lumiverse `staging` should select Canvas `staging`; users on Lumiverse `main` should select Canvas `main`.

An installed extension stays on its selected branch when it updates. Creating Canvas `staging` does not move existing users from Canvas `main` to `staging`; they must switch branches in Spindle when they want the staging track.

## Agent workflow

Choose the target Lumiverse branch before editing Canvas:

1. Start a Canvas task branch from the matching Canvas branch: use `agent/<short-task-name>-main` for Lumiverse `main`, or `agent/<short-task-name>-staging` for Lumiverse `staging`.
2. Run Canvas typecheck and tests for the changed code.
3. Build Canvas into a disposable Lumiverse preview using the matching Lumiverse worktree. Use a fresh preview profile for each full smoke run because the smoke changes saved drawer widths and tab placement.
4. Record both source commit IDs and the preview profile with the result.

For a fix intended for both tracks, validate the first task branch against its matching Lumiverse branch, then port the change to a task branch based on the other Canvas branch and validate that pair too. Keep branch-specific changes on their own track. Do not merge all of upstream Lumiverse `staging` into `main` as part of routine Canvas work.

## Promotion

Canvas does not use pull requests. Task branches are the reviewable candidate. Pushing a task branch does not promote it to either compatibility branch. The owner must accept the candidate and explicitly authorize updating Canvas `main` or `staging` before it becomes the branch users receive.
