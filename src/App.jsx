import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import { Forbidden, Loading } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Stock from './pages/Stock.jsx'
import ItemDetail from './pages/ItemDetail.jsx'
import ItemForm from './pages/ItemForm.jsx'
import Movements from './pages/Movements.jsx'
import Counts from './pages/Counts.jsx'
import Bundles from './pages/Bundles.jsx'
import Orders from './pages/Orders.jsx'
import OrderForm from './pages/OrderForm.jsx'
import OrderDetail from './pages/OrderDetail.jsx'
import Production from './pages/Production.jsx'
import ProductionNew from './pages/ProductionNew.jsx'
import ProductionDetail from './pages/ProductionDetail.jsx'
import QA from './pages/QA.jsx'
import OrNumbers from './pages/OrNumbers.jsx'
import Reports from './pages/Reports.jsx'
import Imports from './pages/Imports.jsx'
import ImportDetail from './pages/ImportDetail.jsx'
import Lookups from './pages/Lookups.jsx'
import Users from './pages/Users.jsx'
import Account from './pages/Account.jsx'

function Guard({ perm, children }) {
  const { can } = useAuth()
  return can(perm) ? children : <Forbidden />
}

export default function App() {
  const { loading, session, profile, signOut } = useAuth()
  if (loading) return <div className="center-screen"><Loading /></div>
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
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<Guard perm="inventory.view"><Stock /></Guard>} />
        <Route path="inventory/items/new" element={<Guard perm="inventory.manage"><ItemForm /></Guard>} />
        <Route path="inventory/items/:id" element={<Guard perm="inventory.view"><ItemDetail /></Guard>} />
        <Route path="inventory/movements" element={<Guard perm="inventory.view"><Movements /></Guard>} />
        <Route path="inventory/counts" element={<Guard perm="inventory.view"><Counts /></Guard>} />
        <Route path="inventory/bundles" element={<Guard perm="inventory.view"><Bundles /></Guard>} />
        <Route path="orders" element={<Guard perm="orders.view"><Orders /></Guard>} />
        <Route path="orders/new" element={<Guard perm="orders.manage"><OrderForm /></Guard>} />
        <Route path="orders/:id" element={<Guard perm="orders.view"><OrderDetail /></Guard>} />
        <Route path="production" element={<Production />} />
        <Route path="production/new" element={<Guard perm="production.manage"><ProductionNew /></Guard>} />
        <Route path="production/:id" element={<ProductionDetail />} />
        <Route path="qa" element={<Guard perm="qa.view"><QA /></Guard>} />
        <Route path="or-numbers" element={<Guard perm="or.manage"><OrNumbers /></Guard>} />
        <Route path="reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
        <Route path="imports" element={<Guard perm="imports.manage"><Imports /></Guard>} />
        <Route path="imports/:id" element={<Guard perm="imports.manage"><ImportDetail /></Guard>} />
        <Route path="settings/lookups" element={<Guard perm="lookups.manage"><Lookups /></Guard>} />
        <Route path="users" element={<Guard perm="users.manage"><Users /></Guard>} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
