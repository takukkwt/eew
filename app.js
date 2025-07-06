// --- 定数定義 ---
const API_EEW = 'https://api.wolfx.jp/jma_eew.json';
const API_EQ_LIST = 'https://api.wolfx.jp/jma_eqlist.json';
const POLLING_INTERVAL_EEW = 1000;
const POLLING_INTERVAL_EQ_LIST = 60000;
const ALERT_STATE_EXPIRATION_MS = 300000; // 5分

// --- 状態管理変数 ---
let currentEventID = null;
let lastPlayedSoundEventID = null;
let leafletMapNormal, leafletMapAlert;
let normalMarkers = [];
let alertEpicenterMarker, alertCircle;

// --- 音声関連 ---
const alertSound = new Audio('./assets/eew-alert.mp3');
const synth = window.speechSynthesis;

// --- DOM要素キャッシュ ---
const DOMElements = {
    normalMode: document.getElementById('normal-mode'),
    alertMode: document.getElementById('alert-mode'),
    eqListTableBody: document.querySelector('#eq-list-table tbody'),
    mapNormal: document.getElementById('map-normal'),
    mapAlert: document.getElementById('map-alert'),
    currentTime: document.getElementById('current-time'),
    alert: {
        title: document.getElementById('alert-title'),
        maxIntensity: document.getElementById('alert-max-intensity'),
        hypocenter: document.getElementById('alert-hypocenter'),
        magnitude: document.getElementById('alert-magnitude'),
        originTime: document.getElementById('alert-origin-time'),
        announcedTime: document.getElementById('alert-announced-time'),
        depth: document.getElementById('alert-depth'),
        latitude: document.getElementById('alert-latitude'),
        longitude: document.getElementById('alert-longitude'),
        warnAreaList: document.getElementById('warn-area-list'),
        eventId: document.getElementById('alert-event-id'),
        serial: document.getElementById('alert-serial'),
        accEpicenter: document.getElementById('alert-acc-epicenter'),
        accDepth: document.getElementById('alert-acc-depth'),
        accMagnitude: document.getElementById('alert-acc-magnitude'),
        maxIntChange: document.getElementById('alert-maxint-change'),
        flags: document.getElementById('area-flags'),
        originalText: document.getElementById('alert-original-text'),
    }
};

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    initMaps();
    restoreState();
    setInterval(fetchEewData, POLLING_INTERVAL_EEW);
    setInterval(fetchEqListData, POLLING_INTERVAL_EQ_LIST);
    setInterval(updateTime, 1000);
    fetchEqListData();
}

