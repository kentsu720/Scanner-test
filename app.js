// ==========================================================================
// Mobile Inventory Barcode Scanner App Logic (Unique Serial Number Version)
// ==========================================================================

// Global App State
let inventory = [];
let html5QrCode = null;
let currentCameraId = null;
let availableCameras = [];
let isScanning = false;
let isProcessingScan = false; // Flag to lock scanning during modals/cooldowns
let sortOrder = 'latest'; // 'latest' or 'barcode'

// Global OCR & Motion Detection State
let ocrWorker = null;
let isOcrRunning = false;
let prevFrameData = null;
let stillTimeStart = null;
let motionInterval = null;
let lastMotionCheckTime = 0;
const MOTION_THRESHOLD = 15; // Pixel change sensitivity (lower is more sensitive)
const STILL_DURATION = 3000; // Stillness duration required (3 seconds)

// DOM Elements
const scannerStatus = document.getElementById('scanner-status');
const statTotalDevices = document.getElementById('stat-total-devices');
const activeCameraDisplay = document.getElementById('active-camera-display');
const activeCameraName = document.getElementById('active-camera-name');

const btnToggleCamera = document.getElementById('btn-toggle-camera');
const btnToggleTorch = document.getElementById('btn-toggle-torch');
const btnManualInput = document.getElementById('btn-manual-input');
const btnExportTxt = document.getElementById('btn-export-txt');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnClearAll = document.getElementById('btn-clear-all');
const inventoryList = document.getElementById('inventory-list');
const btnSortList = document.getElementById('btn-sort-list');
const laserOverlay = document.getElementById('scanner-laser-overlay');

// Modals
const modalDuplicate = document.getElementById('modal-duplicate-alert');
const duplicateBarcodeText = document.getElementById('duplicate-barcode-text');
const btnDupRescan = document.getElementById('btn-dup-rescan');



const modalEntry = document.getElementById('modal-entry-form');
const entryModalTitle = document.getElementById('entry-modal-title');
const entryForm = document.getElementById('entry-form');
const inputBarcode = document.getElementById('input-barcode');
const btnCloseEntryModal = document.getElementById('btn-close-entry-modal');
const btnCancelEntry = document.getElementById('btn-cancel-entry');

// ==========================================================================
// Web Audio API Audio Synthesizer (Unlocked for iOS/Android Safari & Chrome)
// ==========================================================================
let audioCtx = null;

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Play a silent note to unlock Web Audio on mobile browsers
    if (audioCtx && audioCtx.state === 'suspended') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(0);
        osc.stop(0.01);
        audioCtx.resume().then(() => {
            console.log("Audio Context successfully resumed.");
        }).catch(err => {
            console.error("Failed to resume Audio Context:", err);
        });
    }
}

// Crisp scanner success beep (Sine, High Pitch)
function playScanBeep() {
    try {
        initAudioContext();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        if (!audioCtx) return;
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, audioCtx.currentTime); // 900 Hz high pitch
        
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
        console.error('Audio playback failed', e);
    }
}

// Low-pitched double alert buzzer for duplicate scanned (Sawtooth, Low Pitch)
function playWarningBeep() {
    try {
        initAudioContext();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        if (!audioCtx) return;
        
        const playBeep = (delay, duration) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, audioCtx.currentTime + delay); // 220 Hz warning pitch
            
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(audioCtx.currentTime + delay);
            osc.stop(audioCtx.currentTime + delay + duration);
        };
        
        // Double beep
        playBeep(0, 0.2);
        playBeep(0.25, 0.25);
    } catch (e) {
        console.error('Audio playback failed', e);
    }
}

// ==========================================================================
// Vibrate Feedback
// ==========================================================================
function triggerVibration(pattern) {
    if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
    }
}

// ==========================================================================
// Local Storage & State Management
// ==========================================================================
function loadInventory() {
    const data = localStorage.getItem('inventory');
    if (data) {
        try {
            inventory = JSON.parse(data);
        } catch (e) {
            inventory = [];
        }
    } else {
        inventory = [];
    }
    updateStats();
    renderList();
}

function saveInventory() {
    localStorage.setItem('inventory', JSON.stringify(inventory));
    updateStats();
    renderList();
}

function updateStats() {
    if (statTotalDevices) {
        statTotalDevices.textContent = inventory.length;
    }
}

