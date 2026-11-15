import { useEffect, useRef } from 'react'

const REPEAT_IGNORE_MS = 2000
const DETECT_EVERY_MS = 120

function cameraMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow camera access in the browser settings, or use a hardware scanner.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.'
    case 'NotReadableError':
      return 'The camera is in use by another app.'
    default:
      return `The camera could not be started${err?.message ? `: ${err.message}` : '.'}`
  }
}

// True when the browser has a native detector that reads Code 128.
async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats()
    if (!formats.includes('code_128')) return null
    return new window.BarcodeDetector({ formats: ['code_128'] })
  } catch {
    return null
  }
}

// Live camera view that reports Code 128 barcodes. Native BarcodeDetector where it exists, zxing otherwise.
// The same code read again within 2 seconds is ignored (the window slides while the code stays in view).
export default function CameraScanner({ onCode, onError }) {
  const video = useRef(null)
  const handlers = useRef({ onCode, onError })
  useEffect(() => { handlers.current = { onCode, onError } })

  useEffect(() => {
    let stopped = false
    let stream = null
    let controls = null
    let timer = 0
    const last = { code: '', at: 0 }

    const read = (code) => {
      const now = Date.now()
      const repeat = code === last.code && now - last.at < REPEAT_IGNORE_MS
      last.code = code
      last.at = now
      if (!repeat) handlers.current.onCode(code)
    }
    const fail = (err) => { if (!stopped) handlers.current.onError(cameraMessage(err)) }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail({ message: 'this browser or connection does not allow camera access (HTTPS is required)' })
        return
      }
      const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false }
      try {
        const detector = await nativeDetector()
        if (stopped) return
        if (detector) {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
          video.current.srcObject = stream
          await video.current.play()
          const tick = async () => {
            if (stopped) return
            try {
              const found = await detector.detect(video.current)
              if (found[0]?.rawValue) read(found[0].rawValue)
            } catch { /* frame not ready yet */ }
            if (!stopped) timer = setTimeout(tick, DETECT_EVERY_MS)
          }
          tick()
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import('@zxing/browser'), import('@zxing/library'),
          ])
          if (stopped) return
          const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]])
          const reader = new BrowserMultiFormatReader(hints)
          const c = await reader.decodeFromConstraints(constraints, video.current, (result) => {
            if (result) read(result.getText())
          })
          if (stopped) c.stop(); else controls = c
        }
      } catch (err) {
        fail(err)
      }
    }
    start()

    return () => {
      stopped = true
      clearTimeout(timer)
      controls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
      const el = video.current
      el?.srcObject?.getTracks?.().forEach((t) => t.stop())
      if (el) el.srcObject = null
    }
  }, [])

  return <video ref={video} className="camera-view" playsInline muted aria-label="Camera view" />
}
