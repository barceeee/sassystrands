import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, must } from '../supabase.js'

// Small data-loading hook: const { data, error, loading, reload } = useLoad(() => query, [deps])
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const seq = useRef(0)
  const run = useCallback(async () => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await fn()
      if (id === seq.current) setState({ data, error: null, loading: false })
    } catch (e) {
      if (id === seq.current) setState({ data: null, error: e.message ?? String(e), loading: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}

// PostgREST returns at most 1000 rows per request; page through larger tables.
export async function fetchAll(build, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const rows = await must(build().range(from, from + pageSize - 1))
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
}

// Lookups change rarely; cache them for the session.
let lookupCache = null
export async function loadLookups(force = false) {
  if (lookupCache && !force) return lookupCache
  const [styles, laceTypes, laceSizes, locations, stages] = await Promise.all([
    must(supabase.from('styles').select('*').order('sort_order')),
    must(supabase.from('lace_types').select('*').order('sort_order')),
    must(supabase.from('lace_sizes').select('*').order('sort_order')),
    must(supabase.from('locations').select('*').order('sort_order')),
    must(supabase.from('production_stages').select('*').order('sort_order')),
  ])
  lookupCache = { styles, laceTypes, laceSizes, locations, stages, stageLabel: Object.fromEntries(stages.map((s) => [s.code, s.label])) }
  return lookupCache
}
export const useLookups = () => useLoad(() => loadLookups(), [])

let staffCache = null
export async function loadStaff() {
  if (!staffCache) {
    const rows = await must(supabase.rpc('staff_directory'))
    staffCache = Object.fromEntries(rows.map((r) => [r.id, r.full_name]))
  }
  return staffCache
}
export const useStaff = () => useLoad(() => loadStaff(), []).data ?? {}

export const loadItems = () => fetchAll(() => supabase.from('v_items')
  .select('id, sku, name, category, draw, style, lace_type, lace_size, length_in, variant, unit_price, active')
  .order('category').order('style').order('length_in').order('id'))