// ==========================================================================
// UI Rendering
// ==========================================================================
function renderList() {
    inventoryList.innerHTML = '';
    
    if (inventory.length === 0) {
        inventoryList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-qrcode empty-icon"></i>
                <p>尚未登錄任何設備，請開始掃描或手動輸入！</p>
            </div>
        `;
        return;
    }
    
    // Sort items
    let sortedList = [...inventory];
    if (sortOrder === 'latest') {
        sortedList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } else {
        sortedList.sort((a, b) => a.barcode.localeCompare(b.barcode));
    }
    
    sortedList.forEach((item) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'inventory-item';
        
        // Find index in main inventory array for actions
        const mainIndex = inventory.findIndex(invItem => invItem.barcode === item.barcode);
        
        // Check if recently added (within last 5 seconds) to highlight
        const timeDiff = new Date() - new Date(item.timestamp);
        if (timeDiff < 5000 && sortOrder === 'latest') {
            itemEl.classList.add('highlight-new');
        }
        
        const warningIcon = item.isMismatch 
            ? `<span class="mismatch-warning-tag" title="⚠️ 條碼與文字讀取不符！" style="color: var(--danger); font-size: 0.9rem; margin-right: 8px; display: flex; align-items: center;"><i class="fa-solid fa-triangle-exclamation"></i></span>`
            : '';
            
        itemEl.innerHTML = `
            <div class="item-details" style="cursor: default;">
                <div class="item-barcode" style="font-size: 1.05rem;">${escapeHtml(item.barcode)}</div>
            </div>
            <div class="item-actions" style="display: flex; align-items: center;">
                ${warningIcon}
                <button class="item-delete-btn" onclick="deleteItem(${mainIndex})" title="刪除項目">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        
        inventoryList.appendChild(itemEl);
    });
}

// Delete item
window.deleteItem = function(index) {
    if (index >= 0 && index < inventory.length) {
        const item = inventory[index];
        if (confirm(`確定要刪除序號 ${item.barcode} 嗎？`)) {
            inventory.splice(index, 1);
            saveInventory();
        }
    }
};

// ==========================================================================
// Cool-down Mechanism (Prevents continuous scanning of same code)
// ==========================================================================
function startScanCooldown(ms = 3000) {
    isProcessingScan = true;
    
    // Visual indicator: stop laser animation, change hint text
    const laser = document.querySelector('.laser-line');
    const hint = document.querySelector('.scanner-hint');
    
    if (laser) {
        laser.style.background = 'linear-gradient(90deg, transparent, #64748b, transparent)';
        laser.style.boxShadow = 'none';
        laser.style.animationPlayState = 'paused';
    }
    if (hint) {
        hint.textContent = '已暫停掃描，請移開鏡頭...';
        hint.style.color = 'var(--text-secondary)';
    }
    
    setTimeout(() => {
        isProcessingScan = false;
        if (laser) {
            laser.style.background = 'linear-gradient(90deg, transparent, #10b981, transparent)';
            laser.style.boxShadow = '0 0 8px #10b981';
            laser.style.animationPlayState = 'running';
        }
        if (hint) {
            hint.textContent = '請將條碼放入框內進行掃描';
            hint.style.color = 'var(--text-primary)';
        }
    }, ms);
}

// ==========================================================================
// Adding / Editing Logic (Duplicates Detection)
// ==========================================================================
let duplicateItemRef = null; // Store temp reference for duplicate popup

function handleBarcodeScan(barcode, isMismatch = false) {
    if (isProcessingScan) return;
    
    // Check if barcode already exists
    const duplicateIndex = inventory.findIndex(item => item.barcode === barcode);
    
    if (duplicateIndex !== -1) {
        // DUPLICATE DETECTED!
        isProcessingScan = true;
        duplicateItemRef = {
            index: duplicateIndex,
            barcode: barcode
        };
        
        // Sound and Vibration feedback
        playWarningBeep();
        triggerVibration([150, 100, 150]);
        
        // Show warning screen flashes
        laserOverlay.classList.add('warning-flash');
        setTimeout(() => laserOverlay.classList.remove('warning-flash'), 500);
        
        // Display duplicate alert modal
        duplicateBarcodeText.textContent = barcode;
        modalDuplicate.classList.add('open');
    } else {
        // NEW BARCODE
        playScanBeep();
        triggerVibration(100);
        
        // Flash screen green
        laserOverlay.classList.add('success-flash');
        setTimeout(() => laserOverlay.classList.remove('success-flash'), 500);
        
        // Insert new item
        inventory.push({
            barcode: barcode,
            timestamp: new Date().toISOString(),
            isMismatch: isMismatch
        });
        
        saveInventory();
        
        // Engage a 3-second cool-down after a successful scan to let them move the camera!
        startScanCooldown(3000);
    }
}

