# Restore rehearsal swapped production onto a backup copy

- **What:** The live site ran on a copy of production taken the evening before for about
  3 minutes. Nothing visible changed for users: the site stayed up and the copy matched production
  except for log rows.
- **When (UTC; Nairobi is +3):** 2026-11-11 07:48:39 to 07:51:52.
- **Impact:**
  - The live database showed production as of 2026-11-10 18:33 UTC. Missing: 1 nightly
    `reconciliation` payment event and 243 job-run log rows.
  - No users, listings, payments, sessions or messages had changed in that time.
  - One job-run row written to the copy during the window was discarded with it.
  - Photos were unaffected; they are served from the original branch's storage.
- **Cause:**
  - During the S21 restore rehearsal, the snapshot `production-manual-2026-11-10` was restored to
    a new branch with the Neon MCP `restore_snapshot` tool.
  - That tool **finalizes by default** for a new branch. Finalizing moved production's compute
    (`ep-summer-morning-b9otl4v9`) onto the restored branch, made it the default branch named
    `production`, and renamed the real production branch.
  - The operator (Claude) took "finalize" to mean "give the new branch its own compute".
- **Fix** (approved by the owner, done by Claude):
  1. Deleted the empty compute Neon had created on the real production branch.
  2. Moved `ep-summer-morning-b9otl4v9` back to `br-mute-star-b92vpkso`.
  3. Made it the default branch again and renamed it `production`.
  4. Checked the live site and the row counts against the baseline taken just before the
     rehearsal (19 payment events, 1,145 job runs). Confirmed the next scheduled job wrote to the
     real branch.
  5. Deleted the restored copy.

  The connection strings never changed, so Vercel needed nothing.
- **Follow-ups:**
  - Done: the runbook (`docs/OPERATIONS.md` §4) now says to always restore unfinalized for
    rehearsals, and to check production is still the default branch with its endpoint.
  - Done: recorded that photo storage stays with the original branch id, so the old branch must be
    kept after a real restore.
  - Open: Neon branch protection isn't available on the free plan. Revisit if the plan is
    upgraded.
