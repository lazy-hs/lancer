import { test, expect } from "@playwright/test";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  openNewThread,
} from "../helpers/electron-app";

test("Doubao catalog exposes GUI entry without API models and selects its fixed conversation", async () => {
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("doubao-catalog");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  const helper = join(profile, "doubao-catalog-helper.mjs");
  // Native transport fixture only: the renderer, binding owner and IPC remain real.
  await writeFile(
    helper,
    `#!${process.execPath}\nconsole.log(JSON.stringify({ok:true,permission:true,title:'目录直连验证',conversationId:'12345',busy:false,messages:[],hasVideo:false}));\n`,
  );
  await chmod(helper, 0o755);
  const harness = await launchDesktop(profile, {
    agentDir,
    initialWorkspaces: [workspace],
    testMode: "background",
    scrubProviderEnv: true,
    envOverrides: { PI_APP_DOUBAO_HELPER_PATH: helper },
  });
  try {
    const page = await harness.firstWindow();
    await openNewThread(page);
    const family = page
      .getByTestId("model-reel")
      .getByRole("button", { name: "豆包", exact: true });
    await expect(family).toHaveAttribute("title", "豆包 · App direct");
    await family.click();
    const catalog = page.locator(".model-catalog__popover:popover-open");
    await expect(catalog).toContainText("App direct");
    await expect(catalog).not.toContainText("0 models");
    await expect(catalog).not.toContainText("尚未配置");
    await catalog.getByRole("button", { name: "Open Doubao App", exact: true }).click();
    await expect(page.getByTestId("doubao-app-composer")).toBeVisible();
    await expect(family).toHaveAttribute("aria-pressed", "true");
    await family.click();
    await expect(page.getByTestId("catalog-doubao-app")).toHaveAttribute("aria-pressed", "true");
    await expect(catalog).toContainText("current session");
    await page.screenshot({ path: test.info().outputPath("doubao-app-available.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "豆包 App · 切回模型" }).click();
    await expect(family).toHaveAttribute("aria-pressed", "false");
  } finally {
    await harness.close();
  }
});