// Duplicate Actions handlers
btnDupRescan.addEventListener('click', () => {
    closeDuplicateModal();
});

function closeDuplicateModal() {
    modalDuplicate.classList.remove('open');
    duplicateItemRef = null;
    // Engage 3-second cool-down after closing duplicate alert to prevent immediate re-scan
    startScanCooldown(3000);
}

// ==========================================================================
// Camera Scanner Setup (html5-qrcode)
// ==========================================================================
function startScanner() {
    if (isScanning) return;
    
    initAudioContext(); // Pre-init audio context on user interaction
    
    Html5Qrcode.getCameras().then(cameras => {
        availableCameras = cameras;
        if (cameras && cameras.length > 0) {
            // Pick back camera by default if available
            let selectedCamera = cameras[0];
            const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment') || c.label.toLowerCase().includes('後置') || c.label.toLowerCase().includes('後鏡頭') || c.label.toLowerCase().includes('main') || c.label.toLowerCase().includes('camera 0'));
            if (backCam) {
                selectedCamera = backCam;
            }
            
            currentCameraId = selectedCamera.id;
            configureAndStartScanner(currentCameraId);
            
        } else {
            alert("找不到可用的相機鏡頭！");
            scannerStatus.querySelector('.status-text').textContent = '找不到相機';
        }
    }).catch(err => {
        console.error("Unable to query cameras", err);
        scannerStatus.querySelector('.status-text').textContent = '未授權相機權限';
    });
}

function configureAndStartScanner(cameraId) {
    html5QrCode = new Html5Qrcode("interactive-scanner");
    
    const config = {
        fps: 15,
        qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.7;
            return { width: size, height: size * 0.65 };
        },
        aspectRatio: 1.333333 // 4:3
    };
    
    html5QrCode.start(
        cameraId,
        config,
        (decodedText) => {
            // Success callback - route to verification
            handleBarcodeAndOcrVerify(decodedText);
        },
        () => {
            // Error callback (silent)
        }
    ).then(() => {
        isScanning = true;
        scannerStatus.querySelector('.status-dot').className = 'status-dot active';
        scannerStatus.querySelector('.status-text').textContent = '掃描中...';
        
        // Find active camera label
        const activeCamera = availableCameras.find(c => c.id === cameraId);
        if (activeCamera && activeCameraDisplay && activeCameraName) {
            activeCameraName.textContent = activeCamera.label || "未命名鏡頭";
            activeCameraDisplay.style.display = 'flex';
            
            // Check if active camera is back camera
            const activeLabel = (activeCamera.label || "").toLowerCase();
            const isBackCamera = activeLabel.includes('back') || 
                                 activeLabel.includes('environment') || 
                                 activeLabel.includes('後置') || 
                                 activeLabel.includes('後鏡頭') || 
                                 activeLabel.includes('main') ||
                                 activeLabel.includes('camera 0') ||
                                 activeLabel.includes('camera2 0');
            
            let torchSupported = false;
            try {
                const capabilities = html5QrCode.getRunningTrackCapabilities();
                torchSupported = !!(capabilities && capabilities.torch);
            } catch (e) {
                console.warn("Unable to check torch capability", e);
            }
            
            // Enable flashlight ONLY when it's back camera and supported by hardware
            if (isBackCamera && torchSupported) {
                btnToggleTorch.disabled = false;
                btnToggleTorch.classList.remove('disabled');
                btnToggleTorch.title = "開關手電筒";
            } else {
                btnToggleTorch.disabled = true;
                btnToggleTorch.classList.add('disabled');
                btnToggleTorch.title = isBackCamera ? "手電筒不支援此硬體" : "手電筒僅支援後鏡頭";
            }
        }
        
        // Start motion detection for OCR triggering when camera is active!
        startMotionDetection();
    }).catch(err => {
        console.error("Unable to start scanner", err);
        scannerStatus.querySelector('.status-text').textContent = '鏡頭開啟失敗';
    });
}

