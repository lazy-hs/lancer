import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

const DOUYIN_URL = "https://v.douyin.com/video/7431908245560173823";

test("video zone shows the missing-downloader gate only in its owning conversation", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("video-learn");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
    // Exercise the missing-tool path even on machines with yt-dlp installed.
    // This Core test must not launch a real download or depend on the host PATH.
    envOverrides: { YT_DLP: join(userDataDir, "missing-yt-dlp") },
  });
  try {
    const window = await harness.firstWindow();
    await window.evaluate(async () => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const state = await app.getState();
        const workspace = state.workspaces[0];
        if (workspace) {
          await app.createSession({
            workspaceId: workspace.id,
            title: "lancer-zone:video|视频分析",
          });
          return;
        }
        await new Promise((resolve) => globalThis.window.setTimeout(resolve, 100));
      }
      throw new Error("workspace was not registered");
    });
    const bar = window.getByTestId("video-learn-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Download → media check → model analysis");
    await expect(bar).not.toContainText("豆包");
    await expect(bar).not.toContainText("Codex");
    await window.getByTestId("video-learn-url").fill(DOUYIN_URL);
    await window.getByTestId("video-learn-submit").click();
    await expect(window.getByTestId("video-learn-status")).toContainText("download.fail");
    await expect(window.getByTestId("video-learn-status")).toContainText("FAILED");
    const active = JSON.parse(
      await readFile(join(workspacePath, "_gates", "active.json"), "utf8"),
    ) as { video_id: string };
    const gate = JSON.parse(
      await readFile(join(workspacePath, "_gates", `download.${active.video_id}.json`), "utf8"),
    ) as { status_code: string; error_code: string; video_id: string };
    expect(gate).toMatchObject({
      video_id: active.video_id,
      status_code: "download.fail",
      error_code: "E_PROBE_MISSING",
    });
    const link = await readFile(
      join(workspacePath, "inbox", "links", `${active.video_id}.url.json`),
      "utf8",
    );
    expect(link).toContain(DOUYIN_URL);
    expect(link).not.toMatch(/请继续学习|please continue learning/);
    await expect(window.getByTestId("video-learn-handoff")).toHaveCount(0);
    await expect(window.getByTestId("video-learn-status")).not.toContainText("已学习");
    for (const step of ["media", "analysis"]) {
      expect(existsSync(join(workspacePath, "_gates", `${step}.${active.video_id}.json`))).toBe(
        false,
      );
    }
    expect(existsSync(join(workspacePath, "learning", active.video_id, "spec.json"))).toBe(false);
    const screenshots = join(
      process.env.LANCER_VIDEO_PASS_OUTPUT ?? ".lancer-task/out/video-pass",
      "gui-submit",
    );
    mkdirSync(screenshots, { recursive: true });
    await window.screenshot({ path: join(screenshots, "download-failed.png") });
    const owner = JSON.parse(
      await readFile(join(workspacePath, "_gates", `owner.${active.video_id}.json`), "utf8"),
    ) as { role: string };
    expect(owner.role).toBe("download");
    await expect(
      window.locator(".process-stage").filter({ hasText: "E_PROBE_MISSING" }).first(),
    ).toBeVisible();
    // Neighboring conversation is fixture setup, not a provider run.
    await window.evaluate(async () => {
      const app = globalThis.window.piApp!;
      const state = await app.getState();
      await app.createSession({
        workspaceId: state.workspaces[0]!.id,
        title: "lancer-zone:research|Independent research",
      });
    });
    await expect(window.getByTestId("video-learn-bar")).toHaveCount(0);
    await expect(
      window.locator(".process-stage").filter({ hasText: "E_PROBE_MISSING" }),
    ).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

// This opt-in replay reads outputs produced by the real media unit/live run. It proves
// persisted gate -> built Electron renderer presentation, not a second provider request.
test("video pass persisted gates show exact failures and verified mock analysis", async () => {
  const casesRoot = process.env.LANCER_VIDEO_PASS_CASES;
  test.skip(!casesRoot, "Requires retained video-pass case artifacts");
  test.setTimeout(180_000);
  const caseFiles = readdirSync(casesRoot!).filter(
    (name) => /^[a-d]-.*\.json$/.test(name) || name === "e-success-mock.json",
  );
  expect(caseFiles.length).toBeGreaterThanOrEqual(6);
  expect(caseFiles).toContain("e-success-mock.json");
  const screenshots = join(casesRoot!, "gui");
  mkdirSync(screenshots, { recursive: true });
  for (const caseFile of caseFiles) {
    const evidence = JSON.parse(await readFile(join(casesRoot!, caseFile), "utf8")) as {
      root: string;
      snapshot: { errorCode: string | null; guiStatus: string };
    };
    const succeeded = caseFile === "e-success-mock.json";
    expect(evidence.snapshot.guiStatus).toBe(succeeded ? "ANALYZED" : "FAILED");
    const workspacePath = await makeWorkspace("video-pass-gui");
    for (const directory of ["_gates", "inbox", "raw", "learning"]) {
      const from = join(evidence.root, directory);
      if (existsSync(from)) cpSync(from, join(workspacePath, directory), { recursive: true });
    }
    const userDataDir = await makeUserDataDir();
    const agentDir = join(userDataDir, "agent");
    await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
    const harness = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
      scrubProviderEnv: true,
    });
    try {
      const window = await harness.firstWindow();
      await window.evaluate(async () => {
        const app = globalThis.window.piApp!;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const workspace = (await app.getState()).workspaces[0];
          if (workspace) {
            await app.createSession({
              workspaceId: workspace.id,
              title: "lancer-zone:video|视频门控回放",
            });
            return;
          }
          await new Promise((resolve) => globalThis.window.setTimeout(resolve, 100));
        }
        throw new Error("workspace was not registered");
      });
      const bar = window.getByTestId("video-learn-bar");
      await expect(bar).not.toContainText("已学习");
      if (succeeded) {
        await expect(bar).toContainText("ANALYZED");
        await expect(bar).not.toContainText("FAILED");
        for (const step of ["download", "media", "analysis"]) {
          await expect(
            bar.locator(`[data-testid="video-learn-stage"][data-status="${step}.ok"]`),
          ).toHaveCount(1);
        }
      } else {
        await expect(bar).toContainText("FAILED");
        await expect(bar).toContainText(evidence.snapshot.errorCode!);
        await expect(bar).not.toContainText("ANALYZED");
        await expect(window.locator('.lhc[data-l="v"] .s')).toContainText("失败");
        await expect(window.locator('.lhc[data-l="v"] .s')).not.toContainText("✓ 完成");
      }
      await window.screenshot({ path: join(screenshots, `${caseFile}.png`) });
    } finally {
      await harness.close();
    }
  }
});
