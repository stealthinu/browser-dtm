import { launchChrome, waitReady } from "./chrome.js";

async function main(): Promise<void> {
  const b = await launchChrome();
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE", m.text());
  });
  try {
    await waitReady(p, "http://127.0.0.1:5300/");
    console.log("READY", await p.evaluate(() => !!(window as unknown as { __browserDtm?: unknown }).__browserDtm));
    console.log(
      "STATUS",
      await p.evaluate(
        () => (window as unknown as { __browserDtm: { getStatus: () => string } }).__browserDtm.getStatus(),
      ),
    );
  } catch (e) {
    console.log("FAIL", e);
    console.log((await p.content()).slice(0, 800));
  }
  await b.close();
}

main();
