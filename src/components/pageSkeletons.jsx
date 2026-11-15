import { SkeletonPage } from './Skeleton.jsx'

// One loader per page, laid out like that page (same blocks, same order), used while the page's
// code downloads and while a page that loads as a whole fetches its data.
const t = (cols = 5, rows = 6) => ({ type: 'table', cols, rows })
const f = (fields = 4) => ({ type: 'form', fields })
const s = (count = 4) => ({ type: 'stats', count })

export const PAGE_SKELETONS = {
  dashboard: <SkeletonPage blocks={[s(4), s(5), t(3, 5), t(4, 5)]} />,
  stock: <SkeletonPage action blocks={[f(4), t(7, 8)]} />,
  itemForm: <SkeletonPage blocks={[f(8)]} />,
  itemDetail: <SkeletonPage action blocks={[s(4), f(4), t(6, 6), t(5, 4), f(3)]} />,
  movements: <SkeletonPage blocks={[f(5), t(7, 8)]} />,
  counts: <SkeletonPage blocks={[t(6, 8), f(5)]} />,
  bundles: <SkeletonPage blocks={[t(5, 6), f(4)]} />,
  orders: <SkeletonPage action blocks={[{ type: 'tabs', count: 7 }, t(6, 8)]} />,
  orderForm: <SkeletonPage blocks={[f(5)]} />,
  orderDetail: <SkeletonPage action blocks={[t(8, 4), t(4, 3), t(5, 2), f(4)]} />,
  production: <SkeletonPage blocks={[s(6), t(6, 8)]} />,
  piece: <SkeletonPage action blocks={[{ type: 'details', count: 4 }, t(6, 5)]} />,
  receiving: <SkeletonPage blocks={[f(2), t(4, 5)]} />,
  labels: <SkeletonPage action blocks={[{ type: 'labels', count: 6 }]} />,
  scanner: <SkeletonPage subtitle={false} blocks={[{ type: 'scanner' }]} />,
  overview: <SkeletonPage action blocks={[s(5), t(6, 5), t(4, 4)]} />,
  qa: <SkeletonPage blocks={[t(5, 4), t(5, 3), t(5, 5)]} />,
  orNumbers: <SkeletonPage blocks={[t(6, 8), f(4)]} />,
  reports: <SkeletonPage blocks={[{ type: 'tabs', count: 6 }, s(4), t(6, 8)]} />,
  imports: <SkeletonPage blocks={[f(2), t(5, 5)]} />,
  importDetail: <SkeletonPage action blocks={[s(4), t(5, 6)]} />,
  lookups: <SkeletonPage blocks={[t(4, 8)]} />,
  users: <SkeletonPage blocks={[t(6, 6), f(5)]} />,
  account: <SkeletonPage blocks={[{ type: 'details', count: 3 }, f(3)]} />,
}

// The loader for a URL, used while the app is still checking who is signed in.
const ROUTES = [
  [/^\/inventory\/items\/new/, 'itemForm'], [/^\/inventory\/items\//, 'itemDetail'], [/^\/inventory\/movements/, 'movements'],
  [/^\/inventory\/counts/, 'counts'], [/^\/inventory\/bundles/, 'bundles'], [/^\/inventory/, 'stock'],
  [/^\/orders\/new/, 'orderForm'], [/^\/orders\//, 'orderDetail'], [/^\/orders/, 'orders'],
  [/^\/production/, 'production'], [/^\/pieces\//, 'piece'], [/^\/receiving/, 'receiving'], [/^\/labels/, 'labels'],
  [/^\/station\/overview/, 'overview'], [/^\/station/, 'scanner'], [/^\/qa/, 'qa'], [/^\/or-numbers/, 'orNumbers'],
  [/^\/reports/, 'reports'], [/^\/imports\//, 'importDetail'], [/^\/imports/, 'imports'], [/^\/settings\/lookups/, 'lookups'],
  [/^\/users/, 'users'], [/^\/account/, 'account'],
]
export const skeletonFor = (pathname) => PAGE_SKELETONS[ROUTES.find(([re]) => re.test(pathname))?.[1] ?? 'dashboard']
