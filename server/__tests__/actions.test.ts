import { test, expect, describe } from "bun:test";
import {
  shellEscape,
  buildCommandWithEnv,
  isSubmenu,
  findAction,
  validateActions,
} from "../actions.ts";
import type { MenuItem } from "../actions.ts";
import { createAppConfig } from "../app.ts";
import { createGitService } from "../git.ts";
import { createGitHubService } from "../github.ts";
import { createCmuxService, createDryRunConnector } from "../cmux.ts";

test("shell actions receive the typed message before the shell expands variables", async () => {
  const run = async () => "";
  const cwd = process.cwd();
  const app = createAppConfig({
    port: 14569,
    cwd,
    git: createGitService(run, cwd),
    github: createGitHubService(run, cwd),
    cmux: createCmuxService(createDryRunConnector()),
    actions: [{ label: "Read message", type: "shell", command: 'printf "%s" "$MSG"' }],
  });
  const route = app.apiRoutes["/api/action"] as { POST: (request: Request) => Promise<Response> };
  const message = 'Fix "quotes", $HOME, $(echo wrong), and spaces';
  const response = await route.POST(
    new Request("http://127.0.0.1:14569/api/action", {
      method: "POST",
      headers: { host: "127.0.0.1:14569" },
      body: JSON.stringify({ id: "0", variables: { MSG: message } }),
    }),
  );
  expect(await response.json()).toMatchObject({ ok: true, stdout: message });
  app.stop();
});

