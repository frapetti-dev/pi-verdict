--!strict
-- The window half (runs per window on the UI thread; 50 ms per call, 4 ms for chrome formatters).
-- Owns palette commands, binds, chrome (status/tab title), CSS. Use the global `tern`.
--
-- Editor setup:   tern plugin types .      (writes ./tern.d.luau)
--   then point luau-lsp at it in your editor settings:
--   { "luau-lsp.platform.type": "standard",
--     "luau-lsp.sourcemap.enabled": false,
--     "luau-lsp.types.definitionFiles": { "@tern": "tern.d.luau" } }
-- Install for development (edits reload automatically):   tern plugin link .
--
-- The window half: a palette command and a status segment that runs it.

tern.command({
	id = "hello",
	title = "Say hello",
	icon = "sparkle",
	run = function(cx)
		local how = if tern.runtime.jit then "native code" else "the interpreter"
		cx:toast("info", "Hello from " .. tern.plugin.name, "running on " .. how)
	end,
})

-- Status formatters are pure: no cx, 4 ms budget, result cached by the input table.
-- `command` is an action name run on click; a plugin command is "plugin.<plugin id>.<command id>".
tern.chrome.status(function(pane)
	if pane.program == "" then
		return nil
	end
	return { { text = "hello", icon = "sparkle", tone = "muted", command = "plugin.my-plugin.hello" } }
end)
