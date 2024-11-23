document.getElementById("startTransfer").addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "transfer" });
    document.getElementById("startTransfer").disabled = true;
  });
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.msg) {
    if (request.msg == "success") {
      document.getElementById("startTransfer").disabled = false;
    }

    var now = new Date();
    var options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    var formattedTime = new Intl.DateTimeFormat("zh-CN", options).format(now);
    const li = document.createElement("li");
    li.textContent = `${formattedTime} ${request.msg}`;
    var ul = document.getElementById("logList");
    ul.insertBefore(li, ul.firstChild);
  }
});
