# OpenSpec (SDD pipeline artifacts)

This directory holds SDD-pipeline state: `config.yaml`, in-flight `changes/{change-name}/`
folders, and their `archive/`. It is bootstrap tooling for the `sdd-*` phases and does not
replace the project's existing spec method.

## Relationship to `specs/`

The repo-root [`specs/`](../specs/README.md) directory is the established source of truth
for engine/ai/online domain requirements (`specs/{NNN-domain}/spec.md`, numbered `FR-x`
requirements, `AC-xxx` acceptance criteria cited by test names). `sdd-init` did not touch
it and it stays authoritative.

`openspec/changes/{change-name}/specs/{domain}/spec.md` holds delta specs produced by the
`sdd-spec` phase for changes run through the SDD pipeline. When a change extends an existing
numbered domain, its delta should follow the same `FR-x`/`AC-xxx` convention (see
`config.yaml` → `rules.specs`) so it can be folded back into the matching `specs/{NNN-domain}/spec.md`
on archive.
