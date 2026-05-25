from playwright.sync_api import sync_playwright

def log(msg):
    print(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    console_errors = []
    page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)

    network_errors = []
    page.on("response", lambda resp: network_errors.append(f"{resp.status} {resp.url}") if resp.status >= 400 else None)

    # 1. Login
    log("=== Step 1: Login ===")
    page.goto("http://localhost:5173/login")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)
    page.locator('input[type="text"]').first.fill("admin")
    page.locator('input[type="password"]').first.fill("admin123")
    page.locator('button[type="submit"], .el-button--primary').first.click()
    page.wait_for_timeout(3000)
    log(f"URL after login: {page.url}")

    # 2. Navigate to QA page
    log("\n=== Step 2: Navigate to QA page ===")
    page.goto("http://localhost:5173/langchain/qa")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)

    # Close announcement popup if present
    ann_close = page.locator(".announcement-panel .el-button--primary, .announcement-panel button:has-text('关闭'), .announcement-panel .el-icon--close").first
    if ann_close.is_visible():
        ann_close.click()
        page.wait_for_timeout(500)
        log("Closed announcement popup")

    # Also try the close button in announcement header
    ann_close2 = page.locator(".announcement-panel button").last
    if ann_close2.is_visible():
        ann_close2.click()
        page.wait_for_timeout(500)
        log("Closed announcement (fallback)")

    page.screenshot(path="/tmp/qa_01_initial.png", full_page=True)
    log(f"Page URL: {page.url}")
    assert "/langchain/qa" in page.url, "Not on QA page"

    # 3. Page structure
    log("\n=== Step 3: Page Structure ===")
    for sel, name in [(".qa-sidebar","Sidebar"),(".qa-main","Main"),(".qa-header","Header"),(".qa-input","Input"),(".qa-messages","Messages")]:
        log(f"  {name}: {page.locator(sel).is_visible()}")

    # 4. Sidebar
    log("\n=== Step 4: Sidebar ===")
    conv_count = page.locator(".qa-sidebar__item").count()
    log(f"  Conversations: {conv_count}")

    # 5. New conversation
    log("\n=== Step 5: New Conversation ===")
    page.locator(".new-chat-btn").click()
    page.wait_for_timeout(2000)
    new_count = page.locator(".qa-sidebar__item").count()
    log(f"  After new: {new_count} (was {conv_count})")
    page.screenshot(path="/tmp/qa_02_new_conv.png", full_page=True)

    # 6. Knowledge base selector
    log("\n=== Step 6: Knowledge Base Selector ===")
    kb_btn = page.locator(".kb-select-btn")
    log(f"  Button visible: {kb_btn.is_visible()}")
    kb_btn.click()
    page.wait_for_timeout(1500)
    page.screenshot(path="/tmp/qa_03_kb_dialog.png", full_page=True)

    dialog = page.locator(".el-dialog").last
    if dialog.is_visible():
        tree_count = dialog.locator(".el-tree-node").count()
        log(f"  Tree nodes: {tree_count}")

        enabled_cbs = dialog.locator(".el-checkbox:not(.is-disabled)")
        log(f"  Enabled checkboxes: {enabled_cbs.count()}")

        if enabled_cbs.count() > 0:
            enabled_cbs.first.click()
            page.wait_for_timeout(500)
            log("  Checked first enabled KB")

        confirm = dialog.locator("button:has-text('确'), button:has-text('Confirm')").first
        if confirm.is_visible():
            confirm.click()
            page.wait_for_timeout(1000)
            log("  Confirmed")
        else:
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
    else:
        log("  WARNING: Dialog not visible")

    kb_tags = page.locator(".kb-selected-tags .el-tag")
    log(f"  Selected KB tags: {kb_tags.count()}")
    for i in range(kb_tags.count()):
        log(f"    Tag[{i}]: '{kb_tags.nth(i).inner_text()}'")
    page.screenshot(path="/tmp/qa_04_kb_selected.png", full_page=True)

    # 7. Search params
    log("\n=== Step 7: Search Params ===")
    params_btn = page.locator("text=检索参数")
    if params_btn.is_visible():
        params_btn.click()
        page.wait_for_timeout(800)
        page.screenshot(path="/tmp/qa_05_params.png", full_page=True)

        log(f"  TopK: {page.locator('.params-panel .el-input-number').is_visible()}")
        log(f"  Slider: {page.locator('.params-panel .el-slider').is_visible()}")
        log(f"  Radio: {page.locator('.params-panel .el-radio-group').is_visible()}")

        radio_btns = page.locator(".params-panel .el-radio-button")
        log(f"  Radio buttons: {radio_btns.count()}")
        for i in range(radio_btns.count()):
            log(f"    [{i}] '{radio_btns.nth(i).inner_text()}'")

        switches = page.locator(".params-panel .el-switch")
        log(f"  Switches: {switches.count()}")
        for i in range(switches.count()):
            cls = switches.nth(i).get_attribute("class") or ""
            log(f"    [{i}] checked={'is-checked' in cls}")

        reset = page.locator("text=重置默认")
        if reset.is_visible():
            reset.click()
            page.wait_for_timeout(300)
            log("  Reset clicked")

        page.locator(".qa-header").click()
        page.wait_for_timeout(300)
    else:
        log("  WARNING: params button not found")

    # 8. Example prompts
    log("\n=== Step 8: Example Prompts ===")
    prompts = page.locator(".qa-prompt-btn")
    log(f"  Count: {prompts.count()}")
    for i in range(min(prompts.count(), 4)):
        log(f"    [{i}] '{prompts.nth(i).inner_text()[:60]}'")

    if prompts.count() > 0:
        prompts.first.click()
        page.wait_for_timeout(500)
        val = page.locator(".qa-input textarea").input_value()
        log(f"  After prompt click: '{val[:60]}'")

    # 9. Input area
    log("\n=== Step 9: Input Area ===")
    textarea = page.locator(".qa-input textarea")
    send_btn = page.locator(".qa-input .el-button--primary")
    log(f"  Textarea: visible={textarea.is_visible()}, disabled={textarea.is_disabled()}")
    log(f"  Send btn: visible={send_btn.is_visible()}, disabled={send_btn.is_disabled()}")

    textarea.fill("test question")
    page.wait_for_timeout(300)
    has_kb = kb_tags.count() > 0
    log(f"  Send btn disabled (text=yes, KB={has_kb}): {send_btn.is_disabled()}")

    # 10. Send question
    log("\n=== Step 10: Send Question ===")
    if has_kb:
        textarea.fill("GB/T 50265 中对泵站厂房的防火要求有哪些？")
        page.wait_for_timeout(300)

        # Close any remaining overlays
        overlays = page.locator(".el-overlay, .announcement-panel")
        for i in range(overlays.count()):
            if overlays.nth(i).is_visible():
                overlays.nth(i).evaluate("el => el.style.display = 'none'")

        send_btn.click(force=True)
        page.wait_for_timeout(3000)
        page.screenshot(path="/tmp/qa_06_sent.png", full_page=True)

        log(f"  User msgs: {page.locator('.qa-message.user').count()}")
        log(f"  Asst msgs: {page.locator('.qa-message.assistant').count()}")

        log("  Waiting 25s for answer...")
        page.wait_for_timeout(25000)
        page.screenshot(path="/tmp/qa_07_answer.png", full_page=True)

        log(f"  Asst msgs: {page.locator('.qa-message.assistant').count()}")
        log(f"  Sources: {page.locator('.qa-message__sources').count()}")
        log(f"  Processing: {page.locator('.qa-message__processing').count()}")
        log(f"  Failed: {page.locator('.qa-message__failed').count()}")

        asst = page.locator(".qa-message.assistant")
        if asst.count() > 0:
            content = asst.last.locator(".qa-message__content").inner_text()[:300]
            log(f"  Last asst: '{content}'")
    else:
        log("  Skipping: no KB selected")

    # 11. Conversation switching
    log("\n=== Step 11: Conversation Switching ===")
    conv_items = page.locator(".qa-sidebar__item")
    if conv_items.count() > 1:
        log(f"  Switching from conv with {page.locator('.qa-message').count()} msgs")
        conv_items.nth(1).click()
        page.wait_for_timeout(2000)
        log(f"  After switch: {page.locator('.qa-message').count()} msgs")
        page.screenshot(path="/tmp/qa_08_switched.png", full_page=True)
    else:
        log(f"  Only {conv_items.count()} conv(s), skip")

    # 12. Delete conversation
    log("\n=== Step 12: Delete Conversation ===")
    conv_items = page.locator(".qa-sidebar__item")
    if conv_items.count() > 0:
        conv_items.first.hover()
        page.wait_for_timeout(500)
        del_btn = conv_items.first.locator(".qa-sidebar__item-delete")
        if del_btn.is_visible():
            del_btn.click()
            page.wait_for_timeout(800)
            msgbox = page.locator(".el-message-box")
            if msgbox.is_visible():
                log("  Confirm dialog appeared")
                msgbox.locator("button:has-text('取消')").click()
                page.wait_for_timeout(300)
                log("  Cancelled")
            else:
                log("  WARNING: No confirm dialog")
        else:
            log("  Delete btn not visible after hover")
    else:
        log("  No conversations to test")

    # 13. Remove KB tag
    log("\n=== Step 13: Remove KB Tag ===")
    kb_tags = page.locator(".kb-selected-tags .el-tag")
    if kb_tags.count() > 0:
        tag_text = kb_tags.first.inner_text()
        close = kb_tags.first.locator(".el-tag__close")
        if close.is_visible():
            close.click()
            page.wait_for_timeout(500)
            log(f"  Removed '{tag_text}', remaining: {page.locator('.kb-selected-tags .el-tag').count()}")
        else:
            log("  Close btn not visible")
    else:
        log("  No tags to remove")

    # Final
    page.screenshot(path="/tmp/qa_final.png", full_page=True)

    log("\n=== Console Errors ===")
    if console_errors:
        for e in console_errors[:20]:
            log(f"  {e}")
    else:
        log("  None")

    log("\n=== Network Errors (4xx/5xx) ===")
    if network_errors:
        for e in network_errors[:20]:
            log(f"  {e}")
    else:
        log("  None")

    browser.close()

log("\n=== TEST COMPLETE ===")
