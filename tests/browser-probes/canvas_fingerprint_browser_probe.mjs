// 在真实浏览器页面中测量固定 Canvas 图案的像素与文字结果，不读取用户数据。

/** 返回合成图案相对原始像素的变化和文字宽度，供不同启动参数对照。 */
export function inspectCanvasFingerprint() {
  const canvas = document.createElement("canvas")
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return { available: false }

  const image = context.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4
      image.data[index] = (x * 3 + y * 5) % 254
      image.data[index + 1] = (x * 7 + y * 11) % 254
      image.data[index + 2] = (x * 13 + y * 17) % 254
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const first = context.getImageData(0, 0, canvas.width, canvas.height).data
  const second = context.getImageData(0, 0, canvas.width, canvas.height).data
  let changedBytes = 0
  let changedAlpha = 0
  let repeatStable = true
  for (let index = 0; index < image.data.length; index += 1) {
    if (first[index] !== image.data[index]) {
      changedBytes += 1
      if (index % 4 === 3) changedAlpha += 1
    }
    if (first[index] !== second[index]) repeatStable = false
  }
  context.font = "16px Arial"
  return {
    available: true,
    changedBytes,
    changedAlpha,
    repeatStable,
    textWidth: context.measureText("Fingerprint sample AVWX 0123456789").width,
    emptyTextWidth: context.measureText("").width,
  }
}
