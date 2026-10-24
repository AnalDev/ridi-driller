(async () => {
  const { captureVisibleStoreRecords } = await import(chrome.runtime.getURL("src/store-capture.js"));
  const capture = captureVisibleStoreRecords(document, location.href);
  if (!capture.accepted) return { ok: false, kind: "notPurchasePage", source: capture.source, count: 0 };
  const response = await chrome.runtime.sendMessage({
    cmd: "captureStoreRecords",
    source: capture.source,
    records: capture.records,
  });
  return { ...response, visibleCount: capture.records.length, source: capture.source };
})();
