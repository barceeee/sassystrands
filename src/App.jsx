import { lazy, Suspense, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import { PAGE_SKELETONS, skeletonFor } from './components/pageSkeletons.jsx'
import Login from './pages/Login.jsx'
// Pages load on first visit so the first download stays small (Layout shows a loader meanwhile).
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Stock = lazy(() => import('./pages/Stock.jsx'))
const ItemDetail = lazy(() => import('./pages/ItemDetail.jsx'))
const ItemForm = lazy(() => import('./pages/ItemForm.jsx'))
const Movements = lazy(() => import('./pages/Movements.jsx'))
const Counts = lazy(() => import('./pages/Counts.jsx'))
const Bundles = lazy(() => import('./pages/Bundles.jsx'))
const Orders = lazy(() => import('./pages/Orders.jsx'))
const OrderForm = lazy(() => import('./pages/OrderForm.jsx'))
const OrderDetail = lazy(() => import('./pages/OrderDetail.jsx'))
const Production = lazy(() => import('./pages/Production.jsx'))
const Piece = lazy(() => import('./pages/Piece.jsx'))
const Receiving = lazy(() => import('./pages/Receiving.jsx'))
const Labels = lazy(() => import('./pages/Labels.jsx'))
const Scanner = lazy(() => import('./pages/station/Scanner.jsx'))
const Overview = lazy(() => import('./pages/station/Overview.jsx'))
import { homeFor, allowedPath } from './lib/home.js'
const QA = lazy(() => import('./pages/QA.jsx'))
const OrNumbers = lazy(() => import('./pages/OrNumbers.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))
const Imports = lazy(() => import('./pages/Imports.jsx'))
const ImportDetail = lazy(() => import('./pages/ImportDetail.jsx'))
const Lookups = lazy(() => import('./pages/Lookups.jsx'))
const Users = lazy(() => import('./pages/Users.jsx'))
const Account = lazy(() => import('./pages/Account.jsx'))

function Guard({ perm, or, children }) {
  const { can, role } = useAuth()
  return can(perm) || (or && can(or)) ? children : <Navigate to={homeFor(role)} replace />
}

export default function App() {
  const { loading, session, profile, role, signOut } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // Set while the sign-in screen is showing, so the first render after a fresh sign-in goes to the
  // role's home once (a page reload keeps the current URL).
  const justSignedIn = useRef(false)
  useEffect(() => {
    if (session === null) justSignedIn.current = true
    else if (role && justSignedIn.current) {
      justSignedIn.current = false
      navigate(homeFor(role), { replace: true })
    }
  }, [session, role, navigate])
  if (loading) return <div className="content">{skeletonFor(pathname)}</div>
  if (!session) return <Login />
  if (!profile?.active) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>Account not active</h1>
          <p>Your sign-in worked, but this account has no active staff profile. Ask the Owner or an Admin to activate it.</p>
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>
    )
  }
  if (!allowedPath(role, pathname)) return <Navigate to={homeFor(role)} replace />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Suspense fallback={PAGE_SKELETONS.dashboard}><Dashboard /></Suspense>} />
        <Route path="inventory" element={<Guard perm="inventory.view"><Suspense fallback={PAGE_SKELETONS.stock}><Stock /></Suspense></Guard>} />
        <Route path="inventory/items/new" element={<Guard perm="inventory.manage"><Suspense fallback={PAGE_SKELETONS.itemForm}><ItemForm /></Suspense></Guard>} />
        <Route path="inventory/items/:id" element={<Guard perm="inventory.view"><Suspense fallback={PAGE_SKELETONS.itemDetail}><ItemDetail /></Suspense></Guard>} />
        <Route path="inventory/movements" element={<Guard perm="inventory.view"><Suspense fallback={PAGE_SKELETONS.movements}><Movements /></Suspense></Guard>} />
        <Route path="inventory/counts" element={<Guard perm="inventory.view"><Suspense fallback={PAGE_SKELETONS.counts}><Counts /></Suspense></Guard>} />
        <Route path="inventory/bundles" element={<Guard perm="inventory.view"><Suspense fallback={PAGE_SKELETONS.bundles}><Bundles /></Suspense></Guard>} />
        <Route path="orders" element={<Guard perm="orders.view"><Suspense fallback={PAGE_SKELETONS.orders}><Orders /></Suspense></Guard>} />
        <Route path="orders/new" element={<Guard perm="orders.manage"><Suspense fallback={PAGE_SKELETONS.orderForm}><OrderForm /></Suspense></Guard>} />
        <Route path="orders/:id" element={<Guard perm="orders.view"><Suspense fallback={PAGE_SKELETONS.orderDetail}><OrderDetail /></Suspense></Guard>} />
        <Route path="production" element={<Suspense fallback={PAGE_SKELETONS.production}><Production /></Suspense>} />
        <Route path="pieces/:serial" element={<Suspense fallback={PAGE_SKELETONS.piece}><Piece /></Suspense>} />
        <Route path="receiving" element={<Guard perm="receiving.manage"><Suspense fallback={PAGE_SKELETONS.receiving}><Receiving /></Suspense></Guard>} />
        <Route path="labels" element={<Guard perm="receiving.manage" or="station.lead"><Suspense fallback={PAGE_SKELETONS.labels}><Labels /></Suspense></Guard>} />
        <Route path="station" element={<Suspense fallback={PAGE_SKELETONS.scanner}><Scanner /></Suspense>} />
        <Route path="station/overview" element={<Suspense fallback={PAGE_SKELETONS.overview}><Overview /></Suspense>} />
        <Route path="qa" element={<Guard perm="qa.view"><Suspense fallback={PAGE_SKELETONS.qa}><QA /></Suspense></Guard>} />
        <Route path="or-numbers" element={<Guard perm="or.manage"><Suspense fallback={PAGE_SKELETONS.orNumbers}><OrNumbers /></Suspense></Guard>} />
        <Route path="reports" element={<Guard perm="reports.view"><Suspense fallback={PAGE_SKELETONS.reports}><Reports /></Suspense></Guard>} />
        <Route path="imports" element={<Guard perm="imports.manage"><Suspense fallback={PAGE_SKELETONS.imports}><Imports /></Suspense></Guard>} />
        <Route path="imports/:id" element={<Guard perm="imports.manage"><Suspense fallback={PAGE_SKELETONS.importDetail}><ImportDetail /></Suspense></Guard>} />
        <Route path="settings/lookups" element={<Guard perm="lookups.manage"><Suspense fallback={PAGE_SKELETONS.lookups}><Lookups /></Suspense></Guard>} />
        <Route path="users" element={<Guard perm="users.manage"><Suspense fallback={PAGE_SKELETONS.users}><Users /></Suspense></Guard>} />
        <Route path="account" element={<Suspense fallback={PAGE_SKELETONS.account}><Account /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
