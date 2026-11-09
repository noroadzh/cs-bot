import { Layout, Menu } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError } from './api.js';
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
import { UsersPage } from './pages/UsersPage.js';
import { RequestAuditPage } from './pages/RequestAuditPage.js';
import { currentSurface } from './surface.js';

type Role = 'admin' | 'operator' | 'unknown';

const TENANT_COPY: Record<string, { kicker: string; title: string }> = {
  '/dashboard': { kicker: '运营', title: '看板' },
  '/': { kicker: '问答', title: '未命中' },
  '/learning': { kicker: '问答', title: '学习' },
  '/quality': { kicker: '问答', title: '质检' },
  '/archive': { kicker: '问答', title: '存档' },
  '/knowledge': { kicker: '知识', title: '知识库' },
  '/assets': { kicker: '知识', title: '素材' },
  '/import': { kicker: '知识', title: '导入' },
  '/license': { kicker: '系统', title: '授权' },
  '/config': { kicker: '系统', title: '配置' },
  '/users': { kicker: '系统', title: '用户' },
  '/audit-logs': { kicker: '系统', title: '操作审计' },
};

const PLATFORM_COPY: Record<string, { kicker: string; title: string }> = {
  '/': { kicker: '平台', title: '租户' },
  '/audit': { kicker: '平台', title: '审计' },
  '/users': { kicker: '系统', title: '用户' },
  '/audit-logs': { kicker: '系统', title: '操作审计' },
  '/register': { kicker: '自助', title: '自助注册' },
  '/billing': { kicker: '自助', title: '自助续费' },
};

function pageCopy(surface: string, pathname: string) {
  const table = surface === 'platform' ? PLATFORM_COPY : TENANT_COPY;
  if (pathname.startsWith('/import/')) return TENANT_COPY['/import'];
  if (pathname.startsWith('/tenants/')) return { kicker: '平台', title: '租户详情' };
  if (pathname.startsWith('/billing')) return PLATFORM_COPY['/billing'];
  return table[pathname] ?? { kicker: surface === 'platform' ? '平台' : '运营', title: '运营台' };
}

export function App() {
  const surface = currentSurface();
  const location = useLocation();
  const [ready, setReady] = useState(hasCredentials);
  const [role, setRole] = useState<Role>('unknown');

  useEffect(() => {
    const onDenied = () => {
      setReady(false);
      setRole('unknown');
    };
    window.addEventListener('csbot-unauthorized', onDenied);
    return () => window.removeEventListener('csbot-unauthorized', onDenied);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const probe = surface === 'platform' ? '/platform/users' : '/admin/users';
    void api(probe)
      .then(() => setRole('admin'))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setRole('operator');
        else setRole('unknown');
      });
  }, [ready, surface]);

  const selfServePublic =
    surface === 'platform' &&
    (location.pathname === '/register' || location.pathname.startsWith('/billing'));

  const menuItems = useMemo(() => {
    if (surface === 'platform') {
      const items = [
        { key: '/', label: <Link to="/">租户</Link> },
        { key: '/audit', label: <Link to="/audit">审计</Link> },
        { key: '/register', label: <Link to="/register">自助注册</Link> },
        { key: '/billing', label: <Link to="/billing">自助续费</Link> },
      ];
      if (role === 'admin') {
        items.push(
          { key: '/users', label: <Link to="/users">用户</Link> },
          { key: '/audit-logs', label: <Link to="/audit-logs">操作审计</Link> },
        );
      }
      return items;
    }
    const items = [
      { key: '/dashboard', label: <Link to="/dashboard">看板</Link> },
      { key: '/', label: <Link to="/">未命中</Link> },
      { key: '/learning', label: <Link to="/learning">学习</Link> },
      { key: '/quality', label: <Link to="/quality">质检</Link> },
      { key: '/archive', label: <Link to="/archive">存档</Link> },
      { key: '/knowledge', label: <Link to="/knowledge">知识库</Link> },
      { key: '/assets', label: <Link to="/assets">素材</Link> },
      { key: '/import', label: <Link to="/import">导入</Link> },
    ];
    if (role === 'admin') {
      items.push(
        { key: '/license', label: <Link to="/license">授权</Link> },
        { key: '/config', label: <Link to="/config">配置</Link> },
        { key: '/users', label: <Link to="/users">用户</Link> },
        { key: '/audit-logs', label: <Link to="/audit-logs">操作审计</Link> },
      );
    }
    return items;
  }, [surface, role]);

  if (!ready && !selfServePublic) return <LoginPage onReady={() => setReady(true)} />;

  const copy = pageCopy(surface, location.pathname);

  return (
    <Layout className="console">
      <Layout.Sider width={220} theme="dark" className="console-sider">
        <div className="console-brand">
          <span className="console-mark">客</span>
          <div>
            <div className="console-brand-name">{surface === 'platform' ? 'SaaS 控制台' : '租户运营台'}</div>
            <div className="console-brand-sub">微信群客服</div>
          </div>
        </div>
        <Menu
          className="console-nav"
          theme="dark"
          mode="inline"
          selectedKeys={[
            location.pathname.startsWith('/import')
              ? '/import'
              : location.pathname.startsWith('/tenants')
                ? '/'
                : location.pathname.startsWith('/billing')
                  ? '/billing'
                  : location.pathname,
          ]}
          items={menuItems}
        />
        <button
          type="button"
          className="console-logout"
          onClick={() => {
            clearCredentials();
            setReady(false);
            setRole('unknown');
          }}
        >
          退出
        </button>
      </Layout.Sider>
      <Layout>
        <header className="console-top">
          <div>
            <p className="console-kicker">{copy.kicker}</p>
            <h1>{copy.title}</h1>
          </div>
        </header>
        <Layout.Content className="console-main">
          <Routes>
            {surface === 'platform' ? (
              <>
                <Route path="/" element={<TenantListPage />} />
                <Route path="/tenants/:id" element={<TenantDetailPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/audit-logs" element={<RequestAuditPage />} />
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
                <Route path="/users" element={<UsersPage />} />
                <Route path="/audit-logs" element={<RequestAuditPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