function stopScanner() {
    if (!isScanning || !html5QrCode) return;
    
    // Stop motion detection when camera is stopped
    stopMotionDetection();
    
    html5QrCode.stop().then(() => {
        isScanning = false;
        scannerStatus.querySelector('.status-dot').className = 'status-dot offline';
        scannerStatus.querySelector('.status-text').textContent = '相機未啟動';
        if (activeCameraDisplay) activeCameraDisplay.style.display = 'none';
    }).catch(err => {
        console.error("Unable to stop scanner", err);
    });
}

// Camera control triggers
btnToggleCamera.addEventListener('click', () => {
    if (!html5QrCode || availableCameras.length <= 1) {
        alert("無其他可用鏡頭切換");
        return;
    }
    
    const currentIndex = availableCameras.findIndex(c => c.id === currentCameraId);
    const nextIndex = (currentIndex + 1) % availableCameras.length;
    const nextCamera = availableCameras[nextIndex];
    
    // Stop motion detection before stopping camera to switch
    stopMotionDetection();
    html5QrCode.stop().then(() => {
        currentCameraId = nextCamera.id;
        configureAndStartScanner(currentCameraId);
    });
});

let torchActive = false;
btnToggleTorch.addEventListener('click', () => {
    if (!html5QrCode || !isScanning || btnToggleTorch.disabled) return;
    
    torchActive = !torchActive;
    html5QrCode.applyVideoConstraints({
        advanced: [{ torch: torchActive }]
    }).then(() => {
        btnToggleTorch.classList.toggle('active', torchActive);
    }).catch(err => {
        console.error("Flashlight control failed", err);
        torchActive = !torchActive;
    });
});

// ==========================================================================
// Suggested Prefix logic for Manual Entry
// ==========================================================================
function getSuggestedPrefix() {
    if (inventory.length === 0) return "";
    
    // 1. If we have multiple items, calculate Longest Common Prefix (LCP)
    if (inventory.length > 1) {
        let arr = inventory.map(item => item.barcode);
        arr.sort();
        let first = arr[0];
        let last = arr[arr.length - 1];
        let i = 0;
        while (i < first.length && first.charAt(i) === last.charAt(i)) {
            i++;
        }
        let lcp = first.substring(0, i);
        if (lcp.length >= 2) {
            return lcp;
        }
    }
    
    // 2. Fallback: Suggest the last scanned item's barcode minus the last 3 characters
    const lastItem = inventory[inventory.length - 1];
    if (lastItem) {
        const code = lastItem.barcode;
        if (code.length > 6) {
            return code.substring(0, code.length - 3);
        }
        return code;
    }
    
    return "";
}

// ==========================================================================
// Manual Entry & Edit Form Modal
// ==========================================================================
function openEntryForm() {
    initAudioContext();
    isProcessingScan = true; // Lock scanning
    
    // Pre-fill input with suggested prefix based on other scanned items
    inputBarcode.value = getSuggestedPrefix();
    inputBarcode.disabled = false;
    
    modalEntry.classList.add('open');
    
    // Auto-focus and place cursor at the end of pre-filled text
    setTimeout(() => {
        inputBarcode.focus();
        const valLen = inputBarcode.value.length;
        inputBarcode.setSelectionRange(valLen, valLen);
    }, 150);
}

function closeEntryModal() {
    modalEntry.classList.remove('open');
    // Enforce 3-second cool-down after modal close to prevent immediate scan triggers
    startScanCooldown(3000);
}

// Modal Form controls
btnManualInput.addEventListener('click', openEntryForm);
btnCloseEntryModal.addEventListener('click', closeEntryModal);
btnCancelEntry.addEventListener('click', closeEntryModal);

// Submit Form (Save entry)
entryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const barcode = inputBarcode.value.trim();
    
    if (!barcode) {
        alert("請輸入設備序號！");
        return;
    }
    
    // Create new item
    // Check if barcode already exists
    const duplicateIndex = inventory.findIndex(item => item.barcode === barcode);
    if (duplicateIndex !== -1) {
        alert(`⚠️ 序號 ${barcode} 已經登錄過！請輸入其他序號。`);
        return; // Don't allow duplicates
    } else {
        // Create brand new
        inventory.push({
            barcode: barcode,
            timestamp: new Date().toISOString()
        });
        saveInventory();
    }
    
    closeEntryModal();
});

