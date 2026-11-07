//! Descrições das ferramentas internas em inglês (a tabela principal, em tools.rs, é constante e fica em
//! português). Com o studio em inglês, o modelo recebe estas.

/// (descrição, esquema dos parâmetros) em inglês, pelo nome da ferramenta.
pub fn def_en(name: &str) -> Option<(&'static str, &'static str)> {
    Some(match name {
        "list_directory" => ("Lists files and folders. The path is relative to the workspace (use \".\" for the root). Also accepts absolute paths the user referenced.",
            r#"{"type":"object","properties":{"path":{"type":"string","description":"Folder path"}},"required":["path"]}"#),
        "read_file" => ("Reads a text file. A large file without offset/limit comes back as an outline (sections, headings, functions) with line numbers: then read only the parts you need with offset/limit.",
            r#"{"type":"object","properties":{"path":{"type":"string"},"offset":{"type":"integer","description":"First line (1 = first)"},"limit":{"type":"integer","description":"Maximum number of lines"}},"required":["path"]}"#),
        "search_files" => ("Searches files by name (accepts * as a wildcard) and, optionally, by content (regular expression). Returns relative paths and, when searching content, the matching lines with their numbers. path can be a file: searches only in it.",
            r#"{"type":"object","properties":{"name":{"type":"string","description":"Part of the name or a pattern, e.g.: *.py"},"content":{"type":"string","description":"Regex to search inside the files"},"path":{"type":"string","description":"Folder (or file) to search in (default: root)"}}}"#),
        "write_file" => ("Creates or replaces a file inside the workspace with the given content. Creates missing folders. To change part of an existing file, use edit_file (much cheaper).",
            r#"{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}"#),
        "create_directory" => ("Creates a folder (and the ones in between) inside the workspace.",
            r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}"#),
        "edit_file" => ("Changes part of a file. Three ways: old_text + new_text (exact old_text, appearing once, or replace_all); start_line + end_line + new_text (replaces those lines without repeating the old text; end_line = start_line - 1 inserts before; send expect with the start of line start_line); or edits = list of {old_text, new_text} applied together.",
            r#"{"type":"object","properties":{"path":{"type":"string"},"old_text":{"type":"string"},"new_text":{"type":"string"},"replace_all":{"type":"boolean"},"start_line":{"type":"integer"},"end_line":{"type":"integer"},"expect":{"type":"string","description":"With start_line: the start of line start_line as it is now (checks the number did not change)"},"edits":{"type":"array","items":{"type":"object","properties":{"old_text":{"type":"string"},"new_text":{"type":"string"}},"required":["old_text","new_text"]}}},"required":["path"]}"#),
        "run_command" => ("Runs a PowerShell (Windows) command inside the workspace and returns the output and the exit code. Use it to build, run scripts, git, install packages etc. Do not use it for interactive commands.",
            r#"{"type":"object","properties":{"command":{"type":"string","description":"PowerShell command or script"},"cwd":{"type":"string","description":"Subfolder to run in (default: workspace root)"},"timeout":{"type":"integer","description":"Seconds until it is stopped (default 120, maximum 1800)"}},"required":["command"]}"#),
        "execute_code" => ("Runs (async) JavaScript to orchestrate several tools at once, without filling the context with intermediate results. Inside the code: `await tool('tool_name', {arguments})` returns the result text (throws if the tool fails); `console.log(...)` logs; `return value` returns the final result. E.g.: loops over files, filtering results, calling several tools and summarizing.",
            r#"{"type":"object","properties":{"code":{"type":"string","description":"Body of an async JavaScript function"}},"required":["code"]}"#),
        "browser_navigate" => ("Opens a URL in the browser window controlled by the studio and returns the page text and the numbered interactive elements.",
            r#"{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}"#),
        "browser_read" => ("Reads the current browser page: title, URL, text and numbered interactive elements.", r#"{"type":"object","properties":{}}"#),
        "browser_click" => ("Clicks a page element by the number shown in browser_read/browser_navigate.",
            r#"{"type":"object","properties":{"id":{"type":"integer"}},"required":["id"]}"#),
        "browser_type" => ("Types into a page field (by its number). Replaces the current content. Use submit=true to press Enter afterwards.",
            r#"{"type":"object","properties":{"id":{"type":"integer"},"text":{"type":"string"},"submit":{"type":"boolean"}},"required":["id","text"]}"#),
        "browser_press" => ("Presses a key on the page: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, PageDown or PageUp.",
            r#"{"type":"object","properties":{"key":{"type":"string"}},"required":["key"]}"#),
        "browser_back" => ("Goes back to the previous page.", r#"{"type":"object","properties":{}}"#),
        "browser_screenshot" => ("Takes a screenshot of the current page (saved in the screenshots folder). If the model can see images, the image is sent to it.", r#"{"type":"object","properties":{}}"#),
        "browser_eval" => ("Runs JavaScript on the open page and returns the result (JSON).",
            r#"{"type":"object","properties":{"code":{"type":"string","description":"Expression or immediately invoked function"}},"required":["code"]}"#),
        "computer_windows" => ("Lists the windows open on the user's computer (id and title).", r#"{"type":"object","properties":{}}"#),
        "computer_focus" => ("Brings a window to the foreground, by id or part of the title.",
            r#"{"type":"object","properties":{"window":{"type":"string","description":"id or part of the title"}},"required":["window"]}"#),
        "computer_elements" => ("Lists the screen elements (buttons, fields, menus, texts) of a window through Windows UI Automation, numbered for computer_click. Without window, uses the foreground window.",
            r#"{"type":"object","properties":{"window":{"type":"string","description":"id or part of the title (optional)"},"filter":{"type":"string","description":"Only elements containing this text (optional)"}}}"#),
        "computer_screenshot" => ("Captures the whole screen (saved in the screenshots folder). If the model can see images, the image is sent to it.", r#"{"type":"object","properties":{}}"#),
        "computer_click" => ("Clicks an element (id from computer_elements) or a point (x, y from the last screenshot). button: left or right. double: double click.",
            r#"{"type":"object","properties":{"id":{"type":"integer"},"x":{"type":"integer"},"y":{"type":"integer"},"button":{"type":"string","enum":["left","right"]},"double":{"type":"boolean"}}}"#),
        "computer_type" => ("Types text where the cursor is (in the foreground window).",
            r#"{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}"#),
        "computer_key" => ("Presses a key or combination, e.g.: enter, ctrl+s, alt+f4, ctrl+shift+esc, win+r.",
            r#"{"type":"object","properties":{"keys":{"type":"string"}},"required":["keys"]}"#),
        "computer_scroll" => ("Scrolls the mouse wheel. Negative amount scrolls down, positive scrolls up. x and y optional (from the last screenshot).",
            r#"{"type":"object","properties":{"amount":{"type":"integer"},"x":{"type":"integer"},"y":{"type":"integer"}},"required":["amount"]}"#),
        "recall_history" => ("Searches earlier chats (or only the current one) for passages about a subject. Use it when the user refers to something already discussed.",
            r#"{"type":"object","properties":{"query":{"type":"string"},"scope":{"type":"string","enum":["all","current"]},"limit":{"type":"integer"}},"required":["query"]}"#),
        "notebook" => ("Project notebook with lasting findings. list (optional query), get (id), add (title), update (id + fields), remove (id).",
            r#"{"type":"object","properties":{"action":{"type":"string","enum":["list","get","add","update","remove"]},"query":{"type":"string"},"id":{"type":"integer"},"title":{"type":"string"},"kind":{"type":"string","description":"function, address, string, hypothesis..."},"addr":{"type":"string","description":"e.g.: 0x401000"},"status":{"type":"string","enum":["hypothesis","confirmed","discarded"]},"text":{"type":"string"}},"required":["action"]}"#),
        "update_todos" => ("Keeps this chat's task list, visible to the user. Use it for tasks with 3 or more steps: create the list at the start and update it when starting (in_progress) and finishing (done) each item. Always send the whole list; only one item in_progress at a time.",
            r#"{"type":"object","properties":{"todos":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string","description":"What to do, short and in the imperative"},"status":{"type":"string","enum":["pending","in_progress","done"]}},"required":["text","status"]}}},"required":["todos"]}"#),
        "search_tools" => ("MCP connector tools. query: searches by keywords and shows name and description (does not load). names: loads these (exact names) for the next steps.",
            r#"{"type":"object","properties":{"names":{"type":"array","items":{"type":"string"},"description":"Exact names from the catalog"},"query":{"type":"string","description":"Keywords"}}}"#),
        "explore" => ("Starts an explorer subagent: it investigates on its own (read only: files, search and, if on, the browser) with its own context and returns a report. Use it for broad research without filling your context. Call it several times in the same answer to explore in parallel.",
            r#"{"type":"object","properties":{"task":{"type":"string","description":"What to investigate and what the report must contain"},"where":{"type":"string","description":"Folder, files or site to start with (optional)"}},"required":["task"]}"#),
        "read_skill_file" => ("Reads a helper file of an active skill (scripts, templates, references cited in SKILL.md). A large file comes back as an outline; read parts with offset/limit.",
            r#"{"type":"object","properties":{"skill":{"type":"string","description":"skill id"},"path":{"type":"string"},"offset":{"type":"integer"},"limit":{"type":"integer"}},"required":["skill","path"]}"#),
        "customize_ui" => ("Personalize the interface: themes (colors, fonts), layouts, and custom widgets. Creates and applies visualization settings.",
            r#"{"type":"object","properties":{"theme":{"type":"string","description":"Theme name (light, dark, custom)"}, "colors":{"type":"object","description":"Custom colors: background, foreground, accent, primary, secondary, warning, error, success"}, "fonts":{"type":"object","description":"Fonts: body, monospace, header"}, "layout":{"type":"string","description":"Layout: compact, spacious, grid, list"}, "widgets":{"type":"array","items":{"type":"string","description":"Widgets: statusbar, toolbar, sidebar, panels, tabs"}}},"required":[]}"#),
        _ => return None,
    })
}

#[cfg(test)]
mod t {
    #[test]
    fn esquemas_validos() {
        for n in ["list_directory", "read_file", "search_files", "write_file", "create_directory", "edit_file", "run_command", "execute_code", "browser_navigate", "browser_read", "browser_click", "browser_type", "browser_press", "browser_back", "browser_screenshot", "browser_eval", "computer_windows", "computer_focus", "computer_elements", "computer_screenshot", "computer_click", "computer_type", "computer_key", "computer_scroll", "recall_history", "notebook", "update_todos", "search_tools", "explore", "read_skill_file", "customize_ui"] {
            let (_, p) = super::def_en(n).unwrap_or_else(|| panic!("sem inglês: {n}"));
            serde_json::from_str::<serde_json::Value>(p).unwrap_or_else(|e| panic!("{n}: {e}"));
        }
    }
}