describe("shellEscape", () => {
  test("simple string", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  test("string with single quotes", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  test("string with double quotes", () => {
    expect(shellEscape('He said "hi"')).toBe("'He said \"hi\"'");
  });

  test("string with special shell characters", () => {
    expect(shellEscape("$HOME `cmd` $(pwd)")).toBe("'$HOME `cmd` $(pwd)'");
  });

  test("empty string", () => {
    expect(shellEscape("")).toBe("''");
  });

  test("string with multiple single quotes", () => {
    expect(shellEscape("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });
});

describe("buildCommandWithEnv", () => {
  test("no variables", () => {
    expect(buildCommandWithEnv("echo hello", {})).toBe("echo hello");
  });

  test("single variable", () => {
    const result = buildCommandWithEnv('git commit -m "$MSG"', { MSG: "fix: bug" });
    expect(result).toBe("MSG='fix: bug' git commit -m \"$MSG\"");
  });

  test("multiple variables", () => {
    const result = buildCommandWithEnv("echo $A $B", { A: "hello", B: "world" });
    expect(result).toBe("A='hello' B='world' echo $A $B");
  });

  test("variable with special characters", () => {
    const result = buildCommandWithEnv('git commit -m "$MSG"', { MSG: 'it\'s a "fix"' });
    expect(result).toBe("MSG='it'\\''s a \"fix\"' git commit -m \"$MSG\"");
  });

  test("built-in variables", () => {
    const result = buildCommandWithEnv("cd $CMUX_HUB_CWD && git status", {
      CMUX_HUB_CWD: "/home/user/project",
    });
    expect(result).toBe("CMUX_HUB_CWD='/home/user/project' cd $CMUX_HUB_CWD && git status");
  });

  test("rejects invalid variable keys", () => {
    const result = buildCommandWithEnv("echo hello", {
      "FOO=bar;evil #": "value",
      VALID: "ok",
    });
    expect(result).toBe("VALID='ok' echo hello");
    expect(result).not.toContain("evil");
  });

  test("rejects keys starting with number", () => {
    const result = buildCommandWithEnv("echo hello", { "1BAD": "value" });
    expect(result).toBe("echo hello");
  });

  test("rejects keys with spaces", () => {
    const result = buildCommandWithEnv("echo hello", { "FOO BAR": "value" });
    expect(result).toBe("echo hello");
  });
});

describe("isSubmenu", () => {
  test("action item", () => {
    const item: MenuItem = { label: "Commit", type: "shell", command: "git commit" };
    expect(isSubmenu(item)).toBe(false);
  });

  test("submenu item", () => {
    const item: MenuItem = {
      label: "More",
      submenu: [{ label: "Amend", type: "shell", command: "git commit --amend" }],
    };
    expect(isSubmenu(item)).toBe(true);
  });
});

describe("findAction", () => {
  const actions: MenuItem[] = [
    { label: "Commit", type: "shell", command: "git commit" },
    { label: "PR", type: "shell", command: "gh pr create" },
    {
      label: "More",
      submenu: [
        { label: "Amend", type: "shell", command: "git commit --amend" },
        { label: "Stash", type: "shell", command: "git stash" },
      ],
    },
  ];

  test("top-level action by index", () => {
    expect(findAction(actions, "0")).toEqual({
      label: "Commit",
      type: "shell",
      command: "git commit",
    });
    expect(findAction(actions, "1")).toEqual({
      label: "PR",
      type: "shell",
      command: "gh pr create",
    });
  });

  test("submenu action by index path", () => {
    expect(findAction(actions, "2.0")).toEqual({
      label: "Amend",
      type: "shell",
      command: "git commit --amend",
    });
    expect(findAction(actions, "2.1")).toEqual({
      label: "Stash",
      type: "shell",
      command: "git stash",
    });
  });

  test("returns null for submenu itself", () => {
    expect(findAction(actions, "2")).toBeNull();
  });

  test("returns null for out of range", () => {
    expect(findAction(actions, "5")).toBeNull();
    expect(findAction(actions, "2.5")).toBeNull();
    expect(findAction(actions, "-1")).toBeNull();
  });

  test("returns null for invalid id", () => {
    expect(findAction(actions, "abc")).toBeNull();
    expect(findAction(actions, "")).toBeNull();
  });
});

describe("validateActions", () => {
  test("valid actions", () => {
    const data: MenuItem[] = [
      { label: "Commit", type: "shell", command: "git commit" },
      { label: "Review", type: "paste-and-enter", command: "claude review" },
      { label: "Paste", type: "paste", command: "echo hi" },
    ];
    expect(validateActions(data)).toEqual(data);
  });

  test("valid submenu", () => {
    const data: MenuItem[] = [
      {
        label: "More",
        submenu: [{ label: "Amend", type: "shell", command: "git commit --amend" }],
      },
    ];
    expect(validateActions(data)).toEqual(data);
  });

  test("valid action with input", () => {
    const data: MenuItem[] = [
      {
        label: "Commit",
        type: "shell",
        command: 'git commit -m "$MSG"',
        input: { placeholder: "Message...", variable: "MSG" },
      },
    ];
    expect(validateActions(data)).toEqual(data);
  });

  test("rejects non-array", () => {
    expect(() => validateActions("not array")).toThrow("actions must be an array");
  });

  test("rejects missing label", () => {
    expect(() => validateActions([{ type: "shell", command: "echo" }])).toThrow(
      '"label" is required',
    );
  });

  test("rejects missing command", () => {
    expect(() => validateActions([{ label: "Test", type: "shell" }])).toThrow(
      '"command" is required',
    );
  });

  test("rejects missing type", () => {
    expect(() => validateActions([{ label: "Test", command: "echo" }])).toThrow(
      '"type" must be one of',
    );
  });

  test("rejects invalid type", () => {
    expect(() => validateActions([{ label: "Test", type: "invalid", command: "echo" }])).toThrow(
      '"type" must be one of',
    );
  });

  test("rejects invalid input", () => {
    expect(() =>
      validateActions([
        { label: "Test", type: "shell", command: "echo", input: { placeholder: "p" } },
      ]),
    ).toThrow('"variable" is required');
  });

  test("rejects invalid submenu item", () => {
    expect(() => validateActions([{ label: "More", submenu: [{ label: "Sub" }] }])).toThrow(
      '"command" is required',
    );
  });
});