// ==========================================================================
// Sort Order Control
// ==========================================================================
btnSortList.addEventListener('click', () => {
    if (sortOrder === 'latest') {
        sortOrder = 'barcode';
        btnSortList.innerHTML = `<i class="fa-solid fa-sort"></i> 序號升序優先`;
    } else {
        sortOrder = 'latest';
        btnSortList.innerHTML = `<i class="fa-solid fa-sort"></i> 時間最晚優先`;
    }
    renderList();
});

// ==========================================================================
// Export Inventory to Text / CSV File
// ==========================================================================
function getExportDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

// 1. Export as Human-readable TXT (ONLY BARCODES, ONE PER LINE)
btnExportTxt.addEventListener('click', () => {
    if (inventory.length === 0) {
        alert("目前沒有設備資料可供匯出！");
        return;
    }
    
    const owner = prompt("請輸入 Owner (設備擁有者名稱)：");
    if (owner === null) {
        return; // User clicked cancel
    }
    const trimmedOwner = owner.trim() || "Owner";
    
    let content = "";
    inventory.forEach((item) => {
        content += `${item.barcode}\r\n`;
    });
    
    const fileName = `${trimmedOwner} x ${inventory.length}_${getExportDate()}.txt`;
    downloadFile(content, fileName, 'text/plain;charset=utf-8');
});

// 2. Export as CSV (Compatible with Excel, uses UTF-8 with BOM, ONLY BARCODES)
btnExportCsv.addEventListener('click', () => {
    if (inventory.length === 0) {
        alert("目前沒有設備資料可供匯出！");
        return;
    }
    
    const owner = prompt("請輸入 Owner (設備擁有者名稱)：");
    if (owner === null) {
        return; // User clicked cancel
    }
    const trimmedOwner = owner.trim() || "Owner";
    
    // CSV header and barcodes
    let csvContent = "設備序號\r\n";
    
    inventory.forEach((item) => {
        const barcode = `"${item.barcode.replace(/"/g, '""')}"`;
        csvContent += `${barcode}\r\n`;
    });
    
    const fileName = `${trimmedOwner} x ${inventory.length}_${getExportDate()}.csv`;
    const blobContent = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blobContent);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================================================
// Clear Data Function
// ==========================================================================
btnClearAll.addEventListener('click', () => {
    if (inventory.length === 0) {
        alert("目前沒有任何設備資料。");
        return;
    }
    
    const confirmClear = confirm("⚠️ 警告：這將會清除所有登錄的設備序號！此動作無法還原，確定要清空嗎？");
    if (confirmClear) {
        inventory = [];
        saveInventory();
        alert("資料已清空。");
    }
});

// ==========================================================================
// Helper Utility Functions
// ==========================================================================
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Function to show Insecure Origin warning
function showInsecureOriginWarning() {
    const scannerViewport = document.getElementById('interactive-scanner');
    if (scannerViewport) {
        scannerViewport.innerHTML = `
            <div class="insecure-warning-card">
                <i class="fa-solid fa-shield-halved warning-icon"></i>
                <h3>瀏覽器相機安全限制</h3>
                <p>因安全規定，行動端瀏覽器在 <b>HTTP (非加密)</b> 連線下禁止調用鏡頭。只有 <b>HTTPS</b> 或 <b>localhost</b> 能開啟相機。</p>
                <div class="solution-box">
                    <h4>💡 快速解決方案：</h4>
                    <ul>
                        <li><strong>Android 手機 (Chrome)</strong>：<br>
                            1. 網址輸入 <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code><br>
                            2. 啟用 (Enabled) 該選項。<br>
                            3. 在文字框填入電腦 IP 網址：<br><code>http://${window.location.host}</code><br>
                            4. 點擊 Relaunch 重啟 Chrome 瀏覽器。
                        </li>
                        <li><strong>iPhone 手機 (Safari)</strong>：<br>
                            iOS 限制極嚴，不支援網址白名單。請點擊下方「手動輸入」進行登錄，或使用 ngrok 等工具將本地伺服器轉為 HTTPS。
                        </li>
                    </ul>
                </div>
            </div>
        `;
    }
}

// ==========================================================================
// PWA Install Promotion Logic for Chrome & Safari
// ==========================================================================
let deferredPrompt = null;

function initPwaInstallPrompt() {
    const installBanner = document.getElementById('pwa-install-banner');
    const btnInstall = document.getElementById('btn-install-pwa');
    const btnClose = document.getElementById('btn-close-banner');
    const installMessage = document.getElementById('install-message');
    const installIcon = installBanner ? installBanner.querySelector('.install-icon') : null;

    if (!installBanner) return;

    // Check if already running in standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
        return; // Don't show banner if already installed
    }

    // Detect iOS Device
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    // Detect Safari Browser specifically on iOS (excluding Chrome/CriOS)
    const isSafari = isIOS && /Safari/i.test(navigator.userAgent) && !/CriOS/i.test(navigator.userAgent) && !/FxiOS/i.test(navigator.userAgent);

    // If iOS Safari
    if (isSafari) {
        // Change text to show manual instructions for Safari
        installMessage.innerHTML = '點擊 Safari 底部的 <i class="fa-solid fa-share-from-square"></i> 分享按鈕，再選擇「<b>加入主畫面</b>」即可安裝為 App！';
        if (btnInstall) btnInstall.style.display = 'none'; // iOS Safari doesn't support programmatic install
        if (installIcon) {
            installIcon.className = 'fa-solid fa-arrow-down install-icon';
            installIcon.style.animation = 'bounce 2s infinite';
            installIcon.style.color = '#3b82f6';
        }
        
        // Show banner if not dismissed previously in this session
        if (localStorage.getItem('pwa-banner-dismissed') !== 'true') {
            installBanner.classList.add('animate-slide-down');
            installBanner.style.display = 'flex';
        }
    }

    // Listen for Chrome / Android beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent default browser banner
        e.preventDefault();
        // Stash the event
        deferredPrompt = e;
        
        // Show our custom banner if not dismissed previously
        if (localStorage.getItem('pwa-banner-dismissed') !== 'true') {
            installBanner.classList.add('animate-slide-down');
            installBanner.style.display = 'flex';
        }
    });

    if (btnInstall) {
        btnInstall.addEventListener('click', () => {
            if (!deferredPrompt) return;
            // Show prompt
            deferredPrompt.prompt();
            // Wait for user choice
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the PWA install prompt');
                } else {
                    console.log('User dismissed the PWA install prompt');
                }
                deferredPrompt = null;
                installBanner.style.display = 'none';
            });
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            installBanner.style.display = 'none';
            // Remember choice in localStorage to prevent annoying user
            localStorage.setItem('pwa-banner-dismissed', 'true');
        });
    }
}