function initMaps() {
    // 平常時地図
    leafletMapNormal = L.map(DOMElements.mapNormal).setView([36, 138], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(leafletMapNormal);

    // 警報時地図
    leafletMapAlert = L.map(DOMElements.mapAlert).setView([36, 138], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(leafletMapAlert);
}

// --- APIデータ取得 ---
async function fetchEewData() {
    try {
        const response = await fetch(API_EEW, { cache: 'no-store' });
        const data = response.ok ? await response.json() : null;
        processEewData(data);
    } catch (error) {
        console.error('EEW API fetch error:', error);
        processEewData(null);
    }
}

async function fetchEqListData() {
    try {
        const response = await fetch(API_EQ_LIST, { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json();
            renderNormalMode(data);
        }
    } catch (error) {
        console.error('EQ List API fetch error:', error);
    }
}

// --- モード切替ロジック ---
function processEewData(data) {
    const isValidAlert = data && data.EventID && !data.isTraining;

    if (isValidAlert) {
        if (currentEventID !== data.EventID) {
            handleNewAlert(data);
        }
        currentEventID = data.EventID;
        renderAlertMode(data);
        switchToAlertMode();
        saveState(data);
    } else {
        if (currentEventID !== null) {
            clearState();
        }
        currentEventID = null;
        switchToNormalMode();
    }
}

function switchToAlertMode() {
    if (DOMElements.normalMode.style.display !== 'none') {
        DOMElements.normalMode.style.display = 'none';
        DOMElements.alertMode.style.display = 'grid';
        DOMElements.alertMode.classList.add('active');
        leafletMapAlert.invalidateSize();
    }
}

function switchToNormalMode() {
    if (DOMElements.alertMode.style.display !== 'none') {
        DOMElements.alertMode.style.display = 'none';
        DOMElements.alertMode.classList.remove('active');
        DOMElements.normalMode.style.display = 'flex';
        leafletMapNormal.invalidateSize();
    }
}

// --- 描画処理 ---
function renderNormalMode(data) {
    const tableBody = DOMElements.eqListTableBody;
    tableBody.innerHTML = '';
    normalMarkers.forEach(marker => marker.remove());
    normalMarkers = [];

    data.forEach(eq => {
        const row = tableBody.insertRow();
        const maxInt = eq.max_int.replace('震度', '');
        row.className = `shindo-${maxInt}`;

        row.insertCell().textContent = eq.time;
        row.insertCell().textContent = eq.name;
        row.insertCell().textContent = eq.magunitude;
        row.insertCell().textContent = maxInt;
        
        const marker = L.marker([eq.latitude, eq.longitude]).addTo(leafletMapNormal);
        marker.bindPopup(`<b>${eq.name}</b><br>M${eq.magunitude} / 最大震度${maxInt}`);
        normalMarkers.push(marker);

        row.addEventListener('mouseover', () => {
            leafletMapNormal.setView([eq.latitude, eq.longitude], 8);
            marker.openPopup();
        });
    });
}

function renderAlertMode(data) {
    const el = DOMElements.alert;
    el.title.textContent = data.Title || '---';
    el.maxIntensity.textContent = `最大震度 ${data.MaxIntensity || '---'}`;
    el.hypocenter.textContent = data.Hypocenter || '---';
    el.magnitude.textContent = `M${data.Magunitude || '---'}`;
    el.originTime.textContent = data.OriginTime || '---';
    el.announcedTime.textContent = data.AnnouncedTime || '---';
    el.depth.textContent = data.Depth ? `${data.Depth}km` : '---';
    el.latitude.textContent = data.Latitude || '---';
    el.longitude.textContent = data.Longitude || '---';
    el.eventId.textContent = data.EventID || '---';
    el.serial.textContent = data.Serial ? `#${data.Serial}` : '---';
    el.accEpicenter.textContent = data.Accuracy?.Epicenter || '---';
    el.accDepth.textContent = data.Accuracy?.Depth || '---';
    el.accMagnitude.textContent = data.Accuracy?.Magnitude || '---';
    el.maxIntChange.textContent = data.MaxIntChange?.String || '変化なし';
    el.originalText.value = data.OriginalText || '---';

    // 警報地域
    el.warnAreaList.innerHTML = '';
    if (data.WarnArea && data.WarnArea.Chiiki) {
        const fragment = document.createDocumentFragment();
        data.WarnArea.Chiiki.forEach(region => {
            const p = document.createElement('p');
            p.textContent = region;
            fragment.appendChild(p);
        });
        el.warnAreaList.appendChild(fragment);
    }
    
    // フラグ
    el.flags.innerHTML = '';
    const flags = {
        '最終報': data.isFinal, '取消報': data.isCancel, '警報': data.isWarn,
        '海域': data.isSea, '推定': data.isAssumption
    };
    for (const [key, value] of Object.entries(flags)) {
        const badge = document.createElement('span');
        badge.className = `badge ${value ? 'badge-true' : 'badge-false'}`;
        if (key === '取消報' && value) badge.classList.add('badge-cancel');
        badge.textContent = key;
        el.flags.appendChild(badge);
    }

    updateAlertMap(data.Latitude, data.Longitude);
}

// --- 高度な機能 ---
function handleNewAlert(data) {
    if (lastPlayedSoundEventID !== data.EventID && !data.isCancel) {
        alertSound.play().catch(e => console.error("Audio play failed. User interaction might be required.", e));

        const speechText = `緊急地震速報。最大震度${data.MaxIntensity}。震源は、${data.Hypocenter}。マグニチュードは${data.Magunitude}。`;
        const utterance = new SpeechSynthesisUtterance(speechText);
        utterance.lang = 'ja-JP';
        utterance.rate = 1.1;
        synth.speak(utterance);
        
        lastPlayedSoundEventID = data.EventID;
    }
}

function updateAlertMap(lat, lon) {
    if (!lat || !lon) return;
    const position = [lat, lon];
    leafletMapAlert.setView(position, 7);

    if (!alertEpicenterMarker) {
        alertEpicenterMarker = L.marker(position).addTo(leafletMapAlert);
    } else {
        alertEpicenterMarker.setLatLng(position);
    }
    if(!alertCircle) {
        alertCircle = L.circle(position, { radius: 20000, color: 'red' }).addTo(leafletMapAlert);
    } else {
        alertCircle.setLatLng(position);
    }
}

function saveState(data) {
    const state = { data, timestamp: Date.now() };
    localStorage.setItem('eew_alert_state', JSON.stringify(state));
}

function restoreState() {
    const stateJSON = localStorage.getItem('eew_alert_state');
    if (stateJSON) {
        const state = JSON.parse(stateJSON);
        if (Date.now() - state.timestamp < ALERT_STATE_EXPIRATION_MS) {
            processEewData(state.data);
        } else {
            localStorage.removeItem('eew_alert_state');
        }
    }
}

function clearState() {
    localStorage.removeItem('eew_alert_state');
    lastPlayedSoundEventID = null; // 警報が終わったら次の警報で鳴るようにリセット
}

function updateTime() {
    DOMElements.currentTime.textContent = new Date().toLocaleTimeString('ja-JP');
}
