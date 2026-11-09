const input = document.getElementById("server");
chrome.storage.sync.get({ server: "http://localhost:3000" }, (v) => (input.value = v.server));
document.getElementById("save").onclick = () =>
  chrome.storage.sync.set({ server: input.value.trim() || "http://localhost:3000" }, () => (document.getElementById("ok").textContent = "Saved ✓"));
