/* =========================
   ハイブリッド暗号 QR生成
   - AES-GCMで本文暗号化
   - RSA-OAEP(SHA-256)でAES鍵暗号化
   - QR生成
   - 空欄可
   - 簡易レート制限
   ========================= */

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAquM7l1iAsXPiw/WBeBC+
eC2Uzt5PSy/L7XhSvqwoiOQPKiC8aXvsw0+2Nv/yrUu3MB/V0tTprHF9bw5rHPR1
sFJXmPiONEmzOtJyTtCycKHxOn9P3Z/DTwLww2ny7WbGy0DRTHVELJAafZeIHuH6
SocRu32rTo+BDPAwm346E4bhDijX+exnNUAkxCRDEf+VXdG74UyuvCEXUV1Kpkih
cyEEod9dWDIHvz2Y3rksB/z/KI9Wk9vQH8D21MgG5gNUeZS5xdzq/KHVFfqYT5On
lyfQpvAXuZewh325A+RaGXsfEKpL+rjOz5qGHeJaalHLq4eCX5cCrGh92AHozxVL
SQIDAQAB
-----END PUBLIC KEY-----`;

// --------------------
// ユーティリティ関数
// --------------------
function pemToUint8(pem) {
  const b64 = pem.replace(/-----.*?-----/gs, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function uint8ToBase64(u8) {
  return btoa(String.fromCharCode(...u8));
}
function concatUint8Arrays(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// RSA公開鍵のインポート
async function importRsaPublicKey(pem) {
  const der = pemToUint8(pem);
  return crypto.subtle.importKey(
    "spki",
    der.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

// ハイブリッド暗号化関数
async function hybridEncrypt(plainText, publicKeyPem) {
  const rsaKey = await importRsaPublicKey(publicKeyPem);

  // AES-256鍵生成
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawAesKey = new Uint8Array(await crypto.subtle.exportKey("raw", aesKey));

  // RSA-OAEPでAES鍵暗号化
  const encryptedAesKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawAesKey));

  // AES-GCMで本文暗号化
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plainText));
  const cipherUint8 = new Uint8Array(cipherBuf);

  // ペイロード: version(1) + keylen(2) + encryptedKey + iv + cipher
  const version = new Uint8Array([0x01]);
  const keyLen = encryptedAesKey.length;
  const keyLenBytes = new Uint8Array([ (keyLen >> 8) & 0xff, keyLen & 0xff ]);
  const payload = concatUint8Arrays(version, keyLenBytes, encryptedAesKey, iv, cipherUint8);

  return uint8ToBase64(payload);
}

// --------------------
// 簡易レート制限（クライアント側）
// --------------------
const COOLDOWN_MS = 500;   // 0.5秒間隔
const MAX_PER_DAY = 500;     // 日次上限
let lastGeneratedAt = 0;

function canGenerate() {
  const now = Date.now();
  if (now - lastGeneratedAt < COOLDOWN_MS) return { ok: false, reason: "COOLDOWN" };
  const today = new Date().toISOString().slice(0,10);
  const data = JSON.parse(localStorage.getItem("qrRateLimit") || "{}");
  if (data.date !== today) return { ok: true };
  if ((data.count || 0) >= MAX_PER_DAY) return { ok: false, reason: "DAILY_LIMIT" };
  return { ok: true };
}

function recordGeneration() {
  lastGeneratedAt = Date.now();
  const today = new Date().toISOString().slice(0,10);
  const data = JSON.parse(localStorage.getItem("qrRateLimit") || "{}");
  const count = (data.date === today ? (data.count||0) + 1 : 1);
  localStorage.setItem("qrRateLimit", JSON.stringify({ date: today, count }));
}

// --------------------
// フォーム送信処理
// --------------------
document.getElementById("qrForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const check = canGenerate();
  if (!check.ok) {
    if (check.reason === "COOLDOWN") return alert("QR生成は数秒ごとに制限されています。少し待ってください。");
    if (check.reason === "DAILY_LIMIT") return alert("本日のQR生成上限に達しました。");
  }

  // 空欄許可
  let lastName = document.getElementById("lastNameInput")?.value.trim() || "";
  let firstName = document.getElementById("firstNameInput")?.value.trim() || "";
  let lastKana = document.getElementById("lastNameKanaInput")?.value.trim() || "";
  let firstKana = document.getElementById("firstNameKanaInput")?.value.trim() || "";
  let addr1 = document.getElementById("address1Input")?.value.trim() || "";
  let addr2 = document.getElementById("address2Input")?.value.trim() || "";
  let phone = document.getElementById("phoneInput")?.value.trim() || "";

	// 住所の半角カンマを全角に変換
	addr1 = addr1.replace(/,/g, "，");
	addr2 = addr2.replace(/,/g, "，");

	//電話番のハイフンを除去
	phone = phone.replace(/[-－]/g, "");

  // JSON化して短くまとめる
  const plain = [lastName, firstName, lastKana, firstKana, addr1, addr2, phone].join(",");

  try {
    const base64Payload = ">" + (await hybridEncrypt(plain, PUBLIC_KEY_PEM)) + "<";
	//const base91Payload = Base91.encode(payload); // ← Base64の代わりにBase91

	
    // QR生成
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    const canvas = document.createElement("canvas");
    //await QRCode.toCanvas(canvas, plain, { width: 320, errorCorrectionLevel: "L" });
    await QRCode.toCanvas(canvas, base64Payload, { width: 320, errorCorrectionLevel: "L" });
    qrContainer.appendChild(canvas);


	  // 文字列表示（デバッグ用）
	let textDiv = document.getElementById("qrText");
	if (!textDiv) {
		textDiv = document.createElement("div");
		textDiv.id = "qrText";
		textDiv.style.wordBreak = "break-all"; // 長い文字列を折り返す
		textDiv.style.marginTop = "1rem";
		qrContainer.appendChild(textDiv);
	}
	textDiv.textContent = base64Payload;

    // ダウンロードボタン
    const downloadBtn = document.getElementById("downloadBtn");
    downloadBtn.style.display = "inline-block";
    downloadBtn.onclick = () => {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "qrcode.png";
      link.click();
    };

    recordGeneration();
  } catch (err) {
    console.error(err);
    alert("QR生成に失敗しました。開発者コンソールを確認してください。");
  }
});