// ==========================================================================
// Tesseract OCR & Camera Motion Detection Fallback
// ==========================================================================

async function initOcr() {
    if (ocrWorker) return ocrWorker;
    try {
        ocrWorker = await Tesseract.createWorker('eng', 1, {
            workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.3/dist/worker.min.js',
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.3',
            langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        });
        console.log("Tesseract OCR Worker initialized successfully.");
        return ocrWorker;
    } catch (e) {
        console.error("Failed to initialize Tesseract worker", e);
        return null;
    }
}

function startMotionDetection() {
    stopMotionDetection(); // Ensure clean state
    prevFrameData = null;
    stillTimeStart = null;
    motionInterval = setInterval(checkCameraMotion, 100); // Check camera frame changes every 100ms
    console.log("Camera motion detection started.");
}

function stopMotionDetection() {
    if (motionInterval) {
        clearInterval(motionInterval);
        motionInterval = null;
    }
    prevFrameData = null;
    stillTimeStart = null;
    console.log("Camera motion detection stopped.");
}

function checkCameraMotion() {
    // If scanning is paused, modal is open, or OCR is actively processing, skip motion detection
    if (!isScanning || isProcessingScan || isOcrRunning) {
        prevFrameData = null;
        stillTimeStart = null;
        return;
    }

    const videoEl = document.querySelector('#interactive-scanner video');
    if (!videoEl || videoEl.readyState < 2) {
        return;
    }

    const now = Date.now();
    // Throttle actual heavy pixel comparisons to 4 times a second (every 250ms)
    if (now - lastMotionCheckTime < 250) {
        return;
    }
    lastMotionCheckTime = now;

    try {
        // Create a tiny canvas to compare frames very quickly with low CPU overhead
        const checkCanvas = document.createElement('canvas');
        checkCanvas.width = 32;
        checkCanvas.height = 24;
        const ctx = checkCanvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, 32, 24);
        const imgData = ctx.getImageData(0, 0, 32, 24).data;

        if (prevFrameData) {
            let totalDiff = 0;
            // Compare RGB channels, skipping alpha channel
            for (let i = 0; i < imgData.length; i += 4) {
                const rDiff = Math.abs(imgData[i] - prevFrameData[i]);
                const gDiff = Math.abs(imgData[i+1] - prevFrameData[i+1]);
                const bDiff = Math.abs(imgData[i+2] - prevFrameData[i+2]);
                totalDiff += (rDiff + gDiff + bDiff) / 3;
            }
            const avgDiff = totalDiff / (imgData.length / 4);

            if (avgDiff > MOTION_THRESHOLD) {
                // Motion detected! Reset the stillness tracker
                stillTimeStart = null;
                
                // Restore original scanner hint if it was altered by OCR notice
                const hint = document.querySelector('.scanner-hint');
                if (hint && hint.textContent.startsWith('🔍')) {
                    hint.textContent = '請將條碼放入框內進行掃描';
                    hint.style.color = 'var(--text-primary)';
                }
            } else {
                // Camera is held still (avgDiff is within threshold)
                if (stillTimeStart === null) {
                    stillTimeStart = now; // Start timing stillness
                } else if (now - stillTimeStart >= STILL_DURATION) {
                    // Camera held still for 3+ seconds! Trigger OCR!
                    stillTimeStart = null; // Clear so we don't trigger repeatedly
                    runOcrOnViewport();
                }
            }
        } else {
            stillTimeStart = now; // Initialize on first frame
        }

        prevFrameData = imgData;
    } catch (e) {
        console.error("Error running camera motion check:", e);
    }
}

