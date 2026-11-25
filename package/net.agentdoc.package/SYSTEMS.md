# The systems this agent needs

Named by what the work needs rather than by product. The access level
is the most this work needs; a deployment that grants more is granting
more than the job requires.

| System | Kind | Access | What the access is for |
|---|---|---|---|
| code-host | service | read | To read the public repository's record, the commit's record, its recent commits and the archive of the repository at the commit from api.github.com, with GET requests only and no key. |
| vulnerability-database | service | read | To ask api.osv.dev which exact versions of the dependencies have known vulnerabilities, by queries that change nothing, and to read the record of each one found. |
| text-reasoning | model | trigger | To write the judgments over the facts the scripts found: what the agent does, how it works, what it can do on its own, its risks and what it needs to run safely, and the few findings that matter most. |

Whoever deploys this agent binds these systems to their own,
and places any named credential. Nothing here names a product.
