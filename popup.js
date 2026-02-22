document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('solveBtn').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "solve_captcha" }, function (response) {
        if (chrome.runtime.lastError) {
          document.getElementById('status').innerText = 'Error: ' + chrome.runtime.lastError.message;
        } else {
          console.log(response);
          if (response && response.status === "success") {
            document.getElementById('status').innerText = 'CAPTCHA Solved!';
          } else {
            document.getElementById('status').innerText = 'Failed or Content Script not ready.';
          }
        }
      });
    });
  });
});