async function runOcrOnViewport() {
    if (typeof Tesseract === 'undefined') {
        console.warn("Tesseract library not loaded in index.html yet.");
        return;
    }

    const videoEl = document.querySelector('#interactive-scanner video');
    if (!videoEl || videoEl.readyState < 2) {
        return;
    }

    isOcrRunning = true;

    // Show visual status feedback on UI
    const hint = document.querySelector('.scanner-hint');
    const originalHintText = hint ? hint.textContent : '請將條碼放入框內進行掃描';
    if (hint) {
        hint.textContent = '🔍 正在判讀條碼文字中...';
        hint.style.color = '#3b82f6';
    }

    try {
        const width = videoEl.videoWidth;
        const height = videoEl.videoHeight;

        // Viewfinder size calculations (70% of min dimension)
        const boxSize = Math.min(width, height) * 0.7;
        const boxWidth = boxSize;
        // Viewfinder displays 65% height, we crop 90% vertically to capture text above/below the barcode
        const boxHeight = boxSize * 0.9;

        const cropX = (width - boxWidth) / 2;
        const cropY = (height - boxHeight) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = boxWidth;
        canvas.height = boxHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, cropX, cropY, boxWidth, boxHeight, 0, 0, boxWidth, boxHeight);

        // Pre-initialize Tesseract worker
        const worker = await initOcr();
        if (worker && isScanning && !isProcessingScan) {
            const { data: { text } } = await worker.recognize(canvas);
            console.log("OCR Recognized Text raw output:", text);

            const parsedCode = parseOcrText(text);
            if (parsedCode && isScanning && !isProcessingScan) {
                console.log("OCR Successfully parsed valid serial number:", parsedCode);

                // Trigger green flash feedback
                const laserOverlay = document.getElementById('scanner-laser-overlay');
                if (laserOverlay) {
                    laserOverlay.classList.add('success-flash');
                    setTimeout(() => laserOverlay.classList.remove('success-flash'), 500);
                }

                // Process serial number exactly like barcode
                handleBarcodeScan(parsedCode);
                isOcrRunning = false;
                return;
            }
        }
    } catch (err) {
        console.error("OCR recognition error:", err);
    }

    isOcrRunning = false;

    // Restore UI hint text if OCR did not succeed
    if (hint && isScanning && !isProcessingScan) {
        hint.textContent = originalHintText;
        hint.style.color = 'var(--text-primary)';
    }
}

