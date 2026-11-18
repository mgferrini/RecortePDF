import { cropOpenTab, readSettings } from "./tab.mjs";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "crop",
      title: "Recortar esta etiqueta a 10×15",
      contexts: ["page", "action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "crop") void run(tab);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "crop-now") return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => run(tab));
});

async function run(tab) {
  const tabId = tab?.id;
  try {
    await cropOpenTab(tab, await readSettings());
    await badge(tabId, "OK", "#1f6b45");
  } catch {
    await badge(tabId, "!", "#c2412d");
  }
}

async function badge(tabId, text, color) {
  if (tabId == null) return;
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
  await chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), 4000);
}
