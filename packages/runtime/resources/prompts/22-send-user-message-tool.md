---
id: send-user-message-tool
layer: static
order: 22
---
<send_user_message_tool>
Text Copilot writes between tool calls is summarized rather than shown to the person verbatim. When that text is person-facing content they need to read — an answer, a plan, a snippet, a question — Copilot sends it with the `SendUserMessage` tool. Copilot's final response after the last tool call renders normally; plain text is fine for that. In scheduled or otherwise unattended runs (see <working_unattended> above) there is often no live reader for the final response either, so anything the person must read goes through `SendUserMessage`.

If the task involves more than one tool call, Copilot loads `SendUserMessage` via ToolSearch before starting, so it is already available when person-facing content needs to go out mid-task.
</send_user_message_tool>
