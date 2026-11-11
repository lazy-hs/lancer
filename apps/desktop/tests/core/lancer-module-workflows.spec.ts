import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
  writeProjectExtension,
} from "../helpers/electron-app";

test("module handoff keeps context, ordinary chats stay separate and all saved trees remain visible", async () => {
  test.setTimeout(120_000);
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("module-workflows");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(profile, "ui-state.json"),
    JSON.stringify({ themeMode: "light", language: "en" }),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "workflow-fixture",
      defaultModel: "gpt-6.1-sol",
      enabledModels: ["workflow-fixture/gpt-6.1-sol", "workflow-fixture/gpt-6-astra"],
      compaction: { enabled: false },
    }),
  );
  const skillDir = join(workspace, ".agents", "skills", "workflow-proof");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: workflow-proof\ndescription: Verify module task configuration.\n---\nWORKFLOW_SKILL_EXPANDED_89\n",
  );
  await writeProjectExtension(
    workspace,
    "workflow-fixture.ts",
    `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.registerProvider("workflow-fixture", { baseUrl: "http://127.0.0.1:9/unused", apiKey: "LOCAL_FIXTURE", api: "workflow-fixture",
    models: ["gpt-6.1-sol", "gpt-6-astra"].map(id => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    streamSimple(model, context) {
      const users = context.messages.filter(m => m.role === "user");
      const text = "MODEL=" + model.id + " TURNS=" + users.length + " FIRST=" + JSON.stringify(users[0]?.content) + " LAST=" + JSON.stringify(users.at(-1)?.content);
      const message = { role: "assistant", content: [{ type: "text", text }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
      const stream = createAssistantMessageEventStream(); stream.push({ type: "start", partial: { ...message, content: [] } }); stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message }); stream.push({ type: "done", reason: "stop", message }); return stream;
    }
  });
}
`,
  );
  const launch = () =>
    launchDesktop(profile, {
      agentDir,
      initialWorkspaces: [workspace],
      scrubProviderEnv: true,
      testMode: "foreground",
    });
  let harness = await launch();
  const create = async (page: Page, mode: string, prompt: string) => {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await openNewThread(page);
    await page.getByLabel("New thread prompt").fill(prompt);
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect(page.locator(".process-assistant").last()).toContainText("TURNS=1");
    await expect
      .poll(async () =>
        (await getDesktopState(page)).workspaces
          .flatMap((w) => w.sessions)
          .some((s) => s.status === "running"),
      )
      .toBe(false);
    return (await getDesktopState(page)).selectedSessionId;
  };
  try {
    const page = await harness.firstWindow();
    await create(page, "Standard chat", "普通交流：聊视频与论文");
    await expect(page.getByTestId("module-workflow")).toHaveCount(0);
    await expect(page.getByLabel("模型图标预览").getByRole("button")).toHaveCount(9);
    const family = page.locator('[data-anchor-key="family:openai"]');
    await expect(family).toHaveAttribute("aria-pressed", "true");
    expect(await family.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    await page.getByTestId("composer").click();
    await expect(page.getByTestId("composer")).toHaveCSS("outline-style", "none");
    await page.screenshot({ path: test.info().outputPath("composer-model-selection.png") });
    const video = await create(page, "Video re-creation", "视频复刻上下文凭据 BLUE-72");
    await expect(page.getByTestId("module-workflow")).toBeVisible();
    await expect(page.getByTestId("thread-title")).toBeVisible();
    await expect(page.locator(".process-assistant").last()).toHaveCSS("box-shadow", "none");
    await expect(page.locator(".process-assistant").last()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(page.locator(".process-message-time").last()).toHaveText(/\d{2}:\d{2}/);
    const workflowBox = await page.getByTestId("module-workflow").boundingBox();
    const titleBox = await page.getByTestId("thread-title").boundingBox();
    expect(workflowBox!.y + workflowBox!.height).toBeLessThanOrEqual(titleBox!.y);
    await page.screenshot({ path: test.info().outputPath("conversation-layout-wide.png") });
    await harness.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(1000, 760),
    );
    await expect(page.getByLabel("设置模型交接流程")).toBeInViewport();
    await expect(page.getByTestId("composer")).toBeInViewport();
    const mainBox = await page.locator("main.main").boundingBox();
    const composerBox = await page.locator(".composer__surface").boundingBox();
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width);
    const steps = page.getByLabel("模型交接流程", { exact: true });
    expect(await steps.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("conversation-layout-narrow.png") });
    await harness.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(1480, 980),
    );

    await page.getByLabel("设置模型交接流程").click();
    await page
      .getByLabel("阶段 1 模型", { exact: true })
      .selectOption("workflow-fixture/gpt-6.1-sol");
    await page
      .getByLabel("阶段 2 模型", { exact: true })
      .selectOption("workflow-fixture/gpt-6-astra");
    await page.getByLabel("阶段 2 目标", { exact: true }).fill("验证 BLUE-72 的资料来源");
    await page.getByLabel("阶段 2 交付物", { exact: true }).fill("交付有出处的对照表");
    await page.locator(".workflow-editor__stage").nth(1).locator("summary").click();
    await page
      .getByRole("group", { name: "阶段 2 技能", exact: true })
      .getByLabel("workflow-proof", { exact: true })
      .check();
    await page.screenshot({ path: test.info().outputPath("workflow-editor.png") });
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await page.getByLabel("交接阶段 2：学习拆解", { exact: true }).click();
    await expect(page.getByLabel("交接阶段 2：学习拆解", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("composer").fill("保留未发送的草稿");
    await expect
      .poll(async () => (await getDesktopState(page)).composerDraft)
      .toBe("保留未发送的草稿");
    await page.getByRole("button", { name: "载入任务", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("输入框已有草稿");
    await expect(page.getByTestId("composer")).toHaveValue("保留未发送的草稿");
    await page.getByTestId("composer").fill("");
    await expect.poll(async () => (await getDesktopState(page)).composerDraft).toBe("");
    await page.getByRole("button", { name: "载入任务", exact: true }).click();
    await expect(page.getByTestId("composer")).toHaveValue(/^\/skill:workflow-proof /);
    await page.getByTestId("composer").press("Enter");
    await expect(page.locator(".process-assistant").last()).toContainText(
      "MODEL=gpt-6-astra TURNS=2",
    );
    await expect(page.locator(".process-assistant").last()).toContainText("BLUE-72");
    await expect(page.locator(".process-assistant").last()).toContainText(
      "WORKFLOW_SKILL_EXPANDED_89",
    );
    await expect(page.locator(".process-assistant").last()).toContainText("交付有出处的对照表");
    for (const mode of ["Competitor research", "Paper lookup", "GitHub research"])
      await create(page, mode, `${mode}独立会话`);
    await expect(page.locator(".lhc")).toHaveCount(5);
    await expect(page.locator("[data-tree-rail]")).toHaveCount(5);
    const fits = await page
      .locator(".process-tree-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(fits).toBe(false);
    const selectedBeforeFocus = (await getDesktopState(page)).selectedSessionId;
    await page.getByTestId("process-focus-tree").click();
    await expect(page.locator(".lhc")).toHaveCount(1);
    await expect(page.locator("[data-tree-rail]")).toHaveCount(1);
    await expect(page.getByTestId("process-focus-tree")).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () =>
        page.locator("[data-tree-rail]").evaluate((rail) => {
          const svg = rail.closest("svg")!;
          const x = Number(rail.getAttribute("d")?.match(/^M([\d.]+)/)?.[1]);
          return Math.abs(x - svg.getBoundingClientRect().width / 2);
        }),
      )
      .toBeLessThan(2);
    expect((await getDesktopState(page)).selectedSessionId).toBe(selectedBeforeFocus);
    await page.getByTestId("process-global-flow").click();
    await expect(page.locator(".lhc")).toHaveCount(5);
    expect((await getDesktopState(page)).selectedSessionId).toBe(selectedBeforeFocus);
    await page.getByTestId("process-focus-tree").click();
    await page.getByRole("button", { name: "Video re-creation", exact: true }).click();
    await expect(page.getByLabel("交接阶段 2：学习拆解", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".lhc")).toHaveCount(1);
    await expect(page.locator(".lhc")).toHaveAttribute("data-current", "true");
    await page.screenshot({ path: test.info().outputPath("module-workflow-focused-tree.png") });
    await page.getByTestId("process-global-flow").click();
    await expect(page.locator(".lhc")).toHaveCount(5);
    await page.screenshot({ path: test.info().outputPath("module-workflow-all-trees.png") });
    await page.getByRole("button", { name: "总览", exact: true }).click();
    await expect(page.getByRole("button", { name: "正常间距", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "正常间距", exact: true }).click();
    await page
      .getByLabel("模型图标预览")
      .getByRole("button", { name: "Gemini", exact: true })
      .click();
    await expect(page.getByLabel("Select model", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("model-catalog.png") });
    await page.keyboard.press("Escape");
    await page.getByLabel(/^管理会话：/).click();
    await page.getByLabel("会话名称", { exact: true }).fill("保留上下文的制作流程");
    await page.getByRole("button", { name: "保存会话", exact: true }).click();
    await page.getByLabel("Archive 保留上下文的制作流程", { exact: true }).click();
    await expect(page.locator("[data-tree-rail]")).toHaveCount(4);
    await page.locator(".archived-thread-group__toggle").click();
    await page.getByLabel(/^Restore .*保留上下文的制作流程$/).click();
    await expect
      .poll(
        async () =>
          (await getDesktopState(page)).workspaces
            .flatMap((w) => w.sessions)
            .find((s) => s.id === video)?.archivedAt,
      )
      .toBeUndefined();
    await page.getByRole("button", { name: "Video re-creation", exact: true }).click();
    await expect(page.locator(".process-assistant").last()).toContainText("BLUE-72");
    expect((await getDesktopState(page)).selectedSessionId).toBe(video);
    const ids = (await getDesktopState(page)).workspaces
      .flatMap((w) => w.sessions.map((s) => s.id))
      .sort();
    await harness.close();
    harness = await launch();
    const restarted = await harness.firstWindow();
    await expect(restarted.getByLabel("交接阶段 2：学习拆解", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(restarted.locator("[data-tree-rail]")).toHaveCount(5);
    await restarted.getByLabel("设置模型交接流程").click();
    await expect(restarted.getByLabel("阶段 2 目标", { exact: true })).toHaveValue(
      "验证 BLUE-72 的资料来源",
    );
    await expect(restarted.getByLabel("阶段 2 交付物", { exact: true })).toHaveValue(
      "交付有出处的对照表",
    );
    await restarted.locator(".workflow-editor__stage").nth(1).locator("summary").click();
    await expect(
      restarted
        .getByRole("group", { name: "阶段 2 技能", exact: true })
        .getByLabel("workflow-proof", { exact: true }),
    ).toBeChecked();
    await restarted.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      (await getDesktopState(restarted)).workspaces
        .flatMap((w) => w.sessions.map((s) => s.id))
        .sort(),
    ).toEqual(ids);
    await expect(restarted.locator("[data-flight-head], [data-flight-landing]")).toHaveCount(0);
    await restarted.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await restarted.getByRole("button", { name: "Appearance", exact: true }).click();
    await restarted.getByRole("radio", { name: "Dark", exact: true }).click();
    await restarted.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(restarted.getByTestId("lancer-process-surface")).toBeVisible();
    await expect(restarted.locator("html")).toHaveClass(/dark/);
    await restarted.screenshot({ path: test.info().outputPath("module-workflow-dark.png") });
    await harness.electronApp.evaluate(
      ({ BrowserWindow }, url) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === url)
          ?.setSize(1100, 800),
      restarted.url(),
    );
    await expect.poll(() => restarted.evaluate(() => innerWidth)).toBe(1100);
    await expect(restarted.getByTestId("module-workflow")).toBeVisible();
    await restarted.screenshot({ path: test.info().outputPath("module-workflow-1100.png") });
    await restarted.getByLabel("管理会话：保留上下文的制作流程", { exact: true }).click();
    await restarted.getByLabel("会话类型", { exact: true }).selectOption("chat");
    await restarted.getByRole("button", { name: "保存会话", exact: true }).click();
    await expect(restarted.getByTestId("module-workflow")).toHaveCount(0);
    await expect(restarted.locator(".process-assistant").last()).toContainText("BLUE-72");
  } finally {
    await harness.close();
  }
});
