# VSCode Auto Disable Extensions

> **Coming soon to the VS Code Marketplace.**

Most of your extensions are only useful in some projects, yet VS Code loads all of them everywhere:
the C# tools in your Rust repo, Python in your website. That means a slower editor, a side bar
crowded with tabs you never open, extra language servers and commands, and notifications you don't
care about.

Auto Disable Extensions looks at the folder you open (file types, `package.json`, `Cargo.toml`,
`*.csproj`…) and disables, for that workspace only, the extensions it doesn't use, while keeping
general-purpose ones like Git tools, themes and AI assistants.

## How it works

Open a folder and you are asked whether to apply. The window reloads with only what that project
needs. If the project changes (say, its first Docker file), it offers to update. Extensions you
disable or re-enable yourself are respected and remembered. The `⚡` in the status bar shows why each
extension is on or off, and can enable everything again.

VS Code has no public API to enable or disable other extensions, so this uses VS Code's own
"Disable (Workspace)" list, written through an internal API. Changes therefore take effect after a
window reload, and a future VS Code update could break it; if that happens, the extension tells you
and stops changing anything.

## Settings

| Setting | Default | |
|---|---|---|
| `autoDisableExtensions.mode` | `ask` | `ask`, `auto` (apply without asking) or `off` |
| `autoDisableExtensions.extensions` | `{}` | Your own rules: `"always"`, `"never"`, or when it is needed |
| `autoDisableExtensions.scanExclude` | build/vendor folders | Folders ignored when detecting the project |
