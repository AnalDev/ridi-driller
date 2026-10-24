(async () => {
  const { collectReadingNotes } = await import(chrome.runtime.getURL("src/reading-notes.js"));
  let timer = null;
  let lastSignature = "";

  async function capture() {
    const records = collectReadingNotes(document);
    const signature = records.map((record) => record.key).join("|");
    if (!records.length || signature === lastSignature) return;
    lastSignature = signature;
    await chrome.runtime.sendMessage({ cmd: "captureReadingNotes", records }).catch(() => null);
  }

  function scheduleCapture() {
    clearTimeout(timer);
    timer = setTimeout(() => void capture(), 300);
  }

  scheduleCapture();
  new MutationObserver(scheduleCapture).observe(document.body, { childList: true, subtree: true });
})();
