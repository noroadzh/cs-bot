import { Layout, Menu } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { clearCredentials, hasCredentials } from './auth.js';
import { LoginPage } from './pages/LoginPage.js';
import { AuditPage } from './pages/platform/AuditPage.js';
import { TenantDetailPage } from './pages/platform/TenantDetailPage.js';
import { TenantListPage } from './pages/platform/TenantListPage.js';
import { RegisterPage } from './pages/platform/RegisterPage.js';
import { BillingPage } from './pages/platform/BillingPage.js';
import { AssetsPage } from './pages/tenant/AssetsPage.js';
import { ConfigPage } from './pages/tenant/ConfigPage.js';
import { ImportDetailPage } from './pages/tenant/ImportDetailPage.js';
import { ImportListPage } from './pages/tenant/ImportListPage.js';
import { LicensePage } from './pages/tenant/LicensePage.js';
import { MissPage } from './pages/tenant/MissPage.js';
import { DashboardPage } from './pages/tenant/DashboardPage.js';
import { KnowledgePage } from './pages/tenant/KnowledgePage.js';
import { LearningPage } from './pages/tenant/LearningPage.js';
import { QualityPage } from './pages/tenant/QualityPage.js';
import { ArchivePage } from './pages/tenant/ArchivePage.js';
import { currentSurface } from './surface.js';

const TENANT_ITEMS = [
  { key: '/dashboard', label: <Link to="/dashboard">看板</Link> },
  { key: '/', label: <Link to="/">未命中</Link> },
  { key: '/learning', label: <Link to="/learning">学习</Link> },
  { key: '/quality', label: <Link to="/quality">质检</Link> },
  { key: '/archive', label: <Link to="/archive">存档</Link> },
  { key: '/knowledge', label: <Link to="/knowledge">知识库</Link> },
  { key: '/assets', label: <Link to="/assets">素材</Link> },
  { key: '/import', label: <Link to="/import">导入</Link> },
  { key: '/license', label: <Link to="/license">授权</Link> },
  { key: '/config', label: <Link to="/config">配置</Link> },
];

const PLATFORM_ITEMS = [
  { key: '/', label: <Link to="/">租户</Link> },
  { key: '/audit', label: <Link to="/audit">审计</Link> },
  { key: '/register', label: <Link to="/register">自助注册</Link> },
  { key: '/billing', label: <Link to="/billing">自助续费</Link> },
];

export function App() {
  const surface = currentSurface();
  const location = useLocation();
  const [ready, setReady] = useState(hasCredentials);

  useEffect(() => {
    const onDenied = () => setReady(false);
    window.addEventListener('csbot-unauthorized', onDenied);
    return () => window.removeEventListener('csbot-unauthorized', onDenied);
  }, []);

  const selfServePublic =
    surface === 'platform' &&
    (location.pathname === '/register' || location.pathname.startsWith('/billing'));

  if (!ready && !selfServePublic) return <LoginPage onReady={() => setReady(true)} />;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light">
        <Menu
          mode="inline"
          selectedKeys={[
            location.pathname.startsWith('/import')
              ? '/import'
              : location.pathname.startsWith('/tenants')
                ? '/'
                : location.pathname,
          ]}
          items={surface === 'platform' ? PLATFORM_ITEMS : TENANT_ITEMS}
        />
        <Menu
          mode="inline"
          items={[{
            key: 'logout',
            label: '退出',
            onClick: () => {
              clearCredentials();
              setReady(false);
            },
          }]}
        />
      </Layout.Sider>
      <Layout.Content style={{ padding: 24 }}>
        <Routes>
          {surface === 'platform' ? (
            <>
              <Route path="/" element={<TenantListPage />} />
              <Route path="/tenants/:id" element={<TenantDetailPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/billing/orders/:id" element={<BillingPage />} />
            </>
          ) : (
            <>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/" element={<MissPage />} />
              <Route path="/learning" element={<LearningPage />} />
              <Route path="/quality" element={<QualityPage />} />
              <Route path="/archive" element={<ArchivePage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/assets" element={<AssetsPage />} />
              <Route path="/import" element={<ImportListPage />} />
              <Route path="/import/:id" element={<ImportDetailPage />} />
              <Route path="/license" element={<LicensePage />} />
              <Route path="/config" element={<ConfigPage />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout.Content>
    </Layout>
  );
}
