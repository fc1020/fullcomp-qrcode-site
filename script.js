const form = document.getElementById("qrForm");
const qrContainer = document.getElementById("qrcode");
const downloadBtn = document.getElementById("downloadBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // 各フォームの値を取得
  const name = document.getElementById("nameInput").value.trim();
  const address = document.getElementById("addressInput").value.trim();
  const phone = document.getElementById("phoneInput").value.trim();

  // 入力値をカンマで結合
  const combinedText = [name, address, phone].join(",");

  qrContainer.innerHTML = ""; // 前のQRをクリア

  try {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, combinedText, {
      errorCorrectionLevel: "L",
      width: 256,
    });
    qrContainer.appendChild(canvas);

    downloadBtn.style.display = "inline-block";
    downloadBtn.onclick = () => {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "qrcode.png";
      link.click();
    };
  } catch (err) {
    console.error(err);
    alert("QRコードの生成に失敗しました。文字数を減らしてください。");
  }
});
