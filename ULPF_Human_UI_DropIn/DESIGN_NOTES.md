# ULPF Human-Crafted UI Pass

This is a drop-in UI replacement for the existing ULPF FastAPI project.

## Replace
Copy `ulpf/static/` into the existing repository's `ulpf/static/` directory.

The included `pyproject.toml` and `requirements.txt` preserve the Vercel dependency fix discussed during deployment debugging. Use them only if they match the current repository root.

## What changed
- Removed permanent "API connected", "Offline core", schema-version and hackathon/problem-statement status clutter from the sidebar.
- Removed 01/02/03 numbering from navigation.
- Reframed navigation around the actual mental workflow: Work → Investigate → Extend.
- Replaced the generic letter-in-a-box logo with a tiny inline SVG mark: several incoming traces converge into one output line.
- Kept the existing dark green visual language while introducing non-uniform proportions, quieter hierarchy, and varied control sizes.
- Rebuilt spacing around relationships instead of a repeated card/gap formula.
- Kept all frontend dependencies at zero: plain HTML + CSS + JS, no CDN, no framework, no external font, no animation library.
- Connection state is silent when healthy and only appears when a request actually fails.
- Existing API behavior is preserved: overview, ingest, explorer, inspector, registry, quarantine, onboarding, drafts, and NDJSON export.

## Design rule
Do not add a UI element because a dashboard "should have one". Add it only when the operator needs it at that moment.
