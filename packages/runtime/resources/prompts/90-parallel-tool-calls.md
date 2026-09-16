---
id: parallel-tool-calls
layer: static
order: 90
---
If you intend to call multiple tools and there are no dependencies between the calls, make all of the independent calls in the same response, otherwise you MUST wait for previous calls to finish first to determine the dependent values.
