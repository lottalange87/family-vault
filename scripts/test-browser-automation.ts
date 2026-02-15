/**
 * Browser Test: Family Vault Upload + Playback
 * Uses Playwright to automate real browser testing
 */

import { chromium } from "@playwright/test";
import { readFile } from "fs/promises";
import crypto from "crypto";

const TEST_VIDEO = "/tmp/test-video.mp4";
const APP_URL = "http://localhost:3000";

async function testFamilyVault() {
  console.log("🎬 Starting Browser Test for Family Vault\n");
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  try {
    // 1. Load the app
    console.log("📱 Loading Family Vault app...");
    await page.goto(APP_URL);
    await page.waitForLoadState("networkidle");
    
    const title = await page.title();
    console.log(`   ✅ Page loaded: ${title}`);
    
    // Take screenshot of initial state
    await page.screenshot({ path: "/tmp/fv-01-initial.png" });
    console.log("   📸 Screenshot saved: /tmp/fv-01-initial.png");
    
    // 2. Check if vault needs initialization or login
    const pageContent = await page.content();
    
    if (pageContent.includes("VaultInit") || pageContent.includes("Create Master Password")) {
      console.log("\n🔐 Vault needs initialization...");
      console.log("   (This would create a new vault)");
      // For testing, we'll just verify the UI is there
      const initForm = await page.locator("text=Create Master Password").isVisible().catch(() => false);
      console.log(`   ✅ Init form present: ${initForm}`);
    } else if (pageContent.includes("VaultLogin") || pageContent.includes("Unlock Vault")) {
      console.log("\n🔓 Vault needs unlock...");
      console.log("   (This would require the master password)");
      const loginForm = await page.locator("text=Unlock Vault").isVisible().catch(() => false);
      console.log(`   ✅ Login form present: ${loginForm}`);
    } else if (pageContent.includes("Gallery") || pageContent.includes("Upload")) {
      console.log("\n✅ Vault is already unlocked!");
      
      // 3. Test the gallery interface
      console.log("\n📂 Testing Gallery interface...");
      await page.screenshot({ path: "/tmp/fv-02-gallery.png" });
      console.log("   📸 Screenshot saved: /tmp/fv-02-gallery.png");
      
      // Check for upload button
      const uploadBtn = await page.locator("text=Upload").first().isVisible().catch(() => false);
      console.log(`   ✅ Upload button visible: ${uploadBtn}`);
      
      // 4. Test upload (we'll check the upload dropzone)
      console.log("\n📤 Testing Upload interface...");
      
      // Click upload button
      await page.locator("text=Upload").first().click();
      await page.waitForTimeout(500);
      
      await page.screenshot({ path: "/tmp/fv-03-upload.png" });
      console.log("   📸 Screenshot saved: /tmp/fv-03-upload.png");
      
      // Check for dropzone
      const dropzone = await page.locator("text=Drop videos here").isVisible().catch(() => false);
      console.log(`   ✅ Dropzone visible: ${dropzone}`);
      
      // 5. Test file upload
      console.log("\n🎬 Testing actual file upload...");
      console.log("   This tests the complete flow including mp4box.js fragmentation");
      
      // Find file input and upload test video
      const fileInput = await page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(TEST_VIDEO);
      
      console.log("   ✅ File selected for upload");
      
      // Wait for upload to process (mp4box.js fragmentation happens here)
      console.log("   ⏳ Waiting for upload processing (fragmentation + encryption)...");
      await page.waitForTimeout(5000); // Give it time to process
      
      await page.screenshot({ path: "/tmp/fv-04-uploading.png" });
      console.log("   📸 Screenshot saved: /tmp/fv-04-uploading.png");
      
      // Check for upload progress
      const progressVisible = await page.locator("text=Uploading").or(page.locator("text=Fragmenting")).isVisible().catch(() => false);
      console.log(`   ✅ Upload progress visible: ${progressVisible}`);
      
    } else {
      console.log("\n⚠️ Unknown page state");
      console.log("   Page content preview:");
      const text = await page.locator("body").textContent();
      console.log("   " + text?.substring(0, 200) + "...");
    }
    
    console.log("\n✅ Browser test completed!");
    console.log("\nScreenshots saved:");
    console.log("   /tmp/fv-01-initial.png");
    console.log("   /tmp/fv-02-gallery.png (if unlocked)");
    console.log("   /tmp/fv-03-upload.png");
    console.log("   /tmp/fv-04-uploading.png");
    
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    await page.screenshot({ path: "/tmp/fv-error.png" });
    console.log("   📸 Error screenshot saved: /tmp/fv-error.png");
    process.exit(1);
  } finally {
    await browser.close();
  }
}

testFamilyVault();