function parseOcrText(text) {
    if (!text) return "";

    // Split text into lines
    const lines = text.split(/[\n\r]+/);
    let bestCandidate = "";

    for (let line of lines) {
        // Clean line: remove non-alphanumeric and non-dash characters, capitalize
        let clean = line.replace(/[^A-Z0-9-]/gi, "").toUpperCase();

        // Skip common hardware prefixes (SN, S/N, P/N, Part No, Qty, etc.)
        clean = clean.replace(/^(SN|S\/N|SERIAL|NO|NUM|QTY|PART|PN|P\/N)[:\s-]*/g, "");

        // Keep candidates that are at least 5 characters long
        if (clean.length >= 5) {
            // Prefer the longest valid string in the viewfinder
            if (clean.length > bestCandidate.length) {
                bestCandidate = clean;
            }
        }
    }

    return bestCandidate;
}

// ==========================================================================
// Simultaneous Verification & Warning Marker Logic
// ==========================================================================

async function handleBarcodeAndOcrVerify(barcode) {
    if (isProcessingScan) return;
    isProcessingScan = true; // Lock scanning immediately

    // Stop motion detection timer so we don't trigger fallback OCR while verifying
    stillTimeStart = null;

    // Show visual status feedback
    const hint = document.querySelector('.scanner-hint');
    if (hint) {
        hint.textContent = '🔍 正在比對條碼與文字...';
        hint.style.color = '#3b82f6';
    }

    const videoEl = document.querySelector('#interactive-scanner video');
    if (!videoEl || videoEl.readyState < 2 || typeof Tesseract === 'undefined') {
        // Fallback: if no video or Tesseract, log the barcode directly
        isProcessingScan = false;
        handleBarcodeScan(barcode);
        return;
    }

    let isMismatch = false;

    try {
        // 1. Capture the viewfinder frame immediately
        const width = videoEl.videoWidth;
        const height = videoEl.videoHeight;
        const boxSize = Math.min(width, height) * 0.7;
        const boxWidth = boxSize;
        const boxHeight = boxSize * 0.9;
        const cropX = (width - boxWidth) / 2;
        const cropY = (height - boxHeight) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = boxWidth;
        canvas.height = boxHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, cropX, cropY, boxWidth, boxHeight, 0, 0, boxWidth, boxHeight);

        // 2. Run OCR in background
        const worker = await initOcr();
        if (worker) {
            const { data: { text } } = await worker.recognize(canvas);
            const parsedOcr = parseOcrText(text);

            console.log(`Verify: Barcode=${barcode}, OCR=${parsedOcr}`);

            // Clean barcode value for comparison (ignore non-alphanumeric/dash)
            const cleanBarcode = barcode.replace(/[^A-Z0-9-]/gi, "").toUpperCase();

            // If OCR successfully parsed a value, and it differs from the barcode value:
            if (parsedOcr && cleanBarcode !== parsedOcr) {
                isMismatch = true;
                
                // Trigger warning feedback
                playWarningBeep();
                triggerVibration([150, 100, 150]);

                // Flash red briefly
                const laserOverlay = document.getElementById('scanner-laser-overlay');
                if (laserOverlay) {
                    laserOverlay.classList.add('warning-flash');
                    setTimeout(() => laserOverlay.classList.remove('warning-flash'), 500);
                }
            }
        }
    } catch (e) {
        console.error("Error during barcode verification OCR:", e);
    }

    // Restore hint
    if (hint) {
        hint.textContent = '請將條碼放入框內進行掃描';
        hint.style.color = 'var(--text-primary)';
    }

    // Prioritize barcode result, log it directly with the mismatch flag
    isProcessingScan = false;
    handleBarcodeScan(barcode, isMismatch);
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    loadInventory();
    initPwaInstallPrompt(); // Check and prompt for PWA install
    
    // Check if camera API is supported/allowed by the browser
    const isCameraSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const isInsecureOrigin = window.location.protocol === 'http:' && 
                             window.location.hostname !== 'localhost' && 
                             window.location.hostname !== '127.0.0.1';
                             
    if (isInsecureOrigin && !isCameraSupported) {
        showInsecureOriginWarning();
        scannerStatus.querySelector('.status-dot').className = 'status-dot offline';
        scannerStatus.querySelector('.status-text').textContent = '安全限制已封鎖鏡頭';
    } else {
        // Auto-start scanner on page load
        startScanner();
    }
    
    // Register Service Worker for PWA (offline support)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered successfully!', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
    
    // Re-engage and unlock audio context on first screen touch/interaction
    document.body.addEventListener('touchstart', initAudioContext, { once: true });
    document.body.addEventListener('click', initAudioContext, { once: true });
});

// Clean up scanner on page unload
window.addEventListener('beforeunload', () => {
    stopScanner();
});
