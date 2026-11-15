import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

// Code 128 barcode as SVG. Handheld scanners read it and type the serial followed by Enter.
export default function Barcode({ value, height = 48, width = 1.6, fontSize = 13 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, margin: 0, background: 'transparent' })
  }, [value, height, width, fontSize])
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} />
}
