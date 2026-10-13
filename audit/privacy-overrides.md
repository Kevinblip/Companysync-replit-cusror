# Privacy Gate Override Audit Log

This file is the durable record of every emergency bypass of the
staging privacy gate. It is committed back to the repository automatically
each time `allow_privacy_check_override` is used in the Deploy to Production
workflow. Entries survive long after the GitHub Actions run retention window.

To review past overrides, open this file in the repository — no digging
through expired CI runs required.

| Timestamp (UTC) | Actor | Commit SHA | Blocked Staging Run | Justification |
|-----------------|-------|-----------|---------------------|---------------|
