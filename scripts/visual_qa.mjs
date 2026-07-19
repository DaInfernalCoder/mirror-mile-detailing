import { chromium } from "/Users/sumit/.agents/skills/web-clone/node_modules/playwright-core/index.mjs";
import fs from "node:fs/promises";

const base = (process.env.BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const output = process.env.QA_OUTPUT || "/private/tmp/mirrormile-visual-qa";

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const failures = [];

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["tablet", { width: 1024, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const externalRequests = [];

  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText || "failed"}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.hostname.match(/^(127\.0\.0\.1|localhost)$/)) externalRequests.push(request.url());
  });

  const response = await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.querySelectorAll('img[loading="lazy"]').forEach((image) => {
      image.loading = "eager";
      image.removeAttribute("loading");
    });
  });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);

  await page.evaluate(async () => {
    const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await delay(45);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);

  if (!response?.ok()) failures.push(`${size}: HTTP ${response?.status()}`);
  const checks = await page.evaluate(() => {
    const header = document.querySelector(".site-header");
    const navLink = document.querySelector(".site-nav > a");
    const callButton = document.querySelector(".nav-actions .button-call");
    const images = [...document.images];
    return {
      h1: document.querySelectorAll("h1").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title,
      headerBackground: getComputedStyle(header).backgroundColor,
      headerHeight: header.getBoundingClientRect().height,
      navColor: navLink ? getComputedStyle(navLink).color : null,
      callBackground: callButton ? getComputedStyle(callButton).backgroundColor : null,
      callColor: callButton ? getComputedStyle(callButton).color : null,
      callLinks: document.querySelectorAll('a[href="tel:+18323583048"]').length,
      bookLinks: document.querySelectorAll('a[href="https://cal.com/sumitdatta/auto-detail-service"]').length,
      forms: document.querySelectorAll("form").length,
      emailLinks: document.querySelectorAll('a[href^="mailto:"]').length,
      brokenImages: images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
    };
  });

  if (checks.h1 !== 1) failures.push(`${size}: H1 count ${checks.h1}`);
  if (checks.overflow > 1) failures.push(`${size}: horizontal overflow ${checks.overflow}px`);
  if (!checks.title) failures.push(`${size}: empty title`);
  if (checks.callLinks !== 5) failures.push(`${size}: expected 5 call links, found ${checks.callLinks}`);
  if (checks.bookLinks !== 5) failures.push(`${size}: expected 5 booking links, found ${checks.bookLinks}`);
  if (checks.forms !== 0 || checks.emailLinks !== 0) failures.push(`${size}: public form or email link found`);
  if (checks.brokenImages.length) failures.push(`${size}: broken images ${checks.brokenImages.join(", ")}`);
  if (checks.headerHeight < 70 || checks.headerBackground.includes(", 0)")) failures.push(`${size}: header surface is missing or transparent`);
  if (consoleErrors.length) failures.push(`${size}: console ${consoleErrors.join(" | ")}`);
  if (pageErrors.length) failures.push(`${size}: pageerror ${pageErrors.join(" | ")}`);
  if (failedRequests.length) failures.push(`${size}: failed requests ${failedRequests.join(" | ")}`);
  if (externalRequests.length) failures.push(`${size}: external requests ${externalRequests.join(" | ")}`);

  await page.screenshot({ path: `${output}/home-${size}.png`, fullPage: false });
  await page.screenshot({ path: `${output}/home-${size}-full.png`, fullPage: true });

  if (size !== "desktop") {
    const toggle = page.locator(".menu-toggle");
    await toggle.click();
    const expanded = await toggle.getAttribute("aria-expanded");
    const menuVisible = await page.locator("#site-nav").isVisible();
    const menuCallVisible = await page.locator(".nav-actions .button-call").isVisible();
    const menuBookVisible = await page.locator(".nav-actions .button-book").isVisible();
    if (expanded !== "true" || !menuVisible || !menuCallVisible || !menuBookVisible) {
      failures.push(`${size}: mobile navigation or paired actions did not open visibly`);
    }
    await page.screenshot({ path: `${output}/home-${size}-menu.png`, fullPage: false });
  }

  console.log(JSON.stringify({ size, ...checks }));
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error("VISUAL QA FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`VISUAL QA OK — desktop, tablet, and mobile; screenshots: ${output}`);
