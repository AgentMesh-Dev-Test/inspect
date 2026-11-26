# inspect

Inspect reads an outside agent's code in a public GitHub repository, at its newest commit or one you name, without running any of it, and hands back an inspection report on what the agent does and how safe it is. The package AgentMesh installs is under package/; what it was built from, with its spec, record, tests and code, is under source/.

Version 0.4.6. Since 0.4.6 every line its model reads has passed AgentMesh's screening first, and a screening that cannot answer means a report with no judgment, never one made on text that was not screened.
