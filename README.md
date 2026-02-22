# Chrome Extension Setup Guide

## How to Load the Extension
1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (toggle in the top right corner).
3.  Click **Load unpacked**.
4.  Select the folder `d:\Coding\peojects\capcha1`.

## How to Test
1.  Drag and drop the file `test_captcha.html` into Chrome to open it.
2.  Click the new extension icon in the toolbar (it might be hidden in the puzzle piece menu).
3.  Click the **Solve CAPTCHA** button in the popup.
4.  Observe that the text "X7Z9A2" is automatically filled into the "Enter CAPTCHA" input field.

## Notes
- This extension is designed for educational purposes and targets specific IDs (`#captcha-text` and `#captcha-input`) found in the test page.
- To use on other sites, you would need to modify `content.js` to target the specific selectors of that site.
