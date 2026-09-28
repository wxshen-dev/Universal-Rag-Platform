import { Link, Outlet, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Documents' },
  { to: '/chunking', label: 'Chunking' },
  { to: '/retrieval', label: 'Retrieval' },
  { to: '/evaluation', label: 'Evaluation' },
  { to: '/settings', label: 'Settings' },
  { to: '/api-endpoints', label: 'API Endpoints' },
]

export function Layout() {
  const location = useLocation()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Knowledge Core</p>
          <h1>Knowledge Base Console</h1>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`sidebar-link ${location.pathname === item.to ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="dashboard">
        <Outlet />
      </main>
    </div>
  )
}
